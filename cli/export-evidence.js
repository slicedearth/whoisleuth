'use strict';

const { projectCliLookupComparisonInput } = require('./compare');
const { parseSavedLookupDocument } = require('./saved-lookup');

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function buildCliEvidenceExport(text, evidenceModule, generatedAt = new Date().toISOString()) {
  const source = parseSavedLookupDocument(text, { label: 'Evidence export input' });
  // Revalidate every normalized field consumed by the shared comparison
  // model. Raw source payloads are retained deliberately, but remain bounded
  // by the saved-document byte ceiling and are never interpreted here.
  projectCliLookupComparisonInput(source);
  if (!evidenceModule || typeof evidenceModule.buildLookupEvidence !== 'function') {
    throw new TypeError('Lookup evidence export dependency is required.');
  }
  const result = evidenceModule.buildLookupEvidence(source, { generatedAt, idnAnalysis: null });
  if (!objectOrNull(result)
      || result.schema !== evidenceModule.LOOKUP_EVIDENCE_SCHEMA
      || result.schemaVersion !== evidenceModule.LOOKUP_EVIDENCE_SCHEMA_VERSION) {
    throw new TypeError('Lookup evidence builder returned an unsupported report contract.');
  }
  return result;
}

function formatCliEvidenceExport(document, compact = false) {
  return `${JSON.stringify(document, null, compact ? 0 : 2)}\n`;
}

module.exports = { buildCliEvidenceExport, formatCliEvidenceExport };
