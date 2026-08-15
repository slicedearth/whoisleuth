import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';

import {
  canonicalArtifactJsonV2,
  SORTED_JSON_V2,
} from '../packages/evidence/artifact-integrity.mts';
import {
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_VERSION,
  DOMAIN_CONTROL_MANIFEST_SCHEMA,
  MAX_CANONICAL_DOMAIN_CONTROL_RECORDS,
  MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES,
} from '../packages/contracts/domain-control-manifest.mts';
import {
  assertDomainControlManifestByteBudget,
  buildUnsignedDomainControlManifest,
  canonicalDomainControlRecordList,
  normalizeDomainControlManifestDocument,
  type DomainControlManifestDocument,
  type DomainControlManifestEntry,
} from '../packages/evidence/domain-control-runtime.mts';
import { exactKeys } from './bounded-contract-normalizers.mts';
import { normalizeExplicitIsoTimestamp, normalizeLegacyIsoTimestamp } from '../packages/evidence/observation.mts';

export {
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_VERSION,
};
export const DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA = 'whoisleuth.domain-control-review-input';
export const DOMAIN_CONTROL_REVIEW_SCHEMA = 'whoisleuth.domain-control-review';
export const DOMAIN_CONTROL_REVIEW_VERSION = 1;
export const MAX_DOMAIN_CONTROL_ENTRIES = MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES;
export const MAX_DOMAIN_CONTROL_RECORDS = MAX_CANONICAL_DOMAIN_CONTROL_RECORDS;

const REVIEW_INPUT_KEYS = new Set(['schema', 'version', 'manifest', 'observations']);
const OBSERVATION_KEYS = new Set(['domain', 'fields']);
const OBSERVATION_FIELDS = new Set(['nameservers', 'ds', 'mx', 'caa', 'tlsIssuer', 'tlsSpkiSha256', 'registrarLock']);
const OBSERVATION_FIELD_KEYS = new Set(['state', 'values', 'source', 'observedAt']);
type UnknownRecord = Record<string, unknown>;
type DomainControlField = 'nameservers' | 'ds' | 'mx' | 'caa' | 'tlsIssuer' | 'tlsSpkiSha256' | 'registrarLock';
type ObservationState = 'observed' | 'partial' | 'unavailable' | 'unsupported';
type ComparisonState = 'aligned' | 'drift' | 'partial' | 'unavailable' | 'unsupported' | 'not_configured';

export type DomainControlEntry = DomainControlManifestEntry;
export type DomainControlManifest = DomainControlManifestDocument;
type CurrentDomainControlManifest = DomainControlManifest & Readonly<{ version: typeof DOMAIN_CONTROL_MANIFEST_VERSION }>;

type NormalizedObservationField = Readonly<{
  state: ObservationState;
  values: readonly string[];
  source: string;
  observedAt: string | null;
}>;

type DomainControlObservation = Readonly<{
  domain: string;
  fields: Readonly<Partial<Record<DomainControlField, NormalizedObservationField>>>;
}>;

export type DomainControlComparison = Readonly<{
  field: DomainControlField | 'renewalReviewAt';
  state: ComparisonState | 'due';
  desired: readonly string[];
  observed: readonly string[];
  source: string | null;
  observedAt: string | null;
  explanation: string;
}>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function boundedText(value: unknown, maximum = 300): string | null {
  if (typeof value !== 'string' || value.length > maximum * 4 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximum) || null;
}

function timestamp(value: unknown, legacy = false): string | null {
  const text = boundedText(value, 64);
  return text
    ? normalizeExplicitIsoTimestamp(text) ?? (legacy ? normalizeLegacyIsoTimestamp(text) : null)
    : null;
}

function domain(value: unknown): string | null {
  const text = boundedText(value, 253)?.toLowerCase().replace(/\.$/u, '');
  if (!text) return null;
  const ascii = domainToASCII(text);
  if (!ascii || ascii.length > 253 || ascii.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) return null;
  return ascii;
}

function hostnameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, MAX_DOMAIN_CONTROL_RECORDS * 4)
    .map(domain)
    .filter((item): item is string => item !== null))]
    .sort()
    .slice(0, MAX_DOMAIN_CONTROL_RECORDS);
}

function textList(value: unknown, maximum = 300): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, MAX_DOMAIN_CONTROL_RECORDS * 4)
    .map((item) => boundedText(item, maximum)?.toLowerCase() ?? null)
    .filter((item): item is string => item !== null))]
    .sort()
    .slice(0, MAX_DOMAIN_CONTROL_RECORDS);
}

function spkiFingerprint(value: unknown): string | null {
  const text = boundedText(value, 64)?.toLowerCase();
  return text && /^[a-f0-9]{64}$/u.test(text) ? text : null;
}

export function buildDomainControlManifest(
  input: unknown,
  generatedAtValue = new Date().toISOString(),
): CurrentDomainControlManifest {
  const unsigned = buildUnsignedDomainControlManifest(input, generatedAtValue);
  const manifest = Object.freeze({
    ...unsigned,
    integrity: Object.freeze({
      algorithm: 'SHA-256',
      canonicalization: SORTED_JSON_V2,
      digestSha256: `sha256:${createHash('sha256').update(canonicalArtifactJsonV2(unsigned)).digest('hex')}`,
    }),
  }) as CurrentDomainControlManifest;
  assertDomainControlManifestByteBudget(manifest);
  return manifest;
}

export function verifyDomainControlManifest(value: unknown): DomainControlManifest {
  const normalized = normalizeDomainControlManifestDocument(value);
  if (`sha256:${createHash('sha256').update(normalized.canonicalUnsigned).digest('hex')}` !== normalized.manifest.integrity.digestSha256) {
    throw new TypeError('Domain control manifest failed its SHA-256 integrity check.');
  }
  return normalized.manifest;
}

function fieldValues(field: DomainControlField, value: unknown): string[] {
  if (field === 'nameservers') return hostnameList(value);
  if (field === 'mx' || field === 'caa' || field === 'ds') return canonicalDomainControlRecordList(Array.isArray(value) ? value : [value], field);
  if (field === 'tlsSpkiSha256') {
    const normalized = Array.isArray(value) ? value.map(spkiFingerprint).filter(Boolean) : [spkiFingerprint(value)].filter(Boolean);
    return [...new Set(normalized as string[])].sort().slice(0, MAX_DOMAIN_CONTROL_RECORDS);
  }
  if (field === 'registrarLock') {
    const values = Array.isArray(value) ? value : [value];
    return [...new Set(values.filter((item): item is string => item === 'required' || item === 'not_required'))];
  }
  return textList(Array.isArray(value) ? value : [value], 500);
}

function normalizeObservation(value: unknown): DomainControlObservation | null {
  const source = record(value);
  const normalizedDomain = domain(source?.domain);
  const rawFields = record(source?.fields);
  if (!source || !normalizedDomain || !rawFields) return null;
  exactKeys(source, OBSERVATION_KEYS, 'Domain control observation');
  exactKeys(rawFields, OBSERVATION_FIELDS, 'Domain control observation fields');
  const fields: Partial<Record<DomainControlField, NormalizedObservationField>> = {};
  for (const field of ['nameservers', 'ds', 'mx', 'caa', 'tlsIssuer', 'tlsSpkiSha256', 'registrarLock'] as const) {
    const raw = record(rawFields[field]);
    if (!raw) continue;
    exactKeys(raw, OBSERVATION_FIELD_KEYS, `Domain control observation field ${field}`);
    const state = raw.state;
    if (state !== 'observed' && state !== 'partial' && state !== 'unavailable' && state !== 'unsupported') return null;
    const sourceLabel = boundedText(raw.source, 120);
    if (!sourceLabel) return null;
    fields[field] = Object.freeze({
      state,
      values: Object.freeze(fieldValues(field, raw.values)),
      source: sourceLabel,
      observedAt: timestamp(raw.observedAt, true),
    });
  }
  return Object.freeze({ domain: normalizedDomain, fields: Object.freeze(fields) });
}

function desiredValues(entry: DomainControlEntry, field: DomainControlField): string[] {
  if (field === 'tlsIssuer') return entry.tlsIssuer ? [entry.tlsIssuer] : [];
  if (field === 'tlsSpkiSha256') return entry.tlsSpkiSha256 ? [entry.tlsSpkiSha256] : [];
  if (field === 'registrarLock') return entry.registrarLock ? [entry.registrarLock] : [];
  return [...entry[field]];
}

function compareField(entry: DomainControlEntry, observation: DomainControlObservation | null, field: DomainControlField): DomainControlComparison {
  const desired = desiredValues(entry, field);
  if (!desired.length) return Object.freeze({
    field, state: 'not_configured', desired: Object.freeze([]), observed: Object.freeze([]), source: null, observedAt: null,
    explanation: 'No desired value was configured for this field.',
  });
  const evidence = observation?.fields[field];
  if (!evidence) return Object.freeze({
    field, state: 'unavailable', desired: Object.freeze(desired), observed: Object.freeze([]), source: null, observedAt: null,
    explanation: 'No separately attributed observation was supplied for this field.',
  });
  if (evidence.state !== 'observed') return Object.freeze({
    field,
    state: evidence.state,
    desired: Object.freeze(desired),
    observed: evidence.values,
    source: evidence.source,
    observedAt: evidence.observedAt,
    explanation: evidence.state === 'partial'
      ? 'The supplied observation was partial, so a difference is inconclusive.'
      : `The supplied source reported this field as ${evidence.state}.`,
  });
  const aligned = desired.length === evidence.values.length && desired.every((item, index) => item === evidence.values[index]);
  return Object.freeze({
    field,
    state: aligned ? 'aligned' : 'drift',
    desired: Object.freeze(desired),
    observed: evidence.values,
    source: evidence.source,
    observedAt: evidence.observedAt,
    explanation: aligned
      ? 'The complete supplied observation matches the desired value.'
      : 'The complete supplied observation differs from the desired value.',
  });
}

function renewalComparison(entry: DomainControlEntry, now: string): DomainControlComparison {
  if (!entry.renewalReviewAt) return Object.freeze({
    field: 'renewalReviewAt', state: 'not_configured', desired: Object.freeze([]), observed: Object.freeze([]), source: null, observedAt: null,
    explanation: 'No renewal review date was configured.',
  });
  const due = Date.parse(entry.renewalReviewAt) <= Date.parse(now);
  return Object.freeze({
    field: 'renewalReviewAt', state: due ? 'due' : 'aligned', desired: Object.freeze([entry.renewalReviewAt]), observed: Object.freeze([]), source: null, observedAt: null,
    explanation: due ? 'The configured renewal review date is due.' : 'The configured renewal review date is still in the future.',
  });
}

export function reviewDomainControlManifest(input: unknown, generatedAtValue = new Date().toISOString()) {
  const source = record(input);
  if (!source || source.schema !== DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA || source.version !== 1) {
    throw new TypeError(`Domain control review input must use ${DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA} version 1.`);
  }
  exactKeys(source, REVIEW_INPUT_KEYS, 'Domain control review input');
  const generatedAt = timestamp(generatedAtValue);
  if (!generatedAt) throw new TypeError('Domain control review time must be valid and include an explicit timezone.');
  const manifest = verifyDomainControlManifest(source.manifest);
  if (!Array.isArray(source.observations) || source.observations.length > MAX_DOMAIN_CONTROL_ENTRIES * 2) {
    throw new TypeError('Domain control observations must be a bounded array.');
  }
  const observations = source.observations.map(normalizeObservation);
  if (observations.some((item) => item === null)) throw new TypeError('Domain control review contains an invalid observation.');
  const normalizedObservations = observations as DomainControlObservation[];
  if (new Set(normalizedObservations.map((item) => item.domain)).size !== normalizedObservations.length) {
    throw new TypeError('Domain control observations must use unique domains.');
  }
  const observationMap = new Map(normalizedObservations.map((item) => [item.domain, item]));
  const fields = ['nameservers', 'ds', 'mx', 'caa', 'tlsIssuer', 'tlsSpkiSha256', 'registrarLock'] as const;
  const domains = manifest.entries.map((entry) => {
    const observation = observationMap.get(entry.domain) ?? null;
    const comparisons = [...fields.map((field) => compareField(entry, observation, field)), renewalComparison(entry, generatedAt)];
    const state = comparisons.some((item) => item.state === 'drift' || item.state === 'due')
      ? 'drift'
      : comparisons.some((item) => item.state === 'partial' || item.state === 'unavailable' || item.state === 'unsupported')
        ? 'partial'
        : 'aligned';
    return Object.freeze({ domain: entry.domain, state, comparisons: Object.freeze(comparisons) });
  });
  const comparisons = domains.flatMap((item) => item.comparisons);
  const counts = Object.fromEntries(['aligned', 'drift', 'partial', 'unavailable', 'unsupported', 'not_configured', 'due']
    .map((state) => [state, comparisons.filter((item) => item.state === state).length]));
  const expired = Date.parse(manifest.expiresAt) <= Date.parse(generatedAt);
  return Object.freeze({
    schema: DOMAIN_CONTROL_REVIEW_SCHEMA,
    version: DOMAIN_CONTROL_REVIEW_VERSION,
    generatedAt,
    state: expired ? 'expired' : domains.some((item) => item.state === 'drift') ? 'drift' : domains.some((item) => item.state === 'partial') ? 'partial' : 'aligned',
    manifest: Object.freeze({
      generatedAt: manifest.generatedAt,
      expiresAt: manifest.expiresAt,
      digestSha256: manifest.integrity.digestSha256,
      expired,
    }),
    counts: Object.freeze(counts),
    domains: Object.freeze(domains),
    ignoredObservationCount: normalizedObservations.filter((item) => !manifest.entries.some((entry) => entry.domain === item.domain)).length,
    limitations: Object.freeze([
      'This local review compares analyst-authored desired state with separately supplied observations and performs no collection or configuration change.',
      'Only complete observations can produce drift. Partial, unavailable, unsupported, or missing evidence remains inconclusive.',
      'A valid manifest digest or signature establishes file integrity, not the correctness of the desired state or supplied observations.',
    ]),
  });
}

export function formatDomainControlResult(value: DomainControlManifest | ReturnType<typeof reviewDomainControlManifest>): string {
  if (value.schema === DOMAIN_CONTROL_MANIFEST_SCHEMA) {
    return [
      'Domain control manifest',
      `Domains  ${value.entries.length}`,
      `Expires  ${value.expiresAt}`,
      `Digest   ${value.integrity.digestSha256}`,
      '',
      'The manifest records desired state only and performs no collection or configuration change.',
      '',
    ].join('\n');
  }
  return [
    'Domain control review',
    `State    ${value.state}`,
    `Domains  ${value.domains.length}`,
    `Drift    ${value.counts.drift ?? 0}`,
    `Partial  ${(value.counts.partial ?? 0) + (value.counts.unavailable ?? 0) + (value.counts.unsupported ?? 0)}`,
    `Due      ${value.counts.due ?? 0}`,
    '',
    ...value.domains.map((item) => `${item.domain}  ${item.state}`),
    '',
    ...value.limitations.map((item) => `Limitation: ${item}`),
    '',
  ].join('\n');
}
