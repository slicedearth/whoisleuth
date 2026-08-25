import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';

import {
  canonicalArtifactJsonFor,
} from '../packages/evidence/artifact-integrity.mts';
import {
  DOMAIN_CONTROL_MANIFEST_CURRENT_CANONICALIZATION,
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_VERSION,
  DOMAIN_CONTROL_MANIFEST_SCHEMA,
  DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR,
  MAX_DOMAIN_CONTROL_CAA_PRESENTATION_LENGTH,
  MAX_CANONICAL_DOMAIN_CONTROL_RECORDS,
  MAX_DOMAIN_CONTROL_DS_PRESENTATION_LENGTH,
  MAX_DOMAIN_CONTROL_INPUT_RECORDS,
  MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES,
  MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH,
} from '../packages/contracts/domain-control-manifest.mts';
import {
  DOMAIN_CONTROL_REVIEW_FIELDS,
  DOMAIN_CONTROL_REVIEW_COMPARISON_KEYS,
  DOMAIN_CONTROL_REVIEW_COUNT_KEYS,
  DOMAIN_CONTROL_REVIEW_DOMAIN_KEYS,
  DOMAIN_CONTROL_REVIEW_INPUT_KEYS,
  DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  DOMAIN_CONTROL_REVIEW_LIMITATIONS,
  DOMAIN_CONTROL_REVIEW_MANIFEST_SUMMARY_KEYS,
  DOMAIN_CONTROL_REVIEW_OBSERVATION_FIELD_KEYS,
  DOMAIN_CONTROL_REVIEW_OBSERVATION_KEYS,
  DOMAIN_CONTROL_REVIEW_ROOT_KEYS,
  DOMAIN_CONTROL_REVIEW_SCHEMA,
  DOMAIN_CONTROL_REVIEW_VERSION,
  MAX_DOMAIN_CONTROL_REVIEW_OBSERVATIONS,
  MAX_DOMAIN_CONTROL_REVIEW_SOURCE_LENGTH,
  MAX_DOMAIN_CONTROL_REVIEW_TEXT_LENGTH,
  type DomainControlReviewComparison,
  type DomainControlReviewObservationState,
} from '../packages/contracts/domain-control-review.mts';
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
  DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  DOMAIN_CONTROL_REVIEW_SCHEMA,
  DOMAIN_CONTROL_REVIEW_VERSION,
};
export const MAX_DOMAIN_CONTROL_ENTRIES = MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES;
export const MAX_DOMAIN_CONTROL_RECORDS = MAX_CANONICAL_DOMAIN_CONTROL_RECORDS;

const REVIEW_INPUT_KEYS = new Set<string>(DOMAIN_CONTROL_REVIEW_INPUT_KEYS);
const OBSERVATION_KEYS = new Set<string>(DOMAIN_CONTROL_REVIEW_OBSERVATION_KEYS);
const OBSERVATION_FIELDS = new Set<string>(DOMAIN_CONTROL_REVIEW_FIELDS);
const OBSERVATION_FIELD_KEYS = new Set<string>(DOMAIN_CONTROL_REVIEW_OBSERVATION_FIELD_KEYS);
const REVIEW_ROOT_KEYS = new Set<string>(DOMAIN_CONTROL_REVIEW_ROOT_KEYS);
const REVIEW_MANIFEST_KEYS = new Set<string>(DOMAIN_CONTROL_REVIEW_MANIFEST_SUMMARY_KEYS);
const REVIEW_COUNT_KEYS = new Set<string>(DOMAIN_CONTROL_REVIEW_COUNT_KEYS);
const REVIEW_DOMAIN_KEYS = new Set<string>(DOMAIN_CONTROL_REVIEW_DOMAIN_KEYS);
const REVIEW_COMPARISON_KEYS = new Set<string>(DOMAIN_CONTROL_REVIEW_COMPARISON_KEYS);
type UnknownRecord = Record<string, unknown>;
type DomainControlField = typeof DOMAIN_CONTROL_REVIEW_FIELDS[number];
type ObservationState = DomainControlReviewObservationState;

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

export type DomainControlComparison = DomainControlReviewComparison;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function exactReviewRecord(
  value: unknown,
  keys: ReadonlySet<string>,
  label: string,
): Readonly<UnknownRecord> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${label} must be an object.`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} must be an ordinary object.`);
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.size
      || ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))) {
      throw new TypeError(`${label} must use its exact registered fields.`);
    }
    const result: UnknownRecord = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError(`${label}.${key} must be an enumerable data field.`);
      }
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch (cause) {
    if (cause instanceof TypeError && cause.message.startsWith(label)) throw cause;
    throw new TypeError(`${label} must be an ordinary object.`);
  }
}

function exactReviewText(value: unknown, maximum: number, label: string): string {
  const normalized = boundedText(value, maximum);
  if (!normalized || normalized !== value) {
    throw new TypeError(`${label} must be a canonical bounded string.`);
  }
  return normalized;
}

function exactReviewTimestamp(value: unknown, label: string): string {
  const normalized = timestamp(value);
  if (!normalized || normalized !== value) throw new TypeError(`${label} must be a canonical timestamp.`);
  return normalized;
}

function exactReviewInteger(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new TypeError(`${label} must be a bounded non-negative integer.`);
  }
  return Number(value);
}

function exactReviewStringArray(
  value: unknown,
  maximumItems: number,
  maximumCharacters: number,
  label: string,
): readonly string[] {
  const input = boundedDataArray(value, maximumItems);
  if (!input) throw new TypeError(`${label} must be a bounded array.`);
  const output = input.map((item, index) => exactReviewText(item, maximumCharacters, `${label}[${index}]`));
  if (new Set(output).size !== output.length
    || output.some((item, index) => index > 0 && output[index - 1]! >= item)) {
    throw new TypeError(`${label} must contain unique canonically ordered values.`);
  }
  return Object.freeze(output);
}

function boundedText(value: unknown, maximum = 300): string | null {
  if (typeof value !== 'string'
    || value.length > maximum * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR
    || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximum) || null;
}

function timestamp(value: unknown, legacy = false): string | null {
  if (typeof value !== 'string'
    || value.length > MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR
    || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const text = value.replace(/\s+/gu, ' ').trim();
  if (!text || text.length > MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH) return null;
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

function hostnameList(value: readonly unknown[]): string[] {
  return [...new Set(value
    .map(domain)
    .filter((item): item is string => item !== null))]
    .sort()
    .slice(0, MAX_DOMAIN_CONTROL_RECORDS);
}

function textList(value: readonly unknown[], maximum = 300): string[] {
  return [...new Set(value
    .map((item) => boundedText(item, maximum)?.toLowerCase() ?? null)
    .filter((item): item is string => item !== null))]
    .sort()
    .slice(0, MAX_DOMAIN_CONTROL_RECORDS);
}

function spkiFingerprint(value: unknown): string | null {
  if (typeof value !== 'string'
    || value.length > 64 * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR
    || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const text = value.trim().toLowerCase();
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
      canonicalization: DOMAIN_CONTROL_MANIFEST_CURRENT_CANONICALIZATION,
      digestSha256: `sha256:${createHash('sha256').update(canonicalArtifactJsonFor(unsigned, DOMAIN_CONTROL_MANIFEST_CURRENT_CANONICALIZATION)).digest('hex')}`,
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

function boundedDataArray(value: unknown, maximum: number): readonly unknown[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    if (Object.getOwnPropertyDescriptor(value, Symbol.iterator)
      || Object.getOwnPropertyDescriptor(value, 'toJSON')) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor && !lengthDescriptor.enumerable && 'value' in lengthDescriptor
      ? lengthDescriptor.value
      : null;
    if (!Number.isSafeInteger(length)
      || Number(length) < 0
      || Number(length) > maximum) return null;
    const boundedLength = Number(length);
    const keys = Reflect.ownKeys(value);
    if (keys.length !== boundedLength + 1 || !keys.includes('length')) return null;
    const result: unknown[] = [];
    for (let index = 0; index < boundedLength; index += 1) {
      const key = String(index);
      if (!keys.includes(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

function fieldValues(field: DomainControlField, value: readonly unknown[]): string[] | null {
  if (field === 'nameservers') {
    const normalized = value.map(domain);
    return normalized.some((item) => item === null)
      ? null
      : hostnameList(normalized);
  }
  if (field === 'mx' || field === 'caa' || field === 'ds') {
    const normalized = value.flatMap((item) => canonicalDomainControlRecordList([item], field));
    return normalized.length === value.length
      ? [...new Set(normalized)].sort().slice(0, MAX_DOMAIN_CONTROL_RECORDS)
      : null;
  }
  if (field === 'tlsSpkiSha256') {
    const normalized = value.map(spkiFingerprint);
    return normalized.some((item) => item === null)
      ? null
      : [...new Set(normalized as string[])].sort().slice(0, MAX_DOMAIN_CONTROL_RECORDS);
  }
  if (field === 'registrarLock') {
    return value.every((item) => item === 'required' || item === 'not_required')
      ? [...new Set(value as Array<'required' | 'not_required'>)].sort()
      : null;
  }
  const normalized = value.map((item) => boundedText(item, MAX_DOMAIN_CONTROL_REVIEW_TEXT_LENGTH)?.toLowerCase() ?? null);
  return normalized.some((item) => item === null)
    ? null
    : textList(normalized, MAX_DOMAIN_CONTROL_REVIEW_TEXT_LENGTH);
}

function normalizeObservation(value: unknown): DomainControlObservation | null {
  const source = record(value);
  const normalizedDomain = domain(source?.domain);
  const rawFields = record(source?.fields);
  if (!source || !normalizedDomain || !rawFields) return null;
  exactKeys(source, OBSERVATION_KEYS, 'Domain control observation');
  exactKeys(rawFields, OBSERVATION_FIELDS, 'Domain control observation fields');
  const fields: Partial<Record<DomainControlField, NormalizedObservationField>> = {};
  for (const field of DOMAIN_CONTROL_REVIEW_FIELDS) {
    if (!Object.hasOwn(rawFields, field)) continue;
    const raw = record(rawFields[field]);
    if (!raw) return null;
    exactKeys(raw, OBSERVATION_FIELD_KEYS, `Domain control observation field ${field}`);
    if (!DOMAIN_CONTROL_REVIEW_OBSERVATION_FIELD_KEYS.every((key) => Object.hasOwn(raw, key))) return null;
    const state = raw.state;
    if (state !== 'observed' && state !== 'partial' && state !== 'unavailable' && state !== 'unsupported') return null;
    const sourceLabel = boundedText(raw.source, MAX_DOMAIN_CONTROL_REVIEW_SOURCE_LENGTH);
    const values = boundedDataArray(raw.values, MAX_DOMAIN_CONTROL_INPUT_RECORDS);
    if (!sourceLabel || !values) return null;
    const normalizedValues = fieldValues(field, values);
    const observedAt = raw.observedAt === null ? null : timestamp(raw.observedAt, true);
    if (!normalizedValues || (raw.observedAt !== null && !observedAt)) return null;
    fields[field] = Object.freeze({
      state,
      values: Object.freeze(normalizedValues),
      source: sourceLabel,
      observedAt,
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
  if (!source || source.schema !== DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA || source.version !== DOMAIN_CONTROL_REVIEW_VERSION) {
    throw new TypeError(`Domain control review input must use ${DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA} version ${DOMAIN_CONTROL_REVIEW_VERSION}.`);
  }
  exactKeys(source, REVIEW_INPUT_KEYS, 'Domain control review input');
  const generatedAt = timestamp(generatedAtValue);
  if (!generatedAt) throw new TypeError('Domain control review time must be valid and include an explicit timezone.');
  const manifest = verifyDomainControlManifest(source.manifest);
  const rawObservations = boundedDataArray(source.observations, MAX_DOMAIN_CONTROL_REVIEW_OBSERVATIONS);
  if (!rawObservations) {
    throw new TypeError('Domain control observations must be a bounded array.');
  }
  const observations = rawObservations.map(normalizeObservation);
  if (observations.some((item) => item === null)) throw new TypeError('Domain control review contains an invalid observation.');
  const normalizedObservations = observations as DomainControlObservation[];
  if (new Set(normalizedObservations.map((item) => item.domain)).size !== normalizedObservations.length) {
    throw new TypeError('Domain control observations must use unique domains.');
  }
  const observationMap = new Map(normalizedObservations.map((item) => [item.domain, item]));
  const fields = DOMAIN_CONTROL_REVIEW_FIELDS;
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
    limitations: DOMAIN_CONTROL_REVIEW_LIMITATIONS,
  });
}

export function validateDomainControlReviewDocument(
  value: unknown,
): ReturnType<typeof reviewDomainControlManifest> {
  const root = exactReviewRecord(value, REVIEW_ROOT_KEYS, 'Domain control review document');
  if (root.schema !== DOMAIN_CONTROL_REVIEW_SCHEMA || root.version !== DOMAIN_CONTROL_REVIEW_VERSION) {
    throw new TypeError(`Domain control review document must use ${DOMAIN_CONTROL_REVIEW_SCHEMA} version ${DOMAIN_CONTROL_REVIEW_VERSION}.`);
  }
  const generatedAt = exactReviewTimestamp(root.generatedAt, 'Domain control review document generatedAt');
  const manifestInput = exactReviewRecord(root.manifest, REVIEW_MANIFEST_KEYS, 'Domain control review document manifest');
  const manifestGeneratedAt = exactReviewTimestamp(manifestInput.generatedAt, 'Domain control review document manifest generatedAt');
  const expiresAt = exactReviewTimestamp(manifestInput.expiresAt, 'Domain control review document manifest expiresAt');
  if (typeof manifestInput.digestSha256 !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(manifestInput.digestSha256)) {
    throw new TypeError('Domain control review document manifest digest is invalid.');
  }
  const expired = Date.parse(expiresAt) <= Date.parse(generatedAt);
  if (manifestInput.expired !== expired) {
    throw new TypeError('Domain control review document manifest currentness is inconsistent.');
  }
  const manifest = Object.freeze({
    generatedAt: manifestGeneratedAt,
    expiresAt,
    digestSha256: manifestInput.digestSha256,
    expired,
  });

  const countInput = exactReviewRecord(root.counts, REVIEW_COUNT_KEYS, 'Domain control review document counts');
  const maximumComparisons = MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES * (DOMAIN_CONTROL_REVIEW_FIELDS.length + 1);
  const suppliedCounts = Object.fromEntries(DOMAIN_CONTROL_REVIEW_COUNT_KEYS.map((state) => [
    state,
    exactReviewInteger(countInput[state], maximumComparisons, `Domain control review document count ${state}`),
  ])) as Record<typeof DOMAIN_CONTROL_REVIEW_COUNT_KEYS[number], number>;

  const domainInput = boundedDataArray(root.domains, MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES);
  if (!domainInput || domainInput.length < 1) {
    throw new TypeError('Domain control review document domains must be a bounded non-empty array.');
  }
  const comparisonFields = [...DOMAIN_CONTROL_REVIEW_FIELDS, 'renewalReviewAt'] as const;
  const comparisonStates = new Set(DOMAIN_CONTROL_REVIEW_COUNT_KEYS);
  const calculatedCounts = Object.fromEntries(DOMAIN_CONTROL_REVIEW_COUNT_KEYS.map((state) => [state, 0])) as Record<typeof DOMAIN_CONTROL_REVIEW_COUNT_KEYS[number], number>;
  const domains = domainInput.map((domainValue, domainIndex) => {
    const item = exactReviewRecord(domainValue, REVIEW_DOMAIN_KEYS, `Domain control review document domain ${domainIndex + 1}`);
    const normalizedDomain = domain(item.domain);
    if (!normalizedDomain || normalizedDomain !== item.domain) {
      throw new TypeError(`Domain control review document domain ${domainIndex + 1} is invalid.`);
    }
    const comparisonsInput = boundedDataArray(item.comparisons, comparisonFields.length);
    if (!comparisonsInput || comparisonsInput.length !== comparisonFields.length) {
      throw new TypeError(`Domain control review document domain ${domainIndex + 1} comparisons are incomplete.`);
    }
    const comparisons = comparisonsInput.map((comparisonValue, comparisonIndex) => {
      const comparison = exactReviewRecord(
        comparisonValue,
        REVIEW_COMPARISON_KEYS,
        `Domain control review document domain ${domainIndex + 1} comparison ${comparisonIndex + 1}`,
      );
      const expectedField = comparisonFields[comparisonIndex];
      if (comparison.field !== expectedField
        || typeof comparison.state !== 'string'
        || !comparisonStates.has(comparison.state as typeof DOMAIN_CONTROL_REVIEW_COUNT_KEYS[number])) {
        throw new TypeError(`Domain control review document domain ${domainIndex + 1} comparison ${comparisonIndex + 1} is unsupported.`);
      }
      const state = comparison.state as typeof DOMAIN_CONTROL_REVIEW_COUNT_KEYS[number];
      calculatedCounts[state] += 1;
      const maximumValueCharacters = expectedField === 'ds'
        ? MAX_DOMAIN_CONTROL_DS_PRESENTATION_LENGTH
        : expectedField === 'caa'
          ? MAX_DOMAIN_CONTROL_CAA_PRESENTATION_LENGTH
          : MAX_DOMAIN_CONTROL_REVIEW_TEXT_LENGTH;
      const desired = exactReviewStringArray(
        comparison.desired,
        MAX_DOMAIN_CONTROL_RECORDS,
        maximumValueCharacters,
        `Domain control review document domain ${domainIndex + 1} comparison ${comparisonIndex + 1} desired values`,
      );
      const observed = exactReviewStringArray(
        comparison.observed,
        MAX_DOMAIN_CONTROL_RECORDS,
        maximumValueCharacters,
        `Domain control review document domain ${domainIndex + 1} comparison ${comparisonIndex + 1} observed values`,
      );
      const source = comparison.source === null
        ? null
        : exactReviewText(
          comparison.source,
          MAX_DOMAIN_CONTROL_REVIEW_SOURCE_LENGTH,
          `Domain control review document domain ${domainIndex + 1} comparison ${comparisonIndex + 1} source`,
        );
      const observedAt = comparison.observedAt === null
        ? null
        : exactReviewTimestamp(
          comparison.observedAt,
          `Domain control review document domain ${domainIndex + 1} comparison ${comparisonIndex + 1} observedAt`,
        );
      if (expectedField === 'renewalReviewAt' && (observed.length || source !== null || observedAt !== null)) {
        throw new TypeError(`Domain control review document domain ${domainIndex + 1} renewal comparison is inconsistent.`);
      }
      return Object.freeze({
        field: expectedField,
        state,
        desired,
        observed,
        source,
        observedAt,
        explanation: exactReviewText(
          comparison.explanation,
          MAX_DOMAIN_CONTROL_REVIEW_TEXT_LENGTH,
          `Domain control review document domain ${domainIndex + 1} comparison ${comparisonIndex + 1} explanation`,
        ),
      });
    });
    const expectedState = comparisons.some((comparison) => comparison.state === 'drift' || comparison.state === 'due')
      ? 'drift'
      : comparisons.some((comparison) => comparison.state === 'partial'
        || comparison.state === 'unavailable'
        || comparison.state === 'unsupported')
        ? 'partial'
        : 'aligned';
    if (item.state !== expectedState) {
      throw new TypeError(`Domain control review document domain ${domainIndex + 1} state is inconsistent.`);
    }
    return Object.freeze({ domain: normalizedDomain, state: expectedState, comparisons: Object.freeze(comparisons) });
  });
  if (new Set(domains.map((item) => item.domain)).size !== domains.length) {
    throw new TypeError('Domain control review document domains must be unique.');
  }
  for (const state of DOMAIN_CONTROL_REVIEW_COUNT_KEYS) {
    if (suppliedCounts[state] !== calculatedCounts[state]) {
      throw new TypeError('Domain control review document counts are inconsistent.');
    }
  }
  const expectedState = expired
    ? 'expired'
    : domains.some((item) => item.state === 'drift')
      ? 'drift'
      : domains.some((item) => item.state === 'partial')
        ? 'partial'
        : 'aligned';
  if (root.state !== expectedState) throw new TypeError('Domain control review document state is inconsistent.');
  const ignoredObservationCount = exactReviewInteger(
    root.ignoredObservationCount,
    MAX_DOMAIN_CONTROL_REVIEW_OBSERVATIONS,
    'Domain control review document ignored observation count',
  );
  const limitationsInput = boundedDataArray(root.limitations, DOMAIN_CONTROL_REVIEW_LIMITATIONS.length);
  if (!limitationsInput
    || limitationsInput.length !== DOMAIN_CONTROL_REVIEW_LIMITATIONS.length
    || limitationsInput.some((item, index) => item !== DOMAIN_CONTROL_REVIEW_LIMITATIONS[index])) {
    throw new TypeError('Domain control review document limitations are invalid.');
  }
  return Object.freeze({
    schema: DOMAIN_CONTROL_REVIEW_SCHEMA,
    version: DOMAIN_CONTROL_REVIEW_VERSION,
    generatedAt,
    state: expectedState,
    manifest,
    counts: Object.freeze(suppliedCounts),
    domains: Object.freeze(domains),
    ignoredObservationCount,
    limitations: DOMAIN_CONTROL_REVIEW_LIMITATIONS,
  }) as ReturnType<typeof reviewDomainControlManifest>;
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
