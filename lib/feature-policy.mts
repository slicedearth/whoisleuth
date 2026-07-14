// Server-authoritative emergency switches for hosted network features.
//
// Values are read for every request so a long-lived Express process can react
// to an operator changing its environment before a restart where the hosting
// platform supports that. Netlify normally applies environment changes by
// creating new function instances. Frontend state is informative only: every
// network entry point enforces this policy again on the server.

type EnvironmentInput = Record<string, unknown>;

const FEATURE_DISABLED_ERROR_CODE = 'FEATURE_DISABLED';

const NETWORK_FEATURE_DEFINITIONS = Object.freeze({
  lookup: Object.freeze({ env: 'WHOISLEUTH_DISABLE_LOOKUP', label: 'Unified Lookup' }),
  rdap: Object.freeze({ env: 'WHOISLEUTH_DISABLE_RDAP', label: 'RDAP' }),
  whois: Object.freeze({ env: 'WHOISLEUTH_DISABLE_WHOIS', label: 'WHOIS' }),
  availability: Object.freeze({ env: 'WHOISLEUTH_DISABLE_AVAILABILITY', label: 'availability analysis' }),
  dns_intelligence: Object.freeze({ env: 'WHOISLEUTH_DISABLE_DNS_INTELLIGENCE', label: 'DNS intelligence' }),
  website_probe: Object.freeze({ env: 'WHOISLEUTH_DISABLE_WEBSITE_PROBE', label: 'website probing' }),
  tls_intelligence: Object.freeze({ env: 'WHOISLEUTH_DISABLE_TLS_INTELLIGENCE', label: 'TLS intelligence' }),
  certificate_transparency: Object.freeze({ env: 'WHOISLEUTH_DISABLE_CERTIFICATE_TRANSPARENCY', label: 'Certificate Transparency search' }),
  domain_posture: Object.freeze({ env: 'WHOISLEUTH_DISABLE_DOMAIN_POSTURE', label: 'domain-posture auditing' }),
});

type NetworkFeatureId = keyof typeof NETWORK_FEATURE_DEFINITIONS;
type NetworkFeaturePolicy = Record<NetworkFeatureId, boolean>;

type EnabledFeatureDecision = {
  enabled: true;
  feature: NetworkFeatureId;
  disabledBy: null;
  reason: null;
};

type DisabledFeatureDecision = {
  enabled: false;
  feature: NetworkFeatureId;
  disabledBy: NetworkFeatureId;
  reason: string;
};

type FeatureDecision = EnabledFeatureDecision | DisabledFeatureDecision;

type FeatureDisabledError = {
  error: string;
  errorCode: typeof FEATURE_DISABLED_ERROR_CODE;
  feature: NetworkFeatureId;
  disabledBy: NetworkFeatureId;
};

const FEATURE_DEPENDENCIES: Readonly<Partial<Record<NetworkFeatureId, readonly NetworkFeatureId[]>>> = Object.freeze({
  domain_posture: Object.freeze(['dns_intelligence'] as NetworkFeatureId[]),
});

function disabledValue(value: unknown): boolean {
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function networkFeaturePolicy(
  env: EnvironmentInput | null | undefined = process.env,
): NetworkFeaturePolicy {
  return Object.fromEntries(Object.entries(NETWORK_FEATURE_DEFINITIONS).map(([id, definition]) => [
    id,
    !disabledValue(env && env[definition.env]),
  ])) as NetworkFeaturePolicy;
}

function featureDecision(
  feature: string,
  policy: Record<string, unknown> = networkFeaturePolicy(),
): FeatureDecision {
  const knownFeature = feature as NetworkFeatureId;
  const definition = NETWORK_FEATURE_DEFINITIONS[knownFeature];
  if (!definition) throw new Error(`Unknown network feature: ${feature}`);
  if (policy[knownFeature] !== true) {
    return {
      enabled: false,
      feature: knownFeature,
      disabledBy: knownFeature,
      reason: `${definition.label} is disabled by deployment policy.`,
    };
  }
  for (const dependency of FEATURE_DEPENDENCIES[knownFeature] || []) {
    if (policy[dependency] !== true) {
      return {
        enabled: false,
        feature: knownFeature,
        disabledBy: dependency,
        reason: `${definition.label} is unavailable because ${NETWORK_FEATURE_DEFINITIONS[dependency].label} is disabled by deployment policy.`,
      };
    }
  }
  return { enabled: true, feature: knownFeature, disabledBy: null, reason: null };
}

function featureDisabledError(
  feature: string,
  policy: Record<string, unknown> = networkFeaturePolicy(),
): FeatureDisabledError | null {
  const decision = featureDecision(feature, policy);
  if (decision.enabled) return null;
  return {
    error: decision.reason,
    errorCode: FEATURE_DISABLED_ERROR_CODE,
    feature: decision.feature,
    disabledBy: decision.disabledBy,
  };
}

export {
  FEATURE_DISABLED_ERROR_CODE,
  NETWORK_FEATURE_DEFINITIONS,
  disabledValue,
  networkFeaturePolicy,
  featureDecision,
  featureDisabledError,
};

export type {
  DisabledFeatureDecision,
  EnabledFeatureDecision,
  EnvironmentInput,
  FeatureDecision,
  FeatureDisabledError,
  NetworkFeatureId,
  NetworkFeaturePolicy,
};
