import { projectCliLookupComparisonInput } from './compare.mts';
import { parseSavedLookupDocument } from './saved-lookup.mts';
import { validateLookupEvidenceArtifactStructure } from './artifact-structure.mts';
import type { UnknownRecord } from './saved-lookup.mts';
import { WHOISLEUTH_APPLICATION_VERSION } from '../lib/application-version.mts';
import {
  LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES,
  serializeLookupEvidence,
} from '../lib/evidence-export.mts';

type EvidenceModule = {
  LOOKUP_EVIDENCE_SCHEMA: unknown;
  LOOKUP_EVIDENCE_SCHEMA_VERSION: unknown;
  buildLookupEvidence: (
    source: UnknownRecord,
    options: { generatedAt: string; idnAnalysis: null; applicationVersion: string },
  ) => unknown;
};

const APPLICATION_VERSION = WHOISLEUTH_APPLICATION_VERSION;

function objectOrNull(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function buildCliEvidenceExport(
  text: unknown,
  evidenceModule: unknown,
  generatedAt = new Date().toISOString(),
): UnknownRecord {
  const source = parseSavedLookupDocument(text, { label: 'Evidence export input' });
  // Revalidate every normalized field consumed by the shared comparison
  // model. Raw source payloads are retained deliberately, but remain bounded
  // by the saved-document byte ceiling and are never interpreted here.
  projectCliLookupComparisonInput(source);
  const dependency = objectOrNull(evidenceModule);
  if (!dependency || typeof dependency.buildLookupEvidence !== 'function') {
    throw new TypeError('Lookup evidence export dependency is required.');
  }
  const buildLookupEvidence = dependency.buildLookupEvidence as EvidenceModule['buildLookupEvidence'];
  const result = objectOrNull(buildLookupEvidence(source, {
    generatedAt,
    idnAnalysis: null,
    applicationVersion: APPLICATION_VERSION,
  }));
  if (!result
      || result.schema !== dependency.LOOKUP_EVIDENCE_SCHEMA
      || result.schemaVersion !== dependency.LOOKUP_EVIDENCE_SCHEMA_VERSION) {
    throw new TypeError('Lookup evidence builder returned an unsupported report contract.');
  }
  validateLookupEvidenceArtifactStructure(result);
  serializeLookupEvidence(result);
  return result;
}

function formatCliEvidenceExport(document: unknown, compact = false): string {
  const output = `${serializeLookupEvidence(document, !compact)}\n`;
  if (new TextEncoder().encode(output).byteLength > LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES) {
    throw new TypeError('Lookup evidence exceeds the 5 MiB portable file limit.');
  }
  return output;
}

export { APPLICATION_VERSION, buildCliEvidenceExport, formatCliEvidenceExport };
export type { EvidenceModule };
