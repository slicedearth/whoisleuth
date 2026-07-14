'use strict';

const CLI_LOOKUP_SCHEMA_VERSION = 1;

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

module.exports = { CLI_LOOKUP_SCHEMA_VERSION, buildCliBulkDocument, buildCliLookupDocument, bulkJsonItem, formatJsonDocument, formatJsonLines };
