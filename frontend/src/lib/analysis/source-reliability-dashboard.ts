import { parseBoundedJson } from '../bounded-json.ts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';

export const SOURCE_RELIABILITY_DASHBOARD_MAX_BYTES = 512 * 1024;
export const SOURCE_RELIABILITY_DASHBOARD_MAX_SOURCES = 64;
export const SOURCE_RELIABILITY_DASHBOARD_MAX_TIMELINE_POINTS = 100;

type ReliabilityTone = 'attention' | 'healthy' | 'limited' | 'neutral';
type DurationTrend = 'faster' | 'slower' | 'steady' | 'unmeasured';

export type SourceReliabilityDashboardRow = Readonly<{
  source: string;
  stateSamples: number;
  observationSamples: number;
  timingSamples: number;
  failureRate: number | null;
  partialRate: number | null;
  truncatedRate: number | null;
  rateLimitedRate: number | null;
  p95DurationMs: number | null;
  durationTrend: DurationTrend;
  tone: ReliabilityTone;
  sampleLabel: string;
}>;

export type SourceReliabilityDashboard = Readonly<{
  generatedAt: string;
  reportsMerged: number;
  documentsReviewed: number;
  rows: readonly SourceReliabilityDashboardRow[];
  summary: Readonly<{
    sources: number;
    attention: number;
    measuredDuration: number;
    stateSamples: number;
  }>;
}>;

type JsonRecord = Record<string, unknown>;

const ROOT_KEYS = new Set([
  'schema', 'version', 'generatedAt', 'mode', 'reportsMerged',
  'documentsReviewed', 'sampleWindow', 'cohorts', 'sources', 'totals',
  'privacy', 'limitations',
]);
const SOURCE_KEYS = new Set([
  'source', 'samples', 'states', 'truncationCount', 'rateLimitedCount',
  'rates', 'durationMs', 'durationTrend', 'durationTimeline',
]);
const PRIVACY_KEYS = new Set(['targetsRetained', 'queriesRetained', 'rawEvidenceRetained']);
const SAMPLE_KEYS = new Set(['states', 'observations', 'timing']);
const RATE_KEYS = new Set(['failure', 'partial', 'truncated', 'rateLimited']);
const DURATION_KEYS = new Set(['observation', 'lookupTiming']);
const DURATION_SUMMARY_KEYS = new Set(['minimum', 'median', 'p95', 'maximum']);
const DURATION_TREND_KEYS = new Set([
  'reportObservationMedian', 'reportObservationP95',
  'reportTimingMedian', 'reportTimingP95',
]);
const TIMELINE_KEYS = new Set([
  'generatedAt', 'observationMedian', 'observationP95', 'timingMedian', 'timingP95',
]);
const SAMPLE_WINDOW_KEYS = new Set(['earliestGeneratedAt', 'latestGeneratedAt']);
const COHORT_KEYS = new Set(['lookupModes']);
const LOOKUP_MODE_KEYS = new Set(['fast', 'deep', 'unknown']);
const TOTAL_KEYS = new Set(['stateSamples', 'observationSamples', 'timingSamples', 'truncations', 'rateLimits']);
const SOURCE_RE = /^[a-z][a-z0-9_-]{0,39}$/u;
const ALLOWED_STATES = new Set([
  'complete', 'disabled', 'error', 'not_applicable', 'not_found', 'partial',
  'rate_limited', 'skipped', 'stale', 'success', 'unavailable', 'unsupported',
]);

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, allowed: ReadonlySet<string>, label: string): void {
  if (Object.keys(value).length !== allowed.size || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`${label} contains unsupported fields.`);
  }
}

function count(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1_000_000_000) {
    throw new Error(`${label} must be a bounded non-negative integer.`);
  }
  return Number(value);
}

function rate(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be null or a rate from 0 to 1.`);
  }
  return value;
}

function expectedRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function timestamp(value: unknown, label: string): string {
  const normalized = normalizeExplicitIsoTimestamp(value);
  if (!normalized) throw new Error(`${label} must be a valid date and time with an explicit timezone.`);
  return normalized;
}

function optionalTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function duration(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 120_000) {
    throw new Error(`${label} must be a bounded duration.`);
  }
  return Math.round(value);
}

function durationP95(value: unknown, label: string): number | null {
  if (value === null) return null;
  const summary = record(value, label);
  exactKeys(summary, DURATION_SUMMARY_KEYS, label);
  const minimum = duration(summary.minimum, `${label} minimum`);
  const median = duration(summary.median, `${label} median`);
  const p95 = duration(summary.p95, `${label} p95`);
  const maximum = duration(summary.maximum, `${label} maximum`);
  if (minimum === null || median === null || p95 === null || maximum === null
    || minimum > median || median > p95 || p95 > maximum) {
    throw new Error(`${label} has inconsistent durations.`);
  }
  return p95;
}

function timelineTrend(value: unknown, label: string): DurationTrend {
  if (!Array.isArray(value) || value.length > SOURCE_RELIABILITY_DASHBOARD_MAX_TIMELINE_POINTS) {
    throw new Error(`${label} must be a bounded duration timeline.`);
  }
  const points: Array<{ at: string; p95: number }> = [];
  for (const rawPoint of value) {
    const point = record(rawPoint, `${label} point`);
    exactKeys(point, TIMELINE_KEYS, `${label} point`);
    const at = timestamp(point.generatedAt, `${label} point time`);
    const observedP95 = duration(point.observationP95, `${label} observation p95`);
    const timingP95 = duration(point.timingP95, `${label} timing p95`);
    const selected = observedP95 ?? timingP95;
    if (selected !== null) points.push({ at, p95: selected });
  }
  points.sort((left, right) => left.at.localeCompare(right.at));
  const first = points[0]?.p95;
  const last = points.at(-1)?.p95;
  if (first === undefined || last === undefined || points.length < 2) return 'unmeasured';
  const tolerance = Math.max(50, first * 0.1);
  if (last > first + tolerance) return 'slower';
  if (last < first - tolerance) return 'faster';
  return 'steady';
}

function rowTone(row: Omit<SourceReliabilityDashboardRow, 'tone' | 'sampleLabel'>): ReliabilityTone {
  if (row.stateSamples < 5) return 'limited';
  if ((row.failureRate ?? 0) > 0.1 || (row.partialRate ?? 0) > 0.25 || (row.rateLimitedRate ?? 0) > 0.05) return 'attention';
  if ((row.failureRate ?? 0) === 0 && (row.partialRate ?? 0) <= 0.1) return 'healthy';
  return 'neutral';
}

export function parseSourceReliabilityDashboard(raw: string): SourceReliabilityDashboard {
  if (typeof raw !== 'string') throw new Error('Source reliability report must be JSON text.');
  const bytes = new TextEncoder().encode(raw).byteLength;
  if (bytes < 1 || bytes > SOURCE_RELIABILITY_DASHBOARD_MAX_BYTES) {
    throw new Error(`Source reliability report must be between 1 byte and ${SOURCE_RELIABILITY_DASHBOARD_MAX_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = parseBoundedJson(raw, {
      label: 'Source reliability report',
      maximumBytes: SOURCE_RELIABILITY_DASHBOARD_MAX_BYTES,
    });
  } catch {
    throw new Error('Source reliability report is not valid bounded JSON or contains duplicate keys.');
  }
  const root = record(parsed, 'Source reliability report');
  exactKeys(root, ROOT_KEYS, 'Source reliability report');
  if (root.schema !== 'whoisleuth.source-reliability-report' || root.version !== 1 || root.mode !== 'offline_local') {
    throw new Error('Source reliability report has an unsupported schema, version, or mode.');
  }
  const sampleWindow = record(root.sampleWindow, 'Source reliability sample window');
  exactKeys(sampleWindow, SAMPLE_WINDOW_KEYS, 'Source reliability sample window');
  const earliest = optionalTimestamp(sampleWindow.earliestGeneratedAt, 'Sample window start');
  const latest = optionalTimestamp(sampleWindow.latestGeneratedAt, 'Sample window end');
  if ((earliest === null) !== (latest === null) || (earliest !== null && latest !== null && earliest > latest)) {
    throw new Error('Source reliability sample window is inconsistent.');
  }
  const cohorts = record(root.cohorts, 'Source reliability cohorts');
  exactKeys(cohorts, COHORT_KEYS, 'Source reliability cohorts');
  const lookupModes = record(cohorts.lookupModes, 'Source reliability lookup modes');
  exactKeys(lookupModes, LOOKUP_MODE_KEYS, 'Source reliability lookup modes');
  const fastDocuments = count(lookupModes.fast, 'Fast lookup count');
  const deepDocuments = count(lookupModes.deep, 'Deep lookup count');
  const unknownDocuments = count(lookupModes.unknown, 'Unknown lookup count');
  const privacy = record(root.privacy, 'Source reliability privacy declaration');
  exactKeys(privacy, PRIVACY_KEYS, 'Source reliability privacy declaration');
  if (privacy.targetsRetained !== 0 || privacy.queriesRetained !== 0 || privacy.rawEvidenceRetained !== 0) {
    throw new Error('Source reliability report must retain zero targets, queries, and raw evidence.');
  }
  if (!Array.isArray(root.sources) || root.sources.length > SOURCE_RELIABILITY_DASHBOARD_MAX_SOURCES) {
    throw new Error('Source reliability report contains too many source entries.');
  }
  if (!Array.isArray(root.limitations) || root.limitations.length > 8 || root.limitations.some((value) => (
    typeof value !== 'string' || !value.trim() || value.length > 500
  ))) {
    throw new Error('Source reliability report has invalid limitations.');
  }
  const seen = new Set<string>();
  let sourceTruncations = 0;
  let sourceRateLimits = 0;
  const rows = root.sources.map((rawSource, index): SourceReliabilityDashboardRow => {
    const source = record(rawSource, `Source ${index + 1}`);
    exactKeys(source, SOURCE_KEYS, `Source ${index + 1}`);
    if (typeof source.source !== 'string' || !SOURCE_RE.test(source.source) || seen.has(source.source)) {
      throw new Error(`Source ${index + 1} has an invalid or repeated identifier.`);
    }
    seen.add(source.source);
    const samples = record(source.samples, `${source.source} samples`);
    exactKeys(samples, SAMPLE_KEYS, `${source.source} samples`);
    const stateSamples = count(samples.states, `${source.source} state samples`);
    const observationSamples = count(samples.observations, `${source.source} observation samples`);
    const timingSamples = count(samples.timing, `${source.source} timing samples`);
    const states = record(source.states, `${source.source} states`);
    if (Object.keys(states).length > ALLOWED_STATES.size || Object.keys(states).some((state) => !ALLOWED_STATES.has(state))) {
      throw new Error(`${source.source} contains an unsupported state.`);
    }
    const stateCounts = new Map<string, number>();
    const countedStates = Object.entries(states).reduce((sum, [state, value]) => {
      const valueCount = count(value, `${source.source} ${state} count`);
      stateCounts.set(state, valueCount);
      return sum + valueCount;
    }, 0);
    if (countedStates !== stateSamples) throw new Error(`${source.source} has inconsistent state samples.`);
    const rates = record(source.rates, `${source.source} rates`);
    exactKeys(rates, RATE_KEYS, `${source.source} rates`);
    const failureRate = rate(rates.failure, `${source.source} failure rate`);
    const partialRate = rate(rates.partial, `${source.source} partial rate`);
    const truncatedRate = rate(rates.truncated, `${source.source} truncated rate`);
    const rateLimitedRate = rate(rates.rateLimited, `${source.source} rate-limited rate`);
    const truncationCount = count(source.truncationCount, `${source.source} truncation count`);
    const rateLimitedCount = count(source.rateLimitedCount, `${source.source} rate-limited count`);
    if (truncationCount > observationSamples) throw new Error(`${source.source} has inconsistent truncation counts.`);
    if (rateLimitedCount !== (stateCounts.get('rate_limited') ?? 0)) throw new Error(`${source.source} has inconsistent rate-limited counts.`);
    const expectedRates = {
      failure: expectedRate((stateCounts.get('error') ?? 0) + (stateCounts.get('unavailable') ?? 0), stateSamples),
      partial: expectedRate(stateCounts.get('partial') ?? 0, stateSamples),
      truncated: expectedRate(truncationCount, observationSamples),
      rateLimited: expectedRate(rateLimitedCount, stateSamples),
    };
    if (failureRate !== expectedRates.failure
      || partialRate !== expectedRates.partial
      || truncatedRate !== expectedRates.truncated
      || rateLimitedRate !== expectedRates.rateLimited) {
      throw new Error(`${source.source} has inconsistent reliability rates.`);
    }
    sourceTruncations += truncationCount;
    sourceRateLimits += rateLimitedCount;
    const durations = record(source.durationMs, `${source.source} durations`);
    exactKeys(durations, DURATION_KEYS, `${source.source} durations`);
    const durationTrend = record(source.durationTrend, `${source.source} duration trend`);
    exactKeys(durationTrend, DURATION_TREND_KEYS, `${source.source} duration trend`);
    for (const [name, summary] of Object.entries(durationTrend)) {
      durationP95(summary, `${source.source} ${name}`);
    }
    const observationP95 = durationP95(durations.observation, `${source.source} observation duration`);
    const timingP95 = durationP95(durations.lookupTiming, `${source.source} timing duration`);
    const base = {
      source: source.source,
      stateSamples,
      observationSamples,
      timingSamples,
      failureRate,
      partialRate,
      truncatedRate,
      rateLimitedRate,
      p95DurationMs: observationP95 ?? timingP95,
      durationTrend: timelineTrend(source.durationTimeline, `${source.source} duration timeline`),
    } as const;
    return Object.freeze({
      ...base,
      tone: rowTone(base),
      sampleLabel: stateSamples < 5 ? 'Limited sample' : `${stateSamples} state samples`,
    });
  }).sort((left, right) => {
    const priority = { attention: 0, limited: 1, neutral: 2, healthy: 3 } as const;
    return priority[left.tone] - priority[right.tone]
      || (right.failureRate ?? -1) - (left.failureRate ?? -1)
      || left.source.localeCompare(right.source);
  });
  const generatedAt = timestamp(root.generatedAt, 'Report generation time');
  const reportsMerged = count(root.reportsMerged, 'Merged report count');
  const documentsReviewed = count(root.documentsReviewed, 'Reviewed document count');
  if (fastDocuments + deepDocuments + unknownDocuments !== documentsReviewed) {
    throw new Error('Source reliability report has inconsistent lookup cohorts.');
  }
  const totals = record(root.totals, 'Source reliability totals');
  exactKeys(totals, TOTAL_KEYS, 'Source reliability totals');
  const stateSamples = count(totals.stateSamples, 'Total state samples');
  const observationSamples = count(totals.observationSamples, 'Total observation samples');
  const timingSamples = count(totals.timingSamples, 'Total timing samples');
  const truncations = count(totals.truncations, 'Total truncations');
  const rateLimits = count(totals.rateLimits, 'Total rate limits');
  if (stateSamples !== rows.reduce((sum, row) => sum + row.stateSamples, 0)
    || observationSamples !== rows.reduce((sum, row) => sum + row.observationSamples, 0)
    || timingSamples !== rows.reduce((sum, row) => sum + row.timingSamples, 0)
    || truncations !== sourceTruncations
    || rateLimits !== sourceRateLimits) {
    throw new Error('Source reliability report has inconsistent totals.');
  }
  return Object.freeze({
    generatedAt,
    reportsMerged,
    documentsReviewed,
    rows: Object.freeze(rows),
    summary: Object.freeze({
      sources: rows.length,
      attention: rows.filter((row) => row.tone === 'attention').length,
      measuredDuration: rows.filter((row) => row.p95DurationMs !== null).length,
      stateSamples,
    }),
  });
}

export function reliabilityRateLabel(value: number | null): string {
  return value === null ? 'Unmeasured' : `${Math.round(value * 100)}%`;
}

export function reliabilityDurationLabel(value: number | null): string {
  if (value === null) return 'Unmeasured';
  return value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)} s` : `${value} ms`;
}
