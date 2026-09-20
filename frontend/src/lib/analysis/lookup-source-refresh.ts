import type {
  EvidenceCoverageEntry,
  EvidenceCoverageLedger,
} from './evidence-coverage-ledger.ts';
import type { LookupTaskView } from './lookup-presentation.ts';
import type { LookupHttpResponse } from './lookup-response.ts';
import type { CheckpointFact } from './case-evidence-checkpoint.ts';
import type { CaseRecord } from '../cases.ts';
import type { LocalMutationOutcome } from '../local-mutation-outcome.ts';
import { sourceRefreshTarget, readSourceRefreshObservation } from './lookup-source-observation.ts';
import { scanBoundedJson } from '../../../../lib/bounded-json.mts';
import { readObservationTime } from '../../../../packages/evidence/observation.mts';
import {
  BoundedJsonResponseError,
  requestJsonCapped,
} from '../bounded-json-response.ts';

export const LOOKUP_SOURCE_REFRESH_VERSION = 1 as const;
export const LOOKUP_FRESHNESS_POLICY_VERSION = 1 as const;
export const LOOKUP_SOURCE_REFRESH_TIMEOUT_MS = 40_000;
export const MAX_LOOKUP_SOURCE_REFRESH_KEYS = 512;
export const MAX_LOOKUP_SOURCE_REFRESH_BYTES = 2 * 1024 * 1024;
export const MAX_LOOKUP_SOURCE_REFRESH_HISTORY = 12;

export type LookupSourceRefreshId = 'availability' | 'rdap' | 'whois';
export type LookupFreshnessThresholds = Readonly<{
  registration: number;
  network: number;
  web: number;
}>;
export type LookupFreshnessPolicy = Readonly<{
  version: typeof LOOKUP_FRESHNESS_POLICY_VERSION;
  id: 'task-default' | 'analyst-custom';
  task: LookupTaskView;
  thresholdsDays: LookupFreshnessThresholds;
}>;
export type LookupFreshnessPolicyInput = Readonly<{
  id?: unknown;
  thresholdsDays?: Readonly<Partial<Record<keyof LookupFreshnessThresholds, unknown>>>;
}>;

export type LookupSourceRefreshPlanItem = Readonly<{
  id: LookupSourceRefreshId;
  label: string;
  endpoint: '/api/availability' | '/api/rdap' | '/api/whois';
  evidenceIds: readonly string[];
  reason: 'limited' | 'stale';
  requestDisclosure: string;
  supersedesObservedAt: string | null;
  ageDays?: number | null;
  staleAfterDays?: number;
}>;

export type LookupSourceRefreshPlan = Readonly<{
  version: typeof LOOKUP_SOURCE_REFRESH_VERSION;
  stale: boolean;
  ageDays: number | null;
  freshnessPolicy: LookupFreshnessPolicy;
  items: readonly LookupSourceRefreshPlanItem[];
  limitations: readonly string[];
}>;

export type LookupSourceRefreshResult = Readonly<{
  version: typeof LOOKUP_SOURCE_REFRESH_VERSION;
  id: LookupSourceRefreshId;
  state: 'complete' | 'limited' | 'unavailable';
  detail: string;
  observedAt: string | null;
  attemptedAt: string;
  facts: readonly CheckpointFact[];
}>;

export type LookupSourceRefreshLedger = Readonly<{
  version: typeof LOOKUP_SOURCE_REFRESH_VERSION;
  entries: readonly LookupSourceRefreshResult[];
}>;

export type SourceRefreshCaseTarget = Readonly<{
  record: CaseRecord | null;
  ready: boolean;
  busy: boolean;
  status: string;
  oncreate: () => Promise<void>;
  onsave: (facts: readonly CheckpointFact[], fields: string[]) => Promise<LocalMutationOutcome>;
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
const NETWORK_EVIDENCE_IDS = new Set(['availability', 'dns', 'reverse-dns', 'network-context']);
const WEB_EVIDENCE_IDS = new Set(['http', 'tls', 'page-identity', 'page-role', 'client-behavior', 'security-posture', 'technology']);
const TASK_FRESHNESS_THRESHOLDS: Readonly<Record<LookupTaskView, LookupFreshnessThresholds>> = Object.freeze({
  general: Object.freeze({ registration: 30, network: 7, web: 3 }),
  acquisition: Object.freeze({ registration: 7, network: 3, web: 3 }),
  brand: Object.freeze({ registration: 30, network: 3, web: 1 }),
  incident: Object.freeze({ registration: 14, network: 1, web: 1 }),
  owned: Object.freeze({ registration: 30, network: 7, web: 3 }),
});

function freshnessDays(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(365, Math.round(parsed))) : fallback;
}

export function buildLookupFreshnessPolicy(
  task: LookupTaskView,
  input?: LookupFreshnessPolicyInput,
): LookupFreshnessPolicy {
  const defaults = TASK_FRESHNESS_THRESHOLDS[task];
  const custom = input?.id === 'analyst-custom';
  return {
    version: LOOKUP_FRESHNESS_POLICY_VERSION,
    id: custom ? 'analyst-custom' : 'task-default',
    task,
    thresholdsDays: custom ? {
      registration: freshnessDays(input?.thresholdsDays?.registration, defaults.registration),
      network: freshnessDays(input?.thresholdsDays?.network, defaults.network),
      web: freshnessDays(input?.thresholdsDays?.web, defaults.web),
    } : { ...defaults },
  };
}

function limited(entries: readonly EvidenceCoverageEntry[], ids: ReadonlySet<string>): boolean {
  return entries.some((entry) => ids.has(entry.id) && entry.manualReviewSuggested);
}

function availableIds(entries: readonly EvidenceCoverageEntry[], ids: ReadonlySet<string>): string[] {
  return entries.filter((entry) => ids.has(entry.id) && entry.state !== 'skipped' && entry.state !== 'unsupported')
    .map((entry) => entry.id).slice(0, 12);
}

export function buildLookupSourceRefreshPlan(
  ledger: EvidenceCoverageLedger,
  observedAt: unknown,
  now: unknown = new Date().toISOString(),
  options: Readonly<{
    task?: LookupTaskView;
    freshnessPolicy?: LookupFreshnessPolicyInput;
    observedAtByEvidence?: Readonly<Record<string, unknown>>;
  }> = {},
): LookupSourceRefreshPlan {
  const { ageDays } = readObservationTime(observedAt, now);
  const freshnessPolicy = buildLookupFreshnessPolicy(options.task ?? 'general', options.freshnessPolicy);
  const entries = ledger.entries.slice(0, 24);
  const plans: LookupSourceRefreshPlanItem[] = [];
  let stale = false;
  let unknownSourceTimes = false;
  const groups: Array<{
    id: LookupSourceRefreshId;
    label: string;
    endpoint: LookupSourceRefreshPlanItem['endpoint'];
    ids: ReadonlySet<string>;
    disclosure: string;
    threshold: keyof LookupFreshnessThresholds;
  }> = [
    {
      id: 'rdap',
      label: 'Registry RDAP',
      endpoint: '/api/rdap',
      ids: new Set(['rdap']),
      disclosure: 'Starts one bounded registry RDAP operation for this target.',
      threshold: 'registration',
    },
    {
      id: 'whois',
      label: 'WHOIS',
      endpoint: '/api/whois',
      ids: new Set(['whois']),
      disclosure: 'Starts one bounded referral-aware WHOIS operation for this target.',
      threshold: 'registration',
    },
    {
      id: 'availability',
      label: 'Domain evidence',
      endpoint: '/api/availability',
      ids: DOMAIN_EVIDENCE_IDS,
      disclosure: 'Repeats the bounded domain-evidence branch, including eligible DNS, HTTP, page, and TLS work for the selected depth.',
      threshold: 'network',
    },
  ];
  for (const group of groups) {
    const evidenceIds = availableIds(entries, group.ids);
    if (!evidenceIds.length) continue;
    const thresholds = evidenceIds.map((id) => WEB_EVIDENCE_IDS.has(id)
      ? freshnessPolicy.thresholdsDays.web
      : NETWORK_EVIDENCE_IDS.has(id)
        ? freshnessPolicy.thresholdsDays.network
        : freshnessPolicy.thresholdsDays[group.threshold]);
    const staleAfterDays = Math.min(...thresholds);
    // Availability is a derived decision; refresh age belongs to its collected inputs.
    const sourceTimes = evidenceIds.flatMap((id, index) => id === 'availability' ? [] : [{
      ...readObservationTime(options.observedAtByEvidence?.[id], now),
      threshold: thresholds[index]!,
    }]);
    const unknownTime = sourceTimes.some((time) => time.ageDays === null);
    const groupAgeDays = unknownTime || !sourceTimes.length ? null : Math.max(...sourceTimes.map((time) => time.ageDays!));
    const groupStale = sourceTimes.some((time) => time.ageDays !== null && time.ageDays >= time.threshold);
    const isLimited = limited(entries, group.ids) || unknownTime;
    stale ||= groupStale;
    unknownSourceTimes ||= unknownTime;
    if (!isLimited && !groupStale) continue;
    const observationTimes = new Set(sourceTimes.map((time) => time.observedAt));
    plans.push({
      id: group.id,
      label: group.label,
      endpoint: group.endpoint,
      evidenceIds,
      reason: isLimited ? 'limited' : 'stale',
      requestDisclosure: group.disclosure,
      supersedesObservedAt: !unknownTime && observationTimes.size === 1 ? sourceTimes[0]!.observedAt : null,
      ageDays: groupAgeDays,
      staleAfterDays,
    });
  }
  return {
    version: LOOKUP_SOURCE_REFRESH_VERSION,
    stale,
    ageDays,
    freshnessPolicy,
    items: plans,
    limitations: [
      ...(unknownSourceTimes ? ['Some source observation times are missing, invalid or in the future; their age is unknown.'] : []),
      'A source refresh is displayed separately and never merged into the original unified Lookup envelope.',
      'Compare normalised facts here or retain selected dated facts in a Case. A full Lookup export still represents the original result.',
      'Freshness thresholds organise review only. They do not make an older observation false or a newer observation complete.',
    ],
  };
}


function unavailableRefreshResult(
  plan: LookupSourceRefreshPlanItem,
  attemptedAt: string,
  detail: string,
): LookupSourceRefreshResult {
  return {
    version: LOOKUP_SOURCE_REFRESH_VERSION,
    id: plan.id,
    state: 'unavailable',
    detail,
    observedAt: null,
    attemptedAt,
    facts: [],
  };
}

export async function requestLookupSourceRefresh(
  plan: LookupSourceRefreshPlanItem,
  original: LookupHttpResponse,
  depth: 'deep' | 'fast',
  options: Readonly<{
    fetchImpl?: FetchImplementation;
    timeoutMs?: number;
    now?: () => string;
    signal?: AbortSignal;
  }> = {},
): Promise<RefreshRequestOutcome> {
  let normalizedQuery: string;
  try { normalizedQuery = sourceRefreshTarget(plan.id, original); }
  catch (cause) { return { ok: false, message: cause instanceof Error ? cause.message : 'A valid Lookup target is required.' }; }
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.min(LOOKUP_SOURCE_REFRESH_TIMEOUT_MS, Math.round(Number(options.timeoutMs))))
    : LOOKUP_SOURCE_REFRESH_TIMEOUT_MS;
  const attemptedAt = options.now?.() ?? new Date().toISOString();
  try {
    const url = `${plan.endpoint}?q=${encodeURIComponent(normalizedQuery)}${plan.id === 'availability' && depth === 'fast' ? '&fast=true' : ''}`;
    const { response, body: rawBody } = await requestJsonCapped(url, {
      credentials: 'same-origin',
      ...(options.signal ? { signal: options.signal } : {}),
    }, {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      maximumBytes: MAX_LOOKUP_SOURCE_REFRESH_BYTES,
      timeoutMs,
      validateRawJson: raw => scanBoundedJson(raw),
    });
    if (!response.ok) {
      return {
        ok: true,
        value: unavailableRefreshResult(
          plan,
          attemptedAt,
          `The source returned HTTP ${response.status}; no new observation was recorded.`,
        ),
      };
    }
    if (rawBody && typeof rawBody === 'object' && Object.keys(rawBody).length > MAX_LOOKUP_SOURCE_REFRESH_KEYS) {
      return { ok: false, message: 'Source refresh returned an oversized record.' };
    }
    return {
      ok: true,
      value: { version: LOOKUP_SOURCE_REFRESH_VERSION, id: plan.id, attemptedAt,
        ...readSourceRefreshObservation(plan.id, rawBody, original, depth, options.now?.() ?? new Date().toISOString()),
      },
    };
  } catch (cause) {
    if (options.signal?.aborted) return { ok: false, message: 'Source refresh cancelled. No new observation was retained.' };
    if (cause instanceof BoundedJsonResponseError && cause.code === 'response_too_large') {
      return { ok: true, value: unavailableRefreshResult(plan, attemptedAt, 'The source response exceeded the local limit; no new observation was recorded.') };
    }
    return {
      ok: true,
      value: unavailableRefreshResult(
        plan,
        attemptedAt,
        cause instanceof BoundedJsonResponseError && cause.code === 'timeout'
          ? 'The source refresh timed out; no new observation was recorded.'
          : 'The source refresh could not be completed; no new observation was recorded.',
      ),
    };
  }
}

export function mergeLookupSourceRefreshLedger(
  current: LookupSourceRefreshLedger | null,
  result: LookupSourceRefreshResult,
): LookupSourceRefreshLedger {
  const entries = current?.version === LOOKUP_SOURCE_REFRESH_VERSION ? current.entries : [];
  if (entries.length >= MAX_LOOKUP_SOURCE_REFRESH_HISTORY) {
    throw new RangeError('Remove a reviewed refresh entry before collecting another. Existing observations were kept.');
  }
  return { version: LOOKUP_SOURCE_REFRESH_VERSION, entries: [...entries, result] };
}
