import type {
  ThreatIntelligenceProviderDefinition,
  ThreatIntelligenceResult,
} from '../../lib/threat-intelligence-contract.mts';

type ProviderLookupAdapter = Readonly<{
  lookupDomain: (
    domain: string,
    options?: { env?: Record<string, unknown> | null },
  ) => Promise<ThreatIntelligenceResult>;
}>;

type ProviderFixtureMode =
  | Readonly<{ kind: 'response'; response: () => Response | Promise<Response> }>
  | Readonly<{ kind: 'oversized' }>
  | Readonly<{ kind: 'timeout' }>;

type ProviderConformanceProfile = Readonly<{
  provider: ThreatIntelligenceProviderDefinition;
  enabledEnv: Readonly<Record<string, unknown>>;
  createAdapter: (mode: ProviderFixtureMode) => ProviderLookupAdapter;
  neutralResponse: () => Response;
  successResponse: () => Response;
  truncatedResponse: () => Response;
}>;

type ProviderConformanceScenario = Readonly<{
  id: 'neutral_miss' | 'rate_limit' | 'oversized' | 'malformed' | 'timeout' | 'truncation' | 'provenance';
  state: ThreatIntelligenceResult['state'] | null;
  ready: boolean;
  issues: readonly string[];
}>;

type ProviderConformanceReport = Readonly<{
  schema: 'whoisleuth.provider-conformance-report';
  version: 1;
  providerId: string;
  ready: boolean;
  scenarios: readonly ProviderConformanceScenario[];
}>;

const FIXTURE_DOMAIN = 'example.com';
const FIXTURE_OBSERVED_AT = '2026-07-15T02:03:04.000Z';
const SECRET_MARKERS = Object.freeze([
  'fixture-api-key',
  'fixture-auth-key',
  'secret upstream detail',
]);

function scenario(
  id: ProviderConformanceScenario['id'],
  result: ThreatIntelligenceResult | null,
  issues: string[],
): ProviderConformanceScenario {
  return Object.freeze({
    id,
    state: result?.state ?? null,
    ready: issues.length === 0,
    issues: Object.freeze(issues),
  });
}

function inspectResult(
  result: ThreatIntelligenceResult,
  profile: ProviderConformanceProfile,
  expectedState: ThreatIntelligenceResult['state'],
): string[] {
  const issues: string[] = [];
  if (result.schema !== 'whoisleuth.threat-intelligence-result' || result.version !== 1) {
    issues.push('Result schema or version drifted.');
  }
  if (result.provider.id !== profile.provider.id || result.provider.label !== profile.provider.label) {
    issues.push('Provider provenance did not match its manifest.');
  }
  if (result.target.type !== 'domain'
    || result.target.value !== FIXTURE_DOMAIN
    || result.target.exposure !== 'registrable_domain') {
    issues.push('Target provenance was not normalized to the registrable domain.');
  }
  if (result.state !== expectedState) {
    issues.push(`Expected ${expectedState}, received ${result.state}.`);
  }
  if (result.observation.source !== profile.provider.id) {
    issues.push('Observation source did not retain the provider id.');
  }
  if (result.observation.observedAt !== FIXTURE_OBSERVED_AT) {
    issues.push('Observation timestamp was not deterministic.');
  }
  const serialized = JSON.stringify(result);
  for (const marker of SECRET_MARKERS) {
    if (serialized.includes(marker)) issues.push(`Result retained prohibited fixture marker: ${marker}.`);
  }
  return issues;
}

async function lookup(
  profile: ProviderConformanceProfile,
  mode: ProviderFixtureMode,
): Promise<ThreatIntelligenceResult> {
  return profile.createAdapter(mode).lookupDomain(FIXTURE_DOMAIN, {
    env: { ...profile.enabledEnv },
  });
}

export async function runThreatProviderConformance(
  profile: ProviderConformanceProfile,
): Promise<ProviderConformanceReport> {
  const scenarios: ProviderConformanceScenario[] = [];

  const neutral = await lookup(profile, { kind: 'response', response: profile.neutralResponse });
  const neutralIssues = inspectResult(neutral, profile, 'not_found');
  if (neutral.findings.length !== 0) neutralIssues.push('Neutral miss retained findings.');
  if (!neutral.observation.limitations.some((item) => /not evidence.*safe/iu.test(item))) {
    neutralIssues.push('Neutral miss did not retain the no-safety-inference limitation.');
  }
  scenarios.push(scenario('neutral_miss', neutral, neutralIssues));

  const rateLimit = await lookup(profile, {
    kind: 'response',
    response: () => new Response(JSON.stringify({ message: 'secret upstream detail' }), {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': '45',
      },
    }),
  });
  const rateLimitIssues = inspectResult(rateLimit, profile, 'rate_limited');
  if (rateLimit.retryAfterSeconds !== 45) rateLimitIssues.push('Retry-After was not normalized.');
  if (rateLimit.findings.length !== 0) rateLimitIssues.push('Rate-limit result retained findings.');
  scenarios.push(scenario('rate_limit', rateLimit, rateLimitIssues));

  const oversized = await lookup(profile, { kind: 'oversized' });
  const oversizedIssues = inspectResult(oversized, profile, 'error');
  if (oversized.findings.length !== 0) oversizedIssues.push('Oversized response retained findings.');
  scenarios.push(scenario('oversized', oversized, oversizedIssues));

  const malformed = await lookup(profile, {
    kind: 'response',
    response: () => new Response('{', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  const malformedIssues = inspectResult(malformed, profile, 'error');
  if (malformed.findings.length !== 0) malformedIssues.push('Malformed response retained findings.');
  scenarios.push(scenario('malformed', malformed, malformedIssues));

  const timedOut = await lookup(profile, { kind: 'timeout' });
  const timeoutIssues = inspectResult(timedOut, profile, 'error');
  if (!/deadline/iu.test(timedOut.detail ?? '')) timeoutIssues.push('Timeout was not distinguished from a generic error.');
  scenarios.push(scenario('timeout', timedOut, timeoutIssues));

  const truncated = await lookup(profile, {
    kind: 'response',
    response: profile.truncatedResponse,
  });
  const truncatedIssues = inspectResult(truncated, profile, 'partial');
  if (truncated.observation.truncated !== true) {
    truncatedIssues.push('Truncated provider data was not marked truncated.');
  }
  scenarios.push(scenario('truncation', truncated, truncatedIssues));

  const first = await lookup(profile, { kind: 'response', response: profile.successResponse });
  const second = await lookup(profile, { kind: 'response', response: profile.successResponse });
  const provenanceIssues = inspectResult(first, profile, 'success');
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    provenanceIssues.push('Equivalent fixtures did not produce stable normalized provenance.');
  }
  scenarios.push(scenario('provenance', first, provenanceIssues));

  return Object.freeze({
    schema: 'whoisleuth.provider-conformance-report',
    version: 1,
    providerId: profile.provider.id,
    ready: scenarios.every((item) => item.ready),
    scenarios: Object.freeze(scenarios),
  });
}

export type {
  ProviderConformanceProfile,
  ProviderConformanceReport,
  ProviderFixtureMode,
  ProviderLookupAdapter,
};
