// Lookup diagnostics, bounded source errors and optional deep-lookup timing.

import { OPERATION_BUDGET_ERROR_CODE } from './operation-budget.mts';
import { FEATURE_DISABLED_ERROR_CODE } from './feature-policy.mts';

const LOOKUP_DIAGNOSTICS_VERSION = 8;
const LOOKUP_LEGACY_DIAGNOSTICS_VERSION = 7;
const LOOKUP_SOURCE_STATES = Object.freeze([
  'success', 'partial', 'not_found', 'skipped', 'error', 'unsupported',
  'not_applicable', 'unavailable', 'rate_limited', 'complete', 'disabled', 'stale',
] as const);
type LookupSourceState = typeof LOOKUP_SOURCE_STATES[number];
const SOURCE_STATES: ReadonlySet<string> = new Set(LOOKUP_SOURCE_STATES);

function lookupDiagnosticStates(value: unknown): Readonly<Record<string, LookupSourceState | null>> {
  const record = (input: unknown): Record<string, unknown> => input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
  const diagnostics = record(value);
  const candidates = {
    rdap: record(diagnostics.rdap).status,
    registrar_rdap: record(record(diagnostics.rdap).registrar).status,
    whois: record(diagnostics.whois).status,
    availability: record(diagnostics.availability).status,
    reverse_dns: record(diagnostics.reverseDns).status,
    network_context: record(diagnostics.network).status,
    security_txt: record(diagnostics.securityTxt).status,
    sslbl: record(diagnostics.sslbl).status,
  };
  return Object.freeze(Object.fromEntries(Object.entries(candidates).map(([source, state]) => [
    source, typeof state === 'string' && SOURCE_STATES.has(state) ? state as LookupSourceState : null,
  ])));
}
const LOOKUP_TIMING_VERSION = 1;
const MAX_LOOKUP_TIMING_MS = 120_000;
const LOOKUP_TIMING_SOURCE_ORDER = Object.freeze([
  'rdap',
  'whois',
  'domain_evidence',
  'reverse_dns',
  'registrar_rdap',
  'network_context',
  'security_txt',
  'external_intelligence',
  'malware_host_intelligence',
  'malware_ioc_intelligence',
] as const);
type LookupTimingSource = typeof LOOKUP_TIMING_SOURCE_ORDER[number];
type LookupTimingOutcome = 'fulfilled' | 'rejected';
type LookupTimingEntry = {
  source: LookupTimingSource;
  outcome: LookupTimingOutcome;
  durationMs: number;
  completedAfterMs: number;
};
const LOOKUP_ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  CONCURRENCY_LIMITED: OPERATION_BUDGET_ERROR_CODE,
  FEATURE_DISABLED: FEATURE_DISABLED_ERROR_CODE,
  MISSING_QUERY: 'MISSING_QUERY',
  INVALID_QUERY: 'INVALID_QUERY',
  LOOKUP_FAILED: 'LOOKUP_FAILED',
  RDAP_UPSTREAM_FAILED: 'RDAP_UPSTREAM_FAILED',
  RDAP_UNSUPPORTED: 'RDAP_UNSUPPORTED',
  WHOIS_UPSTREAM_FAILED: 'WHOIS_UPSTREAM_FAILED',
  AVAILABILITY_CHECK_FAILED: 'AVAILABILITY_CHECK_FAILED',
});

function errorMessage(err: unknown, fallback: string): string {
  const message = err && typeof err === 'object' && 'message' in err
    ? (err as { message?: unknown }).message
    : null;
  return String(message || fallback);
}

function boundedSourceDetail(err: unknown, fallback: string): string {
  return errorMessage(err, fallback)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240) || fallback;
}

function boundedTimingMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_LOOKUP_TIMING_MS, Math.max(0, Math.round(value)));
}

function createLookupTimingTracker(
  enabled: boolean,
  now: () => number,
) {
  const lookupStartedAt = now();
  const entries = new Map<LookupTimingSource, LookupTimingEntry>();

  function measure<T>(source: LookupTimingSource, operation: () => Promise<T> | T): Promise<T> {
    const sourceStartedAt = now();
    return Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          const finishedAt = now();
          entries.set(source, {
            source,
            outcome: 'fulfilled',
            durationMs: boundedTimingMs(finishedAt - sourceStartedAt),
            completedAfterMs: boundedTimingMs(finishedAt - lookupStartedAt),
          });
          return value;
        },
        (error) => {
          const finishedAt = now();
          entries.set(source, {
            source,
            outcome: 'rejected',
            durationMs: boundedTimingMs(finishedAt - sourceStartedAt),
            completedAfterMs: boundedTimingMs(finishedAt - lookupStartedAt),
          });
          throw error;
        },
      );
  }

  return {
    measure<T>(source: LookupTimingSource, operation: () => Promise<T> | T): Promise<T> {
      return enabled ? measure(source, operation) : Promise.resolve().then(operation);
    },
    snapshot() {
      if (!enabled) return null;
      const totalMs = boundedTimingMs(now() - lookupStartedAt);
      return {
        version: LOOKUP_TIMING_VERSION,
        totalMs,
        sources: LOOKUP_TIMING_SOURCE_ORDER
          .map((source) => entries.get(source))
          .filter((entry): entry is LookupTimingEntry => Boolean(entry)),
      };
    },
  };
}

export {
  LOOKUP_DIAGNOSTICS_VERSION,
  LOOKUP_LEGACY_DIAGNOSTICS_VERSION,
  LOOKUP_SOURCE_STATES,
  LOOKUP_TIMING_VERSION,
  MAX_LOOKUP_TIMING_MS,
  LOOKUP_ERROR_CODES,
  boundedSourceDetail,
  createLookupTimingTracker,
  errorMessage,
  lookupDiagnosticStates,
};
export type { LookupSourceState, LookupTimingSource };
