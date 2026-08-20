import { Buffer } from 'node:buffer';
import { types as utilTypes } from 'node:util';
import { classifyQuery, type ClassifiedQuery } from '../lib/classify.mts';
import {
  isSafeJsonObjectKey,
  scanBoundedJson,
} from '../lib/bounded-json.mts';
import { decodeBoundedUtf8 } from '../lib/bounded-file.mts';
import { CliUsageError } from './arguments.mts';
import type { BoundedTextStream } from './bulk.mts';
import {
  validHttpDeliveryMetadata,
  validPagePublicationMetadata,
} from '../lib/homepage-metadata-contract.mts';
import { normalizeExplicitIsoTimestamp, normalizeLegacyIsoTimestamp } from '../packages/evidence/observation.mts';
import {
  CLI_LOOKUP_SCHEMA as SAVED_LOOKUP_SCHEMA,
  CLI_LOOKUP_VERSION as SAVED_LOOKUP_SCHEMA_VERSION,
  LEGACY_CLI_LOOKUP_VERSION as LEGACY_SAVED_LOOKUP_SCHEMA_VERSION,
  MAX_CLI_LOOKUP_BYTES as MAX_SAVED_LOOKUP_INPUT_BYTES,
  MAX_CLI_LOOKUP_JSON_CONTAINER_ITEMS as MAX_BOUNDED_JSON_CONTAINER_ITEMS,
  MAX_CLI_LOOKUP_JSON_DEPTH as MAX_BOUNDED_JSON_DEPTH,
  MAX_CLI_LOOKUP_JSON_KEYS as MAX_BOUNDED_JSON_KEYS,
  MAX_CLI_LOOKUP_JSON_VALUES as MAX_BOUNDED_JSON_VALUES,
  MAX_CLI_LOOKUP_STRING_LENGTH as MAX_SAVED_LOOKUP_STRING_LENGTH,
  SUPPORTED_CLI_LOOKUP_VERSIONS as SUPPORTED_SAVED_LOOKUP_SCHEMA_VERSIONS,
} from '../packages/contracts/cli-lookup.mts';

const RDAP_STATUSES = new Set([
  'success', 'complete', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled',
  'unavailable', 'rate_limited', 'not_applicable', 'stale',
]);
const WHOIS_STATUSES = new Set([
  'success', 'complete', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled',
  'unavailable', 'rate_limited', 'not_applicable', 'stale',
]);
const QUERY_TYPES = new Set(['domain', 'ipv4', 'ipv6', 'asn']);
type UnknownRecord = Record<string, unknown>;
type CliLookupQueryType = 'domain' | 'ipv4' | 'ipv6' | 'asn';
type CliLookupDocument = UnknownRecord & {
  schema: typeof SAVED_LOOKUP_SCHEMA;
  version: typeof LEGACY_SAVED_LOOKUP_SCHEMA_VERSION | typeof SAVED_LOOKUP_SCHEMA_VERSION;
  type: CliLookupQueryType;
  mode: 'fast' | 'deep';
  query: string;
  generatedAt: string;
  diagnostics: UnknownRecord & {
    rdap: UnknownRecord & { status: string };
    whois: UnknownRecord & { status: string };
  };
  rdap?: UnknownRecord & { parsed?: unknown };
  whois?: UnknownRecord & { parsed?: unknown };
};
type SavedLookupDocument = CliLookupDocument & {
  type: 'domain';
  registrableDomain: string;
};

type LookupCollectionContext = Readonly<{
  observerLabel?: string;
  vantageLabel?: string;
}>;
type SavedLookupReadOptions = { limit?: number; label?: string };
type SavedLookupParseOptions = { label?: string };

type JsonCopyBudget = {
  keys: number;
  values: number;
  compactBytes: number;
  prettyBytes: number;
};

function objectOrNull(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function snapshotLookupResultRoot(value: UnknownRecord): UnknownRecord {
  if (utilTypes.isProxy(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError('Lookup result must be one ordinary object.');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_BOUNDED_JSON_CONTAINER_ITEMS) {
    throw new TypeError(`Lookup result contains more than ${MAX_BOUNDED_JSON_CONTAINER_ITEMS} fields.`);
  }
  const result: UnknownRecord = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !isSafeJsonObjectKey(key)) {
      throw new TypeError('Lookup result contains an unsafe object key.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError('Lookup result contains a non-ordinary object field.');
    }
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotKnownDataFields(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>,
): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must be one ordinary object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be one ordinary object.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))) {
    throw new TypeError(`${label} contains an unsupported field.`);
  }
  const result: UnknownRecord = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} contains a non-ordinary field.`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function addJsonBytes(
  budget: JsonCopyBudget,
  compactBytes: number,
  prettyBytes: number,
  label: string,
): void {
  budget.compactBytes += compactBytes;
  budget.prettyBytes += prettyBytes;
  if (budget.compactBytes > MAX_SAVED_LOOKUP_INPUT_BYTES
    || budget.prettyBytes > MAX_SAVED_LOOKUP_INPUT_BYTES) {
    throw new TypeError(`${label} is limited to ${MAX_SAVED_LOOKUP_INPUT_BYTES} bytes.`);
  }
}

function jsonStringCodePointBytes(value: string, index: number): Readonly<{
  bytes: number;
  advance: number;
}> {
  const code = value.charCodeAt(index);
  if (code === 0x22 || code === 0x5c
    || code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
    return { bytes: 2, advance: 1 };
  }
  if (code <= 0x1f) return { bytes: 6, advance: 1 };
  if (code <= 0x7f) return { bytes: 1, advance: 1 };
  if (code <= 0x7ff) return { bytes: 2, advance: 1 };
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = value.charCodeAt(index + 1);
    return next >= 0xdc00 && next <= 0xdfff
      ? { bytes: 4, advance: 2 }
      : { bytes: 6, advance: 1 };
  }
  if (code >= 0xdc00 && code <= 0xdfff) return { bytes: 6, advance: 1 };
  return { bytes: 3, advance: 1 };
}

function addJsonStringBytes(budget: JsonCopyBudget, value: string, label: string): void {
  addJsonBytes(budget, 2, 2, label);
  for (let index = 0; index < value.length;) {
    const item = jsonStringCodePointBytes(value, index);
    addJsonBytes(budget, item.bytes, item.bytes, label);
    index += item.advance;
  }
}

function jsonStringBytes(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length;) {
    const item = jsonStringCodePointBytes(value, index);
    bytes += item.bytes;
    index += item.advance;
  }
  return bytes;
}

function jsonNonStringScalarBytes(value: number | boolean | null): number {
  if (value === null) return 4;
  if (typeof value === 'boolean') return value ? 4 : 5;
  return Buffer.byteLength(String(value), 'utf8');
}

function snapshotBoundedJson(value: unknown, label: string): Readonly<{
  value: unknown;
  compactBytes: number;
  prettyBytes: number;
}> {
  // Reserve the one terminal LF used by the portable pretty-JSON document.
  const budget: JsonCopyBudget = { keys: 0, values: 0, compactBytes: 0, prettyBytes: 1 };
  const ancestors = new Set<object>();

  const copy = (current: unknown, depth: number): unknown => {
    budget.values += 1;
    if (budget.values > MAX_BOUNDED_JSON_VALUES) {
      throw new TypeError(`${label} exceeds the ${MAX_BOUNDED_JSON_VALUES}-value limit.`);
    }
    if (depth > MAX_BOUNDED_JSON_DEPTH) {
      throw new TypeError(`${label} exceeds the ${MAX_BOUNDED_JSON_DEPTH}-level nesting limit.`);
    }
    if (typeof current === 'string') {
      addJsonStringBytes(budget, current, label);
      return current;
    }
    if (current === null || typeof current === 'boolean') {
      const bytes = jsonNonStringScalarBytes(current);
      addJsonBytes(budget, bytes, bytes, label);
      return current;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError(`${label} contains a non-finite number.`);
      const bytes = jsonNonStringScalarBytes(current);
      addJsonBytes(budget, bytes, bytes, label);
      return current;
    }
    if (!current || typeof current !== 'object') {
      throw new TypeError(`${label} contains a non-JSON value.`);
    }
    if (utilTypes.isProxy(current)) {
      throw new TypeError(`${label} contains a non-ordinary object.`);
    }
    if (ancestors.has(current)) throw new TypeError(`${label} contains a cyclic object reference.`);
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype
          || Object.prototype.hasOwnProperty.call(current, Symbol.iterator)) {
          throw new TypeError(`${label} contains a non-ordinary array.`);
        }
        const lengthDescriptor = Object.getOwnPropertyDescriptor(current, 'length');
        const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : null;
        if (!Number.isSafeInteger(length)
          || Number(length) < 0
          || Number(length) > MAX_BOUNDED_JSON_CONTAINER_ITEMS) {
          throw new TypeError(`${label} contains a container with more than ${MAX_BOUNDED_JSON_CONTAINER_ITEMS} items.`);
        }
        const keys = Reflect.ownKeys(current);
        if (keys.length !== Number(length) + 1
          || keys.at(-1) !== 'length'
          || keys.slice(0, -1).some((key, index) => key !== String(index))) {
          throw new TypeError(`${label} contains a sparse or extended array.`);
        }
        if (Number(length) === 0) addJsonBytes(budget, 2, 2, label);
        else addJsonBytes(budget, 1, 2, label);
        const result: unknown[] = [];
        for (let index = 0; index < Number(length); index += 1) {
          if (index > 0) addJsonBytes(budget, 1, 2, label);
          addJsonBytes(budget, 0, (depth + 1) * 2, label);
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
            throw new TypeError(`${label} contains a non-ordinary array entry.`);
          }
          result.push(copy(descriptor.value, depth + 1));
        }
        if (Number(length) > 0) addJsonBytes(budget, 1, 2 + (depth * 2), label);
        return Object.freeze(result);
      }

      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${label} contains a non-ordinary object.`);
      }
      const keys = Reflect.ownKeys(current);
      if (keys.length > MAX_BOUNDED_JSON_CONTAINER_ITEMS) {
        throw new TypeError(`${label} contains a container with more than ${MAX_BOUNDED_JSON_CONTAINER_ITEMS} items.`);
      }
      budget.keys += keys.length;
      if (budget.keys > MAX_BOUNDED_JSON_KEYS) {
        throw new TypeError(`${label} exceeds the ${MAX_BOUNDED_JSON_KEYS}-key limit.`);
      }
      if (keys.length === 0) addJsonBytes(budget, 2, 2, label);
      else addJsonBytes(budget, 1, 2, label);
      const result: UnknownRecord = {};
      for (const [index, key] of keys.entries()) {
        if (typeof key !== 'string' || !isSafeJsonObjectKey(key)) {
          throw new TypeError(`${label} contains an unsafe object key.`);
        }
        if (index > 0) addJsonBytes(budget, 1, 2, label);
        addJsonBytes(budget, 1, ((depth + 1) * 2) + 2, label);
        addJsonStringBytes(budget, key, label);
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw new TypeError(`${label} contains a non-ordinary object field.`);
        }
        result[key] = copy(descriptor.value, depth + 1);
      }
      if (keys.length > 0) addJsonBytes(budget, 1, 2 + (depth * 2), label);
      return Object.freeze(result);
    } finally {
      ancestors.delete(current);
    }
  };

  const copied = copy(value, 0);
  return Object.freeze({
    value: copied,
    compactBytes: budget.compactBytes,
    prettyBytes: budget.prettyBytes,
  });
}

function requiredBoundedString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} is missing.`);
  if (value.length > MAX_SAVED_LOOKUP_STRING_LENGTH) {
    throw new TypeError(`${field} exceeds the saved-document value limit.`);
  }
  return value;
}

function requiredStatus(value: unknown, allowed: Set<string>, field: string): string {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new TypeError(`${field} is missing or unsupported.`);
  }
  return value;
}

function assertLookupQueryIdentity(document: UnknownRecord, query: string, type: CliLookupQueryType): void {
  let classified: ClassifiedQuery;
  try {
    classified = classifyQuery(query);
  } catch {
    throw new TypeError('query must identify the declared lookup type.');
  }
  if (classified.type !== type) throw new TypeError('query must identify the declared lookup type.');
  if (type !== 'domain' || classified.type !== 'domain') {
    if (document.inputHostname !== undefined
      || document.registrableDomain !== undefined
      || document.isSubdomain !== undefined) {
      throw new TypeError('Non-domain lookup documents cannot contain domain identity fields.');
    }
    return;
  }

  const registrableDomain = requiredBoundedString(document.registrableDomain, 'registrableDomain');
  if (classified.registrableDomain !== registrableDomain.toLowerCase().replace(/\.$/u, '')) {
    throw new TypeError('query must identify the declared registrable domain.');
  }
  if (document.inputHostname !== undefined
    && requiredBoundedString(document.inputHostname, 'inputHostname') !== classified.inputHostname) {
    throw new TypeError('inputHostname must match the classified query.');
  }
  if (document.isSubdomain !== undefined && document.isSubdomain !== classified.isSubdomain) {
    throw new TypeError('isSubdomain must match the classified query.');
  }
}

function assertLookupEnvelope(document: UnknownRecord, label: string): string {
  if (document.schema !== SAVED_LOOKUP_SCHEMA
    || typeof document.version !== 'number'
    || !Number.isSafeInteger(document.version)
    || !SUPPORTED_SAVED_LOOKUP_SCHEMA_VERSIONS.some((version) => version === document.version)) {
    throw new TypeError(`${label} must use ${SAVED_LOOKUP_SCHEMA} version ${SUPPORTED_SAVED_LOOKUP_SCHEMA_VERSIONS.join(' or ')}.`);
  }
  if (typeof document.type !== 'string' || !QUERY_TYPES.has(document.type)) {
    throw new TypeError(`${label} has an unsupported lookup type.`);
  }
  if (document.mode !== 'fast' && document.mode !== 'deep') {
    throw new TypeError(`${label} has an unsupported lookup mode.`);
  }
  const query = requiredBoundedString(document.query, 'query');
  assertLookupQueryIdentity(document, query, document.type as CliLookupQueryType);

  const rawGeneratedAt = requiredBoundedString(document.generatedAt, 'generatedAt');
  const generatedAt = document.version === LEGACY_SAVED_LOOKUP_SCHEMA_VERSION
    ? normalizeLegacyIsoTimestamp(rawGeneratedAt)
    : normalizeExplicitIsoTimestamp(rawGeneratedAt);
  if (!generatedAt) {
    throw new TypeError(document.version === LEGACY_SAVED_LOOKUP_SCHEMA_VERSION
      ? 'generatedAt must be a valid ISO timestamp.'
      : 'generatedAt must be a valid timestamp with an explicit timezone.');
  }

  const diagnostics = objectOrNull(document.diagnostics);
  const rdapDiagnostics = objectOrNull(diagnostics?.rdap);
  const whoisDiagnostics = objectOrNull(diagnostics?.whois);
  const rdapStatus = requiredStatus(rdapDiagnostics?.status, RDAP_STATUSES, 'diagnostics.rdap.status');
  const whoisStatus = requiredStatus(whoisDiagnostics?.status, WHOIS_STATUSES, 'diagnostics.whois.status');
  const rdap = objectOrNull(document.rdap);
  const whois = objectOrNull(document.whois);
  const availability = objectOrNull(document.availability);
  const pageIdentity = objectOrNull(availability?.pageIdentity);
  const http = objectOrNull(availability?.http);
  const httpResponse = objectOrNull(http?.response);
  const publicationMetadata = pageIdentity?.publicationMetadata;
  const deliveryMetadata = httpResponse?.deliveryMetadata;
  if (document.version === LEGACY_SAVED_LOOKUP_SCHEMA_VERSION
    && (publicationMetadata !== undefined || deliveryMetadata !== undefined)) {
    throw new TypeError(`${label} version ${LEGACY_SAVED_LOOKUP_SCHEMA_VERSION} cannot contain version ${SAVED_LOOKUP_SCHEMA_VERSION} homepage metadata.`);
  }
  if (document.version === SAVED_LOOKUP_SCHEMA_VERSION
    && (publicationMetadata !== undefined && (
      !['success', 'partial'].includes(String(pageIdentity?.status))
      || !validPagePublicationMetadata(publicationMetadata)
    )
      || deliveryMetadata !== undefined && (
        !['success', 'partial'].includes(String(http?.status))
        || !validHttpDeliveryMetadata(deliveryMetadata)
      ))) {
    throw new TypeError(`${label} contains invalid homepage metadata.`);
  }
  const rdapParsed = objectOrNull(rdap?.parsed);
  const whoisParsed = objectOrNull(whois?.parsed);
  if (rdapStatus === 'success' && !rdapParsed) {
    throw new TypeError('Successful RDAP input is missing normalised parsed data.');
  }
  if ((whoisStatus === 'complete' || whoisStatus === 'partial') && !whoisParsed) {
    throw new TypeError('Successful WHOIS input is missing normalised parsed data.');
  }
  return generatedAt;
}

function normalizeCliLookupDocument(
  value: unknown,
  options: SavedLookupParseOptions = {},
): CliLookupDocument {
  const label = options.label || 'Saved lookup input';
  const snapshot = snapshotBoundedJson(value, label);
  const document = objectOrNull(snapshot.value);
  if (!document) throw new TypeError(`${label} must be one JSON object.`);
  const generatedAt = assertLookupEnvelope(document, label);
  const generatedAtByteDelta = jsonStringBytes(generatedAt)
    - jsonStringBytes(document.generatedAt as string);
  if (snapshot.compactBytes + generatedAtByteDelta > MAX_SAVED_LOOKUP_INPUT_BYTES
    || snapshot.prettyBytes + generatedAtByteDelta > MAX_SAVED_LOOKUP_INPUT_BYTES) {
    throw new TypeError(`${label} is limited to ${MAX_SAVED_LOOKUP_INPUT_BYTES} bytes.`);
  }
  const normalized: UnknownRecord = {};
  for (const [key, item] of Object.entries(document)) {
    normalized[key] = key === 'generatedAt' ? generatedAt : item;
  }
  return Object.freeze(normalized) as CliLookupDocument;
}

function parseCliLookupDocument(
  text: unknown,
  options: SavedLookupParseOptions = {},
): CliLookupDocument {
  const label = options.label || 'Saved lookup input';
  if (typeof text !== 'string') throw new CliUsageError(`${label} must be a JSON document.`);
  if (Buffer.byteLength(text, 'utf8') > MAX_SAVED_LOOKUP_INPUT_BYTES) {
    throw new CliUsageError(`${label} is limited to ${MAX_SAVED_LOOKUP_INPUT_BYTES} bytes.`);
  }
  const normalized = text.replace(/^\uFEFF/u, '');
  try {
    scanBoundedJson(normalized);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : '';
    if (detail === 'Artefact input is not valid JSON.') {
      throw new CliUsageError(`${label} must be valid JSON.`);
    }
    const boundedDetail = detail.replace(/^Artefact JSON /u, '');
    throw new CliUsageError(boundedDetail ? `${label} ${boundedDetail}` : `${label} must be valid JSON.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new CliUsageError(`${label} must be valid JSON.`);
  }
  try {
    return normalizeCliLookupDocument(parsed, { label });
  } catch (cause) {
    throw new CliUsageError(cause instanceof Error ? cause.message : `${label} is invalid.`);
  }
}

function parseSavedLookupDocument(
  text: unknown,
  options: SavedLookupParseOptions = {},
): SavedLookupDocument {
  const label = options.label || 'Saved lookup input';
  const document = parseCliLookupDocument(text, { label });
  if (document.type !== 'domain') throw new CliUsageError(`${label} supports domain lookup documents only.`);
  return document as SavedLookupDocument;
}

function serialiseNormalizedCliLookupDocument(document: CliLookupDocument): string {
  const output = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(output, 'utf8') > MAX_SAVED_LOOKUP_INPUT_BYTES) {
    throw new TypeError(`Lookup document output is limited to ${MAX_SAVED_LOOKUP_INPUT_BYTES} bytes.`);
  }
  return output;
}

function serializeCliLookupDocument(value: unknown): string {
  return serialiseNormalizedCliLookupDocument(normalizeCliLookupDocument(value, {
    label: 'Lookup document output',
  }));
}

function buildCliLookupDocument(
  query: string,
  classified: ClassifiedQuery,
  result: UnknownRecord,
  generatedAt = new Date().toISOString(),
  mode = 'fast',
  collectionContext: LookupCollectionContext = {},
): CliLookupDocument {
  const normalizedGeneratedAt = normalizeExplicitIsoTimestamp(generatedAt);
  if (!normalizedGeneratedAt) {
    throw new TypeError('Lookup document generation time must be valid and include an explicit timezone.');
  }
  const classifiedSnapshot = snapshotKnownDataFields(
    classified,
    'Lookup classification',
    new Set(['type', 'value', 'inputHostname', 'registrableDomain', 'isSubdomain']),
  );
  const contextSnapshot = snapshotKnownDataFields(
    collectionContext,
    'Lookup collection context',
    new Set(['observerLabel', 'vantageLabel']),
  );
  const observerLabel = typeof contextSnapshot.observerLabel === 'string'
    ? contextSnapshot.observerLabel
    : null;
  const vantageLabel = typeof contextSnapshot.vantageLabel === 'string'
    ? contextSnapshot.vantageLabel
    : null;
  const resultSnapshot = snapshotLookupResultRoot(result);
  delete resultSnapshot.collectionContext;
  const classifiedType = classifiedSnapshot.type;
  if (typeof classifiedType !== 'string' || !QUERY_TYPES.has(classifiedType)) {
    throw new TypeError('Lookup classification has an unsupported query type.');
  }
  const candidate: UnknownRecord = {
    ...resultSnapshot,
    schema: SAVED_LOOKUP_SCHEMA,
    version: SAVED_LOOKUP_SCHEMA_VERSION,
    generatedAt: normalizedGeneratedAt,
    mode: mode === 'deep' ? 'deep' : 'fast',
    query,
    type: classifiedType,
    ...(classifiedType === 'domain' ? {
      inputHostname: classifiedSnapshot.inputHostname,
      registrableDomain: classifiedSnapshot.registrableDomain,
      isSubdomain: classifiedSnapshot.isSubdomain,
    } : {}),
    ...((observerLabel || vantageLabel) ? {
      collectionContext: {
        ...(observerLabel ? { observerLabel } : {}),
        ...(vantageLabel ? { vantageLabel } : {}),
      },
    } : {}),
  };
  if (classifiedType !== 'domain') {
    delete candidate.inputHostname;
    delete candidate.registrableDomain;
    delete candidate.isSubdomain;
  }
  return normalizeCliLookupDocument(candidate, { label: 'Lookup document output' });
}

async function readSavedLookupInputBounded(
  stream: BoundedTextStream | null | undefined,
  options: SavedLookupReadOptions = {},
): Promise<string> {
  const limit = options.limit || MAX_SAVED_LOOKUP_INPUT_BYTES;
  const label = options.label || 'Saved lookup input';
  if (!stream || stream.isTTY) return '';
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<unknown>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > limit) throw new CliUsageError(`${label} is limited to ${limit} bytes.`);
    chunks.push(buffer);
  }
  try {
    return decodeBoundedUtf8(Buffer.concat(chunks), label);
  } catch (cause) {
    throw new CliUsageError(cause instanceof Error ? cause.message : `${label} must contain valid UTF-8 text.`);
  }
}

export {
  MAX_SAVED_LOOKUP_INPUT_BYTES,
  MAX_SAVED_LOOKUP_STRING_LENGTH,
  SAVED_LOOKUP_SCHEMA,
  LEGACY_SAVED_LOOKUP_SCHEMA_VERSION,
  SAVED_LOOKUP_SCHEMA_VERSION,
  SUPPORTED_SAVED_LOOKUP_SCHEMA_VERSIONS,
  buildCliLookupDocument,
  normalizeCliLookupDocument,
  parseCliLookupDocument,
  parseSavedLookupDocument,
  readSavedLookupInputBounded,
  serializeCliLookupDocument,
};
export type {
  CliLookupDocument,
  CliLookupQueryType,
  LookupCollectionContext,
  SavedLookupDocument,
  SavedLookupParseOptions,
  SavedLookupReadOptions,
  UnknownRecord,
};
