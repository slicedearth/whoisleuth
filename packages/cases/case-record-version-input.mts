import {
  EVIDENCE_FOLLOW_UP_CASE_SCHEMA_VERSION,
  INCIDENT_CASE_SCHEMA_VERSION,
  PUBLISHED_V2_CASE_SCHEMA_VERSION,
  PUBLISHED_V2_3_CASE_SCHEMA_VERSION,
} from '../contracts/case-portability.mts';

/** Adapt declared historical fields before ordinary current-record recovery. */
export function caseRecordVersionInput(record: Record<string, unknown>, sourceVersion?: number | null) {
  const declared = sourceVersion != null;
  if (record.evidenceLinks !== undefined && declared && sourceVersion < EVIDENCE_FOLLOW_UP_CASE_SCHEMA_VERSION) {
    throw new TypeError('Evidence relationships require the current Case schema.');
  }
  return {
    record: declared && sourceVersion < INCIDENT_CASE_SCHEMA_VERSION ? {
      ...record,
      ...(sourceVersion < PUBLISHED_V2_CASE_SCHEMA_VERSION ? { observedEffects: undefined, closures: undefined } : {}),
      title: '',
    } : record,
    timestampOptions: {
      legacyTimestamps: declared && sourceVersion < PUBLISHED_V2_3_CASE_SCHEMA_VERSION,
      ...(sourceVersion === undefined ? {} : { sourceVersion }),
    },
  };
}
