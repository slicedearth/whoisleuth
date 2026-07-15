// Optional, lookup-only URLscan Search API adapter. The adapter searches
// existing public scan history and never submits a target for scanning. It is
// disabled unless the deployment explicitly enables it and supplies an API
// key; credentials are sent only in a header to the fixed HTTPS endpoint.

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

const URLSCAN_SEARCH_ENDPOINT = 'https://urlscan.io/api/v1/search/';
const URLSCAN_SEARCH_DAYS = 90;
const URLSCAN_MAX_RESULTS = 20;
const URLSCAN_MAX_RESPONSE_BYTES = 256 * 1024;
const URLSCAN_TIMEOUT_MS = 6_000;
const URLSCAN_DAILY_REQUESTS = 1_000;
const URLSCAN_MONTHLY_REQUESTS = 30_000;
const MAX_API_KEY_LENGTH = 256;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const URLSCAN_PROVIDER = defineThreatIntelligenceProvider({
  id: 'urlscan_search',
  label: 'URLscan archived verdicts',
  capabilities: ['domain_lookup', 'indicator_search'],
  targets: { domain: 'registrable_domain' },
  interaction: 'lookup_only',
  terms: {
    reviewedAt: '2026-07-15T00:00:00.000Z',
    termsUrl: 'https://urlscan.io/terms/',
    privacyUrl: 'https://urlscan.io/privacy/',
    commercialUse: 'restricted',
    attribution: 'unknown',
    caching: 'prohibited',
    queryRetention: 'provider_defined',
    redistribution: 'restricted',
  },
  limits: {
    timeoutMs: URLSCAN_TIMEOUT_MS,
    maxResponseBytes: URLSCAN_MAX_RESPONSE_BYTES,
    cacheTtlMs: 0,
    concurrency: 1,
    dailyRequests: URLSCAN_DAILY_REQUESTS,
    monthlyRequests: URLSCAN_MONTHLY_REQUESTS,
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function enabledValue(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function normalizedApiKey(value: unknown): string | null {
  if (typeof value !== 'string'
    || value.length < 8
    || value.length > MAX_API_KEY_LENGTH
    || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  return value;
}

function urlscanConfiguration(env: EnvironmentInput | null | undefined = process.env) {
  const source = env && typeof env === 'object' ? env : {};
  const enabled = enabledValue(source.WHOISLEUTH_ENABLE_URLSCAN);
  const apiKey = normalizedApiKey(source.URLSCAN_API_KEY);
  return {
    enabled,
    configured: enabled && apiKey !== null,
    apiKey: enabled ? apiKey : null,
    reason: !enabled
      ? 'Archived URLscan verdict search is not enabled for this deployment.'
      : apiKey
        ? null
        : 'Archived URLscan verdict search is enabled but its API credential is unavailable or malformed.',
  };
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized ? normalized.slice(0, maxLength) : null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function retryAfterSeconds(response: Response): number | null {
  for (const name of ['retry-after', 'x-rate-limit-reset-after']) {
    const value = response.headers.get(name);
    if (!value || !/^\d{1,6}$/u.test(value.trim())) continue;
    const seconds = Number(value);
    if (Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 86_400) return seconds;
  }
  return null;
}

function targetDomainFromUrl(value: unknown): string | null {
  const raw = boundedText(value, 2_048);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    const classified = classifyQuery(parsed.hostname);
    return classified.type === 'domain' ? classified.registrableDomain : null;
  } catch {
    return null;
  }
}

function normalizedCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .slice(0, 40)
    .map((item) => boundedText(item, 64)?.toLowerCase() || null)
    .filter((item): item is string => item !== null))]
    .sort()
    .slice(0, 20);
}

function findingCategory(tags: string[]): 'phishing' | 'malware' | 'spam' | 'suspicious' | 'abuse' {
  if (tags.some((tag) => tag.includes('phish'))) return 'phishing';
  if (tags.some((tag) => tag.includes('malware'))) return 'malware';
  if (tags.some((tag) => tag.includes('spam'))) return 'spam';
  if (tags.some((tag) => tag.includes('abuse'))) return 'abuse';
  return 'suspicious';
}

function normalizeSearchFinding(value: unknown, targetDomain: string) {
  if (!isRecord(value)) return null;
  const task = isRecord(value.task) ? value.task : {};
  const page = isRecord(value.page) ? value.page : {};
  const verdicts = isRecord(value.verdicts) ? value.verdicts : {};
  const id = boundedText(value._id, 80) || boundedText(task.uuid, 80);
  if (!id || !UUID_RE.test(id) || targetDomainFromUrl(task.url) !== targetDomain) return null;
  // The fixed query requires verdicts.malicious:true. A contradictory response
  // is discarded rather than being presented as a positive provider finding;
  // an omitted property remains acceptable because API fields are optional.
  if (verdicts.malicious === false) return null;
  const categories = normalizedCategories(verdicts.categories);
  const observedAt = isoTimestamp(task.time) || isoTimestamp(value.date);
  const title = boundedText(page.title, 180);
  return {
    id,
    category: findingCategory(categories),
    // The search verdict is binary and does not publish a portable severity
    // scale, so keep severity unknown instead of inventing one locally.
    severity: 'unknown',
    confidence: 'medium',
    providerVerdict: 'malicious verdict match',
    detail: title ? `Archived scan page title: ${title}` : 'An archived scan matched the provider malicious-verdict query.',
    firstObservedAt: observedAt,
    lastObservedAt: observedAt,
    referenceUrl: `https://urlscan.io/result/${id}/`,
    tags: categories,
  };
}

function searchUrl(targetDomain: string): string {
  const url = new URL(URLSCAN_SEARCH_ENDPOINT);
  url.searchParams.set('q', `task.apexDomain:${targetDomain} AND verdicts.malicious:true AND date:>now-${URLSCAN_SEARCH_DAYS}d`);
  url.searchParams.set('size', String(URLSCAN_MAX_RESULTS));
  return url.toString();
}

function result(
  targetDomain: string,
  input: Record<string, unknown>,
  observedAt: string,
): ThreatIntelligenceResult {
  return createThreatIntelligenceResult(
    URLSCAN_PROVIDER,
    { type: 'domain', value: targetDomain },
    input,
    observedAt,
  );
}

function createUrlscanIntelligenceAdapter(dependencies: AdapterDependencies = {}) {
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
    if (dayRequests >= URLSCAN_DAILY_REQUESTS || monthRequests >= URLSCAN_MONTHLY_REQUESTS) return false;
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
      throw new TypeError('URLscan intelligence requires a valid registrable domain');
    }
    const configuration = urlscanConfiguration(options.env);
    if (!configuration.configured || !configuration.apiKey) {
      return result(targetDomain, {
        state: configuration.enabled ? 'unavailable' : 'skipped',
        detail: configuration.reason,
      }, observedAt);
    }
    if (activeRequests >= URLSCAN_PROVIDER.limits.concurrency) {
      return result(targetDomain, {
        state: 'unavailable',
        detail: 'The local URLscan request concurrency limit is already in use; try again shortly.',
      }, observedAt);
    }
    if (!consumeLocalBudget(now())) {
      return result(targetDomain, {
        state: 'rate_limited',
        detail: 'The local URLscan request budget has been reached for this runtime instance.',
      }, observedAt);
    }

    activeRequests += 1;
    try {
      const { response } = await fetchDetailed(searchUrl(targetDomain), {
        headers: {
          accept: 'application/json',
          'api-key': configuration.apiKey,
          'user-agent': 'WHOISleuth/1.0',
        },
        signal: AbortSignal.timeout(URLSCAN_PROVIDER.limits.timeoutMs),
      }, { maxRedirects: 0 });
      const upstreamStatus = response.status;
      if (upstreamStatus === 429) {
        await response.body?.cancel().catch(() => {});
        return result(targetDomain, {
          state: 'rate_limited',
          detail: 'URLscan reported that its search quota is temporarily exhausted.',
          upstreamStatus,
          retryAfterSeconds: retryAfterSeconds(response),
        }, observedAt);
      }
      if (upstreamStatus === 401 || upstreamStatus === 403) {
        await response.body?.cancel().catch(() => {});
        return result(targetDomain, {
          state: 'unavailable',
          detail: 'URLscan did not accept the configured search credential.',
          upstreamStatus,
        }, observedAt);
      }
      if (upstreamStatus < 200 || upstreamStatus >= 300) {
        await response.body?.cancel().catch(() => {});
        return result(targetDomain, {
          state: 'error',
          detail: `URLscan search failed with HTTP ${upstreamStatus}.`,
          upstreamStatus,
        }, observedAt);
      }

      const captured = await readResponse(response, URLSCAN_PROVIDER.limits.maxResponseBytes);
      if (captured.truncated) {
        return result(targetDomain, {
          state: 'error',
          detail: 'URLscan search returned a response larger than the configured safety limit.',
          upstreamStatus,
        }, observedAt);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(captured.text);
      } catch {
        return result(targetDomain, {
          state: 'error',
          detail: 'URLscan search returned malformed JSON.',
          upstreamStatus,
        }, observedAt);
      }
      if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
        return result(targetDomain, {
          state: 'error',
          detail: 'URLscan search returned an unexpected response shape.',
          upstreamStatus,
        }, observedAt);
      }

      const rawResults = parsed.results.slice(0, URLSCAN_MAX_RESULTS);
      const findings = rawResults
        .map((item) => normalizeSearchFinding(item, targetDomain))
        .filter((item): item is NonNullable<ReturnType<typeof normalizeSearchFinding>> => item !== null);
      const overLimit = parsed.results.length > URLSCAN_MAX_RESULTS || parsed.has_more === true;
      const invalid = rawResults.length - findings.length;
      if (!findings.length && parsed.results.length === 0) {
        return result(targetDomain, {
          state: 'not_found',
          detail: `No archived malicious-verdict match was returned for the last ${URLSCAN_SEARCH_DAYS} days.`,
          upstreamStatus,
        }, observedAt);
      }
      return result(targetDomain, {
        state: overLimit || invalid > 0 ? 'partial' : 'success',
        truncated: overLimit,
        detail: overLimit
          ? `Showing the newest ${findings.length} bounded archived malicious-verdict match${findings.length === 1 ? '' : 'es'}; older matches may exist.`
          : invalid > 0
            ? `${invalid} provider record${invalid === 1 ? ' was' : 's were'} omitted because it could not be safely normalized.`
            : `Found ${findings.length} archived malicious-verdict match${findings.length === 1 ? '' : 'es'} in the last ${URLSCAN_SEARCH_DAYS} days.`,
        upstreamStatus,
        findings,
        limitations: [
          'Search covers archived scans and provider verdicts only; it does not submit or rescan the domain.',
          `Search is limited to the newest ${URLSCAN_MAX_RESULTS} matches from the last ${URLSCAN_SEARCH_DAYS} days.`,
        ],
      }, observedAt);
    } catch (error) {
      const timedOut = error instanceof Error
        && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return result(targetDomain, {
        state: 'error',
        detail: timedOut
          ? 'URLscan search exceeded its bounded request deadline.'
          : 'URLscan search could not be completed.',
      }, observedAt);
    } finally {
      activeRequests -= 1;
    }
  }

  return Object.freeze({ lookupDomain });
}

const defaultUrlscanAdapter = createUrlscanIntelligenceAdapter();

export {
  URLSCAN_PROVIDER,
  URLSCAN_SEARCH_ENDPOINT,
  URLSCAN_SEARCH_DAYS,
  URLSCAN_MAX_RESULTS,
  URLSCAN_MAX_RESPONSE_BYTES,
  URLSCAN_TIMEOUT_MS,
  urlscanConfiguration,
  createUrlscanIntelligenceAdapter,
};

export const lookupUrlscanDomain = defaultUrlscanAdapter.lookupDomain;
