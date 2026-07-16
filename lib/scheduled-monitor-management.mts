// Provider-neutral authenticated-management contract for optional hosted
// monitoring. HTTP/authentication and Blob construction remain at deployment
// boundaries; this module owns strict commands, optimistic state updates,
// capacity admission, and public-state projection without exposing ciphertext,
// storage versions, leases, or encryption material.

import { randomUUID } from 'node:crypto';
import { MAX_CYCLE_LOOKUPS } from './scheduled-monitor-cycle.mts';
import { SCHEDULED_MONITOR_TRIGGER_INTERVAL_MINUTES } from './scheduled-monitor-configuration.mts';
import {
  ALLOWED_SCHEDULE_INTERVAL_HOURS,
  assertScheduledMonitorStaticBudget,
  createScheduledWatchlist,
  isScheduledMonitorId,
  MAX_SCHEDULED_WATCHLISTS,
  nextScheduledMonitorRevision,
  normalizeScheduledMonitorState,
  normalizeScheduledWatchlistName,
  scheduledMonitorPublicState,
} from '../frontend/src/lib/analysis/scheduled-monitor-model.js';

type ScheduledMonitorState = ReturnType<typeof normalizeScheduledMonitorState>;
type ScheduledMonitorPublicState = ReturnType<typeof scheduledMonitorPublicState>;
type RepositoryUpdate<Result> = {
  state: ScheduledMonitorState;
  result: Result;
  changed?: boolean;
};
type ScheduledMonitorRepositoryContract = {
  read: () => Promise<ScheduledMonitorState>;
  update: <Result>(mutator: (
    state: ScheduledMonitorState,
  ) => RepositoryUpdate<Result> | Promise<RepositoryUpdate<Result>>) => Promise<{
    state: ScheduledMonitorState;
    result: Result;
  }>;
};
type ScheduledMonitorManagerOptions = {
  repository: ScheduledMonitorRepositoryContract;
  now?: () => number;
  randomUUID?: () => string;
};
type ScheduledMonitorCommand = Record<string, unknown>;
type CapacityReport = {
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

const CAPACITY_VERSION = 1;
const CAPACITY_RESERVE_PERCENT = 25;
const MINUTES_PER_WEEK = 7 * 24 * 60;
const THEORETICAL_LOOKUPS_PER_WEEK = Math.floor(
  MINUTES_PER_WEEK / SCHEDULED_MONITOR_TRIGGER_INTERVAL_MINUTES,
) * MAX_CYCLE_LOOKUPS;
const ADMITTED_LOOKUPS_PER_WEEK = Math.floor(
  THEORETICAL_LOOKUPS_PER_WEEK * (100 - CAPACITY_RESERVE_PERCENT) / 100,
);
const INTERVALS = new Set(ALLOWED_SCHEDULE_INTERVAL_HOURS);
const CREATE_KEYS = new Set(['action', 'name', 'entry', 'intervalHours']);
const UPDATE_KEYS = new Set(['action', 'id', 'name', 'entry', 'intervalHours', 'enabled']);
const DELETE_KEYS = new Set(['action', 'id']);

const MANAGEMENT_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'SCHEDULED_MONITOR_INVALID_REQUEST',
  NOT_FOUND: 'SCHEDULED_MONITOR_NOT_FOUND',
  NAME_CONFLICT: 'SCHEDULED_MONITOR_NAME_CONFLICT',
  LIMIT_REACHED: 'SCHEDULED_MONITOR_LIMIT_REACHED',
  CAPACITY_EXCEEDED: 'SCHEDULED_MONITOR_CAPACITY_EXCEEDED',
});

type ManagementErrorCode = typeof MANAGEMENT_ERROR_CODES[keyof typeof MANAGEMENT_ERROR_CODES];

class ScheduledMonitorManagementError extends Error {
  code: ManagementErrorCode;

  constructor(code: ManagementErrorCode, message: string) {
    super(message);
    this.name = 'ScheduledMonitorManagementError';
    this.code = code;
  }
}

function managementError(code: ManagementErrorCode, message: string): never {
  throw new ScheduledMonitorManagementError(code, message);
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function repositoryContract(value: unknown): value is ScheduledMonitorRepositoryContract {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<ScheduledMonitorRepositoryContract>;
  return typeof candidate.read === 'function' && typeof candidate.update === 'function';
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function normalizedTimestamp(now: () => number): string {
  const value = now();
  if (!Number.isFinite(value)) {
    throw new Error('Scheduled monitoring management clock returned an invalid time.');
  }
  return new Date(Math.trunc(value)).toISOString();
}

function generatedId(source: () => string): string {
  const value = source();
  if (!isScheduledMonitorId(value)) {
    throw new Error('Scheduled monitoring management identifier source returned an invalid value.');
  }
  return value;
}

function weeklyLookups(watchlist: ScheduledMonitorState['watchlists'][number]): number {
  if (!watchlist.enabled) return 0;
  return watchlist.sources.length * (7 * 24 / watchlist.intervalHours);
}

function scheduledMonitorCapacity(value: unknown): CapacityReport {
  const state = normalizeScheduledMonitorState(value);
  const projectedLookupsPerWeek = state.watchlists.reduce(
    (total, watchlist) => total + weeklyLookups(watchlist),
    0,
  );
  const remainingLookupsPerWeek = Math.max(0, ADMITTED_LOOKUPS_PER_WEEK - projectedLookupsPerWeek);
  return {
    version: CAPACITY_VERSION,
    triggerIntervalMinutes: SCHEDULED_MONITOR_TRIGGER_INTERVAL_MINUTES,
    lookupLimitPerInvocation: MAX_CYCLE_LOOKUPS,
    theoreticalLookupsPerWeek: THEORETICAL_LOOKUPS_PER_WEEK,
    admittedLookupsPerWeek: ADMITTED_LOOKUPS_PER_WEEK,
    projectedLookupsPerWeek,
    remainingLookupsPerWeek,
    utilizationPercent: Number((projectedLookupsPerWeek / ADMITTED_LOOKUPS_PER_WEEK * 100).toFixed(2)),
    reservePercent: CAPACITY_RESERVE_PERCENT,
  };
}

function assertScheduledMonitorCapacity(value: unknown): CapacityReport {
  const capacity = scheduledMonitorCapacity(value);
  if (capacity.projectedLookupsPerWeek > capacity.admittedLookupsPerWeek) {
    managementError(
      MANAGEMENT_ERROR_CODES.CAPACITY_EXCEEDED,
      'This schedule exceeds the hosted monitoring capacity. Pause a watchlist, reduce its domains, or choose a longer interval.',
    );
  }
  return capacity;
}

function normalizeCommand(value: unknown): ScheduledMonitorCommand {
  const command = plainRecord(value);
  if (!command || typeof command.action !== 'string') {
    managementError(MANAGEMENT_ERROR_CODES.INVALID_REQUEST, 'A scheduled monitoring action is required.');
  }
  if (command.action === 'create') {
    if (!hasOnlyKeys(command, CREATE_KEYS)) {
      managementError(MANAGEMENT_ERROR_CODES.INVALID_REQUEST, 'The create action contains unsupported fields.');
    }
    return command;
  }
  if (command.action === 'update') {
    if (!hasOnlyKeys(command, UPDATE_KEYS)
      || !Object.hasOwn(command, 'id')
      || !['name', 'entry', 'intervalHours', 'enabled'].some((key) => Object.hasOwn(command, key))) {
      managementError(MANAGEMENT_ERROR_CODES.INVALID_REQUEST, 'The update action is incomplete or contains unsupported fields.');
    }
    return command;
  }
  if (command.action === 'delete') {
    if (!hasOnlyKeys(command, DELETE_KEYS) || !Object.hasOwn(command, 'id')) {
      managementError(MANAGEMENT_ERROR_CODES.INVALID_REQUEST, 'The delete action is incomplete or contains unsupported fields.');
    }
    return command;
  }
  managementError(MANAGEMENT_ERROR_CODES.INVALID_REQUEST, 'The scheduled monitoring action is unsupported.');
}

function assertUniqueName(
  state: ScheduledMonitorState,
  name: string,
  ignoredId: string | null = null,
): void {
  const key = name.toLowerCase();
  if (state.watchlists.some((watchlist) => watchlist.id !== ignoredId && watchlist.name.toLowerCase() === key)) {
    managementError(
      MANAGEMENT_ERROR_CODES.NAME_CONFLICT,
      'A scheduled watchlist with this name already exists.',
    );
  }
}

function publicResult(state: ScheduledMonitorState, result: Record<string, unknown>) {
  return {
    ...result,
    state: scheduledMonitorPublicState(state),
    capacity: scheduledMonitorCapacity(state),
  };
}

function normalizedManagedWatchlist(options: Parameters<typeof createScheduledWatchlist>[0]) {
  try {
    return createScheduledWatchlist(options);
  } catch {
    managementError(
      MANAGEMENT_ERROR_CODES.INVALID_REQUEST,
      'The scheduled watchlist contains invalid or over-limit evidence.',
    );
  }
}

function boundedStaticState(value: unknown): ScheduledMonitorState {
  try {
    return assertScheduledMonitorStaticBudget(value);
  } catch {
    managementError(
      MANAGEMENT_ERROR_CODES.LIMIT_REACHED,
      'Hosted monitoring storage is full. Remove or reduce a scheduled watchlist before saving more.',
    );
  }
}

function nextManagedRevision(value: number): number {
  try {
    return nextScheduledMonitorRevision(value);
  } catch {
    managementError(
      MANAGEMENT_ERROR_CODES.LIMIT_REACHED,
      'This scheduled watchlist cannot be revised again. Delete and recreate it to continue.',
    );
  }
}

function applyCreate(
  state: ScheduledMonitorState,
  command: ScheduledMonitorCommand,
  timestamp: string,
  id: string,
): RepositoryUpdate<Record<string, unknown>> {
  if (state.watchlists.length >= MAX_SCHEDULED_WATCHLISTS) {
    managementError(
      MANAGEMENT_ERROR_CODES.LIMIT_REACHED,
      `Hosted monitoring is limited to ${MAX_SCHEDULED_WATCHLISTS} scheduled watchlists.`,
    );
  }
  const name = normalizeScheduledWatchlistName(command.name);
  if (!name) {
    managementError(
      MANAGEMENT_ERROR_CODES.INVALID_REQUEST,
      'Scheduled watchlist names must be 1–100 characters without control characters.',
    );
  }
  assertUniqueName(state, name);
  const intervalHours = command.intervalHours === undefined ? 24 : command.intervalHours;
  if (typeof intervalHours !== 'number' || !INTERVALS.has(intervalHours)) {
    managementError(MANAGEMENT_ERROR_CODES.INVALID_REQUEST, 'Unsupported scheduled scan interval.');
  }
  const watchlist = normalizedManagedWatchlist({
    name,
    entry: command.entry,
    intervalHours,
    now: timestamp,
    id,
  });
  const next = boundedStaticState({
    ...state,
    watchlists: [...state.watchlists, watchlist],
  });
  assertScheduledMonitorCapacity(next);
  return {
    state: next,
    result: { action: 'created', id: watchlist.id },
  };
}

function applyUpdate(
  state: ScheduledMonitorState,
  command: ScheduledMonitorCommand,
  timestamp: string,
): RepositoryUpdate<Record<string, unknown>> {
  if (!isScheduledMonitorId(command.id)) {
    managementError(MANAGEMENT_ERROR_CODES.INVALID_REQUEST, 'Scheduled watchlist identifier is invalid.');
  }
  const index = state.watchlists.findIndex((watchlist) => watchlist.id === command.id);
  if (index === -1) {
    managementError(MANAGEMENT_ERROR_CODES.NOT_FOUND, 'The scheduled watchlist was not found.');
  }
  const current = state.watchlists[index];
  const name = Object.hasOwn(command, 'name')
    ? normalizeScheduledWatchlistName(command.name)
    : current.name;
  if (!name) {
    managementError(
      MANAGEMENT_ERROR_CODES.INVALID_REQUEST,
      'Scheduled watchlist names must be 1–100 characters without control characters.',
    );
  }
  assertUniqueName(state, name, current.id);
  const intervalHours = Object.hasOwn(command, 'intervalHours')
    ? command.intervalHours
    : current.intervalHours;
  if (!INTERVALS.has(intervalHours)) {
    managementError(MANAGEMENT_ERROR_CODES.INVALID_REQUEST, 'Unsupported scheduled scan interval.');
  }
  const enabled = Object.hasOwn(command, 'enabled') ? command.enabled : current.enabled;
  if (typeof enabled !== 'boolean') {
    managementError(MANAGEMENT_ERROR_CODES.INVALID_REQUEST, 'Scheduled watchlist enabled state must be true or false.');
  }
  const entryChanged = Object.hasOwn(command, 'entry');
  const replacement = entryChanged
    ? normalizedManagedWatchlist({
        name,
        entry: command.entry,
        intervalHours,
        now: timestamp,
        id: current.id,
      })
    : null;
  const relevantChange = name !== current.name
    || intervalHours !== current.intervalHours
    || enabled !== current.enabled
    || entryChanged;
  if (!relevantChange) {
    return { state, result: { action: 'unchanged', id: current.id }, changed: false };
  }

  const nextWatchlist = {
    ...current,
    name,
    enabled,
    intervalHours,
    revision: nextManagedRevision(current.revision),
    updatedAt: timestamp,
    nextRunAt: enabled
      ? (entryChanged || intervalHours !== current.intervalHours || current.enabled === false
          ? timestamp
          : current.nextRunAt || timestamp)
      : null,
    status: enabled ? 'idle' : 'paused',
    ...(replacement ? { entry: replacement.entry, sources: replacement.sources } : {}),
  };
  const watchlists = [...state.watchlists];
  watchlists[index] = nextWatchlist;
  const next = boundedStaticState({
    ...state,
    watchlists,
    activeRun: state.activeRun?.watchlistId === current.id ? null : state.activeRun,
  });
  assertScheduledMonitorCapacity(next);
  return {
    state: next,
    result: { action: 'updated', id: current.id },
  };
}

function applyDelete(
  state: ScheduledMonitorState,
  command: ScheduledMonitorCommand,
): RepositoryUpdate<Record<string, unknown>> {
  if (!isScheduledMonitorId(command.id)) {
    managementError(MANAGEMENT_ERROR_CODES.INVALID_REQUEST, 'Scheduled watchlist identifier is invalid.');
  }
  const existing = state.watchlists.find((watchlist) => watchlist.id === command.id);
  if (!existing) {
    managementError(MANAGEMENT_ERROR_CODES.NOT_FOUND, 'The scheduled watchlist was not found.');
  }
  return {
    state: normalizeScheduledMonitorState({
      ...state,
      watchlists: state.watchlists.filter((watchlist) => watchlist.id !== command.id),
      activeRun: state.activeRun?.watchlistId === command.id ? null : state.activeRun,
    }),
    result: { action: 'deleted', id: existing.id },
  };
}

function applyScheduledMonitorCommand(
  value: unknown,
  commandInput: unknown,
  options: { now: () => number; randomUUID: () => string },
): RepositoryUpdate<Record<string, unknown>> {
  const state = normalizeScheduledMonitorState(value);
  const command = normalizeCommand(commandInput);
  if (command.action === 'delete') return applyDelete(state, command);
  const timestamp = normalizedTimestamp(options.now);
  if (command.action === 'create') {
    return applyCreate(state, command, timestamp, generatedId(options.randomUUID));
  }
  return applyUpdate(state, command, timestamp);
}

function createScheduledMonitorManager(options: ScheduledMonitorManagerOptions) {
  if (!options || !repositoryContract(options.repository)) {
    throw new Error('A scheduled monitoring repository is required for management.');
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new Error('A scheduled monitoring management clock is required.');
  }
  if (options.randomUUID !== undefined && typeof options.randomUUID !== 'function') {
    throw new Error('A scheduled monitoring management identifier source is required.');
  }
  const now = options.now || Date.now;
  const idSource = options.randomUUID || randomUUID;
  return {
    async read(): Promise<{ state: ScheduledMonitorPublicState; capacity: CapacityReport }> {
      const state = normalizeScheduledMonitorState(await options.repository.read());
      return {
        state: scheduledMonitorPublicState(state),
        capacity: scheduledMonitorCapacity(state),
      };
    },
    async execute(command: unknown) {
      const outcome = await options.repository.update((state) => applyScheduledMonitorCommand(
        state,
        command,
        { now, randomUUID: idSource },
      ));
      return publicResult(outcome.state, outcome.result);
    },
  };
}

export {
  ADMITTED_LOOKUPS_PER_WEEK,
  applyScheduledMonitorCommand,
  assertScheduledMonitorCapacity,
  CAPACITY_RESERVE_PERCENT,
  createScheduledMonitorManager,
  MANAGEMENT_ERROR_CODES,
  ScheduledMonitorManagementError,
  scheduledMonitorCapacity,
  THEORETICAL_LOOKUPS_PER_WEEK,
};
export type {
  CapacityReport,
  ManagementErrorCode,
  ScheduledMonitorManagerOptions,
  ScheduledMonitorRepositoryContract,
};
