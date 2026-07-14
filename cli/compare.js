'use strict';

const { CliUsageError } = require('./arguments');
const {
  MAX_SAVED_LOOKUP_INPUT_BYTES,
  MAX_SAVED_LOOKUP_STRING_LENGTH,
  SAVED_LOOKUP_SCHEMA,
  SAVED_LOOKUP_SCHEMA_VERSION,
  parseSavedLookupDocument,
  readSavedLookupInputBounded,
} = require('./saved-lookup');

const MAX_COMPARE_INPUT_BYTES = MAX_SAVED_LOOKUP_INPUT_BYTES;
// Covers the largest scalar accepted by the normalized WHOIS parser while
// preventing a saved document from inflating the derived comparison output.
const MAX_COMPARE_STRING_LENGTH = MAX_SAVED_LOOKUP_STRING_LENGTH;
const MAX_COMPARE_LIST_ITEMS = 200;
const MAX_COMPARE_EVENTS = 100;
const LOOKUP_SCHEMA = SAVED_LOOKUP_SCHEMA;
const LOOKUP_SCHEMA_VERSION = SAVED_LOOKUP_SCHEMA_VERSION;

async function readCompareInputBounded(stream, limit = MAX_COMPARE_INPUT_BYTES) {
  return readSavedLookupInputBounded(stream, { limit, label: 'Comparison input' });
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

function parseCliLookupDocument(text) {
  const document = parseSavedLookupDocument(text, { label: 'Comparison input' });
  return projectCliLookupComparisonInput(document);
}

function projectCliLookupComparisonInput(document) {
  const rdapStatus = document.diagnostics.rdap.status;
  const whoisStatus = document.diagnostics.whois.status;
  const rdapParsed = objectOrNull(document.rdap?.parsed);
  const whoisParsed = objectOrNull(document.whois?.parsed);
  return {
    query: document.query,
    registrableDomain: document.registrableDomain,
    lookupGeneratedAt: document.generatedAt,
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
  projectCliLookupComparisonInput,
  readCompareInputBounded,
};
