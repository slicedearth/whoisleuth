'use strict';

const { CliUsageError } = require('./arguments');

const MAX_COMPARE_INPUT_BYTES = 8 * 1024 * 1024;
// Covers the largest scalar accepted by the normalized WHOIS parser while
// preventing a saved document from inflating the derived comparison output.
const MAX_COMPARE_STRING_LENGTH = 1024;
const MAX_COMPARE_LIST_ITEMS = 200;
const MAX_COMPARE_EVENTS = 100;
const LOOKUP_SCHEMA = 'whoisleuth.cli.lookup';
const LOOKUP_SCHEMA_VERSION = 1;
const RDAP_STATUSES = new Set(['success', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled']);
const WHOIS_STATUSES = new Set(['complete', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled']);

async function readCompareInputBounded(stream, limit = MAX_COMPARE_INPUT_BYTES) {
  if (!stream || stream.isTTY) return '';
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) throw new CliUsageError(`Comparison input is limited to ${limit} bytes.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function boundedSourceString(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new CliUsageError(`${field} must be text when present.`);
  if (value.length > MAX_COMPARE_STRING_LENGTH) {
    throw new CliUsageError(`${field} exceeds the comparison value limit.`);
  }
  return value;
}

function boundedSourceList(value, field) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new CliUsageError(`${field} must be an array when present.`);
  if (value.length > MAX_COMPARE_LIST_ITEMS) {
    throw new CliUsageError(`${field} exceeds the comparison item limit.`);
  }
  return value.map((item, index) => boundedSourceString(item, `${field}[${index}]`)).filter((item) => item !== null);
}

function projectLifecycle(value, prefix) {
  if (value !== null && value !== undefined && !objectOrNull(value)) {
    throw new CliUsageError(`${prefix} must be an object when present.`);
  }
  const lifecycle = objectOrNull(value) || {};
  return {
    createdDate: boundedSourceString(lifecycle.createdDate, `${prefix}.createdDate`),
    createdDateIso: boundedSourceString(lifecycle.createdDateIso, `${prefix}.createdDateIso`),
    expiryDate: boundedSourceString(lifecycle.expiryDate, `${prefix}.expiryDate`),
    expiryDateIso: boundedSourceString(lifecycle.expiryDateIso, `${prefix}.expiryDateIso`),
    updatedDate: boundedSourceString(lifecycle.updatedDate, `${prefix}.updatedDate`),
    updatedDateIso: boundedSourceString(lifecycle.updatedDateIso, `${prefix}.updatedDateIso`),
  };
}

function projectRdapSource(value) {
  const source = objectOrNull(value) || {};
  const registrar = objectOrNull(source.registrar);
  const events = source.events === null || source.events === undefined ? [] : source.events;
  if (!Array.isArray(events)) throw new CliUsageError('rdap.parsed.events must be an array when present.');
  if (events.length > MAX_COMPARE_EVENTS) throw new CliUsageError('rdap.parsed.events exceeds the comparison item limit.');
  return {
    domain: boundedSourceString(source.domain, 'rdap.parsed.domain'),
    handle: boundedSourceString(source.handle, 'rdap.parsed.handle'),
    registrar: registrar ? {
      name: boundedSourceString(registrar.name, 'rdap.parsed.registrar.name'),
      org: boundedSourceString(registrar.org, 'rdap.parsed.registrar.org'),
      handle: boundedSourceString(registrar.handle, 'rdap.parsed.registrar.handle'),
    } : boundedSourceString(source.registrar, 'rdap.parsed.registrar'),
    registrarIanaId: boundedSourceString(source.registrarIanaId, 'rdap.parsed.registrarIanaId'),
    lifecycle: projectLifecycle(source.lifecycle, 'rdap.parsed.lifecycle'),
    events: events.map((event, index) => {
      const item = objectOrNull(event);
      if (!item) throw new CliUsageError(`rdap.parsed.events[${index}] must be an object.`);
      return {
        action: boundedSourceString(item.action, `rdap.parsed.events[${index}].action`),
        date: boundedSourceString(item.date, `rdap.parsed.events[${index}].date`),
      };
    }),
    dnssec: boundedSourceString(source.dnssec, 'rdap.parsed.dnssec'),
    statuses: boundedSourceList(source.statuses, 'rdap.parsed.statuses'),
    nameservers: boundedSourceList(source.nameservers, 'rdap.parsed.nameservers'),
  };
}

function projectWhoisSource(value) {
  const source = objectOrNull(value) || {};
  return {
    domainName: boundedSourceString(source.domainName, 'whois.parsed.domainName'),
    registryDomainId: boundedSourceString(source.registryDomainId, 'whois.parsed.registryDomainId'),
    registrar: boundedSourceString(source.registrar, 'whois.parsed.registrar'),
    registrarIanaId: boundedSourceString(source.registrarIanaId, 'whois.parsed.registrarIanaId'),
    createdDate: boundedSourceString(source.createdDate, 'whois.parsed.createdDate'),
    createdDateIso: boundedSourceString(source.createdDateIso, 'whois.parsed.createdDateIso'),
    expiryDate: boundedSourceString(source.expiryDate, 'whois.parsed.expiryDate'),
    expiryDateIso: boundedSourceString(source.expiryDateIso, 'whois.parsed.expiryDateIso'),
    updatedDate: boundedSourceString(source.updatedDate, 'whois.parsed.updatedDate'),
    updatedDateIso: boundedSourceString(source.updatedDateIso, 'whois.parsed.updatedDateIso'),
    lifecycle: projectLifecycle(source.lifecycle, 'whois.parsed.lifecycle'),
    dnssec: boundedSourceString(source.dnssec, 'whois.parsed.dnssec'),
    statuses: boundedSourceList(source.statuses, 'whois.parsed.statuses'),
    nameservers: boundedSourceList(source.nameservers, 'whois.parsed.nameservers'),
  };
}

function requiredStatus(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new CliUsageError(`${field} is missing or unsupported.`);
  }
  return value;
}

function requiredSourceString(value, field) {
  const text = boundedSourceString(value, field);
  if (!text || !text.trim()) throw new CliUsageError(`${field} is missing.`);
  return text;
}

function parseCliLookupDocument(text) {
  if (typeof text !== 'string') throw new CliUsageError('Comparison input must be a JSON document.');
  if (Buffer.byteLength(text, 'utf8') > MAX_COMPARE_INPUT_BYTES) {
    throw new CliUsageError(`Comparison input is limited to ${MAX_COMPARE_INPUT_BYTES} bytes.`);
  }
  let document;
  try {
    document = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new CliUsageError('Comparison input must be valid JSON.');
  }
  if (!objectOrNull(document)) throw new CliUsageError('Comparison input must be one JSON object.');
  if (document.schema !== LOOKUP_SCHEMA || document.version !== LOOKUP_SCHEMA_VERSION) {
    throw new CliUsageError(`Comparison input must use ${LOOKUP_SCHEMA} version ${LOOKUP_SCHEMA_VERSION}.`);
  }
  if (document.type !== 'domain') throw new CliUsageError('compare supports domain lookup documents only.');
  if (!['fast', 'deep'].includes(document.mode)) throw new CliUsageError('Comparison input has an unsupported lookup mode.');
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
  return {
    query: requiredSourceString(document.query, 'query'),
    registrableDomain: requiredSourceString(document.registrableDomain, 'registrableDomain'),
    lookupGeneratedAt: requiredSourceString(document.generatedAt, 'generatedAt'),
    lookupMode: document.mode,
    rdapStatus,
    whoisStatus,
    rdapParsed: projectRdapSource(rdapParsed),
    whoisParsed: projectWhoisSource(whoisParsed),
  };
}

function compareLookupDocument(input, compareRegistrySources) {
  if (typeof compareRegistrySources !== 'function') throw new TypeError('Registry comparison dependency is required.');
  const comparison = compareRegistrySources(input.rdapParsed, input.whoisParsed, {
    rdapStatus: input.rdapStatus,
    whoisStatus: input.whoisStatus,
  });
  return {
    query: input.query,
    registrableDomain: input.registrableDomain,
    lookupGeneratedAt: input.lookupGeneratedAt,
    lookupMode: input.lookupMode,
    ...comparison,
  };
}

module.exports = {
  LOOKUP_SCHEMA,
  LOOKUP_SCHEMA_VERSION,
  MAX_COMPARE_EVENTS,
  MAX_COMPARE_INPUT_BYTES,
  MAX_COMPARE_LIST_ITEMS,
  MAX_COMPARE_STRING_LENGTH,
  compareLookupDocument,
  parseCliLookupDocument,
  readCompareInputBounded,
};
