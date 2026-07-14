'use strict';

const CLI_LOOKUP_SCHEMA_VERSION = 1;
const CLI_CT_SEARCH_SCHEMA_VERSION = 1;
const CLI_DISCOVER_SCHEMA_VERSION = 1;
const CLI_POSTURE_SCHEMA_VERSION = 1;
const CLI_HTTP_SCHEMA_VERSION = 1;
const CLI_TLS_SCHEMA_VERSION = 1;

function buildCliLookupDocument(query, classified, result, generatedAt = new Date().toISOString(), mode = 'fast') {
  return {
    schema: 'whoisleuth.cli.lookup',
    version: CLI_LOOKUP_SCHEMA_VERSION,
    generatedAt,
    mode: mode === 'deep' ? 'deep' : 'fast',
    query,
    type: classified.type,
    inputHostname: classified.inputHostname,
    registrableDomain: classified.registrableDomain,
    isSubdomain: classified.isSubdomain,
    ...result,
  };
}

function formatJsonDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function buildCliCtSearchDocument(keyword, result, generatedAt = new Date().toISOString()) {
  return {
    ...result,
    schema: 'whoisleuth.cli.ct-search',
    version: CLI_CT_SEARCH_SCHEMA_VERSION,
    generatedAt,
    keyword,
  };
}

function buildCliDiscoverDocument(seed, result, metadata) {
  return {
    ...result,
    schema: 'whoisleuth.cli.discover',
    version: CLI_DISCOVER_SCHEMA_VERSION,
    generatedAt: metadata.generatedAt,
    seed,
    preset: metadata.preset,
    keyboardLayout: metadata.keyboardLayout,
    tlds: [...metadata.tlds],
  };
}

function discoverJsonItem(candidate, metadata) {
  return {
    schema: 'whoisleuth.cli.discover.item',
    version: CLI_DISCOVER_SCHEMA_VERSION,
    generatedAt: metadata.generatedAt,
    seed: metadata.seed,
    preset: metadata.preset,
    keyboardLayout: metadata.keyboardLayout,
    domain: candidate.domain,
    source: candidate.source,
    tld: candidate.tld,
    mutationTypes: candidate.mutationTypes,
  };
}

function formatDiscoverJsonLines(candidates, metadata) {
  if (!candidates.length) return '';
  return `${candidates.map((candidate) => JSON.stringify(discoverJsonItem(candidate, metadata))).join('\n')}\n`;
}

function buildCliPostureDocument(requestedDomain, report, generatedAt = new Date().toISOString()) {
  return {
    ...report,
    schema: 'whoisleuth.cli.posture',
    version: CLI_POSTURE_SCHEMA_VERSION,
    generatedAt,
    requestedDomain,
  };
}

function buildCliHttpDocument(requestedDomain, result, generatedAt = new Date().toISOString()) {
  return {
    ...result,
    schema: 'whoisleuth.cli.http',
    version: CLI_HTTP_SCHEMA_VERSION,
    generatedAt,
    requestedDomain,
  };
}

function buildCliTlsDocument(requestedHostname, result, generatedAt = new Date().toISOString()) {
  return {
    ...result,
    schema: 'whoisleuth.cli.tls',
    version: CLI_TLS_SCHEMA_VERSION,
    generatedAt,
    requestedHostname,
  };
}

function buildCliBulkDocument(items, metadata) {
  const succeeded = items.filter((item) => item.ok).length;
  return {
    schema: 'whoisleuth.cli.bulk',
    version: 1,
    generatedAt: metadata.generatedAt,
    mode: metadata.deep ? 'deep' : 'fast',
    summary: { total: items.length, succeeded, failed: items.length - succeeded, duplicatesRemoved: metadata.duplicates || 0 },
    results: items.map((item) => bulkJsonItem(item, metadata)),
  };
}

function bulkJsonItem(item, metadata) {
  if (!item.ok) {
    return {
      schema: 'whoisleuth.cli.bulk.item',
      version: 1,
      generatedAt: metadata.generatedAt,
      index: item.index,
      query: item.query,
      ok: false,
      error: item.error,
    };
  }
  return {
    schema: 'whoisleuth.cli.bulk.item',
    version: 1,
    generatedAt: metadata.generatedAt,
    index: item.index,
    query: item.query,
    ok: true,
    type: item.classified.type,
    inputHostname: item.classified.inputHostname,
    registrableDomain: item.classified.registrableDomain,
    isSubdomain: item.classified.isSubdomain,
    availability: item.result.availability,
    diagnostics: item.result.diagnostics,
    mode: metadata.deep ? 'deep' : 'fast',
  };
}

function formatJsonLines(items, metadata) {
  return `${items.map((item) => JSON.stringify(bulkJsonItem(item, metadata))).join('\n')}\n`;
}

module.exports = {
  CLI_CT_SEARCH_SCHEMA_VERSION,
  CLI_DISCOVER_SCHEMA_VERSION,
  CLI_HTTP_SCHEMA_VERSION,
  CLI_POSTURE_SCHEMA_VERSION,
  CLI_TLS_SCHEMA_VERSION,
  CLI_LOOKUP_SCHEMA_VERSION,
  buildCliBulkDocument,
  buildCliCtSearchDocument,
  buildCliDiscoverDocument,
  buildCliHttpDocument,
  buildCliLookupDocument,
  buildCliPostureDocument,
  buildCliTlsDocument,
  bulkJsonItem,
  discoverJsonItem,
  formatDiscoverJsonLines,
  formatJsonDocument,
  formatJsonLines,
};
