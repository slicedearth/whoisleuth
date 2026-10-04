import { parseBoundedJson } from '../analysis/bounded-json.mts';
import { exact, enumeration, text, array, integer } from '../evidence/artifact-structure.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import {
  INTAKE_DISTRIBUTION_CHANNELS,
  MAX_INTAKE_INDICATORS,
  MAX_INTAKE_INDICATOR_CANDIDATES,
  type IntakeDistributionContext,
  type MessageIntakeReport,
  type CurrentMessageIntakeReport,
} from '../contracts/message-intake.mts';
import { canonicalIpAddress } from '../contracts/ip-address.mts';

export const INTAKE_CONTEXT_SCHEMA = 'whoisleuth.intake-context';
export const INTAKE_CONTEXT_VERSION = 1;
export const MAX_INTAKE_CONTEXT_BYTES = 8_192;

function label(value: unknown, name: string, maximum: number, nullable = true): string | null {
  if (nullable && (value === null || value === '')) return null;
  const result = text(value, name, maximum);
  if (!result.trim()) throw new TypeError(`${name} cannot be blank.`);
  if (/@|:\/\/|[?&][^\s=]+=/u.test(result))
    throw new TypeError(`${name} must be a non-sensitive label, not an address or exact URL.`);
  return result;
}

export function readIntakeDistributionContext(raw: unknown): IntakeDistributionContext | null {
  if (raw === null) return null;
  const input = exact(
    raw,
    ['channel', 'observedAt', 'sourceLabel', 'reference', 'observerLabel', 'vantageLabel'],
    'Supplied distribution context',
  );
  const observedAt =
    input.observedAt === null ? null : normalizeExplicitIsoTimestamp(input.observedAt);
  if (input.observedAt !== null && !observedAt)
    throw new TypeError('Declared observation time requires an explicit timezone.');
  return {
    channel: enumeration(input.channel, INTAKE_DISTRIBUTION_CHANNELS, 'Distribution channel'),
    observedAt,
    sourceLabel: label(input.sourceLabel, 'Context source label', 160, false)!,
    reference: label(input.reference, 'Context reference', 160),
    observerLabel: label(input.observerLabel, 'Observer label', 80),
    vantageLabel: label(input.vantageLabel, 'Vantage label', 80),
  };
}

export function parseIntakeContextInput(input: string): IntakeDistributionContext {
  const root = exact(
    parseBoundedJson(input, {
      label: 'Intake context input',
      maximumBytes: MAX_INTAKE_CONTEXT_BYTES,
    }),
    ['schema', 'version', 'context'],
    'Intake context input',
  );
  if (root.schema !== INTAKE_CONTEXT_SCHEMA || root.version !== INTAKE_CONTEXT_VERSION)
    throw new TypeError('Unsupported intake context schema or version.');
  const result = readIntakeDistributionContext(root.context);
  if (!result) throw new TypeError('Supply an explicit distribution context.');
  return result;
}

export function withIntakeDistributionContext(
  report: MessageIntakeReport,
  raw: unknown,
): CurrentMessageIntakeReport {
  if (report.schemaVersion !== 2)
    throw new TypeError(
      'Historical intake reports cannot acquire new declarations without a fresh review.',
    );
  return { ...report, distributionContext: readIntakeDistributionContext(raw) };
}

/** Validate only the versioned additions; this is not a general report importer. */
export function validateIntakeExtensions(report: MessageIntakeReport): void {
  if (report.schemaVersion === 1) {
    if (
      ['indicators', 'indicatorCoverage', 'distributionContext'].some((key) =>
        Object.hasOwn(report, key),
      )
    )
      throw new TypeError('Version-1 intake reports cannot declare version-2 evidence.');
    return;
  }
  if (report.schemaVersion !== 2) throw new TypeError('Unsupported intake report version.');
  const locations = new Set([
    'input',
    ...report.messageParts.map((part) => `message-${part.part}`),
    ...(report.documentReview?.parts.map((part) => part.id) ?? []),
  ]);
  array(report.indicators, 'Extracted indicators', MAX_INTAKE_INDICATORS).forEach((raw, index) => {
    const value = exact(
      raw,
      ['id', 'kind', 'value', 'source', 'location', 'basis'],
      'Extracted indicator',
    );
    const kind = enumeration(
      value.kind,
      ['ipv4', 'ipv6', 'md5', 'sha1', 'sha256'] as const,
      'Indicator kind',
    );
    const content = text(value.value, 'Indicator value', 64);
    const location = exact(value.location, ['partId', 'page'], 'Indicator location');
    if (
      value.id !== `indicator-${index + 1}` ||
      value.basis !== 'literal_text' ||
      !locations.has(String(location.partId))
    )
      throw new TypeError('Indicator source reference is not present in this review.');
    if (location.page !== null) integer(location.page, 'Indicator page', 1, 100_000);
    const source = enumeration(
      value.source,
      ['text', 'calendar', 'document_text'] as const,
      'Indicator source',
    );
    if (kind === 'ipv4' || kind === 'ipv6') {
      if (canonicalIpAddress(content) !== content || content.includes(':') !== (kind === 'ipv6'))
        throw new TypeError('Indicator IP address is not canonical.');
    } else if (
      !new RegExp(`^[a-f0-9]{${{ md5: 32, sha1: 40, sha256: 64 }[kind]}}$`, 'u').test(content)
    )
      throw new TypeError('Indicator hash is malformed.');
    const part = report.documentReview?.parts.find((part) => part.id === location.partId);
    if (part ? location.page !== part.page : location.page !== null)
      throw new TypeError('Indicator page does not match its source part.');
    const messageParts = report.messageParts.filter(
      (part) => `message-${part.part}` === location.partId,
    );
    const validSource =
      source === 'document_text'
        ? (report.source.kind === 'pdf' || report.source.kind === 'docx') && part?.kind === 'text'
        : report.source.kind === 'email'
          ? messageParts.length === 1
          : location.partId === 'input' && report.source.kind === source;
    if (!validSource)
      throw new TypeError('Indicator source kind does not match the reviewed text part.');
  });
  const coverage = exact(
    report.indicatorCoverage,
    ['state', 'candidatesReviewed'],
    'Indicator coverage',
  );
  enumeration(
    coverage.state,
    ['reviewed', 'partial', 'not_reviewed'] as const,
    'Indicator coverage',
  );
  const candidatesReviewed = integer(
    coverage.candidatesReviewed,
    'Indicator candidate count',
    0,
    MAX_INTAKE_INDICATOR_CANDIDATES,
  );
  if (
    candidatesReviewed < report.indicators.length ||
    (coverage.state === 'not_reviewed' && candidatesReviewed !== 0)
  )
    throw new TypeError('Indicator coverage contradicts the retained observations.');
  if (
    report.source.kind === 'identity' ||
    report.source.kind === 'har' ||
    report.source.kind === 'qr'
  ) {
    if (
      report.indicators.length ||
      coverage.state !== 'not_reviewed' ||
      coverage.candidatesReviewed !== 0
    )
      throw new TypeError(
        'This input keeps its existing sensitive-data projection; indicator text was not reviewed.',
      );
  }
  readIntakeDistributionContext(report.distributionContext);
}
