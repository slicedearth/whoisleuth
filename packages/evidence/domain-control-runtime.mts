import {
  canonicalArtifactJsonFor,
  resolveArtifactCanonicalization,
  SORTED_JSON_V1,
  SORTED_JSON_V2,
  type ArtifactCanonicalization,
} from './artifact-integrity.mts';
import { normalizeDomain } from './domain-name.mts';
import { normalizeExplicitIsoTimestamp, normalizeLegacyIsoTimestamp } from './observation.mts';
import {
  DOMAIN_CONTROL_CAA_RECORD_KEYS,
  DOMAIN_CONTROL_DIGEST_SHA256_HEX_LENGTH,
  DOMAIN_CONTROL_DS_RECORD_KEYS,
  DOMAIN_CONTROL_MANIFEST_ENTRY_KEYS,
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA as DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_INPUT_KEYS,
  DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
  DOMAIN_CONTROL_MANIFEST_INTEGRITY_KEYS,
  DOMAIN_CONTROL_MANIFEST_LIMITATIONS,
  DOMAIN_CONTROL_MANIFEST_ROOT_KEYS,
  DOMAIN_CONTROL_MANIFEST_SCHEMA as DOMAIN_CONTROL_PASSPORT_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_VERSION,
  DOMAIN_CONTROL_MX_RECORD_KEYS,
  DOMAIN_CONTROL_RECORD_LIST_FIELDS,
  DOMAIN_CONTROL_SPKI_SHA256_HEX_LENGTH,
  DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR,
  LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION as DOMAIN_CONTROL_PASSPORT_VERSION,
  MAX_CANONICAL_DOMAIN_CONTROL_RECORDS,
  MAX_DOMAIN_CONTROL_CAA_FLAGS,
  MAX_DOMAIN_CONTROL_CAA_PRESENTATION_LENGTH,
  MAX_DOMAIN_CONTROL_CAA_TAG_LENGTH,
  MAX_DOMAIN_CONTROL_CAA_VALUE_LENGTH,
  MAX_DOMAIN_CONTROL_DOMAIN_LENGTH,
  MAX_DOMAIN_CONTROL_DS_ALGORITHM,
  MAX_DOMAIN_CONTROL_DS_DIGEST_LENGTH,
  MAX_DOMAIN_CONTROL_DS_DIGEST_TYPE,
  MAX_DOMAIN_CONTROL_DS_KEY_TAG,
  MAX_DOMAIN_CONTROL_DS_PRESENTATION_LENGTH,
  MAX_DOMAIN_CONTROL_INPUT_RECORDS,
  MAX_DOMAIN_CONTROL_JSON_DEPTH,
  MAX_DOMAIN_CONTROL_JSON_VALUES,
  MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
  MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES,
  MAX_DOMAIN_CONTROL_MX_PRIORITY,
  MAX_DOMAIN_CONTROL_MX_TEXT_LENGTH,
  MAX_DOMAIN_CONTROL_NAME_INPUT_LENGTH,
  MAX_DOMAIN_CONTROL_NOTE_LENGTH,
  MAX_DOMAIN_CONTROL_RECORD_INTEGER_TEXT_LENGTH,
  MAX_DOMAIN_CONTROL_TEXT_LENGTH,
  MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH,
  MIN_DOMAIN_CONTROL_DS_DIGEST_LENGTH,
  MIN_DOMAIN_CONTROL_MANIFEST_ENTRIES,
  MIN_DOMAIN_CONTROL_RECORDS,
} from '../contracts/domain-control-manifest.mts';

export {
  DOMAIN_CONTROL_MANIFEST_VERSION,
  DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA,
  DOMAIN_CONTROL_PASSPORT_SCHEMA,
  DOMAIN_CONTROL_PASSPORT_VERSION,
  MAX_CANONICAL_DOMAIN_CONTROL_RECORDS,
  MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
};
export const MAX_DOMAIN_CONTROL_PASSPORT_BYTES = MAX_DOMAIN_CONTROL_MANIFEST_BYTES;
export const MAX_DOMAIN_CONTROL_PASSPORT_ENTRIES = MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES;
export const DOMAIN_CONTROL_PASSPORT_LIMITATIONS = DOMAIN_CONTROL_MANIFEST_LIMITATIONS;

const INPUT_KEYS = new Set<string>(DOMAIN_CONTROL_MANIFEST_INPUT_KEYS);
const MANIFEST_KEYS = new Set<string>(DOMAIN_CONTROL_MANIFEST_ROOT_KEYS);
const ENTRY_KEYS = new Set<string>(DOMAIN_CONTROL_MANIFEST_ENTRY_KEYS);
const INTEGRITY_KEYS = new Set<string>(DOMAIN_CONTROL_MANIFEST_INTEGRITY_KEYS);
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const RECORD_LIST_FIELDS = DOMAIN_CONTROL_RECORD_LIST_FIELDS;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type DomainControlPassportEntry = Readonly<{
  domain: string;
  nameservers: readonly string[];
  ds: readonly string[];
  mx: readonly string[];
  caa: readonly string[];
  tlsIssuer: string | null;
  tlsSpkiSha256: string | null;
  registrarLock: 'required' | 'not_required' | null;
  renewalReviewAt: string | null;
  note: string | null;
}>;

export type UnsignedDomainControlPassport = Readonly<{
  schema: typeof DOMAIN_CONTROL_PASSPORT_SCHEMA;
  version: typeof DOMAIN_CONTROL_PASSPORT_VERSION | typeof DOMAIN_CONTROL_MANIFEST_VERSION;
  generatedAt: string;
  expiresAt: string;
  entries: readonly DomainControlPassportEntry[];
  limitations: readonly string[];
}>;

export type DomainControlPassport = UnsignedDomainControlPassport & Readonly<{
  integrity: Readonly<{
    algorithm: 'SHA-256';
    canonicalization: typeof SORTED_JSON_V1 | typeof SORTED_JSON_V2;
    digestSha256: string;
  }>;
}>;

function boundedDataRecord(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const serialiser = Object.getOwnPropertyDescriptor(value, 'toJSON');
  if (serialiser) throw new TypeError(`${label} contains an unknown field: toJSON.`);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of allowed) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} must use ordinary data fields.`);
    }
    result[key] = descriptor.value;
  }
  let visibleKeys = 0;
  for (const key in value as Record<string, unknown>) {
    if (!Object.hasOwn(value, key) || !allowed.has(key)) {
      const detail = key.length <= 80 ? `: ${key}` : '';
      throw new TypeError(`${label} contains an unknown field${detail}.`);
    }
    visibleKeys += 1;
    if (visibleKeys > allowed.size) throw new TypeError(`${label} contains too many fields.`);
  }
  return result;
}

function boundedDataArray(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  maximumMessage?: string,
): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must contain between ${minimum} and ${maximum} entries.`);
  }
  if (Object.getOwnPropertyDescriptor(value, Symbol.iterator)
    || Object.getOwnPropertyDescriptor(value, 'toJSON')) {
    throw new TypeError(`${label} must contain ordinary indexed data entries without custom behaviour.`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  const length = lengthDescriptor && 'value' in lengthDescriptor
    ? lengthDescriptor.value
    : null;
  if (Number.isSafeInteger(length) && Number(length) > maximum && maximumMessage) {
    throw new TypeError(maximumMessage);
  }
  if (!lengthDescriptor
    || lengthDescriptor.enumerable
    || !Number.isSafeInteger(length)
    || Number(length) < minimum
    || Number(length) > maximum) {
    throw new TypeError(`${label} must contain between ${minimum} and ${maximum} entries.`);
  }
  const boundedLength = Number(length);
  const result: unknown[] = [];
  for (let index = 0; index < boundedLength; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} must contain ordinary indexed data entries.`);
    }
    result.push(descriptor.value);
  }
  return result;
}

type DomainControlRecordKind = 'caa' | 'ds' | 'mx';

const MX_RECORD_KEYS = new Set<string>(DOMAIN_CONTROL_MX_RECORD_KEYS);
const CAA_RECORD_KEYS = new Set<string>(DOMAIN_CONTROL_CAA_RECORD_KEYS);
const DS_RECORD_KEYS = new Set<string>(DOMAIN_CONTROL_DS_RECORD_KEYS);
const DS_DIGEST_PATTERN = new RegExp(`^[a-f0-9]{${MIN_DOMAIN_CONTROL_DS_DIGEST_LENGTH},${MAX_DOMAIN_CONTROL_DS_DIGEST_LENGTH}}$`, 'u');
const SPKI_DIGEST_PATTERN = new RegExp(`^[a-f0-9]{${DOMAIN_CONTROL_SPKI_SHA256_HEX_LENGTH}}$`, 'u');
const MANIFEST_DIGEST_PATTERN = new RegExp(`^sha256:[a-f0-9]{${DOMAIN_CONTROL_DIGEST_SHA256_HEX_LENGTH}}$`, 'u');

function structuredRecord(
  value: unknown,
  keys: ReadonlySet<string>,
  label: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return boundedDataRecord(value, keys, label);
}

function recordText(value: unknown, maximum = MAX_DOMAIN_CONTROL_MX_TEXT_LENGTH): string {
  if (typeof value !== 'string'
    || value.length > maximum * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR
    || /[\u0000-\u001f\u007f]/u.test(value)) return '';
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximum).trim();
}

function recordInteger(value: unknown, maximum: number): number | null {
  const candidate = typeof value === 'number'
    ? value
    : typeof value === 'string'
      && value.length <= MAX_DOMAIN_CONTROL_RECORD_INTEGER_TEXT_LENGTH
      && /^\d+$/u.test(value.trim())
      ? Number(value)
      : NaN;
  return Number.isSafeInteger(candidate) && candidate >= 0 && candidate <= maximum
    ? candidate
    : null;
}

function domainControlName(value: unknown): string {
  return typeof value === 'string' && value.length <= MAX_DOMAIN_CONTROL_NAME_INPUT_LENGTH
    ? normalizeDomain(value)
    : '';
}

function exchange(value: unknown): string {
  const candidate = recordText(value, MAX_DOMAIN_CONTROL_DOMAIN_LENGTH).toLowerCase();
  if (candidate === '.') return '.';
  return domainControlName(candidate);
}

function suppliedAliasValues(
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): readonly unknown[] {
  const values: unknown[] = [];
  for (const key of keys) {
    if (!Object.hasOwn(source, key)) continue;
    const value = source[key];
    if (value !== null && value !== undefined) values.push(value);
  }
  return values;
}

function canonicalStringAlias(
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  normalise: (value: unknown) => string,
  label: string,
): string {
  const values = suppliedAliasValues(source, keys);
  if (!values.length) return '';
  const normalised = values.map(normalise);
  if (normalised.length > 1
    && (normalised.some((value) => !value) || normalised.some((value) => value !== normalised[0]))) {
    throw new TypeError(`${label} aliases must resolve to one valid canonical value.`);
  }
  return normalised[0] ?? '';
}

function canonicalIntegerAlias(
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  maximum: number,
  label: string,
  fallback: number | null = null,
): number | null {
  const values = suppliedAliasValues(source, keys);
  if (!values.length) return fallback;
  const normalised = values.map((value) => recordInteger(value, maximum));
  if (normalised.length > 1
    && (normalised.some((value) => value === null) || normalised.some((value) => value !== normalised[0]))) {
    throw new TypeError(`${label} aliases must resolve to one valid canonical value.`);
  }
  return normalised[0] ?? null;
}

export function canonicalMxRecord(value: unknown): string {
  const item = structuredRecord(value, MX_RECORD_KEYS, 'Domain control MX record');
  if (item) {
    const host = canonicalStringAlias(item, ['exchange', 'host', 'value'], exchange, 'Domain control MX host');
    const priority = canonicalIntegerAlias(item, ['priority', 'preference'], MAX_DOMAIN_CONTROL_MX_PRIORITY, 'Domain control MX priority');
    return host && priority !== null ? `${priority} ${host}` : '';
  }
  const candidate = recordText(value, MAX_DOMAIN_CONTROL_MX_TEXT_LENGTH).toLowerCase();
  const match = /^(\d{1,5})\s+(.+)$/u.exec(candidate);
  if (match) {
    const priority = recordInteger(match[1], MAX_DOMAIN_CONTROL_MX_PRIORITY);
    const host = exchange(match[2]);
    return priority !== null && host ? `${priority} ${host}` : '';
  }
  return exchange(candidate);
}

function caaValue(value: unknown): string {
  return recordText(value, MAX_DOMAIN_CONTROL_CAA_VALUE_LENGTH).replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, '$1$2').trim().toLowerCase();
}

export function canonicalCaaRecord(value: unknown): string {
  const item = structuredRecord(value, CAA_RECORD_KEYS, 'Domain control CAA record');
  if (item) {
    const flags = canonicalIntegerAlias(item, ['critical', 'flags'], MAX_DOMAIN_CONTROL_CAA_FLAGS, 'Domain control CAA flags', 0);
    const tag = recordText(item.tag, MAX_DOMAIN_CONTROL_CAA_TAG_LENGTH).toLowerCase();
    const payload = caaValue(item.value);
    return flags !== null && /^(?:issue|issuewild|iodef)$/u.test(tag) && payload
      ? `${flags} ${tag} ${payload}`
      : '';
  }
  const candidate = recordText(value, MAX_DOMAIN_CONTROL_CAA_PRESENTATION_LENGTH);
  const match = /^(\d{1,3})\s+(issue|issuewild|iodef)\s+(.+)$/iu.exec(candidate);
  if (!match) return '';
  const flags = recordInteger(match[1], MAX_DOMAIN_CONTROL_CAA_FLAGS);
  const tag = match[2]?.toLowerCase() ?? '';
  const payload = caaValue(match[3]);
  return flags !== null && payload ? `${flags} ${tag} ${payload}` : '';
}

export function canonicalDsRecord(value: unknown): string {
  const item = structuredRecord(value, DS_RECORD_KEYS, 'Domain control DS record');
  if (item) {
    const keyTag = canonicalIntegerAlias(item, ['keyTag', 'key_tag'], MAX_DOMAIN_CONTROL_DS_KEY_TAG, 'Domain control DS key tag');
    const algorithm = recordInteger(item.algorithm, MAX_DOMAIN_CONTROL_DS_ALGORITHM);
    const digestType = canonicalIntegerAlias(item, ['digestType', 'digest_type'], MAX_DOMAIN_CONTROL_DS_DIGEST_TYPE, 'Domain control DS digest type');
    const digest = recordText(item.digest, MAX_DOMAIN_CONTROL_DS_DIGEST_LENGTH).replace(/\s+/gu, '').toLowerCase();
    return keyTag !== null && algorithm !== null && digestType !== null && DS_DIGEST_PATTERN.test(digest)
      ? `${keyTag} ${algorithm} ${digestType} ${digest}`
      : '';
  }
  const candidate = recordText(value, MAX_DOMAIN_CONTROL_DS_PRESENTATION_LENGTH);
  const match = /^(\d{1,5})\s+(\d{1,3})\s+(\d{1,3})\s+([a-f0-9\s]+)$/iu.exec(candidate);
  if (!match) return '';
  return canonicalDsRecord({ keyTag: match[1], algorithm: match[2], digestType: match[3], digest: match[4] });
}

export function canonicalDomainControlRecordList(value: unknown, kind: DomainControlRecordKind): string[] {
  let normalise: (item: unknown) => string;
  if (kind === 'mx') normalise = canonicalMxRecord;
  else if (kind === 'caa') normalise = canonicalCaaRecord;
  else if (kind === 'ds') normalise = canonicalDsRecord;
  else throw new TypeError('Domain control record kind is unsupported.');
  if (!Array.isArray(value)) return [];
  const source = boundedDataArray(
    value,
    `Domain control ${kind.toUpperCase()} records`,
    MIN_DOMAIN_CONTROL_RECORDS,
    MAX_DOMAIN_CONTROL_INPUT_RECORDS,
  );
  const retained: string[] = [];
  for (const item of source) {
    const canonical = normalise(item);
    if (canonical) retained.push(canonical);
  }
  return [...new Set(retained)]
    .sort(compareCodeUnits)
    .slice(0, MAX_CANONICAL_DOMAIN_CONTROL_RECORDS);
}

class DomainControlJsonBudgetError extends Error {}
class DomainControlJsonStructureError extends Error {}

function addJsonBytes(current: number, addition: number): number {
  const total = current + addition;
  if (!Number.isSafeInteger(total) || total > MAX_DOMAIN_CONTROL_PASSPORT_BYTES) {
    throw new DomainControlJsonBudgetError();
  }
  return total;
}

function jsonStringBytes(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    let addition = 0;
    if (code === 0x22 || code === 0x5c) addition = 2;
    else if (code <= 0x1f) addition = code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        addition = 4;
        index += 1;
      } else addition = 6;
    } else if (code >= 0xdc00 && code <= 0xdfff) addition = 6;
    else if (code <= 0x7f) addition = 1;
    else if (code <= 0x7ff) addition = 2;
    else addition = 3;
    bytes = addJsonBytes(bytes, addition);
  }
  return bytes;
}

function boundedPrettyJsonBytes(value: unknown): number {
  const active = new Set<object>();
  let values = 0;

  const measure = (input: unknown, depth: number, arrayElement: boolean): number | null => {
    values += 1;
    if (values > MAX_DOMAIN_CONTROL_JSON_VALUES || depth > MAX_DOMAIN_CONTROL_JSON_DEPTH) {
      throw new DomainControlJsonStructureError();
    }
    if (input === null) return 4;
    if (typeof input === 'string') return jsonStringBytes(input);
    if (typeof input === 'boolean') return input ? 4 : 5;
    if (typeof input === 'number') return Number.isFinite(input) ? (JSON.stringify(input)?.length ?? 4) : 4;
    if (typeof input === 'undefined' || typeof input === 'function' || typeof input === 'symbol') {
      return arrayElement ? 4 : null;
    }
    if (typeof input === 'bigint' || typeof input !== 'object') throw new DomainControlJsonStructureError();
    if (active.has(input)) throw new DomainControlJsonStructureError();
    active.add(input);
    try {
      const childIndent = (depth + 1) * 2;
      const closingIndent = depth * 2;
      if (Array.isArray(input)) {
        const items = boundedDataArray(
          input,
          'Domain control JSON array',
          0,
          MAX_DOMAIN_CONTROL_JSON_VALUES,
        );
        if (!items.length) return 2;
        let bytes = 1;
        for (let index = 0; index < items.length; index += 1) {
          if (index > 0) bytes = addJsonBytes(bytes, 1);
          bytes = addJsonBytes(bytes, 1 + childIndent);
          bytes = addJsonBytes(bytes, measure(items[index], depth + 1, true) ?? 4);
        }
        return addJsonBytes(bytes, 1 + closingIndent + 1);
      }
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) throw new DomainControlJsonStructureError();
      if (Object.prototype.hasOwnProperty.call(input, 'toJSON')) throw new DomainControlJsonStructureError();
      let bytes = 1;
      let properties = 0;
      for (const key in input as Record<string, unknown>) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !descriptor.enumerable) continue;
        if (!('value' in descriptor)) throw new DomainControlJsonStructureError();
        const measured = measure(descriptor.value, depth + 1, false);
        if (measured === null) continue;
        if (properties > 0) bytes = addJsonBytes(bytes, 1);
        bytes = addJsonBytes(bytes, 1 + childIndent);
        bytes = addJsonBytes(bytes, jsonStringBytes(key));
        bytes = addJsonBytes(bytes, 2);
        bytes = addJsonBytes(bytes, measured);
        properties += 1;
      }
      return properties ? addJsonBytes(bytes, 1 + closingIndent + 1) : 2;
    } finally {
      active.delete(input);
    }
  };

  const bytes = measure(value, 0, false);
  if (bytes === null) throw new DomainControlJsonStructureError();
  return addJsonBytes(bytes, 1);
}

export function domainControlPassportSerialisedBytes(value: unknown, label = 'Domain control manifest'): number {
  try {
    return boundedPrettyJsonBytes(value);
  } catch (cause) {
    if (cause instanceof DomainControlJsonBudgetError) {
      throw new TypeError(`${label} exceeds ${MAX_DOMAIN_CONTROL_PASSPORT_BYTES} serialised bytes.`);
    }
    throw new TypeError(`${label} must be serialisable as bounded JSON.`);
  }
}

export function assertDomainControlPassportByteBudget(value: unknown, label = 'Domain control manifest'): void {
  domainControlPassportSerialisedBytes(value, label);
}

function boundedDomainControlPassportEntries(value: unknown, label: string): unknown[] {
  const entries = boundedDataArray(
    value,
    label,
    MIN_DOMAIN_CONTROL_MANIFEST_ENTRIES,
    MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES,
  );
  return entries.map((entry) => {
    const source = boundedDataRecord(entry, ENTRY_KEYS, `${label} entry`);
    if (!source) return entry;
    for (const field of RECORD_LIST_FIELDS) {
      if (!Object.hasOwn(source, field)) continue;
      source[field] = boundedDataArray(
      source[field],
      `${label} entry ${field}`,
      MIN_DOMAIN_CONTROL_RECORDS,
      MAX_DOMAIN_CONTROL_INPUT_RECORDS,
      `${label} entry ${field} exceeds ${MAX_DOMAIN_CONTROL_INPUT_RECORDS} input records.`,
    );
    }
    return source;
  });
}

function text(value: unknown, maximum = MAX_DOMAIN_CONTROL_TEXT_LENGTH): string | null {
  if (typeof value !== 'string'
    || value.length > maximum * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR
    || CONTROL_RE.test(value)) return null;
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximum) || null;
}

function timestamp(value: unknown, legacy = false): string | null {
  const candidate = text(value, MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH);
  return candidate
    ? normalizeExplicitIsoTimestamp(candidate) ?? (legacy ? normalizeLegacyIsoTimestamp(candidate) : null)
    : null;
}

function hostnames(value: unknown): string[] {
  if (value === undefined) return [];
  const source = boundedDataArray(
    value,
    'Domain control nameservers',
    MIN_DOMAIN_CONTROL_RECORDS,
    MAX_DOMAIN_CONTROL_INPUT_RECORDS,
  );
  const names: string[] = [];
  for (const item of source) {
    const normalized = domainControlName(item);
    if (normalized) names.push(normalized);
  }
  return [...new Set(names)].sort(compareCodeUnits).slice(0, MAX_CANONICAL_DOMAIN_CONTROL_RECORDS);
}

function digest(value: unknown): string | null {
  const candidate = text(value, DOMAIN_CONTROL_SPKI_SHA256_HEX_LENGTH)?.toLowerCase() ?? '';
  return SPKI_DIGEST_PATTERN.test(candidate) ? candidate : null;
}

function normalizeEntry(value: unknown): DomainControlPassportEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const domain = domainControlName(source.domain);
  if (!domain) return null;
  return Object.freeze({
    domain,
    nameservers: Object.freeze(hostnames(source.nameservers)),
    ds: Object.freeze(canonicalDomainControlRecordList(source.ds, 'ds')),
    mx: Object.freeze(canonicalDomainControlRecordList(source.mx, 'mx')),
    caa: Object.freeze(canonicalDomainControlRecordList(source.caa, 'caa')),
    tlsIssuer: text(source.tlsIssuer, MAX_DOMAIN_CONTROL_TEXT_LENGTH)?.toLowerCase() ?? null,
    tlsSpkiSha256: digest(source.tlsSpkiSha256),
    registrarLock: source.registrarLock === 'required' || source.registrarLock === 'not_required'
      ? source.registrarLock
      : null,
    renewalReviewAt: timestamp(source.renewalReviewAt, true),
    note: text(source.note, MAX_DOMAIN_CONTROL_NOTE_LENGTH),
  });
}

function buildUnsignedDomainControlPassportInternal(
  input: unknown,
  generatedAtValue: unknown,
  options: Readonly<{ legacyGeneratedAt?: boolean; preserveEntryOrder?: boolean }> = {},
): UnsignedDomainControlPassport {
  const source = boundedDataRecord(input, INPUT_KEYS, 'Domain control manifest input');
  if (!source || source.schema !== DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA || source.version !== DOMAIN_CONTROL_MANIFEST_INPUT_VERSION) {
    throw new TypeError(`Domain control manifest input must use ${DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA} version ${DOMAIN_CONTROL_MANIFEST_INPUT_VERSION}.`);
  }
  const inputEntries = boundedDomainControlPassportEntries(source.entries, 'Domain control manifest input');
  source.entries = inputEntries;
  assertDomainControlPassportByteBudget(source, 'Domain control manifest input');
  const generatedAt = timestamp(generatedAtValue, options.legacyGeneratedAt === true);
  const expiresAt = timestamp(source.expiresAt, true);
  if (!generatedAt) {
    throw new TypeError('Domain control manifest generation time must be valid and include an explicit timezone.');
  }
  if (!expiresAt || Date.parse(expiresAt) <= Date.parse(generatedAt)) {
    throw new TypeError('Domain control manifest expiry must be a valid time after generation.');
  }
  const entries = inputEntries.map(normalizeEntry);
  if (entries.some((entry) => entry === null)) throw new TypeError('Domain control manifest contains an invalid entry.');
  const normalizedEntries = entries as DomainControlPassportEntry[];
  if (new Set(normalizedEntries.map((entry) => entry.domain)).size !== normalizedEntries.length) {
    throw new TypeError('Domain control manifest entries must use unique domains.');
  }
  const orderedEntries = options.preserveEntryOrder === true
    ? [...normalizedEntries]
    : [...normalizedEntries].sort((left, right) => compareCodeUnits(left.domain, right.domain));
  return Object.freeze({
    schema: DOMAIN_CONTROL_PASSPORT_SCHEMA,
    version: DOMAIN_CONTROL_MANIFEST_VERSION,
    generatedAt,
    expiresAt,
    entries: Object.freeze(orderedEntries),
    limitations: DOMAIN_CONTROL_PASSPORT_LIMITATIONS,
  });
}

export function buildUnsignedDomainControlPassport(
  input: unknown,
  generatedAtValue: unknown,
  options: Readonly<{ legacyGeneratedAt?: boolean }> = {},
): UnsignedDomainControlPassport {
  return buildUnsignedDomainControlPassportInternal(input, generatedAtValue, options);
}

type NormalizedDomainControlPassportDocument = Readonly<{
  manifest: DomainControlPassport;
  unsigned: UnsignedDomainControlPassport;
  canonicalUnsigned: string;
  canonicalization: ArtifactCanonicalization;
}>;

function normalizeDomainControlPassportDocumentInternal(value: unknown): NormalizedDomainControlPassportDocument & Readonly<{
  serialisableManifest: DomainControlPassport;
}> {
  const source = boundedDataRecord(value, MANIFEST_KEYS, 'Domain control manifest');
  const integrity = boundedDataRecord(source?.integrity, INTEGRITY_KEYS, 'Domain control manifest integrity');
  if (!source
    || source.schema !== DOMAIN_CONTROL_PASSPORT_SCHEMA
    || !integrity
    || integrity.algorithm !== 'SHA-256'
    || typeof integrity.digestSha256 !== 'string'
    || !MANIFEST_DIGEST_PATTERN.test(integrity.digestSha256)) {
    throw new TypeError('Domain control manifest has an unsupported or malformed structure.');
  }
  let limitations: unknown[];
  try {
    limitations = boundedDataArray(
      source.limitations,
      'Domain control manifest limitations',
      DOMAIN_CONTROL_PASSPORT_LIMITATIONS.length,
      DOMAIN_CONTROL_PASSPORT_LIMITATIONS.length,
    );
  } catch {
    throw new TypeError('Domain control manifest has an unsupported or malformed structure.');
  }
  if (limitations.some((item, index) => item !== DOMAIN_CONTROL_PASSPORT_LIMITATIONS[index])) {
    throw new TypeError('Domain control manifest has an unsupported or malformed structure.');
  }
  source.limitations = limitations;
  const manifestEntries = boundedDomainControlPassportEntries(source.entries, 'Domain control manifest');
  source.entries = manifestEntries;
  source.integrity = integrity;
  assertDomainControlPassportByteBudget(source);
  const canonicalization = resolveArtifactCanonicalization(
    source.version,
    integrity.canonicalization,
    [
      { version: DOMAIN_CONTROL_PASSPORT_VERSION, canonicalization: SORTED_JSON_V1, explicit: true },
      { version: DOMAIN_CONTROL_MANIFEST_VERSION, canonicalization: SORTED_JSON_V2, explicit: true },
    ],
    'Domain control manifest',
  );
  const baseUnsigned = buildUnsignedDomainControlPassportInternal({
    schema: DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA,
    version: DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
    expiresAt: source.expiresAt,
    entries: manifestEntries,
  }, source.generatedAt, {
    legacyGeneratedAt: source.version === DOMAIN_CONTROL_PASSPORT_VERSION,
    preserveEntryOrder: true,
  });
  const unsigned = Object.freeze({ ...baseUnsigned, version: source.version }) as UnsignedDomainControlPassport;
  const { integrity: _integrity, ...suppliedUnsigned } = source;
  const canonicalUnsigned = canonicalArtifactJsonFor(unsigned, canonicalization);
  if (canonicalArtifactJsonFor(suppliedUnsigned, canonicalization) !== canonicalUnsigned) {
    throw new TypeError('Domain control manifest must use its canonical normalised content.');
  }
  const serialisableManifest = Object.freeze({
    ...unsigned,
    integrity: Object.freeze({
      algorithm: 'SHA-256' as const,
      canonicalization,
      digestSha256: integrity.digestSha256,
    }),
  });
  return {
    manifest: serialisableManifest,
    unsigned,
    canonicalUnsigned,
    canonicalization,
    serialisableManifest,
  };
}

export function normalizeDomainControlPassportDocument(value: unknown): NormalizedDomainControlPassportDocument {
  const normalized = normalizeDomainControlPassportDocumentInternal(value);
  return Object.freeze({
    manifest: normalized.manifest,
    unsigned: normalized.unsigned,
    canonicalUnsigned: normalized.canonicalUnsigned,
    canonicalization: normalized.canonicalization,
  });
}

/**
 * Produces the portable two-space JSON representation of a structurally valid
 * manifest. This does not authenticate the retained digest; callers that need
 * integrity assurance must use the Node or browser verifier separately.
 */
export function serializeDomainControlManifest(value: unknown): string {
  const normalized = normalizeDomainControlPassportDocumentInternal(value);
  assertDomainControlPassportByteBudget(normalized.serialisableManifest);
  return `${JSON.stringify(normalized.serialisableManifest, null, 2)}\n`;
}

export {
  DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA as DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  DOMAIN_CONTROL_PASSPORT_SCHEMA as DOMAIN_CONTROL_MANIFEST_SCHEMA,
  DOMAIN_CONTROL_PASSPORT_VERSION as LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION,
  DOMAIN_CONTROL_PASSPORT_LIMITATIONS as DOMAIN_CONTROL_MANIFEST_LIMITATIONS,
  MAX_DOMAIN_CONTROL_PASSPORT_ENTRIES as MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES,
  assertDomainControlPassportByteBudget as assertDomainControlManifestByteBudget,
  buildUnsignedDomainControlPassport as buildUnsignedDomainControlManifest,
  domainControlPassportSerialisedBytes as domainControlManifestSerialisedBytes,
  normalizeDomainControlPassportDocument as normalizeDomainControlManifestDocument,
};

export type DomainControlManifestEntry = DomainControlPassportEntry;
export type UnsignedDomainControlManifest = UnsignedDomainControlPassport;
export type DomainControlManifestDocument = DomainControlPassport;
