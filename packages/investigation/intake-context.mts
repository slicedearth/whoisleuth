import { parseBoundedJson } from '../analysis/bounded-json.mts';
import { exact, exactOptional, enumeration, text, array, integer } from '../evidence/artifact-structure.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import {
  INTAKE_DISTRIBUTION_CHANNELS,
  MAX_INTAKE_INDICATORS,
  MAX_INTAKE_INDICATOR_CANDIDATES,
  type IntakeDistributionContext,
  type MessageIntakeReport,
  type CurrentMessageIntakeReport,
  INTAKE_TEXT_BASES, INTAKE_PHONE_ROLES, MAX_INTAKE_URL_LENGTH,
  type MessageIntakeResult, type IntakePhoneDeclaration, type IntakeEvidenceDeclaration,
  type IntakeDestinationDeclaration, type IntakeDestinationPair, type IntakeSelectedEvidence,
  type IntakeSelectedPhone, type IntakeDestinationProjection,
} from '../contracts/message-intake.mts';
import { canonicalIpAddress } from '../contracts/ip-address.mts';
import { phoneCandidateValue, validatePhoneReview, MAX_SELECTED_INTAKE_PHONES, MAX_INTAKE_PHONE_CHARACTERS } from './intake-phones.mts';
import { compareIntakeDestinations, projectIntakeDestination } from './link-intake.mts';

export const INTAKE_CONTEXT_SCHEMA = 'whoisleuth.intake-context';
export const INTAKE_CONTEXT_VERSION = 1;
export const INTAKE_CONTEXT_SELECTION_VERSION = 2;
export const MAX_INTAKE_CONTEXT_BYTES = 8_192;
export const INTAKE_SELECTED_EVIDENCE_LIMITATIONS = [
  'Selected contact values are supplied candidates, not verified numbers, ownership, common control or independent corroboration.',
  'Source labels, roles, country context and observation times are analyst declarations; a digest identifies selected bytes, not authorship or capture time.',
  'Selected phone values and private source text are excluded from public and trusted Case summaries and are not mapped to STIX or MISP; use the deliberately selected private review only.',
  'Destination pairs compare supplied hostnames only. Exact entered URLs are not retained, redirects are not followed, and a mismatch does not establish phishing.',
] as const;

export type IntakeSelectedEvidenceInput = Readonly<{
  sourceDigestSha256: string;
  phones: readonly Readonly<{ start: number; end: number; declaration: IntakePhoneDeclaration }>[];
  destinationPair: Readonly<{ displayed: string; destination: string; displayedDeclaration: IntakeDestinationDeclaration; destinationDeclaration: IntakeDestinationDeclaration }> | null;
}>;

function label(value: unknown, name: string, maximum: number, nullable = true): string | null {
  if (nullable && (value === null || value === '')) return null;
  const result = text(value, name, maximum);
  if (!result.trim()) throw new TypeError(`${name} cannot be blank.`);
  if (/@|:\/\/|[?&][^\s=]+=/u.test(result))
    throw new TypeError(`${name} must be a non-sensitive label, not an address or exact URL.`);
  return result;
}

function declarationFields(input: Record<string, unknown>): IntakeEvidenceDeclaration {
  const observedAt = input.observedAt === null ? null : normalizeExplicitIsoTimestamp(input.observedAt);
  if (input.observedAt !== null && !observedAt) throw new TypeError('Declared observation time requires an explicit timezone.');
  const sourceLabel = label(input.sourceLabel, 'Selected evidence source label', 160, false)!;
  if (/\p{Cf}|\d[\d ()+\-\u00a0]{5,}\d/u.test(sourceLabel)) throw new TypeError('Use a non-sensitive source label, not a contact number or identifier.');
  return { sourceLabel, observedAt, basis: enumeration(input.basis, INTAKE_TEXT_BASES, 'Selected text basis') };
}

export function readIntakePhoneDeclaration(raw: unknown): IntakePhoneDeclaration {
  const input = exact(raw, ['sourceLabel', 'observedAt', 'basis', 'role', 'countryCallingCode'], 'Phone declaration');
  if (input.countryCallingCode !== null && (typeof input.countryCallingCode !== 'string' || !/^\+[1-9][0-9]{0,2}$/u.test(input.countryCallingCode))) throw new TypeError('Country calling context must be an explicitly supplied + prefix of one to three digits, or unknown.');
  return { ...declarationFields(input), role: enumeration(input.role, INTAKE_PHONE_ROLES, 'Phone role'), countryCallingCode: input.countryCallingCode as string | null };
}

function destinationDeclaration(raw: unknown, displayed: boolean): IntakeDestinationDeclaration {
  const input = exact(raw, ['sourceLabel', 'observedAt', 'basis', 'role'], 'Destination declaration');
  return { ...declarationFields(input), role: enumeration(input.role, displayed ? ['displayed_claim'] as const : ['claimed_landing', 'supplied_redirect'] as const, 'Destination evidence role') };
}

function phoneMeaning(original: string, declaration: IntakePhoneDeclaration) {
  const parsed = phoneCandidateValue(original);
  if (parsed.state === 'unsupported') throw new TypeError('Unsupported phone candidates cannot be selected.');
  const conflict = parsed.canonical && declaration.countryCallingCode && !parsed.canonical.startsWith(declaration.countryCallingCode);
  return { canonical: conflict ? null : parsed.canonical, extension: parsed.extension,
    state: conflict ? 'country_context_conflict' as const : parsed.state };
}

/** A deliberate projection: unselected candidates and exact paired URLs never enter the report. */
export function withIntakeSelectedEvidence(result: MessageIntakeResult, raw: unknown): CurrentMessageIntakeReport {
  if (result.report.schemaVersion !== 2) throw new TypeError('Historical intake reports require a fresh review before selecting evidence.');
  if (raw === null) {
    const { selectedEvidence: _removed, ...report } = result.report;
    return report;
  }
  const input = exact(raw, ['sourceDigestSha256', 'phones', 'destinationPair'], 'Selected intake evidence');
  if (input.sourceDigestSha256 !== result.report.source.digestSha256) throw new TypeError('Selected evidence does not identify this complete input digest.');
  validatePhoneReview(result);
  const phones: Array<Omit<IntakeSelectedPhone, 'occurrences'> & { occurrences: Array<{ original: string; start: number; end: number }> }> = [];
  const seenSpans = new Set<string>(), groups = new Map<string, number>();
  for (const rawSelection of array(input.phones, 'Selected phone spans', MAX_SELECTED_INTAKE_PHONES)) {
    const selection = exact(rawSelection, ['start', 'end', 'declaration'], 'Selected phone span');
    if (!result.phoneReview) throw new TypeError('Phone selections require a fresh plaintext review.');
    const start = integer(selection.start, 'Phone span start', 0, result.phoneReview.sourceTextLength), end = integer(selection.end, 'Phone span end', start + 1, result.phoneReview.sourceTextLength);
    const candidate = result.phoneReview.candidates.find(item => item.start === start && item.end === end);
    const span = `${start}:${end}`;
    if (!candidate || seenSpans.has(span)) throw new TypeError('Select each exact reviewed phone span at most once.');
    seenSpans.add(span);
    const declaration = readIntakePhoneDeclaration(selection.declaration), meaning = phoneMeaning(candidate.original, declaration);
    // Group only safely canonicalised equivalent observations; keep every exact source occurrence.
    const key = meaning.canonical ? JSON.stringify([meaning.canonical, meaning.extension, declaration]) : span;
    const occurrence = { original: candidate.original, start, end }, existing = groups.get(key);
    if (existing === undefined) { groups.set(key, phones.length); phones.push({ ...meaning, declaration, occurrences: [occurrence] }); }
    else phones[existing]!.occurrences.push(occurrence);
  }
  let destinationPair: IntakeDestinationPair | null = null;
  if (input.destinationPair !== null) {
    const pair = exact(input.destinationPair, ['displayed', 'destination', 'displayedDeclaration', 'destinationDeclaration'], 'Supplied destination pair');
    for (const value of [pair.displayed, pair.destination]) if (typeof value !== 'string' || value.length > MAX_INTAKE_URL_LENGTH) throw new TypeError('Supplied destination values exceed the bounded text limit.');
    const displayed = projectIntakeDestination(pair.displayed as string, true), destination = projectIntakeDestination(pair.destination as string, true);
    destinationPair = { displayed, destination, displayedDeclaration: destinationDeclaration(pair.displayedDeclaration, true), destinationDeclaration: destinationDeclaration(pair.destinationDeclaration, false), state: compareIntakeDestinations(displayed, destination) };
  }
  const selectedEvidence: IntakeSelectedEvidence = { version: 1, sourceDigestSha256: result.report.source.digestSha256,
    phoneCoverage: result.phoneReview ? { state: result.phoneReview.state, candidatesReviewed: result.phoneReview.candidatesReviewed, candidatesShown: result.phoneReview.candidates.length } : { state: 'not_reviewed', candidatesReviewed: 0, candidatesShown: 0 },
    sourceTextLength: result.phoneReview?.sourceTextLength ?? null, offsetUnit: 'utf16_code_unit', phones, destinationPair, limitations: [...INTAKE_SELECTED_EVIDENCE_LIMITATIONS] };
  const report = { ...result.report, selectedEvidence };
  validateIntakeSelectedEvidence(report);
  return report;
}

function validateDestinationProjection(raw: unknown): IntakeDestinationProjection {
  const input = exact(raw, ['state', 'hostname', 'origin', 'registrationDomain', 'hasPrivateLocation', 'normalisation'], 'Retained destination projection');
  enumeration(input.state, ['parsed', 'missing', 'unsupported'] as const, 'Destination state');
  if (typeof input.hasPrivateLocation !== 'boolean') throw new TypeError('Destination privacy state is malformed.');
  const flags = array(input.normalisation, 'Destination normalisation', 3);
  for (const flag of flags) enumeration(flag, ['assumed_https_for_hostname_parsing', 'refanged_scheme_or_authority', 'unicode_hostname_to_ascii'] as const, 'Destination normalisation');
  if (new Set(flags).size !== flags.length) throw new TypeError('Destination normalisation is duplicated.');
  if (input.state === 'parsed') {
    if (typeof input.origin !== 'string') throw new TypeError('Retained destination origin is malformed.');
    const parsed = projectIntakeDestination(input.origin);
    if (parsed.state !== 'parsed' || parsed.origin !== input.origin || parsed.hostname !== input.hostname || parsed.registrationDomain !== input.registrationDomain || parsed.hasPrivateLocation) throw new TypeError('Retained destinations must contain only a canonical origin and hostname.');
  } else if (input.hostname !== null || input.origin !== null || input.registrationDomain !== null || input.hasPrivateLocation || flags.length) throw new TypeError('An unavailable destination cannot declare parsed values.');
  return input as unknown as IntakeDestinationProjection;
}

export function validateIntakeSelectedEvidence(report: MessageIntakeReport): void {
  if (!Object.hasOwn(report, 'selectedEvidence')) return;
  if (report.schemaVersion !== 2) throw new TypeError('Selected evidence requires intake version 2.');
  const input = exact(report.selectedEvidence, ['version', 'sourceDigestSha256', 'sourceTextLength', 'phoneCoverage', 'offsetUnit', 'phones', 'destinationPair', 'limitations'], 'Retained selected evidence');
  if (input.version !== 1 || input.sourceDigestSha256 !== report.source.digestSha256 || input.offsetUnit !== 'utf16_code_unit') throw new TypeError('Unsupported selected-evidence version or source identity.');
  const sourceLength = input.sourceTextLength === null ? null : integer(input.sourceTextLength, 'Selected source text length', 0, report.source.byteLength);
  if (sourceLength !== null && report.source.kind !== 'text') throw new TypeError('Only plaintext has phone source spans.');
  const coverage = exact(input.phoneCoverage, ['state', 'candidatesReviewed', 'candidatesShown'], 'Retained phone coverage');
  enumeration(coverage.state, ['reviewed', 'partial', 'not_reviewed'] as const, 'Retained phone coverage');
  const reviewed = integer(coverage.candidatesReviewed, 'Reviewed phone candidates', 0, MAX_INTAKE_INDICATOR_CANDIDATES), shown = integer(coverage.candidatesShown, 'Shown phone candidates', 0, MAX_INTAKE_INDICATORS);
  if (reviewed < shown || (coverage.state === 'not_reviewed' ? sourceLength !== null || reviewed !== 0 || shown !== 0 : sourceLength === null)) throw new TypeError('Retained phone coverage is inconsistent.');
  let occurrences = 0;
  const spans = new Set<string>();
  for (const rawPhone of array(input.phones, 'Retained phone groups', MAX_SELECTED_INTAKE_PHONES)) {
    if (report.source.kind !== 'text' || sourceLength === null) throw new TypeError('Retained phones require plaintext source identity.');
    const phone = exact(rawPhone, ['canonical', 'extension', 'state', 'declaration', 'occurrences'], 'Retained phone');
    const declaration = readIntakePhoneDeclaration(phone.declaration);
    for (const rawOccurrence of array(phone.occurrences, 'Retained phone occurrences', MAX_SELECTED_INTAKE_PHONES, 1)) {
      if (++occurrences > MAX_SELECTED_INTAKE_PHONES) throw new TypeError('Selected phone occurrences exceed their aggregate limit.');
      const occurrence = exact(rawOccurrence, ['original', 'start', 'end'], 'Retained phone occurrence');
      const start = integer(occurrence.start, 'Phone span start', 0, sourceLength), end = integer(occurrence.end, 'Phone span end', start + 1, sourceLength);
      if (typeof occurrence.original !== 'string' || occurrence.original.length !== end - start || occurrence.original.length > MAX_INTAKE_PHONE_CHARACTERS || spans.has(`${start}:${end}`)) throw new TypeError('Retained phone occurrence is malformed or duplicated.');
      spans.add(`${start}:${end}`);
      const parsed = phoneMeaning(occurrence.original, declaration);
      if (phone.canonical !== parsed.canonical || phone.extension !== parsed.extension || phone.state !== parsed.state) throw new TypeError('Retained phone meaning contradicts its original text or declaration.');
    }
    if (phone.canonical === null && (phone.occurrences as unknown[]).length !== 1) throw new TypeError('Ambiguous phone occurrences cannot be merged.');
  }
  if (occurrences > shown) throw new TypeError('Selected phone occurrences exceed the reviewed candidates.');
  if (input.destinationPair !== null) {
    const pair = exact(input.destinationPair, ['displayed', 'destination', 'displayedDeclaration', 'destinationDeclaration', 'state'], 'Retained destination pair');
    const displayed = validateDestinationProjection(pair.displayed), destination = validateDestinationProjection(pair.destination);
    destinationDeclaration(pair.displayedDeclaration, true); destinationDeclaration(pair.destinationDeclaration, false);
    if (pair.state !== compareIntakeDestinations(displayed, destination)) throw new TypeError('Destination comparison contradicts its retained hosts.');
  }
  if (JSON.stringify(input.limitations) !== JSON.stringify(INTAKE_SELECTED_EVIDENCE_LIMITATIONS)) throw new TypeError('Selected evidence must retain its privacy and source limitations.');
}

/** Existing v1 context remains supported; v2 selections are bound to the current transient review. */
export function applyIntakeContextInput(result: MessageIntakeResult, input: string): CurrentMessageIntakeReport {
  const parsed = parseBoundedJson(input, { label: 'Intake context input', maximumBytes: MAX_INTAKE_CONTEXT_BYTES });
  const root = exactOptional(parsed, ['schema', 'version', 'context'], ['review'], 'Intake context input');
  if (root.schema !== INTAKE_CONTEXT_SCHEMA) throw new TypeError('Unsupported intake context schema.');
  if (root.version === 1) return withIntakeDistributionContext(result.report, parseIntakeContextInput(input));
  if (root.version !== INTAKE_CONTEXT_SELECTION_VERSION) throw new TypeError('Unsupported intake context version.');
  const report = withIntakeDistributionContext(result.report, root.context);
  return Object.hasOwn(root, 'review') ? withIntakeSelectedEvidence({ ...result, report }, root.review) : report;
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
      ['indicators', 'indicatorCoverage', 'distributionContext', 'selectedEvidence'].some((key) =>
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
  validateIntakeSelectedEvidence(report);
}
