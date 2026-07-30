import type {
  EvidenceCoverageEntry,
  EvidenceCoverageLedger,
} from './evidence-coverage-ledger.ts';

export const LOOKUP_SOURCE_REFRESH_VERSION = 1 as const;
export const LOOKUP_SOURCE_STALE_AFTER_DAYS = 7;
export const LOOKUP_SOURCE_REFRESH_TIMEOUT_MS = 40_000;
export const MAX_LOOKUP_SOURCE_REFRESH_KEYS = 512;
export const MAX_LOOKUP_SOURCE_REFRESH_BYTES = 2 * 1024 * 1024;

export type LookupSourceRefreshId = 'availability' | 'rdap' | 'whois';

export type LookupSourceRefreshPlanItem = Readonly<{
  id: LookupSourceRefreshId;
  label: string;
  endpoint: '/api/availability' | '/api/rdap' | '/api/whois';
  evidenceIds: readonly string[];
  reason: 'limited' | 'stale';
  requestDisclosure: string;
}>;

export type LookupSourceRefreshPlan = Readonly<{
  version: typeof LOOKUP_SOURCE_REFRESH_VERSION;
  stale: boolean;
  ageDays: number | null;
  items: readonly LookupSourceRefreshPlanItem[];
  limitations: readonly string[];
}>;

export type LookupSourceRefreshResult = Readonly<{
  id: LookupSourceRefreshId;
  state: 'complete' | 'limited' | 'unavailable';
  detail: string;
  observedAt: string;
}>;

type RefreshRequestOutcome =
  | { readonly ok: true; readonly value: LookupSourceRefreshResult }
  | { readonly ok: false; readonly message: string };

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const DOMAIN_EVIDENCE_IDS = new Set([
  'availability',
  'client-behavior',
  'dns',
  'http',
  'page-identity',
  'page-role',
  'security-posture',
  'technology',
  'tls',
]);

function observedAgeDays(observedAt: unknown, now: unknown): number | null {
  if (typeof observedAt !== 'string' || typeof now !== 'string') return null;
  const observedMs = Date.parse(observedAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.floor((nowMs - observedMs) / 86_400_000));
}

function limited(entries: readonly EvidenceCoverageEntry[], ids: ReadonlySet<string>): boolean {
  return entries.some((entry) => ids.has(entry.id) && entry.manualReviewSuggested);
}

function availableIds(entries: readonly EvidenceCoverageEntry[], ids: ReadonlySet<string>): string[] {
  return entries.filter((entry) => ids.has(entry.id)).map((entry) => entry.id).slice(0, 12);
}

export function buildLookupSourceRefreshPlan(
  ledger: EvidenceCoverageLedger,
  observedAt: unknown,
  now: unknown = new Date().toISOString(),
): LookupSourceRefreshPlan {
  const ageDays = observedAgeDays(observedAt, now);
  const stale = ageDays !== null && ageDays >= LOOKUP_SOURCE_STALE_AFTER_DAYS;
  const entries = ledger.entries.slice(0, 24);
  const plans: LookupSourceRefreshPlanItem[] = [];
  const groups: Array<{
    id: LookupSourceRefreshId;
    label: string;
    endpoint: LookupSourceRefreshPlanItem['endpoint'];
    ids: ReadonlySet<string>;
    disclosure: string;
  }> = [
    {
      id: 'rdap',
      label: 'Registry RDAP',
      endpoint: '/api/rdap',
      ids: new Set(['rdap']),
      disclosure: 'Starts one bounded registry RDAP operation for this target.',
    },
    {
      id: 'whois',
      label: 'WHOIS',
      endpoint: '/api/whois',
      ids: new Set(['whois']),
      disclosure: 'Starts one bounded referral-aware WHOIS operation for this target.',
    },
    {
      id: 'availability',
      label: 'Domain evidence',
      endpoint: '/api/availability',
      ids: DOMAIN_EVIDENCE_IDS,
      disclosure: 'Repeats the bounded domain-evidence branch, including eligible DNS, HTTP, page, and TLS work for the selected depth.',
    },
  ];
  for (const group of groups) {
    const evidenceIds = availableIds(entries, group.ids);
    if (!evidenceIds.length) continue;
    const isLimited = limited(entries, group.ids);
    if (!isLimited && !stale) continue;
    plans.push({
      id: group.id,
      label: group.label,
      endpoint: group.endpoint,
      evidenceIds,
      reason: isLimited ? 'limited' : 'stale',
      requestDisclosure: group.disclosure,
    });
  }
  return {
    version: LOOKUP_SOURCE_REFRESH_VERSION,
    stale,
    ageDays,
    items: plans,
    limitations: [
      'A source refresh is displayed separately and never merged into the original unified Lookup envelope.',
      'Run a complete Lookup before saving, comparing, or exporting replacement evidence collected at one review time.',
      'A retry can remain partial or unavailable and never proves that missing evidence is absent.',
    ],
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function boundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LOOKUP_SOURCE_REFRESH_BYTES) {
    throw new Error('oversized');
  }
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_LOOKUP_SOURCE_REFRESH_BYTES) throw new Error('oversized');
      chunks.push(value);
    }
  } finally {
    if (total > MAX_LOOKUP_SOURCE_REFRESH_BYTES) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

function text(value: unknown, maximum = 180): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function summarizeSource(
  id: LookupSourceRefreshId,
  body: Record<string, unknown>,
  observedAt: string,
  depth: 'deep' | 'fast',
): LookupSourceRefreshResult {
  if (id === 'rdap') {
    const upstreamStatus = Number(body.upstreamStatus);
    const parsed = record(body.parsed);
    const complete = upstreamStatus === 200 && Object.keys(parsed).length > 0;
    return {
      id,
      state: complete ? 'complete' : 'limited',
      detail: complete
        ? `Registry RDAP returned a validated ${upstreamStatus} response.`
        : `Registry RDAP returned ${Number.isFinite(upstreamStatus) ? `HTTP ${upstreamStatus}` : 'no complete structured record'}.`,
      observedAt,
    };
  }
  if (id === 'whois') {
    const chain = Array.isArray(body.chain) ? body.chain : [];
    const chainStatus = text(record(body.parsed).chainStatus, 40);
    const complete = chain.length > 0 && chainStatus === 'complete';
    return {
      id,
      state: complete ? 'complete' : 'limited',
      detail: complete
        ? `WHOIS returned a complete ${chain.length}-hop referral chain.`
        : `WHOIS returned ${chain.length} hop${chain.length === 1 ? '' : 's'} with ${chainStatus || 'unknown'} chain status.`,
      observedAt,
    };
  }
  const state = text(body.state, 40) || 'unknown';
  const complete = body.deepScanComplete === true
    || (depth === 'fast' && state !== 'unknown');
  const sourceStates = ['dns', 'http', 'tls']
    .map((key) => text(record(body[key]).status, 40))
    .filter(Boolean);
  return {
    id,
    state: complete ? 'complete' : 'limited',
    detail: `Domain evidence returned ${state}${sourceStates.length ? `; DNS, HTTP, and TLS states: ${sourceStates.join(', ')}` : ''}.`,
    observedAt,
  };
}

export async function requestLookupSourceRefresh(
  plan: LookupSourceRefreshPlanItem,
  query: string,
  depth: 'deep' | 'fast',
  options: Readonly<{
    fetchImpl?: FetchImplementation;
    timeoutMs?: number;
    now?: () => string;
  }> = {},
): Promise<RefreshRequestOutcome> {
  const normalizedQuery = text(query, 4096);
  if (!normalizedQuery) return { ok: false, message: 'A valid Lookup target is required.' };
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.min(LOOKUP_SOURCE_REFRESH_TIMEOUT_MS, Math.round(Number(options.timeoutMs))))
    : LOOKUP_SOURCE_REFRESH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    const url = `${plan.endpoint}?q=${encodeURIComponent(normalizedQuery)}${plan.id === 'availability' && depth === 'fast' ? '&fast=true' : ''}`;
    const response = await (options.fetchImpl ?? fetch)(url, {
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const body = record(await boundedJson(response));
    if (!response.ok) {
      return {
        ok: false,
        message: text(body.error, 240) || `Source refresh failed with HTTP ${response.status}.`,
      };
    }
    if (Object.keys(body).length > MAX_LOOKUP_SOURCE_REFRESH_KEYS) {
      return { ok: false, message: 'Source refresh returned an oversized record.' };
    }
    return {
      ok: true,
      value: summarizeSource(plan.id, body, options.now?.() ?? new Date().toISOString(), depth),
    };
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'oversized') {
      return { ok: false, message: 'Source refresh returned an oversized response.' };
    }
    return {
      ok: false,
      message: controller.signal.aborted ? 'Source refresh timed out.' : 'Source refresh could not be completed.',
    };
  } finally {
    clearTimeout(timeout);
  }
}
