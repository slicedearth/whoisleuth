import { Buffer } from 'node:buffer';
import { classifyQuery } from '../lib/classify.mts';
import { scanBoundedJson } from '../lib/bounded-json.mts';
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
  SUPPORTED_CLI_LOOKUP_VERSIONS as SUPPORTED_SAVED_LOOKUP_SCHEMA_VERSIONS,
} from '../packages/contracts/cli-lookup.mts';

const MAX_SAVED_LOOKUP_STRING_LENGTH = 1024;
const RDAP_STATUSES = new Set(['success', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled']);
const WHOIS_STATUSES = new Set(['complete', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled']);

type UnknownRecord = Record<string, unknown>;
type SavedLookupDocument = UnknownRecord & {
  schema: typeof SAVED_LOOKUP_SCHEMA;
  version: typeof LEGACY_SAVED_LOOKUP_SCHEMA_VERSION | typeof SAVED_LOOKUP_SCHEMA_VERSION;
  type: 'domain';
  mode: 'fast' | 'deep';
  query: string;
  registrableDomain: string;
  generatedAt: string;
  diagnostics: UnknownRecord & {
    rdap: UnknownRecord & { status: string };
    whois: UnknownRecord & { status: string };
  };
  rdap?: UnknownRecord & { parsed?: unknown };
  whois?: UnknownRecord & { parsed?: unknown };
};

type SavedLookupReadOptions = { limit?: number; label?: string };
type SavedLookupParseOptions = { label?: string };

function objectOrNull(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function requiredBoundedString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new CliUsageError(`${field} is missing.`);
  if (value.length > MAX_SAVED_LOOKUP_STRING_LENGTH) {
    throw new CliUsageError(`${field} exceeds the saved-document value limit.`);
  }
  return value;
}

function requiredStatus(value: unknown, allowed: Set<string>, field: string): string {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new CliUsageError(`${field} is missing or unsupported.`);
  }
  return value;
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

function parseSavedLookupDocument(text: unknown, options: SavedLookupParseOptions = {}): SavedLookupDocument {
  const label = options.label || 'Saved lookup input';
  if (typeof text !== 'string') throw new CliUsageError(`${label} must be a JSON document.`);
  if (Buffer.byteLength(text, 'utf8') > MAX_SAVED_LOOKUP_INPUT_BYTES) {
    throw new CliUsageError(`${label} is limited to ${MAX_SAVED_LOOKUP_INPUT_BYTES} bytes.`);
  }
  const normalized = text.replace(/^\uFEFF/, '');
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
  const document = objectOrNull(parsed);
  if (!document) throw new CliUsageError(`${label} must be one JSON object.`);
  if (document.schema !== SAVED_LOOKUP_SCHEMA
    || typeof document.version !== 'number'
    || !Number.isSafeInteger(document.version)
    || !SUPPORTED_SAVED_LOOKUP_SCHEMA_VERSIONS.some((version) => version === document.version)) {
    throw new CliUsageError(`${label} must use ${SAVED_LOOKUP_SCHEMA} version ${SUPPORTED_SAVED_LOOKUP_SCHEMA_VERSIONS.join(' or ')}.`);
  }
  if (document.type !== 'domain') throw new CliUsageError(`${label} supports domain lookup documents only.`);
  if (document.mode !== 'fast' && document.mode !== 'deep') {
    throw new CliUsageError(`${label} has an unsupported lookup mode.`);
  }
  const query = requiredBoundedString(document.query, 'query');
  const registrableDomain = requiredBoundedString(document.registrableDomain, 'registrableDomain');
  try {
    const classified = classifyQuery(query);
    if (classified.type !== 'domain' || classified.registrableDomain !== registrableDomain.toLowerCase().replace(/\.$/u, '')) {
      throw new Error('Saved query does not match its declared registrable domain.');
    }
  } catch {
    throw new CliUsageError('query must identify the declared registrable domain.');
  }
  const rawGeneratedAt = requiredBoundedString(document.generatedAt, 'generatedAt');
  const generatedAt = document.version === LEGACY_SAVED_LOOKUP_SCHEMA_VERSION
    ? normalizeLegacyIsoTimestamp(rawGeneratedAt)
    : normalizeExplicitIsoTimestamp(rawGeneratedAt);
  if (!generatedAt) {
    throw new CliUsageError(document.version === LEGACY_SAVED_LOOKUP_SCHEMA_VERSION
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
    throw new CliUsageError(`${label} version ${LEGACY_SAVED_LOOKUP_SCHEMA_VERSION} cannot contain version ${SAVED_LOOKUP_SCHEMA_VERSION} homepage metadata.`);
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
    throw new CliUsageError(`${label} contains invalid homepage metadata.`);
  }
  const rdapParsed = objectOrNull(rdap?.parsed);
  const whoisParsed = objectOrNull(whois?.parsed);
  if (rdapStatus === 'success' && !rdapParsed) {
    throw new CliUsageError('Successful RDAP input is missing normalised parsed data.');
  }
  if ((whoisStatus === 'complete' || whoisStatus === 'partial') && !whoisParsed) {
    throw new CliUsageError('Successful WHOIS input is missing normalised parsed data.');
  }
  return { ...document, generatedAt } as SavedLookupDocument;
}

export {
  MAX_SAVED_LOOKUP_INPUT_BYTES,
  MAX_SAVED_LOOKUP_STRING_LENGTH,
  SAVED_LOOKUP_SCHEMA,
  LEGACY_SAVED_LOOKUP_SCHEMA_VERSION,
  SAVED_LOOKUP_SCHEMA_VERSION,
  SUPPORTED_SAVED_LOOKUP_SCHEMA_VERSIONS,
  parseSavedLookupDocument,
  readSavedLookupInputBounded,
};
export type { SavedLookupDocument, SavedLookupParseOptions, SavedLookupReadOptions, UnknownRecord };
