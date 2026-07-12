// Server-authoritative emergency switches for hosted network features.
//
// Values are read for every request so a long-lived Express process can react
// to an operator changing its environment before a restart where the hosting
// platform supports that. Netlify normally applies environment changes by
// creating new function instances. Frontend state is informative only: every
// network entry point enforces this policy again on the server.

const FEATURE_DISABLED_ERROR_CODE = 'FEATURE_DISABLED';

const NETWORK_FEATURE_DEFINITIONS = Object.freeze({
  lookup: Object.freeze({ env: 'WHOISLEUTH_DISABLE_LOOKUP', label: 'Unified Lookup' }),
  rdap: Object.freeze({ env: 'WHOISLEUTH_DISABLE_RDAP', label: 'RDAP' }),
  whois: Object.freeze({ env: 'WHOISLEUTH_DISABLE_WHOIS', label: 'WHOIS' }),
  availability: Object.freeze({ env: 'WHOISLEUTH_DISABLE_AVAILABILITY', label: 'availability analysis' }),
  dns_intelligence: Object.freeze({ env: 'WHOISLEUTH_DISABLE_DNS_INTELLIGENCE', label: 'DNS intelligence' }),
  website_probe: Object.freeze({ env: 'WHOISLEUTH_DISABLE_WEBSITE_PROBE', label: 'website probing' }),
  certificate_transparency: Object.freeze({ env: 'WHOISLEUTH_DISABLE_CERTIFICATE_TRANSPARENCY', label: 'Certificate Transparency search' }),
  domain_posture: Object.freeze({ env: 'WHOISLEUTH_DISABLE_DOMAIN_POSTURE', label: 'domain-posture auditing' }),
});

const FEATURE_DEPENDENCIES = Object.freeze({
  domain_posture: Object.freeze(['dns_intelligence']),
});

function disabledValue(value) {
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function networkFeaturePolicy(env = process.env) {
  return Object.fromEntries(Object.entries(NETWORK_FEATURE_DEFINITIONS).map(([id, definition]) => [
    id,
    !disabledValue(env && env[definition.env]),
  ]));
}

function featureDecision(feature, policy = networkFeaturePolicy()) {
  const definition = NETWORK_FEATURE_DEFINITIONS[feature];
  if (!definition) throw new Error(`Unknown network feature: ${feature}`);
  if (policy[feature] !== true) {
    return { enabled: false, feature, disabledBy: feature, reason: `${definition.label} is disabled by deployment policy.` };
  }
  for (const dependency of FEATURE_DEPENDENCIES[feature] || []) {
    if (policy[dependency] !== true) {
      return {
        enabled: false,
        feature,
        disabledBy: dependency,
        reason: `${definition.label} is unavailable because ${NETWORK_FEATURE_DEFINITIONS[dependency].label} is disabled by deployment policy.`,
      };
    }
  }
  return { enabled: true, feature, disabledBy: null, reason: null };
}

function featureDisabledError(feature, policy = networkFeaturePolicy()) {
  const decision = featureDecision(feature, policy);
  if (decision.enabled) return null;
  return {
    error: decision.reason,
    errorCode: FEATURE_DISABLED_ERROR_CODE,
    feature: decision.feature,
    disabledBy: decision.disabledBy,
  };
}

module.exports = {
  FEATURE_DISABLED_ERROR_CODE,
  NETWORK_FEATURE_DEFINITIONS,
  disabledValue,
  networkFeaturePolicy,
  featureDecision,
  featureDisabledError,
};
