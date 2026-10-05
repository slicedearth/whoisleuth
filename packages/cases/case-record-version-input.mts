import {
  EVIDENCE_FOLLOW_UP_CASE_SCHEMA_VERSION,
  INCIDENT_CASE_SCHEMA_VERSION,
  PUBLISHED_V2_CASE_SCHEMA_VERSION,
  PUBLISHED_V2_3_CASE_SCHEMA_VERSION,
  OBJECT_RESPONSE_CASE_SCHEMA_VERSION,
  DELIVERY_CORRECTION_CASE_SCHEMA_VERSION,
} from '../contracts/case-portability.mts';

/** Adapt declared historical fields before ordinary current-record recovery. */
export function caseRecordVersionInput(record: Record<string, unknown>, sourceVersion?: number | null) {
  const declared = sourceVersion != null;
  if (declared && sourceVersion < DELIVERY_CORRECTION_CASE_SCHEMA_VERSION && Array.isArray(record.actions)
    && record.actions.some(action => action && typeof action === 'object' && (action.correction !== undefined
      || Array.isArray(action.history) && action.history.some((event: Record<string, unknown>) => event?.packetReceipt !== undefined)))) {
    throw new TypeError('Delivery receipts and corrections require Case schema 19; historical deliveries were not reinterpreted.');
  }
  if (declared && sourceVersion < OBJECT_RESPONSE_CASE_SCHEMA_VERSION) {
    const items = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
    const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const pins = items(record.evidencePins);
    const actions = items(record.actions);
    const reviews = items(object(record.observedEffects).reviews);
    const closures = items(object(record.closures).records);
    const questions = [...items(record.assertions), ...reviews].map(item => object(item.recheck));
    const events = actions.flatMap(action => items(action.history));
    if (pins.some(pin => pin.responseObject !== undefined || pin.infrastructureObservation !== undefined)
      || actions.some(action => action.responseObjects !== undefined)
      || events.some(event => event.responseObjects !== undefined || event.objectOutcome !== undefined)
      || [...reviews, ...closures, ...questions].some(item => item.responseObject !== undefined || item.objectOutcome !== undefined)
      || [...items(record.evidenceHistory), object(record.evidence)].some(snapshot => snapshot.hasExternalPasswordForm !== undefined)) {
      throw new TypeError('Object response and password-form attribution fields require Case schema 18; historical evidence was not reinterpreted.');
    }
  }
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
