'use strict';

const { CliUsageError } = require('./arguments');

const MAX_SAVED_LOOKUP_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_SAVED_LOOKUP_STRING_LENGTH = 1024;
const SAVED_LOOKUP_SCHEMA = 'whoisleuth.cli.lookup';
const SAVED_LOOKUP_SCHEMA_VERSION = 1;
const RDAP_STATUSES = new Set(['success', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled']);
const WHOIS_STATUSES = new Set(['complete', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled']);

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function requiredBoundedString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new CliUsageError(`${field} is missing.`);
  if (value.length > MAX_SAVED_LOOKUP_STRING_LENGTH) throw new CliUsageError(`${field} exceeds the saved-document value limit.`);
  return value;
}

function requiredStatus(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.has(value)) throw new CliUsageError(`${field} is missing or unsupported.`);
  return value;
}

async function readSavedLookupInputBounded(stream, options = {}) {
  const limit = options.limit || MAX_SAVED_LOOKUP_INPUT_BYTES;
  const label = options.label || 'Saved lookup input';
  if (!stream || stream.isTTY) return '';
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) throw new CliUsageError(`${label} is limited to ${limit} bytes.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseSavedLookupDocument(text, options = {}) {
  const label = options.label || 'Saved lookup input';
  if (typeof text !== 'string') throw new CliUsageError(`${label} must be a JSON document.`);
  if (Buffer.byteLength(text, 'utf8') > MAX_SAVED_LOOKUP_INPUT_BYTES) {
    throw new CliUsageError(`${label} is limited to ${MAX_SAVED_LOOKUP_INPUT_BYTES} bytes.`);
  }
  let document;
  try {
    document = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new CliUsageError(`${label} must be valid JSON.`);
  }
  if (!objectOrNull(document)) throw new CliUsageError(`${label} must be one JSON object.`);
  if (document.schema !== SAVED_LOOKUP_SCHEMA || document.version !== SAVED_LOOKUP_SCHEMA_VERSION) {
    throw new CliUsageError(`${label} must use ${SAVED_LOOKUP_SCHEMA} version ${SAVED_LOOKUP_SCHEMA_VERSION}.`);
  }
  if (document.type !== 'domain') throw new CliUsageError(`${label} supports domain lookup documents only.`);
  if (!['fast', 'deep'].includes(document.mode)) throw new CliUsageError(`${label} has an unsupported lookup mode.`);
  requiredBoundedString(document.query, 'query');
  requiredBoundedString(document.registrableDomain, 'registrableDomain');
  requiredBoundedString(document.generatedAt, 'generatedAt');
  const diagnostics = objectOrNull(document.diagnostics);
  const rdapDiagnostics = objectOrNull(diagnostics?.rdap);
  const whoisDiagnostics = objectOrNull(diagnostics?.whois);
  const rdapStatus = requiredStatus(rdapDiagnostics?.status, RDAP_STATUSES, 'diagnostics.rdap.status');
  const whoisStatus = requiredStatus(whoisDiagnostics?.status, WHOIS_STATUSES, 'diagnostics.whois.status');
  const rdapParsed = objectOrNull(document.rdap?.parsed);
  const whoisParsed = objectOrNull(document.whois?.parsed);
  if (rdapStatus === 'success' && !rdapParsed) throw new CliUsageError('Successful RDAP input is missing normalized parsed data.');
  if (['complete', 'partial'].includes(whoisStatus) && !whoisParsed) {
    throw new CliUsageError('Successful WHOIS input is missing normalized parsed data.');
  }
  return document;
}

module.exports = {
  MAX_SAVED_LOOKUP_INPUT_BYTES,
  MAX_SAVED_LOOKUP_STRING_LENGTH,
  SAVED_LOOKUP_SCHEMA,
  SAVED_LOOKUP_SCHEMA_VERSION,
  parseSavedLookupDocument,
  readSavedLookupInputBounded,
};
