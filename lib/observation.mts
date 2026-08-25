// Historical import facade. The dependency-neutral observation and timestamp
// contract is owned by the pure evidence package.
export {
  MAX_OBSERVATION_DIAGNOSTICS,
  MAX_OBSERVATION_LIMITATIONS,
  MAX_OBSERVATION_LIMITATION_LENGTH,
  OBSERVATION_VERSION,
  createObservation,
  normalizeCtTimestamp,
  normalizeExplicitIsoTimestamp,
  normalizeLegacyIsoTimestamp,
  readObservationEnvelope,
} from '../packages/evidence/observation.mts';

export type {
  Observation,
  ObservationInput,
  ObservationReadResult,
  ObservationStatus,
  ScanMode,
} from '../packages/evidence/observation.mts';
