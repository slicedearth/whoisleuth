// Stable CommonJS entry point retained while backend modules migrate to
// Node's native erasable TypeScript support.
const {
  FEATURE_DISABLED_ERROR_CODE,
  NETWORK_FEATURE_DEFINITIONS,
  disabledValue,
  networkFeaturePolicy,
  featureDecision,
  featureDisabledError,
} = require('./feature-policy.mts');

module.exports = {
  FEATURE_DISABLED_ERROR_CODE,
  NETWORK_FEATURE_DEFINITIONS,
  disabledValue,
  networkFeaturePolicy,
  featureDecision,
  featureDisabledError,
};
