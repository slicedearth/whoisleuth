import { domainToASCII } from 'node:url';

import {
  exactKeys,
  requireBoundedString,
  requireIsoTimestamp,
  requireRecord,
} from '../lib/bounded-contract-normalizers.mts';
import {
  EXTERNAL_FINDING_CATEGORIES,
  MAX_EXTERNAL_FINDINGS,
  MAX_EXTERNAL_FINDINGS_PER_DOMAIN,
  MAX_EXTERNAL_FINDING_DOMAINS,
  parseExternalFindingsDocument,
  type ExternalFindingCategory,
  type ExternalFindingEvidenceClass,
} from '../frontend/src/lib/analysis/external-findings-import.ts';

export const EXTERNAL_OBSERVATION_MAPPING_SCHEMA = 'whoisleuth.external-observation-mapping';
export const EXTERNAL_OBSERVATION_MAPPING_VERSION = 1;
export const MAX_EXTERNAL_OBSERVATION_MAPPING_BYTES = 4 * 1024 * 1024;
export const MAX_EXTERNAL_OBSERVATION_RECORDS = 500;

const ROOT_KEYS = new Set(['schema', 'version', 'source', 'profile', 'records']);
const SOURCE_KEYS = new Set(['name', 'reference', 'collectedAt']);
const PROFILE_KEYS = new Set([
  'id', 'version', 'domainField', 'summaryField', 'observedAtField', 'referenceField',
  'completenessField', 'category', 'evidenceClass', 'limitations',
]);
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,7}$/u;
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const COMPLETENESS = new Set(['complete', 'inconclusive', 'partial', 'unknown']);
const CATEGORIES = new Set<string>(EXTERNAL_FINDING_CATEGORIES);

function optionalText(value: unknown, label: string, maximum: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireBoundedString(value, label, maximum);
}

function path(value: unknown, label: string, optional = false): string | null {
  if (optional && (value === undefined || value === null || value === '')) return null;
  const candidate = requireBoundedString(value, label, 200);
  if (!PATH_RE.test(candidate) || candidate.split('.').some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment))) {
    throw new TypeError(`${label} must be a safe bounded dotted field path.`);
  }
  return candidate;
}

function readPath(value: unknown, fieldPath: string): unknown {
  let current = value;
  for (const segment of fieldPath.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function domain(value: unknown, label: string): string {
  const supplied = requireBoundedString(value, label, 253).trim().toLowerCase().replace(/^\*\./u, '').replace(/\.$/u, '');
  const ascii = domainToASCII(supplied).toLowerCase();
  if (!ascii || ascii.length > 253 || !ascii.includes('.') || ascii.split('.').some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(part))) {
    throw new TypeError(`${label} must resolve to a valid DNS name.`);
  }
  return ascii;
}

function limitations(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 8) throw new TypeError('profile.limitations must contain no more than 8 entries.');
  return Object.freeze([...new Set(value.map((entry, index) => requireBoundedString(entry, `profile.limitations[${index}]`, 240)))]);
}

export function mapExternalObservations(inputRaw: unknown) {
  const input = requireRecord(inputRaw, 'External observation mapping');
  if (input.schema !== EXTERNAL_OBSERVATION_MAPPING_SCHEMA || input.version !== EXTERNAL_OBSERVATION_MAPPING_VERSION) {
    throw new TypeError(`External observation mapping must use ${EXTERNAL_OBSERVATION_MAPPING_SCHEMA} version ${EXTERNAL_OBSERVATION_MAPPING_VERSION}.`);
  }
  exactKeys(input, ROOT_KEYS, 'External observation mapping');
  const sourceInput = requireRecord(input.source, 'source');
  exactKeys(sourceInput, SOURCE_KEYS, 'source');
  const profileInput = requireRecord(input.profile, 'profile');
  exactKeys(profileInput, PROFILE_KEYS, 'profile');
  const profile = Object.freeze({
    id: requireBoundedString(profileInput.id, 'profile.id', 80),
    version: Number(profileInput.version),
    domainField: path(profileInput.domainField, 'profile.domainField') as string,
    summaryField: path(profileInput.summaryField, 'profile.summaryField') as string,
    observedAtField: path(profileInput.observedAtField, 'profile.observedAtField') as string,
    referenceField: path(profileInput.referenceField, 'profile.referenceField', true),
    completenessField: path(profileInput.completenessField, 'profile.completenessField', true),
    category: profileInput.category,
    evidenceClass: profileInput.evidenceClass,
    limitations: limitations(profileInput.limitations),
  });
  if (!Number.isSafeInteger(profile.version) || profile.version < 1 || profile.version > 1_000) throw new TypeError('profile.version is invalid.');
  if (typeof profile.category !== 'string' || !CATEGORIES.has(profile.category)) throw new TypeError('profile.category is unsupported.');
  if (profile.evidenceClass !== 'deployment_observation' && profile.evidenceClass !== 'provider_report') throw new TypeError('profile.evidenceClass is unsupported.');
  if (!Array.isArray(input.records) || input.records.length < 1 || input.records.length > MAX_EXTERNAL_OBSERVATION_RECORDS) {
    throw new TypeError(`records must contain between 1 and ${MAX_EXTERNAL_OBSERVATION_RECORDS} entries.`);
  }
  const source = Object.freeze({
    name: requireBoundedString(sourceInput.name, 'source.name', 80),
    reference: optionalText(sourceInput.reference, 'source.reference', 500),
    collectedAt: sourceInput.collectedAt === null || sourceInput.collectedAt === undefined
      ? null
      : requireIsoTimestamp(sourceInput.collectedAt, 'source.collectedAt'),
  });
  const candidates = input.records.map((record, index) => {
    const domainValue = domain(readPath(record, profile.domainField), `records[${index}].${profile.domainField}`);
    const summary = requireBoundedString(readPath(record, profile.summaryField), `records[${index}].${profile.summaryField}`, 900);
    const observedAt = requireIsoTimestamp(readPath(record, profile.observedAtField), `records[${index}].${profile.observedAtField}`);
    const completenessValue = profile.completenessField ? readPath(record, profile.completenessField) : 'unknown';
    if (typeof completenessValue !== 'string' || !COMPLETENESS.has(completenessValue)) {
      throw new TypeError(`records[${index}] completeness is unsupported.`);
    }
    return Object.freeze({
      domain: domainValue,
      category: profile.category as ExternalFindingCategory,
      evidenceClass: profile.evidenceClass as ExternalFindingEvidenceClass,
      summary,
      observedAt,
      completeness: completenessValue as 'complete' | 'inconclusive' | 'partial' | 'unknown',
      limitations: profile.limitations,
      reference: profile.referenceField
        ? optionalText(readPath(record, profile.referenceField), `records[${index}].${profile.referenceField}`, 500)
        : null,
      structuredObservation: null,
    });
  }).sort((left, right) => left.domain.localeCompare(right.domain) || left.observedAt.localeCompare(right.observedAt) || left.summary.localeCompare(right.summary));
  const selected: typeof candidates = [];
  const seen = new Set<string>();
  const domainCounts = new Map<string, number>();
  const domains = new Set<string>();
  for (const finding of candidates) {
    const key = `${finding.domain}\u0000${finding.category}\u0000${finding.summary}\u0000${finding.observedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!domains.has(finding.domain) && domains.size >= MAX_EXTERNAL_FINDING_DOMAINS) continue;
    const count = domainCounts.get(finding.domain) ?? 0;
    if (count >= MAX_EXTERNAL_FINDINGS_PER_DOMAIN) continue;
    if (selected.length >= MAX_EXTERNAL_FINDINGS) continue;
    domains.add(finding.domain);
    domainCounts.set(finding.domain, count + 1);
    selected.push(finding);
  }
  const truncated = selected.length < seen.size;
  const document = {
    schema: 'whoisleuth.external-findings',
    schemaVersion: 3,
    source,
    findings: selected.map((finding) => ({
      ...finding,
      limitations: [
        ...finding.limitations,
        `Mapped locally with declarative profile ${profile.id} version ${profile.version}; the profile does not verify the upstream field semantics.`,
        ...(truncated ? ['The supplied records exceeded the browser import boundary; only the first deterministic bounded findings were retained.'] : []),
      ].slice(0, 8),
    })),
  };
  return parseExternalFindingsDocument(document);
}

export function formatExternalObservationMapping(document: ReturnType<typeof mapExternalObservations>): string {
  return [
    'External observation mapping',
    `Source    ${document.source.name}`,
    `Findings  ${document.findings.length}`,
    `Domains   ${new Set(document.findings.map((finding) => finding.domain)).size}`,
    '',
    'The JSON form can be deliberately imported through the Console external-findings workflow.',
    '',
  ].join('\n');
}
