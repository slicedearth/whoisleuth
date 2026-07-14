import { Buffer } from 'node:buffer';
import { CliUsageError } from './arguments.mts';
import type { BoundedTextStream } from './bulk.mts';

const MAX_SAVED_LOOKUP_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_SAVED_LOOKUP_STRING_LENGTH = 1024;
const SAVED_LOOKUP_SCHEMA = 'whoisleuth.cli.lookup';
const SAVED_LOOKUP_SCHEMA_VERSION = 1;
const RDAP_STATUSES = new Set(['success', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled']);
const WHOIS_STATUSES = new Set(['complete', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled']);

type UnknownRecord = Record<string, unknown>;
type SavedLookupDocument = UnknownRecord & {
  schema: typeof SAVED_LOOKUP_SCHEMA;
  version: typeof SAVED_LOOKUP_SCHEMA_VERSION;
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
  return Buffer.concat(chunks).toString('utf8');
}

function parseSavedLookupDocument(text: unknown, options: SavedLookupParseOptions = {}): SavedLookupDocument {
  const label = options.label || 'Saved lookup input';
  if (typeof text !== 'string') throw new CliUsageError(`${label} must be a JSON document.`);
  if (Buffer.byteLength(text, 'utf8') > MAX_SAVED_LOOKUP_INPUT_BYTES) {
    throw new CliUsageError(`${label} is limited to ${MAX_SAVED_LOOKUP_INPUT_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new CliUsageError(`${label} must be valid JSON.`);
  }
  const document = objectOrNull(parsed);
  if (!document) throw new CliUsageError(`${label} must be one JSON object.`);
  if (document.schema !== SAVED_LOOKUP_SCHEMA || document.version !== SAVED_LOOKUP_SCHEMA_VERSION) {
    throw new CliUsageError(`${label} must use ${SAVED_LOOKUP_SCHEMA} version ${SAVED_LOOKUP_SCHEMA_VERSION}.`);
  }
  if (document.type !== 'domain') throw new CliUsageError(`${label} supports domain lookup documents only.`);
  if (document.mode !== 'fast' && document.mode !== 'deep') {
    throw new CliUsageError(`${label} has an unsupported lookup mode.`);
  }
  requiredBoundedString(document.query, 'query');
  requiredBoundedString(document.registrableDomain, 'registrableDomain');
  requiredBoundedString(document.generatedAt, 'generatedAt');
  const diagnostics = objectOrNull(document.diagnostics);
  const rdapDiagnostics = objectOrNull(diagnostics?.rdap);
  const whoisDiagnostics = objectOrNull(diagnostics?.whois);
  const rdapStatus = requiredStatus(rdapDiagnostics?.status, RDAP_STATUSES, 'diagnostics.rdap.status');
  const whoisStatus = requiredStatus(whoisDiagnostics?.status, WHOIS_STATUSES, 'diagnostics.whois.status');
  const rdap = objectOrNull(document.rdap);
  const whois = objectOrNull(document.whois);
  const rdapParsed = objectOrNull(rdap?.parsed);
  const whoisParsed = objectOrNull(whois?.parsed);
  if (rdapStatus === 'success' && !rdapParsed) {
    throw new CliUsageError('Successful RDAP input is missing normalized parsed data.');
  }
  if ((whoisStatus === 'complete' || whoisStatus === 'partial') && !whoisParsed) {
    throw new CliUsageError('Successful WHOIS input is missing normalized parsed data.');
  }
  return document as SavedLookupDocument;
}

export {
  MAX_SAVED_LOOKUP_INPUT_BYTES,
  MAX_SAVED_LOOKUP_STRING_LENGTH,
  SAVED_LOOKUP_SCHEMA,
  SAVED_LOOKUP_SCHEMA_VERSION,
  parseSavedLookupDocument,
  readSavedLookupInputBounded,
};
export type { SavedLookupDocument, SavedLookupParseOptions, SavedLookupReadOptions, UnknownRecord };
