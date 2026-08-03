import {
  normalizeDomain,
  openOrCreateCase,
  updateCase,
  type CaseRecord,
} from './case-model.ts';

export const EXTERNAL_FINDINGS_SCHEMA = 'whoisleuth.external-findings';
export const EXTERNAL_FINDINGS_VERSION = 2;
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

export type ExternalFinding = Readonly<{
  domain: string;
  category: ExternalFindingCategory;
  evidenceClass: ExternalFindingEvidenceClass;
  summary: string;
  observedAt: string;
  completeness: 'complete' | 'inconclusive' | 'partial' | 'unknown';
  limitations: readonly string[];
  reference: string | null;
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
]);

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

function iso(value: unknown, label: string, optional = false): string | null {
  if (optional && (value === undefined || value === null || value === '')) return null;
  const text = requiredText(value, 64, label);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date and time.`);
  return new Date(parsed).toISOString();
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

function findingKey(finding: ExternalFinding, sourceName: string): string {
  return [
    finding.domain,
    finding.category,
    finding.evidenceClass,
    finding.summary,
    finding.observedAt,
    finding.completeness,
    sourceName,
  ].join('\u0000');
}

export function parseExternalFindingsDocument(value: unknown): ExternalFindingsDocument {
  const root = record(value);
  if (!root || !hasOnlyKeys(root, ROOT_KEYS)) {
    throw new Error('External findings must use the documented object shape without additional top-level fields.');
  }
  if (root.schema !== EXTERNAL_FINDINGS_SCHEMA || (root.schemaVersion !== 1 && root.schemaVersion !== EXTERNAL_FINDINGS_VERSION)) {
    throw new Error(`External findings must use ${EXTERNAL_FINDINGS_SCHEMA} schema version 1 or ${EXTERNAL_FINDINGS_VERSION}.`);
  }
  const sourceValue = record(root.source);
  if (!sourceValue || !hasOnlyKeys(sourceValue, SOURCE_KEYS)) {
    throw new Error('External findings require a bounded source object without additional fields.');
  }
  const source = {
    name: requiredText(sourceValue.name, 80, 'Source name'),
    reference: optionalText(sourceValue.reference, 500, 'Source reference'),
    collectedAt: iso(sourceValue.collectedAt, 'Source collection time', true),
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
      observedAt: iso(item.observedAt, `Finding ${index + 1} observation time`) as string,
      completeness: item.completeness as ExternalFinding['completeness'],
      limitations: limitations(item.limitations, index),
      reference: optionalText(item.reference, 500, `Finding ${index + 1} reference`),
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
  const expectedValue = pinValue(finding);
  const expectedSource = importedSourceLabel(finding, sourceName);
  return recordValue.evidencePins.some((pin) => (
    pin.label === expectedLabel
    && pin.value === expectedValue
    && pin.source === expectedSource
    && pin.observedAt === finding.observedAt
    && pin.completeness === finding.completeness
  )) ? findingKey(finding, sourceName) : '';
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
    const updated = updateCase(cases, target.id, {
      evidencePin: {
        label: `External ${finding.category} finding`,
        value: pinValue(finding),
        source: importedSourceLabel(finding, document.source.name),
        observedAt: finding.observedAt,
        completeness: finding.completeness,
        limitations: sourceLimitations,
      },
    }, now);
    cases = updated.cases;
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
