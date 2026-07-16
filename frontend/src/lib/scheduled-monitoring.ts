import {
  ALLOWED_SCHEDULE_INTERVAL_HOURS,
  isScheduledMonitorId,
  MAX_SCHEDULED_DOMAINS,
  MAX_SCHEDULED_WATCHLISTS,
  normalizeScheduledWatchlistName,
  SCHEDULED_MONITOR_SCHEMA,
  SCHEDULED_MONITOR_SCHEMA_VERSION,
  SCHEDULED_WATCHLIST_STATUSES,
} from './analysis/scheduled-monitor-model.js';
import { normalizeWatchlistEntry } from './analysis/watchlist-history.js';
import type { WatchlistEntry } from './watchlists';

export type ScheduledWatchlistStatus = typeof SCHEDULED_WATCHLIST_STATUSES[number];
export type ScheduledWatchlist = {
  id: string;
  name: string;
  enabled: boolean;
  intervalHours: number;
  revision: number;
  domainCount: number;
  updatedAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  status: ScheduledWatchlistStatus;
  lastError: string | null;
  prunedHistoryEvents: number;
  entry: WatchlistEntry;
  progress: { completed: number; total: number } | null;
};
export type ScheduledMonitoringCapacity = {
  version: 1;
  triggerIntervalMinutes: number;
  lookupLimitPerInvocation: number;
  theoreticalLookupsPerWeek: number;
  admittedLookupsPerWeek: number;
  projectedLookupsPerWeek: number;
  remainingLookupsPerWeek: number;
  utilizationPercent: number;
  reservePercent: number;
};
export type ScheduledMonitoringState = {
  schema: typeof SCHEDULED_MONITOR_SCHEMA;
  version: typeof SCHEDULED_MONITOR_SCHEMA_VERSION;
  watchlists: ScheduledWatchlist[];
};
export type ScheduledMonitoringResponse = {
  state: ScheduledMonitoringState;
  capacity: ScheduledMonitoringCapacity;
  action: 'created' | 'updated' | 'deleted' | 'unchanged' | null;
  id: string | null;
};
export type ScheduledMonitoringCommand =
  | { action: 'create'; name: string; entry: WatchlistEntry; intervalHours: number }
  | { action: 'update'; id: string; name?: string; entry?: WatchlistEntry; intervalHours?: number; enabled?: boolean }
  | { action: 'delete'; id: string };

const ENDPOINT = '/api/scheduled-monitor';
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const INTERVALS = new Set<number>(ALLOWED_SCHEDULE_INTERVAL_HOURS);
const STATUSES = new Set<string>(SCHEDULED_WATCHLIST_STATUSES);
const ACTIONS = new Set(['created', 'updated', 'deleted', 'unchanged']);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function integer(value: unknown, minimum: number, maximum: number): number | null {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? value as number
    : null;
}

function timestamp(value: unknown, nullable = true): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function boundedText(value: unknown, maximum: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return null;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}

function normalizeProgress(value: unknown, domainCount: number) {
  if (value === null) return null;
  const input = record(value);
  if (!input) return null;
  const completed = integer(input.completed, 0, domainCount);
  const total = integer(input.total, 1, MAX_SCHEDULED_DOMAINS);
  return completed !== null && total === domainCount
    ? { completed, total }
    : null;
}

function normalizeScheduledWatchlist(value: unknown): ScheduledWatchlist | null {
  const input = record(value);
  const id = typeof input?.id === 'string' && isScheduledMonitorId(input.id) ? input.id : null;
  if (!input || !id) return null;
  const name = normalizeScheduledWatchlistName(input.name);
  const intervalHours = integer(input.intervalHours, 1, 168);
  const revision = integer(input.revision, 1, Number.MAX_SAFE_INTEGER);
  const domainCount = integer(input.domainCount, 1, MAX_SCHEDULED_DOMAINS);
  const updatedAt = timestamp(input.updatedAt, false);
  if (!name
    || typeof input.enabled !== 'boolean'
    || intervalHours === null
    || !INTERVALS.has(intervalHours)
    || revision === null
    || domainCount === null
    || !updatedAt
    || typeof input.status !== 'string'
    || !STATUSES.has(input.status)) return null;

  const entryInput = record(input.entry);
  if (!entryInput) return null;
  const entry = normalizeWatchlistEntry(entryInput) as WatchlistEntry;
  if (entry.results.length !== domainCount || entry.results.length === 0) return null;
  const lastError = input.lastError === null ? null : boundedText(input.lastError, 300);
  if (input.lastError !== null && lastError === null) return null;
  const nextRunAt = timestamp(input.nextRunAt);
  const lastRunAt = timestamp(input.lastRunAt);
  if ((input.nextRunAt !== null && nextRunAt === null)
    || (input.lastRunAt !== null && lastRunAt === null)) return null;
  const prunedHistoryEvents = integer(input.prunedHistoryEvents, 0, 1_000_000);
  if (prunedHistoryEvents === null) return null;
  const progress = normalizeProgress(input.progress, domainCount);
  if (input.progress !== null && progress === null) return null;
  return {
    id,
    name,
    enabled: input.enabled,
    intervalHours,
    revision,
    domainCount,
    updatedAt,
    nextRunAt,
    lastRunAt,
    status: input.status as ScheduledWatchlistStatus,
    lastError,
    prunedHistoryEvents,
    entry,
    progress,
  };
}

function normalizeState(value: unknown): ScheduledMonitoringState | null {
  const input = record(value);
  if (!input
    || input.schema !== SCHEDULED_MONITOR_SCHEMA
    || input.version !== SCHEDULED_MONITOR_SCHEMA_VERSION
    || !Array.isArray(input.watchlists)) return null;
  const watchlists: ScheduledWatchlist[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const candidate of input.watchlists.slice(0, MAX_SCHEDULED_WATCHLISTS * 4)) {
    const watchlist = normalizeScheduledWatchlist(candidate);
    if (!watchlist) continue;
    const nameKey = watchlist.name.toLowerCase();
    if (ids.has(watchlist.id) || names.has(nameKey)) continue;
    ids.add(watchlist.id);
    names.add(nameKey);
    watchlists.push(watchlist);
    if (watchlists.length >= MAX_SCHEDULED_WATCHLISTS) break;
  }
  return {
    schema: SCHEDULED_MONITOR_SCHEMA,
    version: SCHEDULED_MONITOR_SCHEMA_VERSION,
    watchlists,
  };
}

function normalizeCapacity(value: unknown, state: ScheduledMonitoringState): ScheduledMonitoringCapacity | null {
  const input = record(value);
  if (!input || input.version !== 1) return null;
  const triggerIntervalMinutes = integer(input.triggerIntervalMinutes, 1, 60);
  const lookupLimitPerInvocation = integer(input.lookupLimitPerInvocation, 1, 10);
  const reservePercent = integer(input.reservePercent, 0, 90);
  if (triggerIntervalMinutes === null || lookupLimitPerInvocation === null || reservePercent === null) return null;
  const theoretical = Math.floor(7 * 24 * 60 / triggerIntervalMinutes) * lookupLimitPerInvocation;
  const admitted = Math.floor(theoretical * (100 - reservePercent) / 100);
  const projected = state.watchlists.reduce((total, watchlist) => (
    total + (watchlist.enabled ? watchlist.domainCount * (7 * 24 / watchlist.intervalHours) : 0)
  ), 0);
  const remaining = Math.max(0, admitted - projected);
  const utilization = Number((projected / admitted * 100).toFixed(2));
  if (input.theoreticalLookupsPerWeek !== theoretical
    || input.admittedLookupsPerWeek !== admitted
    || input.projectedLookupsPerWeek !== projected
    || input.remainingLookupsPerWeek !== remaining
    || input.utilizationPercent !== utilization) return null;
  return {
    version: 1,
    triggerIntervalMinutes,
    lookupLimitPerInvocation,
    theoreticalLookupsPerWeek: theoretical,
    admittedLookupsPerWeek: admitted,
    projectedLookupsPerWeek: projected,
    remainingLookupsPerWeek: remaining,
    utilizationPercent: utilization,
    reservePercent,
  };
}

export function normalizeScheduledMonitoringResponse(value: unknown): ScheduledMonitoringResponse | null {
  const input = record(value);
  if (!input) return null;
  const state = normalizeState(input.state);
  if (!state) return null;
  const capacity = normalizeCapacity(input.capacity, state);
  if (!capacity) return null;
  const action = input.action === undefined || input.action === null
    ? null
    : typeof input.action === 'string' && ACTIONS.has(input.action)
      ? input.action as ScheduledMonitoringResponse['action']
      : null;
  if (input.action !== undefined && input.action !== null && action === null) return null;
  const id = input.id === undefined || input.id === null
    ? null
    : typeof input.id === 'string' && isScheduledMonitorId(input.id) ? input.id : null;
  if (input.id !== undefined && input.id !== null && id === null) return null;
  if ((action === null) !== (id === null)) return null;
  return { state, capacity, action, id };
}

async function responseError(response: Response): Promise<Error> {
  try {
    const body = record(await response.json());
    const message = boundedText(body?.error, 300);
    if (message) return new Error(message);
  } catch {
    // A malformed error body is reported through the stable fallback below.
  }
  return new Error(`Hosted monitoring request failed (${response.status}).`);
}

async function parseResponse(response: Response): Promise<ScheduledMonitoringResponse> {
  if (!response.ok) throw await responseError(response);
  const normalized = normalizeScheduledMonitoringResponse(await response.json());
  if (!normalized) throw new Error('Hosted monitoring returned an invalid response.');
  return normalized;
}

export async function fetchScheduledMonitoring(
  fetcher: typeof fetch = fetch,
): Promise<ScheduledMonitoringResponse> {
  return parseResponse(await fetcher(ENDPOINT, {
    credentials: 'same-origin',
    cache: 'no-store',
  }));
}

export async function mutateScheduledMonitoring(
  command: ScheduledMonitoringCommand,
  fetcher: typeof fetch = fetch,
): Promise<ScheduledMonitoringResponse> {
  return parseResponse(await fetcher(ENDPOINT, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  }));
}
