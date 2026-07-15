// Optional, lookup-only malware-host adapter. It queries an existing public
// intelligence corpus and never submits a URL, hostname, or sample. The
// adapter is disabled unless the deployment explicitly enables it and supplies
// an Auth-Key; credentials are sent only in a header to the fixed HTTPS host
// lookup endpoint.

import { classifyQuery } from './classify.mts';
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

const URLHAUS_HOST_ENDPOINT = 'https://urlhaus-api.abuse.ch/v1/host/';
const URLHAUS_MAX_RESULTS = 20;
const URLHAUS_MAX_INPUT_RESULTS = 100;
const URLHAUS_MAX_RESPONSE_BYTES = 256 * 1024;
const URLHAUS_TIMEOUT_MS = 6_000;
// These are conservative process-local guardrails below the provider's
// unspecified fair-use query-volume ceiling. Provider-side account limits
// remain authoritative, and serverless cold starts can reset local counters.
const URLHAUS_DAILY_REQUESTS = 200;
const URLHAUS_MONTHLY_REQUESTS = 3_000;
const MAX_AUTH_KEY_LENGTH = 256;
const MAX_URL_ID_LENGTH = 24;

const URLHAUS_PROVIDER = defineThreatIntelligenceProvider({
  id: 'urlhaus_host',
  label: 'URLhaus malware-host records',
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
    timeoutMs: URLHAUS_TIMEOUT_MS,
    maxResponseBytes: URLHAUS_MAX_RESPONSE_BYTES,
    cacheTtlMs: 0,
    concurrency: 1,
    dailyRequests: URLHAUS_DAILY_REQUESTS,
    monthlyRequests: URLHAUS_MONTHLY_REQUESTS,
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function enabledValue(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function normalizedAuthKey(value: unknown): string | null {
  if (typeof value !== 'string'
    || value.length < 8
    || value.length > MAX_AUTH_KEY_LENGTH
    || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  return value;
}

function urlhausConfiguration(env: EnvironmentInput | null | undefined = process.env) {
  const source = env && typeof env === 'object' ? env : {};
  const enabled = enabledValue(source.WHOISLEUTH_ENABLE_URLHAUS);
  const authKey = normalizedAuthKey(source.URLHAUS_AUTH_KEY);
  return {
    enabled,
    configured: enabled && authKey !== null,
    authKey: enabled ? authKey : null,
    reason: !enabled
      ? 'Malware-host intelligence is not enabled for this deployment.'
      : authKey
        ? null
        : 'Malware-host intelligence is enabled but its API credential is unavailable or malformed.',
  };
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized ? normalized.slice(0, maxLength) : null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?: UTC)?$/u.test(trimmed)
    ? `${trimmed.slice(0, 10)}T${trimmed.slice(11, 19)}Z`
    : trimmed;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (!value || !/^\d{1,6}$/u.test(value.trim())) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 86_400 ? seconds : null;
}

function exactDomainFromUrl(value: unknown): string | null {
  const raw = boundedText(value, 2_048);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    const classified = classifyQuery(parsed.hostname);
    return classified.type === 'domain' ? classified.inputHostname : null;
  } catch {
    return null;
  }
}

function exactDomain(value: unknown): string | null {
  const raw = boundedText(value, 253);
  if (!raw) return null;
  try {
    const classified = classifyQuery(raw);
    return classified.type === 'domain' ? classified.inputHostname : null;
  } catch {
    return null;
  }
}

function normalizedTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .slice(0, 40)
    .map((item) => boundedText(item, 64)?.toLowerCase() || null)
    .filter((item): item is string => item !== null))]
    .sort()
    .slice(0, 18);
}

function normalizedUrlCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000) return value;
  if (typeof value !== 'string' || !/^\d{1,7}$/u.test(value.trim())) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count <= 1_000_000 ? count : null;
}

function normalizeHostFinding(value: unknown, targetDomain: string) {
  if (!isRecord(value)) return null;
  const id = boundedText(value.id, MAX_URL_ID_LENGTH);
  const status = boundedText(value.url_status, 16)?.toLowerCase();
  const threat = boundedText(value.threat, 64)?.toLowerCase();
  if (!id
    || !/^\d{1,24}$/u.test(id)
    || !status
    || !['online', 'offline', 'unknown'].includes(status)
    || threat !== 'malware_download'
    || exactDomainFromUrl(value.url) !== targetDomain) return null;
  const observedAt = isoTimestamp(value.date_added);
  const tags = normalizedTags(value.tags);
  tags.push(`url-status:${status}`);
  return {
    id,
    category: 'malware',
    // The provider classifies URL purpose and online state, but does not
    // publish a portable severity or confidence scale for the host record.
    severity: 'unknown',
    confidence: 'medium',
    providerVerdict: `malware distribution · ${status}`,
    detail: `The provider labels an archived malware-distribution URL on this host as ${status}. A host may have been compromised and the record may be historical.`,
    firstObservedAt: observedAt,
    lastObservedAt: observedAt,
    referenceUrl: `https://urlhaus.abuse.ch/url/${id}/`,
    tags,
  };
}

function result(
  targetDomain: string,
  input: Record<string, unknown>,
  observedAt: string,
): ThreatIntelligenceResult {
  return createThreatIntelligenceResult(
    URLHAUS_PROVIDER,
    { type: 'domain', value: targetDomain },
    input,
    observedAt,
  );
}

function createUrlhausIntelligenceAdapter(dependencies: AdapterDependencies = {}) {
  const fetchDetailed = dependencies.fetchDetailed || safeFetchDetailed;
  const readResponse = dependencies.readResponse || readTextCapped;
  const now = dependencies.now || Date.now;
  let activeRequests = 0;
  let dayBucket = '';
  let monthBucket = '';
  let dayRequests = 0;
  let monthRequests = 0;

  function consumeLocalBudget(timestamp: number): boolean {
    const date = new Date(timestamp);
    const nextDay = date.toISOString().slice(0, 10);
    const nextMonth = nextDay.slice(0, 7);
    if (nextDay !== dayBucket) {
      dayBucket = nextDay;
      dayRequests = 0;
    }
    if (nextMonth !== monthBucket) {
      monthBucket = nextMonth;
      monthRequests = 0;
    }
    if (dayRequests >= URLHAUS_PROVIDER.limits.dailyRequests
      || monthRequests >= URLHAUS_PROVIDER.limits.monthlyRequests) return false;
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
      throw new TypeError('Malware-host intelligence requires a valid registrable domain');
    }
    const configuration = urlhausConfiguration(options.env);
    if (!configuration.configured || !configuration.authKey) {
      return result(targetDomain, {
        state: configuration.enabled ? 'unavailable' : 'skipped',
        detail: configuration.reason,
      }, observedAt);
    }
    if (activeRequests >= URLHAUS_PROVIDER.limits.concurrency) {
      return result(targetDomain, {
        state: 'unavailable',
        detail: 'The local malware-host request concurrency limit is already in use; try again shortly.',
      }, observedAt);
    }
    if (!consumeLocalBudget(now())) {
      return result(targetDomain, {
        state: 'rate_limited',
        detail: 'The local malware-host request budget has been reached for this runtime instance.',
      }, observedAt);
    }

    activeRequests += 1;
    try {
      const body = new URLSearchParams({ host: targetDomain }).toString();
      const { response } = await fetchDetailed(URLHAUS_HOST_ENDPOINT, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'auth-key': configuration.authKey,
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'user-agent': 'WHOISleuth/1.0',
        },
        body,
        signal: AbortSignal.timeout(URLHAUS_PROVIDER.limits.timeoutMs),
      }, { maxRedirects: 0 });
      const upstreamStatus = response.status;
      if (upstreamStatus === 429) {
        await response.body?.cancel().catch(() => {});
        return result(targetDomain, {
          state: 'rate_limited',
          detail: 'The malware-host provider reported that its query quota is temporarily exhausted.',
          upstreamStatus,
          retryAfterSeconds: retryAfterSeconds(response),
        }, observedAt);
      }
      if (upstreamStatus === 401 || upstreamStatus === 403) {
        await response.body?.cancel().catch(() => {});
        return result(targetDomain, {
          state: 'unavailable',
          detail: 'The malware-host provider did not accept the configured API credential.',
          upstreamStatus,
        }, observedAt);
      }
      if (upstreamStatus < 200 || upstreamStatus >= 300) {
        await response.body?.cancel().catch(() => {});
        return result(targetDomain, {
          state: 'error',
          detail: `Malware-host lookup failed with HTTP ${upstreamStatus}.`,
          upstreamStatus,
        }, observedAt);
      }

      const captured = await readResponse(response, URLHAUS_PROVIDER.limits.maxResponseBytes);
      if (captured.truncated) {
        return result(targetDomain, {
          state: 'error',
          detail: 'Malware-host lookup returned a response larger than the configured safety limit.',
          upstreamStatus,
        }, observedAt);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(captured.text);
      } catch {
        return result(targetDomain, {
          state: 'error',
          detail: 'Malware-host lookup returned malformed JSON.',
          upstreamStatus,
        }, observedAt);
      }
      if (!isRecord(parsed) || typeof parsed.query_status !== 'string') {
        return result(targetDomain, {
          state: 'error',
          detail: 'Malware-host lookup returned an unexpected response shape.',
          upstreamStatus,
        }, observedAt);
      }

      const queryStatus = parsed.query_status.trim().toLowerCase();
      if (queryStatus === 'no_results') {
        return result(targetDomain, {
          state: 'not_found',
          detail: 'The provider returned no malware-distribution record for this registrable domain.',
          upstreamStatus,
        }, observedAt);
      }
      if (['no_api_key', 'auth_key_invalid', 'user_blacklisted'].includes(queryStatus)) {
        return result(targetDomain, {
          state: 'unavailable',
          detail: 'The malware-host provider did not accept the configured API credential.',
          upstreamStatus,
        }, observedAt);
      }
      if (queryStatus !== 'ok'
        || exactDomain(parsed.host) !== targetDomain
        || !Array.isArray(parsed.urls)) {
        return result(targetDomain, {
          state: 'error',
          detail: 'Malware-host lookup returned an invalid or mismatched host response.',
          upstreamStatus,
        }, observedAt);
      }

      const inputRecords = parsed.urls.slice(0, URLHAUS_MAX_INPUT_RESULTS);
      const normalized = inputRecords
        .map((item) => normalizeHostFinding(item, targetDomain))
        .filter((item): item is NonNullable<ReturnType<typeof normalizeHostFinding>> => item !== null);
      const findings = normalized.slice(0, URLHAUS_MAX_RESULTS);
      const discarded = inputRecords.length - normalized.length;
      const urlCount = normalizedUrlCount(parsed.url_count);
      const truncated = parsed.urls.length > URLHAUS_MAX_INPUT_RESULTS
        || normalized.length > URLHAUS_MAX_RESULTS
        || (urlCount !== null && urlCount > parsed.urls.length);
      const partial = truncated || discarded > 0 || findings.length === 0;
      return result(targetDomain, {
        state: partial ? 'partial' : 'success',
        truncated,
        detail: findings.length
          ? `Found ${findings.length} bounded malware-distribution record${findings.length === 1 ? '' : 's'} for this host${truncated ? '; additional provider records may exist' : ''}.`
          : 'The provider reported this host but no returned record could be safely normalized.',
        upstreamStatus,
        findings,
        limitations: [
          'The provider tracks malware-distribution URLs, not phishing pages generally.',
          'A listed host may have been compromised, cleaned, or reassigned; record status and timestamps require analyst review.',
          ...(discarded > 0
            ? [`${discarded} provider record${discarded === 1 ? ' was' : 's were'} omitted because it could not be safely normalized.`]
            : []),
        ],
      }, observedAt);
    } catch (error) {
      const timedOut = error instanceof Error
        && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return result(targetDomain, {
        state: 'error',
        detail: timedOut
          ? 'Malware-host lookup exceeded its bounded request deadline.'
          : 'Malware-host lookup could not be completed.',
      }, observedAt);
    } finally {
      activeRequests -= 1;
    }
  }

  return Object.freeze({ lookupDomain });
}

const defaultUrlhausAdapter = createUrlhausIntelligenceAdapter();

export {
  URLHAUS_PROVIDER,
  URLHAUS_HOST_ENDPOINT,
  URLHAUS_MAX_RESULTS,
  URLHAUS_MAX_RESPONSE_BYTES,
  URLHAUS_TIMEOUT_MS,
  urlhausConfiguration,
  createUrlhausIntelligenceAdapter,
};

export const lookupUrlhausDomain = defaultUrlhausAdapter.lookupDomain;
