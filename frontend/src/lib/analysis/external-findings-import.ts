import {
  normalizeDomain,
  openOrCreateCase,
  updateCase,
  type CaseRecord,
} from './case-model.ts';
import { normalizeExplicitIsoTimestamp, normalizeLegacyIsoTimestamp } from '../../../../packages/evidence/observation.mts';

export const EXTERNAL_FINDINGS_SCHEMA = 'whoisleuth.external-findings';
export const EXTERNAL_FINDINGS_VERSION = 4;
export const MAX_EXTERNAL_FINDINGS_IMPORT_BYTES = 384 * 1024;
export const MAX_EXTERNAL_FINDINGS = 100;
export const MAX_EXTERNAL_FINDINGS_PER_DOMAIN = 20;
export const MAX_EXTERNAL_FINDING_DOMAINS = 25;

export const EXTERNAL_FINDING_CATEGORIES = [
  'certificate',
  'dns',
  'http',
  'malware',
  'other',
  'page',
  'registration',
  'reputation',
] as const;
export type ExternalFindingCategory = typeof EXTERNAL_FINDING_CATEGORIES[number];
export type ExternalFindingEvidenceClass = 'deployment_observation' | 'provider_report';
export type ExternalFindingStructuredObservation = Readonly<{
  sourceSchema:
    | 'whoisleuth.domain-observation-rows'
    | 'whoisleuth.dns-observation-rows'
    | 'whoisleuth.certificate-observation-rows';
  sourceVersion: 1;
  field: string;
  value: string;
  issuer: string | null;
  notAfter: string | null;
  eventId: string | null;
  logId: string | null;
  certificateSha256: string | null;
  dnsNameCount: number | null;
  namesComplete: boolean | null;
}>;

export type ExternalFinding = Readonly<{
  domain: string;
  category: ExternalFindingCategory;
  evidenceClass: ExternalFindingEvidenceClass;
  summary: string;
  observedAt: string;
  completeness: 'complete' | 'inconclusive' | 'partial' | 'unknown';
  limitations: readonly string[];
  reference: string | null;
  structuredObservation: ExternalFindingStructuredObservation | null;
}>;

export type ExternalFindingsDocument = Readonly<{
  schema: typeof EXTERNAL_FINDINGS_SCHEMA;
  schemaVersion: typeof EXTERNAL_FINDINGS_VERSION;
  source: Readonly<{
    name: string;
    reference: string | null;
    collectedAt: string | null;
  }>;
  findings: readonly ExternalFinding[];
}>;

export type ExternalFindingsMergeResult = Readonly<{
  cases: CaseRecord[];
  casesCreated: number;
  casesUpdated: number;
  findingsAdded: number;
  duplicatesSkipped: number;
}>;

const CATEGORIES = new Set<string>(EXTERNAL_FINDING_CATEGORIES);
const COMPLETENESS = new Set(['complete', 'inconclusive', 'partial', 'unknown']);
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const ROOT_KEYS = new Set(['schema', 'schemaVersion', 'source', 'findings']);
const SOURCE_KEYS = new Set(['name', 'reference', 'collectedAt']);
const FINDING_KEYS = new Set([
  'domain',
  'category',
  'evidenceClass',
  'summary',
  'observedAt',
  'completeness',
  'limitations',
  'reference',
  'structuredObservation',
]);
const STRUCTURED_OBSERVATION_KEYS = new Set([
  'sourceSchema',
  'sourceVersion',
  'field',
  'value',
  'issuer',
  'notAfter',
  'eventId',
  'logId',
  'certificateSha256',
  'dnsNameCount',
  'namesComplete',
]);
const STRUCTURED_OBSERVATION_SCHEMAS = new Set([
  'whoisleuth.domain-observation-rows',
  'whoisleuth.dns-observation-rows',
  'whoisleuth.certificate-observation-rows',
]);
const SHA256_RE = /^[a-f0-9]{64}$/u;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function requiredText(value: unknown, maximum: number, label: string): string {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.length > maximum
    || CONTROL_RE.test(value)
  ) {
    throw new Error(`${label} must be non-empty, bounded text without control characters.`);
  }
  return value.trim();
}

function optionalText(value: unknown, maximum: number, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, maximum, label);
}

function iso(value: unknown, label: string, optional = false, legacy = false): string | null {
  if (optional && (value === undefined || value === null || value === '')) return null;
  const text = requiredText(value, 64, label);
  const normalized = normalizeExplicitIsoTimestamp(text)
    ?? (legacy ? normalizeLegacyIsoTimestamp(text) : null);
  if (!normalized) throw new Error(`${label} must be a valid date and time with an explicit timezone.`);
  return normalized;
}

function limitations(value: unknown, index: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) {
    throw new Error(`Finding ${index + 1} limitations must be an array with no more than 8 entries.`);
  }
  const unique = new Set<string>();
  for (const item of value) unique.add(requiredText(item, 240, `Finding ${index + 1} limitation`));
  return [...unique];
}

function structuredObservation(value: unknown, index: number, documentVersion: number): ExternalFindingStructuredObservation | null {
  if (value === undefined || value === null) return null;
  const item = record(value);
  if (!item || !hasOnlyKeys(item, STRUCTURED_OBSERVATION_KEYS)) {
    throw new Error(`Finding ${index + 1} structured observation has an invalid shape or additional fields.`);
  }
  if (typeof item.sourceSchema !== 'string' || !STRUCTURED_OBSERVATION_SCHEMAS.has(item.sourceSchema)) {
    throw new Error(`Finding ${index + 1} structured observation source schema is unsupported.`);
  }
  if (item.sourceVersion !== 1) {
    throw new Error(`Finding ${index + 1} structured observation source version is unsupported.`);
  }
  const field = requiredText(item.field, 40, `Finding ${index + 1} structured observation field`);
  const observationValue = requiredText(item.value, 500, `Finding ${index + 1} structured observation value`);
  const issuer = optionalText(item.issuer, 160, `Finding ${index + 1} certificate issuer`);
  const notAfter = iso(
    item.notAfter,
    `Finding ${index + 1} certificate expiry`,
    true,
    documentVersion < EXTERNAL_FINDINGS_VERSION,
  );
  const certificateSchema = item.sourceSchema === 'whoisleuth.certificate-observation-rows';
  if (certificateSchema && (field === 'certificateSha256' || field === 'fingerprintSha256') && !SHA256_RE.test(observationValue.toLowerCase())) {
    throw new Error(`Finding ${index + 1} certificate observation value must be a SHA-256 hexadecimal digest.`);
  }
  if (!certificateSchema && (issuer !== null || notAfter !== null)) {
    throw new Error(`Finding ${index + 1} non-certificate observation cannot declare certificate metadata.`);
  }
  const declaresEventMetadata = ['eventId', 'logId', 'certificateSha256', 'dnsNameCount', 'namesComplete']
    .some((key) => item[key] !== undefined && item[key] !== null);
  let eventId: string | null = null;
  let logId: string | null = null;
  let certificateSha256: string | null = null;
  let dnsNameCount: number | null = null;
  let namesComplete: boolean | null = null;
  if (declaresEventMetadata) {
    if (!certificateSchema || documentVersion < 4) {
      throw new Error(`Finding ${index + 1} certificate-event metadata requires external-findings schema version 4.`);
    }
    eventId = requiredText(item.eventId, 64, `Finding ${index + 1} certificate event id`);
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(eventId)) {
      throw new Error(`Finding ${index + 1} certificate event id is invalid.`);
    }
    logId = requiredText(item.logId, 200, `Finding ${index + 1} certificate log id`);
    certificateSha256 = requiredText(item.certificateSha256, 64, `Finding ${index + 1} certificate digest`).toLowerCase();
    if (!SHA256_RE.test(certificateSha256)) {
      throw new Error(`Finding ${index + 1} certificate event digest must be a SHA-256 hexadecimal digest.`);
    }
    if (certificateSha256 !== observationValue.toLowerCase()) {
      throw new Error(`Finding ${index + 1} certificate event digest must match the structured observation value.`);
    }
    if (!Number.isSafeInteger(item.dnsNameCount) || Number(item.dnsNameCount) < 1 || Number(item.dnsNameCount) > 100) {
      throw new Error(`Finding ${index + 1} certificate DNS name count is invalid.`);
    }
    dnsNameCount = Number(item.dnsNameCount);
    if (typeof item.namesComplete !== 'boolean') {
      throw new Error(`Finding ${index + 1} certificate name completeness is invalid.`);
    }
    namesComplete = item.namesComplete;
  }
  return {
    sourceSchema: item.sourceSchema as ExternalFindingStructuredObservation['sourceSchema'],
    sourceVersion: 1,
    field,
    value: observationValue,
    issuer,
    notAfter,
    eventId,
    logId,
    certificateSha256,
    dnsNameCount,
    namesComplete,
  };
}

function findingKey(finding: ExternalFinding, sourceName: string): string {
  return [
    finding.domain,
    finding.category,
    finding.evidenceClass,
    finding.summary,
    finding.observedAt,
    finding.completeness,
    sourceName,
    finding.structuredObservation?.eventId ?? '',
  ].join('\u0000');
}

export function parseExternalFindingsDocument(value: unknown): ExternalFindingsDocument {
  const root = record(value);
  if (!root || !hasOnlyKeys(root, ROOT_KEYS)) {
    throw new Error('External findings must use the documented object shape without additional top-level fields.');
  }
  if (
    root.schema !== EXTERNAL_FINDINGS_SCHEMA
    || ![1, 2, 3, EXTERNAL_FINDINGS_VERSION].includes(Number(root.schemaVersion))
  ) {
    throw new Error(`External findings must use ${EXTERNAL_FINDINGS_SCHEMA} schema version 1, 2, 3, or ${EXTERNAL_FINDINGS_VERSION}.`);
  }
  const documentVersion = Number(root.schemaVersion);
  const legacyTimestamps = documentVersion < EXTERNAL_FINDINGS_VERSION;
  const sourceValue = record(root.source);
  if (!sourceValue || !hasOnlyKeys(sourceValue, SOURCE_KEYS)) {
    throw new Error('External findings require a bounded source object without additional fields.');
  }
  const source = {
    name: requiredText(sourceValue.name, 80, 'Source name'),
    reference: optionalText(sourceValue.reference, 500, 'Source reference'),
    collectedAt: iso(sourceValue.collectedAt, 'Source collection time', true, legacyTimestamps),
  };
  if (!Array.isArray(root.findings) || !root.findings.length || root.findings.length > MAX_EXTERNAL_FINDINGS) {
    throw new Error(`External findings must contain between 1 and ${MAX_EXTERNAL_FINDINGS} findings.`);
  }

  const normalized: ExternalFinding[] = [];
  const seen = new Set<string>();
  const domainCounts = new Map<string, number>();
  for (const [index, raw] of root.findings.entries()) {
    const item = record(raw);
    if (!item || !hasOnlyKeys(item, FINDING_KEYS)) {
      throw new Error(`Finding ${index + 1} has an invalid shape or additional fields.`);
    }
    const domainInput = requiredText(item.domain, 253, `Finding ${index + 1} domain`);
    const domain = normalizeDomain(domainInput);
    if (!domain) throw new Error(`Finding ${index + 1} domain is invalid.`);
    if (typeof item.category !== 'string' || !CATEGORIES.has(item.category)) {
      throw new Error(`Finding ${index + 1} category is unsupported.`);
    }
    if (typeof item.completeness !== 'string' || !COMPLETENESS.has(item.completeness)) {
      throw new Error(`Finding ${index + 1} completeness is unsupported.`);
    }
    const evidenceClass = item.evidenceClass === undefined && root.schemaVersion === 1
      ? 'provider_report'
      : item.evidenceClass;
    if (evidenceClass !== 'deployment_observation' && evidenceClass !== 'provider_report') {
      throw new Error(`Finding ${index + 1} evidence class is unsupported.`);
    }
    const finding: ExternalFinding = {
      domain,
      category: item.category as ExternalFindingCategory,
      evidenceClass,
      summary: requiredText(item.summary, 900, `Finding ${index + 1} summary`),
      observedAt: iso(item.observedAt, `Finding ${index + 1} observation time`, false, legacyTimestamps) as string,
      completeness: item.completeness as ExternalFinding['completeness'],
      limitations: limitations(item.limitations, index),
      reference: optionalText(item.reference, 500, `Finding ${index + 1} reference`),
      structuredObservation: structuredObservation(item.structuredObservation, index, documentVersion),
    };
    const key = findingKey(finding, source.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const count = (domainCounts.get(domain) ?? 0) + 1;
    if (count > MAX_EXTERNAL_FINDINGS_PER_DOMAIN) {
      throw new Error(`External findings exceed the ${MAX_EXTERNAL_FINDINGS_PER_DOMAIN}-finding per-domain limit.`);
    }
    domainCounts.set(domain, count);
    if (domainCounts.size > MAX_EXTERNAL_FINDING_DOMAINS) {
      throw new Error(`External findings exceed the ${MAX_EXTERNAL_FINDING_DOMAINS}-domain limit.`);
    }
    normalized.push(finding);
  }
  if (!normalized.length) throw new Error('External findings did not contain a unique valid finding.');

  return {
    schema: EXTERNAL_FINDINGS_SCHEMA,
    schemaVersion: EXTERNAL_FINDINGS_VERSION,
    source,
    findings: normalized,
  };
}

function pinValue(finding: ExternalFinding): string {
  return finding.reference
    ? `${finding.summary} Reference: ${finding.reference}`
    : finding.summary;
}

function importedSourceLabel(finding: ExternalFinding, sourceName: string): string {
  return finding.evidenceClass === 'deployment_observation'
    ? `Deployment observation: ${sourceName}`
    : `Provider report: ${sourceName}`;
}

function existingPinKey(recordValue: CaseRecord, finding: ExternalFinding, sourceName: string): string {
  const expectedLabel = `External ${finding.category} finding`;
  const expectedValue = finding.structuredObservation?.value ?? pinValue(finding);
  const expectedSource = importedSourceLabel(finding, sourceName);
  const observation = finding.structuredObservation;
  return recordValue.evidencePins.some((pin) => (
    pin.label === expectedLabel
    && pin.value === expectedValue
    && pin.source === expectedSource
    && pin.observedAt === finding.observedAt
    && pin.completeness === finding.completeness
    && (!observation || (
      pin.field === observation.field
      && pin.sourceSchema?.collection === 'external_observations'
      && pin.sourceSchema.schema === observation.sourceSchema
      && pin.sourceSchema.version === observation.sourceVersion
      && (observation.eventId === null || pin.certificateObservation?.eventId === observation.eventId)
    ))
  )) ? findingKey(finding, sourceName) : '';
}

function structuredPinFields(finding: ExternalFinding): Record<string, unknown> {
  const observation = finding.structuredObservation;
  if (!observation) return {};
  const certificateObservation = observation.eventId
    && observation.logId
    && observation.certificateSha256
    && observation.dnsNameCount !== null
    && observation.namesComplete !== null
    ? {
        eventId: observation.eventId,
        logId: observation.logId,
        certificateSha256: observation.certificateSha256,
        issuer: observation.issuer,
        notAfter: observation.notAfter,
        dnsNameCount: observation.dnsNameCount,
        namesComplete: observation.namesComplete,
      }
    : null;
  return {
    field: observation.field,
    category: finding.category,
    sourceSchema: {
      collection: 'external_observations',
      schema: observation.sourceSchema,
      version: observation.sourceVersion,
    },
    certificateObservation,
  };
}

export function mergeExternalFindingsIntoCases(
  current: readonly CaseRecord[],
  document: ExternalFindingsDocument,
  now: string = new Date().toISOString(),
): ExternalFindingsMergeResult {
  let cases = [...current];
  const createdDomains = new Set<string>();
  const updatedDomains = new Set<string>();
  let findingsAdded = 0;
  let duplicatesSkipped = 0;

  for (const finding of document.findings) {
    const existing = cases.find((candidate) => candidate.domain === finding.domain) ?? null;
    const opened = openOrCreateCase(cases, { domain: finding.domain, source: 'import' }, now);
    cases = opened.cases;
    const target = cases.find((candidate) => candidate.id === opened.record.id) ?? opened.record;
    if (existingPinKey(target, finding, document.source.name)) {
      duplicatesSkipped += 1;
      continue;
    }
    const sourceLimitations = [
      finding.evidenceClass === 'deployment_observation'
        ? `Imported as an observation made by ${document.source.name}; this browser session did not collect or independently verify it.`
        : `Reported by ${document.source.name}; WHOISleuth did not collect or independently verify this provider finding.`,
      ...(document.source.reference ? [`Source reference: ${document.source.reference}`] : []),
      ...finding.limitations,
    ];
    const existingPinIds = new Set(target.evidencePins.map((pin) => pin.id));
    const updated = updateCase(cases, target.id, {
      evidencePin: {
        ...structuredPinFields(finding),
        label: `External ${finding.category} finding`,
        value: finding.structuredObservation?.value ?? pinValue(finding),
        source: importedSourceLabel(finding, document.source.name),
        observedAt: finding.observedAt,
        completeness: finding.completeness,
        limitations: sourceLimitations,
      },
    }, now);
    cases = updated.cases;
    const addedPin = updated.record.evidencePins.find((pin) => !existingPinIds.has(pin.id)) ?? null;
    if (addedPin) {
      cases = updateCase(cases, updated.record.id, {
        sighting: {
          state: finding.evidenceClass === 'deployment_observation'
            ? 'observed_by_deployment'
            : 'reported_by_provider',
          category: finding.category === 'dns'
            ? 'delegation'
            : finding.category === 'certificate'
              ? 'certificate'
              : finding.category === 'registration'
                ? 'registration'
                : finding.category === 'http' || finding.category === 'page'
                  ? 'website'
                  : 'other',
          source: document.source.name,
          observedAt: finding.observedAt,
          completeness: finding.completeness,
          evidencePinId: addedPin.id,
          limitations: sourceLimitations,
        },
      }, now).cases;
    }
    findingsAdded += 1;
    if (existing) updatedDomains.add(finding.domain);
    else createdDomains.add(finding.domain);
  }

  return {
    cases,
    casesCreated: createdDomains.size,
    casesUpdated: updatedDomains.size,
    findingsAdded,
    duplicatesSkipped,
  };
}
