// Stable CommonJS entry point retained while backend modules migrate to
// Node's native erasable TypeScript support.
const {
  OBSERVATION_VERSION,
  createObservation,
  readObservationEnvelope,
} = require('./observation.mts');

module.exports = {
  OBSERVATION_VERSION,
  createObservation,
  readObservationEnvelope,
};
