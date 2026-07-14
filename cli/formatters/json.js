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

module.exports = { CLI_LOOKUP_SCHEMA_VERSION, buildCliLookupDocument, formatJsonDocument };
