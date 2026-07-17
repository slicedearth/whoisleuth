import { projectCliLookupComparisonInput, validateCliRegistrarPublicationInput } from './compare.mts';
import { parseSavedLookupDocument } from './saved-lookup.mts';
import type { UnknownRecord } from './saved-lookup.mts';

type EvidenceModule = {
  LOOKUP_EVIDENCE_SCHEMA: unknown;
  LOOKUP_EVIDENCE_SCHEMA_VERSION: unknown;
  buildLookupEvidence: (
    source: UnknownRecord,
    options: { generatedAt: string; idnAnalysis: null },
  ) => unknown;
};

function objectOrNull(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function buildCliEvidenceExport(
  text: unknown,
  evidenceModule: EvidenceModule | null | undefined,
  generatedAt = new Date().toISOString(),
): UnknownRecord {
  const source = parseSavedLookupDocument(text, { label: 'Evidence export input' });
  // Revalidate every normalized field consumed by the shared comparison
  // model. Raw source payloads are retained deliberately, but remain bounded
  // by the saved-document byte ceiling and are never interpreted here.
  projectCliLookupComparisonInput(source);
  validateCliRegistrarPublicationInput(source);
  if (!evidenceModule || typeof evidenceModule.buildLookupEvidence !== 'function') {
    throw new TypeError('Lookup evidence export dependency is required.');
  }
  const result = objectOrNull(evidenceModule.buildLookupEvidence(source, { generatedAt, idnAnalysis: null }));
  if (!result
      || result.schema !== evidenceModule.LOOKUP_EVIDENCE_SCHEMA
      || result.schemaVersion !== evidenceModule.LOOKUP_EVIDENCE_SCHEMA_VERSION) {
    throw new TypeError('Lookup evidence builder returned an unsupported report contract.');
  }
  return result;
}

function formatCliEvidenceExport(document: unknown, compact = false): string {
  return `${JSON.stringify(document, null, compact ? 0 : 2)}\n`;
}

export { buildCliEvidenceExport, formatCliEvidenceExport };
export type { EvidenceModule };
