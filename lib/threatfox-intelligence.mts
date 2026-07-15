// Optional, lookup-only malware-IOC adapter. It searches an existing public
// corpus for an exact registrable domain and never submits an IOC, URL, or
// sample. The adapter is disabled unless explicitly enabled and credentialed.

import { abusechAuthKey } from './abusech-auth.mts';
import { safeFetchDetailed, readTextCapped } from './safe-fetch.mts';
import {
  createThreatIntelligenceResult,
  defineThreatIntelligenceProvider,
  normalizeThreatIntelligenceTarget,
} from './threat-intelligence-contract.mts';
import type { ThreatIntelligenceResult } from './threat-intelligence-contract.mts';

type EnvironmentInput = Record<string, unknown>;
type AdapterDependencies = {
  fetchDetailed?: typeof safeFetchDetailed;
  readResponse?: typeof readTextCapped;
  now?: () => number;
};
type LookupOptions = { env?: EnvironmentInput | null };

const THREATFOX_SEARCH_ENDPOINT = 'https://threatfox-api.abuse.ch/api/v1/';
const THREATFOX_MAX_RESULTS = 20;
const THREATFOX_MAX_INPUT_RESULTS = 100;
const THREATFOX_MAX_RESPONSE_BYTES = 256 * 1024;
const THREATFOX_TIMEOUT_MS = 6_000;
const THREATFOX_DAILY_REQUESTS = 200;
const THREATFOX_MONTHLY_REQUESTS = 3_000;

const THREATFOX_PROVIDER = defineThreatIntelligenceProvider({
  id: 'threatfox_domain_ioc',
  label: 'ThreatFox malware IOCs',
  capabilities: ['domain_lookup', 'indicator_search'],
  targets: { domain: 'registrable_domain' },
  interaction: 'lookup_only',
  terms: {
    reviewedAt: '2026-07-15T00:00:00.000Z',
    termsUrl: 'https://abuse.ch/terms-of-use/',
    privacyUrl: 'https://abuse.ch/privacy-policy/',
    commercialUse: 'restricted',
    attribution: 'unknown',
    caching: 'provider_defined',
    queryRetention: 'provider_defined',
    redistribution: 'restricted',
  },
  limits: {
    timeoutMs: THREATFOX_TIMEOUT_MS,
    maxResponseBytes: THREATFOX_MAX_RESPONSE_BYTES,
    cacheTtlMs: 0,
    concurrency: 1,
    dailyRequests: THREATFOX_DAILY_REQUESTS,
    monthlyRequests: THREATFOX_MONTHLY_REQUESTS,
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function enabledValue(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function threatfoxConfiguration(env: EnvironmentInput | null | undefined = process.env) {
  const source = env && typeof env === 'object' ? env : {};
  const enabled = enabledValue(source.WHOISLEUTH_ENABLE_THREATFOX);
  const authKey = abusechAuthKey(source);
  return {
    enabled,
    configured: enabled && authKey !== null,
    authKey: enabled ? authKey : null,
    reason: !enabled
      ? 'Malware-IOC intelligence is not enabled for this deployment.'
      : authKey
        ? null
        : 'Malware-IOC intelligence is enabled but its API credential is unavailable or malformed.',
  };
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized || null;
}

function isoTimestamp(value: unknown): string | null {
  const raw = boundedText(value, 64);
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?: UTC)?$/u.test(raw)
    ? `${raw.slice(0, 10)}T${raw.slice(11, 19)}Z`
    : raw;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizedTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 40)
    .map((item) => boundedText(item, 64)?.toLowerCase() || null)
    .filter((item): item is string => item !== null))]
    .sort()
    .slice(0, 18);
}

function normalizedConfidence(value: unknown): 'high' | 'medium' | 'low' | 'unknown' {
  const score = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(score) || score < 0 || score > 100) return 'unknown';
  return score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';
}

function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (!value || !/^\d{1,6}$/u.test(value.trim())) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 86_400 ? seconds : null;
}

function normalizeIocFinding(value: unknown, targetDomain: string) {
  if (!isRecord(value)) return null;
  const id = boundedText(String(value.id ?? ''), 32);
  const ioc = boundedText(value.ioc, 253)?.toLowerCase();
  const iocType = boundedText(value.ioc_type, 32)?.toLowerCase();
  const threatType = boundedText(value.threat_type, 64)?.toLowerCase();
  const threatDescription = boundedText(value.threat_type_desc, 120);
  const malware = boundedText(value.malware_printable, 120) || boundedText(value.malware, 120);
  if (!id || !/^\d{1,32}$/u.test(id) || ioc !== targetDomain || iocType !== 'domain' || !threatType) return null;
  const firstObservedAt = isoTimestamp(value.first_seen);
  const lastObservedAt = isoTimestamp(value.last_seen) || firstObservedAt;
  const tags = normalizedTags(value.tags);
  tags.push(`role:${threatType}`);
  if (malware) tags.push(`malware:${malware.toLowerCase()}`);
  return {
    id,
    category: 'malware',
    severity: 'unknown',
    confidence: normalizedConfidence(value.confidence_level),
    providerVerdict: [threatDescription || threatType.replaceAll('_', ' '), malware].filter(Boolean).join(' · '),
    detail: `The provider associates this domain with ${threatDescription || threatType.replaceAll('_', ' ')}${malware ? ` involving ${malware}` : ''}. The record may be historical and requires analyst review.`,
    firstObservedAt,
    lastObservedAt,
    referenceUrl: `https://threatfox.abuse.ch/ioc/${id}/`,
    tags: [...new Set(tags)].sort().slice(0, 20),
  };
}

function result(targetDomain: string, input: Record<string, unknown>, observedAt: string): ThreatIntelligenceResult {
  return createThreatIntelligenceResult(
    THREATFOX_PROVIDER,
    { type: 'domain', value: targetDomain },
    input,
    observedAt,
  );
}

function createThreatfoxIntelligenceAdapter(dependencies: AdapterDependencies = {}) {
  const fetchDetailed = dependencies.fetchDetailed || safeFetchDetailed;
  const readResponse = dependencies.readResponse || readTextCapped;
  const now = dependencies.now || Date.now;
  let activeRequests = 0;
  let dayBucket = '';
  let monthBucket = '';
  let dayRequests = 0;
  let monthRequests = 0;

  function consumeLocalBudget(timestamp: number): boolean {
    const day = new Date(timestamp).toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    if (day !== dayBucket) { dayBucket = day; dayRequests = 0; }
    if (month !== monthBucket) { monthBucket = month; monthRequests = 0; }
    if (dayRequests >= THREATFOX_PROVIDER.limits.dailyRequests
      || monthRequests >= THREATFOX_PROVIDER.limits.monthlyRequests) return false;
    dayRequests += 1;
    monthRequests += 1;
    return true;
  }

  async function lookupDomain(domain: string, options: LookupOptions = {}): Promise<ThreatIntelligenceResult> {
    const observedAt = new Date(now()).toISOString();
    let targetDomain: string;
    try {
      targetDomain = normalizeThreatIntelligenceTarget(
        { type: 'domain', value: domain },
        'registrable_domain',
      ).value;
    } catch {
      throw new TypeError('Malware-IOC intelligence requires a valid registrable domain');
    }
    const configuration = threatfoxConfiguration(options.env);
    if (!configuration.configured || !configuration.authKey) {
      return result(targetDomain, {
        state: configuration.enabled ? 'unavailable' : 'skipped',
        detail: configuration.reason,
      }, observedAt);
    }
    if (activeRequests >= THREATFOX_PROVIDER.limits.concurrency) {
      return result(targetDomain, {
        state: 'unavailable',
        detail: 'The local malware-IOC request concurrency limit is already in use; try again shortly.',
      }, observedAt);
    }
    if (!consumeLocalBudget(now())) {
      return result(targetDomain, {
        state: 'rate_limited',
        detail: 'The local malware-IOC request budget has been reached for this runtime instance.',
      }, observedAt);
    }

    activeRequests += 1;
    try {
      const body = JSON.stringify({ query: 'search_ioc', search_term: targetDomain, exact_match: true });
      const { response } = await fetchDetailed(THREATFOX_SEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'auth-key': configuration.authKey,
          'content-type': 'application/json',
          'user-agent': 'WHOISleuth/1.0',
        },
        body,
        signal: AbortSignal.timeout(THREATFOX_PROVIDER.limits.timeoutMs),
      }, { maxRedirects: 0 });
      const upstreamStatus = response.status;
      if (upstreamStatus === 429) {
        await response.body?.cancel().catch(() => {});
        return result(targetDomain, {
          state: 'rate_limited',
          detail: 'The malware-IOC provider reported that its query quota is temporarily exhausted.',
          upstreamStatus,
          retryAfterSeconds: retryAfterSeconds(response),
        }, observedAt);
      }
      if (upstreamStatus === 401 || upstreamStatus === 403) {
        await response.body?.cancel().catch(() => {});
        return result(targetDomain, {
          state: 'unavailable',
          detail: 'The malware-IOC provider did not accept the configured API credential.',
          upstreamStatus,
        }, observedAt);
      }
      if (upstreamStatus < 200 || upstreamStatus >= 300) {
        await response.body?.cancel().catch(() => {});
        return result(targetDomain, {
          state: 'error',
          detail: `Malware-IOC lookup failed with HTTP ${upstreamStatus}.`,
          upstreamStatus,
        }, observedAt);
      }

      const captured = await readResponse(response, THREATFOX_PROVIDER.limits.maxResponseBytes);
      if (captured.truncated) {
        return result(targetDomain, {
          state: 'error',
          detail: 'Malware-IOC lookup returned a response larger than the configured safety limit.',
          upstreamStatus,
        }, observedAt);
      }
      let parsed: unknown;
      try { parsed = JSON.parse(captured.text); } catch {
        return result(targetDomain, {
          state: 'error', detail: 'Malware-IOC lookup returned malformed JSON.', upstreamStatus,
        }, observedAt);
      }
      if (!isRecord(parsed) || typeof parsed.query_status !== 'string') {
        return result(targetDomain, {
          state: 'error', detail: 'Malware-IOC lookup returned an unexpected response shape.', upstreamStatus,
        }, observedAt);
      }

      const queryStatus = parsed.query_status.trim().toLowerCase();
      if (queryStatus === 'no_result' || queryStatus === 'no_results') {
        return result(targetDomain, {
          state: 'not_found',
          detail: 'The provider returned no retained malware-IOC record for this registrable domain.',
          upstreamStatus,
          limitations: ['The provider expires older indicators from its community API, so a neutral miss does not cover all historical activity.'],
        }, observedAt);
      }
      if (['no_api_key', 'auth_key_invalid', 'user_blacklisted'].includes(queryStatus)) {
        return result(targetDomain, {
          state: 'unavailable', detail: 'The malware-IOC provider did not accept the configured API credential.', upstreamStatus,
        }, observedAt);
      }
      if (queryStatus !== 'ok' || !Array.isArray(parsed.data)) {
        return result(targetDomain, {
          state: 'error', detail: 'Malware-IOC lookup returned an unexpected response shape.', upstreamStatus,
        }, observedAt);
      }

      const inputRecords = parsed.data.slice(0, THREATFOX_MAX_INPUT_RESULTS);
      const normalized = inputRecords
        .map((item) => normalizeIocFinding(item, targetDomain))
        .filter((item): item is NonNullable<ReturnType<typeof normalizeIocFinding>> => item !== null);
      const findings = normalized.slice(0, THREATFOX_MAX_RESULTS);
      const discarded = inputRecords.length - normalized.length;
      const truncated = parsed.data.length > THREATFOX_MAX_INPUT_RESULTS || normalized.length > THREATFOX_MAX_RESULTS;
      const partial = truncated || discarded > 0 || findings.length === 0;
      return result(targetDomain, {
        state: partial ? 'partial' : 'success',
        truncated,
        detail: findings.length
          ? `Found ${findings.length} bounded malware-IOC record${findings.length === 1 ? '' : 's'} for this domain${truncated ? '; additional provider records may exist' : ''}.`
          : 'The provider reported a match but no returned record could be safely normalized.',
        upstreamStatus,
        findings,
        limitations: [
          'The provider retains malware-associated indicators for a limited period and does not represent complete historical coverage.',
          'An IOC association can be historical, shared, compromised, or reassigned and requires analyst review.',
          ...(discarded > 0
            ? [`${discarded} provider record${discarded === 1 ? ' was' : 's were'} omitted because it could not be safely normalized.`]
            : []),
        ],
      }, observedAt);
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return result(targetDomain, {
        state: 'error',
        detail: timedOut ? 'Malware-IOC lookup exceeded its bounded request deadline.' : 'Malware-IOC lookup could not be completed.',
      }, observedAt);
    } finally {
      activeRequests -= 1;
    }
  }

  return Object.freeze({ lookupDomain });
}

const defaultThreatfoxAdapter = createThreatfoxIntelligenceAdapter();

export {
  THREATFOX_PROVIDER,
  THREATFOX_SEARCH_ENDPOINT,
  THREATFOX_MAX_RESULTS,
  THREATFOX_MAX_RESPONSE_BYTES,
  THREATFOX_TIMEOUT_MS,
  threatfoxConfiguration,
  createThreatfoxIntelligenceAdapter,
};

export const lookupThreatfoxDomain = defaultThreatfoxAdapter.lookupDomain;
