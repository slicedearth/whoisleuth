// Pure state contract for optional hosted watchlist monitoring. Storage,
// scheduling, authentication, network lookup, and notification adapters live
// outside this module. The model retains only the same compact, authority-aware
// evidence accepted by browser-local watchlists and rejects future schemas.

import {
  compactWatchlistResults,
  MAX_WATCHLIST_CHANGES_PER_EVENT,
  normalizeWatchlistEntry,
} from './watchlist-history.js';

export const SCHEDULED_MONITOR_SCHEMA = 'whoisleuth.scheduled-monitor';
export const SCHEDULED_MONITOR_SCHEMA_VERSION = 1;
export const MAX_SCHEDULED_WATCHLISTS = 20;
export const MAX_SCHEDULED_WATCHLIST_INPUTS = MAX_SCHEDULED_WATCHLISTS * 4;
export const MAX_SCHEDULED_DOMAINS = 100;
export const MAX_SCHEDULED_HISTORY_EVENTS = 6;
export const MAX_SCHEDULED_CHANGES_PER_EVENT = 100;
export const MAX_SCHEDULED_NAME_LENGTH = 100;
export const MAX_SCHEDULED_ERROR_LENGTH = 300;
export const MAX_SCHEDULED_MONITOR_STORE_BYTES = 1536 * 1024;
export const MAX_SCHEDULED_MONITOR_STATIC_BYTES = 896 * 1024;
export const MAX_SCHEDULED_PRUNED_HISTORY_EVENTS = 1_000_000;
export const ALLOWED_SCHEDULE_INTERVAL_HOURS = Object.freeze([6, 12, 24, 168]);
export const SCHEDULED_WATCHLIST_STATUSES = Object.freeze([
  'idle',
  'queued',
  'running',
  'complete',
  'partial',
  'failed',
  'paused',
]);

const INTERVALS = new Set(ALLOWED_SCHEDULE_INTERVAL_HOURS);
const STATUSES = new Set(SCHEDULED_WATCHLIST_STATUSES);
const SAFE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const BLOCKED_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_TIMESTAMP_LENGTH = 64;
const EPOCH = new Date(0).toISOString();

function plainRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function isScheduledMonitorId(value) {
  return typeof value === 'string' && SAFE_ID_RE.test(value);
}

function safeId(value) {
  return isScheduledMonitorId(value) ? value : null;
}

function makeId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  throw new Error('Secure random identifiers are unavailable.');
}

function isoOrNull(value) {
  if (typeof value !== 'string' || value.length > MAX_TIMESTAMP_LENGTH || CONTROL_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function positiveRevision(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

export function nextScheduledMonitorRevision(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Scheduled monitoring revision is invalid or exhausted.');
  }
  return value + 1;
}

function boundedCounter(value, maximum = MAX_SCHEDULED_PRUNED_HISTORY_EVENTS) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, maximum) : 0;
}

function boundedError(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
  return normalized.slice(0, MAX_SCHEDULED_ERROR_LENGTH).trim() || null;
}

export function normalizeScheduledWatchlistName(value) {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return '';
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > MAX_SCHEDULED_NAME_LENGTH) return '';
  return BLOCKED_NAMES.has(normalized.toLowerCase()) ? '' : normalized;
}

function scheduledSources(results) {
  return compactWatchlistResults(results).slice(0, MAX_SCHEDULED_DOMAINS).map((record) => ({
    domain: record.domain,
    mutationTypes: record.mutationTypes,
  }));
}

function scheduledRunSources(results) {
  return compactWatchlistResults(results).slice(0, MAX_SCHEDULED_DOMAINS).map((record) => ({
    domain: record.domain,
  }));
}

function sourceFingerprint(sources) {
  return JSON.stringify(sources.map(({ domain }) => domain));
}

function normalizeScheduledEntry(value) {
  const input = plainRecord(value);
  if (!input) return null;
  const normalized = normalizeWatchlistEntry(input);
  const results = normalized.results.slice(0, MAX_SCHEDULED_DOMAINS);
  if (results.length === 0) return null;
  const domains = new Set(results.map((record) => record.domain));
  const baseline = normalized.baseline
    .filter((record) => domains.has(record.domain))
    .slice(0, MAX_SCHEDULED_DOMAINS);
  const history = normalized.history.slice(-MAX_SCHEDULED_HISTORY_EVENTS).map((event) => {
    const relevantChanges = event.changes.filter((change) => domains.has(change.domain));
    const changes = relevantChanges.slice(0, MAX_SCHEDULED_CHANGES_PER_EVENT);
    const newlyOmitted = Math.max(0, relevantChanges.length - changes.length);
    const omittedChanges = Math.min(
      MAX_WATCHLIST_CHANGES_PER_EVENT,
      event.omittedChanges + newlyOmitted,
    );
    return {
      checkedAt: event.checkedAt,
      mode: event.mode,
      resultCount: Math.min(event.resultCount, MAX_SCHEDULED_DOMAINS),
      conclusiveCount: Math.min(event.conclusiveCount, MAX_SCHEDULED_DOMAINS),
      changeCount: Math.min(
        MAX_WATCHLIST_CHANGES_PER_EVENT,
        Math.max(event.changeCount, changes.length + omittedChanges),
      ),
      omittedChanges,
      changes,
    };
  });
  return {
    updatedAt: normalized.updatedAt,
    results,
    baseline,
    history,
  };
}

function normalizeStoredWatchlist(value) {
  const record = plainRecord(value);
  if (!record) return null;
  const id = safeId(record.id);
  const name = normalizeScheduledWatchlistName(record.name);
  const entry = normalizeScheduledEntry(record.entry);
  if (!id || !name || !entry) return null;
  const enabled = record.enabled !== false;
  const intervalHours = INTERVALS.has(record.intervalHours) ? record.intervalHours : 24;
  const candidateStatus = STATUSES.has(record.status) ? record.status : 'idle';
  return {
    id,
    name,
    enabled,
    intervalHours,
    revision: positiveRevision(record.revision),
    createdAt: isoOrNull(record.createdAt) || EPOCH,
    updatedAt: isoOrNull(record.updatedAt) || EPOCH,
    nextRunAt: enabled ? isoOrNull(record.nextRunAt) : null,
    lastRunAt: isoOrNull(record.lastRunAt),
    status: enabled ? (candidateStatus === 'paused' ? 'idle' : candidateStatus) : 'paused',
    lastError: boundedError(record.lastError),
    prunedHistoryEvents: boundedCounter(record.prunedHistoryEvents),
    sources: scheduledSources(entry.results),
    entry,
  };
}

function normalizeLease(value, cursor) {
  const record = plainRecord(value);
  if (!record) return null;
  const token = safeId(record.token);
  const expiresAt = isoOrNull(record.expiresAt);
  return token && expiresAt && record.cursor === cursor
    ? { token, cursor, expiresAt }
    : null;
}

function normalizeActiveRun(value, watchlistsById) {
  const record = plainRecord(value);
  if (!record) return null;
  const id = safeId(record.id);
  const watchlistId = safeId(record.watchlistId);
  const watchlist = watchlistId ? watchlistsById.get(watchlistId) : null;
  if (!id || !watchlist?.enabled || record.watchlistRevision !== watchlist.revision) return null;

  const sources = scheduledRunSources(record.sources);
  const expectedSources = watchlist.sources.map(({ domain }) => ({ domain }));
  if (sources.length === 0 || sourceFingerprint(sources) !== sourceFingerprint(expectedSources)) return null;
  const cursor = Number.isSafeInteger(record.cursor)
    && record.cursor >= 0
    && record.cursor <= sources.length
    ? record.cursor
    : null;
  if (cursor === null) return null;

  const results = compactWatchlistResults(record.results).slice(0, cursor).map((result) => ({
    ...result,
    mutationTypes: [],
  }));
  if (results.length !== cursor) return null;
  for (let index = 0; index < cursor; index += 1) {
    if (results[index].domain !== sources[index].domain) return null;
  }

  return {
    id,
    watchlistId,
    watchlistRevision: watchlist.revision,
    cursor,
    sources,
    results,
    errorCount: Number.isSafeInteger(record.errorCount)
      ? Math.max(0, Math.min(record.errorCount, cursor))
      : 0,
    startedAt: isoOrNull(record.startedAt) || EPOCH,
    updatedAt: isoOrNull(record.updatedAt) || EPOCH,
    lease: normalizeLease(record.lease, cursor),
  };
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function assertStoreBudget(state) {
  if (byteLength(JSON.stringify(state)) > MAX_SCHEDULED_MONITOR_STORE_BYTES) {
    throw new Error('Scheduled monitoring storage is full. Remove or reduce a scheduled watchlist before saving more.');
  }
  return state;
}

export function assertScheduledMonitorStaticBudget(value) {
  const state = normalizeScheduledMonitorState(value);
  const staticState = { ...state, activeRun: null };
  if (byteLength(JSON.stringify(staticState)) > MAX_SCHEDULED_MONITOR_STATIC_BYTES) {
    throw new Error('Scheduled monitoring storage is full. Remove or reduce a scheduled watchlist before saving more.');
  }
  return state;
}

export function pruneScheduledMonitorHistoryToStaticBudget(value) {
  const record = plainRecord(value);
  if (!record
    || record.schema !== SCHEDULED_MONITOR_SCHEMA
    || record.version !== SCHEDULED_MONITOR_SCHEMA_VERSION
    || !Array.isArray(record.watchlists)) {
    throw new Error('Scheduled monitoring data uses an unsupported schema version.');
  }
  if (record.activeRun !== null) {
    throw new Error('Scheduled monitoring history cannot be pruned while a scan is active.');
  }
  const state = structuredClone(record);
  let pruned = 0;
  const affectedWatchlists = new Set();
  while (byteLength(JSON.stringify(state)) > MAX_SCHEDULED_MONITOR_STATIC_BYTES) {
    const candidates = state.watchlists
      .filter((watchlist) => Array.isArray(watchlist?.entry?.history) && watchlist.entry.history.length > 1)
      .sort((left, right) => {
        const leftTime = Date.parse(left.entry.history[0]?.checkedAt || EPOCH);
        const rightTime = Date.parse(right.entry.history[0]?.checkedAt || EPOCH);
        return leftTime - rightTime || String(left.id || '').localeCompare(String(right.id || ''));
      });
    const candidate = candidates[0];
    if (!candidate) {
      throw new Error('Scheduled monitoring storage is full. Remove or reduce a scheduled watchlist before saving more.');
    }
    candidate.entry.history.shift();
    candidate.prunedHistoryEvents = boundedCounter(boundedCounter(candidate.prunedHistoryEvents) + 1);
    affectedWatchlists.add(candidate.id);
    pruned += 1;
  }
  for (const watchlist of state.watchlists) {
    if (affectedWatchlists.has(watchlist.id)) {
      watchlist.revision = nextScheduledMonitorRevision(watchlist.revision);
    }
  }
  return { state: normalizeScheduledMonitorState(state), pruned };
}

export function emptyScheduledMonitorState() {
  return {
    schema: SCHEDULED_MONITOR_SCHEMA,
    version: SCHEDULED_MONITOR_SCHEMA_VERSION,
    watchlists: [],
    activeRun: null,
  };
}

export function normalizeScheduledMonitorState(value) {
  const record = plainRecord(value);
  if (!record
    || record.schema !== SCHEDULED_MONITOR_SCHEMA
    || record.version !== SCHEDULED_MONITOR_SCHEMA_VERSION) {
    throw new Error('Scheduled monitoring data uses an unsupported schema version.');
  }
  const watchlists = [];
  const ids = new Set();
  const names = new Set();
  const candidates = Array.isArray(record.watchlists)
    ? record.watchlists.slice(0, MAX_SCHEDULED_WATCHLIST_INPUTS)
    : [];
  for (const candidate of candidates) {
    const watchlist = normalizeStoredWatchlist(candidate);
    const nameKey = watchlist?.name.toLowerCase();
    if (!watchlist || ids.has(watchlist.id) || names.has(nameKey)) continue;
    ids.add(watchlist.id);
    names.add(nameKey);
    watchlists.push(watchlist);
    if (watchlists.length >= MAX_SCHEDULED_WATCHLISTS) break;
  }
  const byId = new Map(watchlists.map((watchlist) => [watchlist.id, watchlist]));
  const activeRun = normalizeActiveRun(record.activeRun, byId);
  const consistentWatchlists = watchlists.map((watchlist) => {
    const activeForWatchlist = activeRun?.watchlistId === watchlist.id ? activeRun : null;
    return {
      ...watchlist,
      status: activeForWatchlist
        ? activeForWatchlist.lease ? 'running' : 'queued'
        : watchlist.status === 'running' || watchlist.status === 'queued'
          ? 'idle'
          : watchlist.status,
    };
  });
  return assertStoreBudget({
    schema: SCHEDULED_MONITOR_SCHEMA,
    version: SCHEDULED_MONITOR_SCHEMA_VERSION,
    watchlists: consistentWatchlists,
    activeRun,
  });
}

export function createScheduledWatchlist({
  name,
  entry,
  intervalHours = 24,
  now = new Date().toISOString(),
  id = makeId(),
}) {
  const normalizedName = normalizeScheduledWatchlistName(name);
  if (!normalizedName) {
    throw new Error('Scheduled watchlist names must be 1–100 characters without control characters.');
  }
  if (!INTERVALS.has(intervalHours)) throw new Error('Unsupported scheduled scan interval.');
  if (!safeId(id)) throw new Error('Scheduled watchlist identifier is invalid.');
  const timestamp = isoOrNull(now);
  if (!timestamp) throw new Error('Scheduled watchlist timestamp is invalid.');
  if (!Array.isArray(entry?.results) || entry.results.length === 0) {
    throw new Error('The watchlist has no valid domains to monitor.');
  }
  if (entry.results.length > MAX_SCHEDULED_DOMAINS) {
    throw new Error(`Scheduled watchlists are limited to ${MAX_SCHEDULED_DOMAINS} domains.`);
  }
  const normalizedEntry = normalizeScheduledEntry(entry);
  if (!normalizedEntry) throw new Error('The watchlist has no valid domains to monitor.');
  const created = normalizeStoredWatchlist({
    id,
    name: normalizedName,
    enabled: true,
    intervalHours,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    nextRunAt: timestamp,
    lastRunAt: null,
    status: 'idle',
    lastError: null,
    prunedHistoryEvents: 0,
    entry: normalizedEntry,
  });
  if (!created) throw new Error('Could not create the scheduled watchlist.');
  return created;
}

export function scheduledMonitorPublicState(value) {
  const state = normalizeScheduledMonitorState(value);
  return {
    schema: state.schema,
    version: state.version,
    watchlists: state.watchlists.map((watchlist) => ({
      id: watchlist.id,
      name: watchlist.name,
      enabled: watchlist.enabled,
      intervalHours: watchlist.intervalHours,
      revision: watchlist.revision,
      domainCount: watchlist.sources.length,
      updatedAt: watchlist.updatedAt,
      nextRunAt: watchlist.nextRunAt,
      lastRunAt: watchlist.lastRunAt,
      status: watchlist.status,
      lastError: watchlist.lastError,
      prunedHistoryEvents: watchlist.prunedHistoryEvents,
      entry: watchlist.entry,
      progress: state.activeRun?.watchlistId === watchlist.id
        ? { completed: state.activeRun.cursor, total: state.activeRun.sources.length }
        : null,
    })),
  };
}
