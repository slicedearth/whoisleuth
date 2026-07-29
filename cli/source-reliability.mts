import { Buffer } from 'node:buffer';

import { canonicalArtifactJson } from '../frontend/src/lib/analysis/artifact-integrity.ts';

export const SOURCE_RELIABILITY_REPORT_SCHEMA = 'whoisleuth.source-reliability-report';
export const SOURCE_RELIABILITY_REPORT_VERSION = 1;
export const MAX_SOURCE_RELIABILITY_INPUT_BYTES = 12 * 1024 * 1024;
export const MAX_SOURCE_RELIABILITY_DOCUMENTS = 100;
export const MAX_SOURCE_RELIABILITY_SOURCES = 64;
export const MAX_SOURCE_RELIABILITY_TRAVERSAL_NODES = 25_000;

type UnknownRecord = Record<string, unknown>;
type SourceState =
  | 'success'
  | 'partial'
  | 'not_found'
  | 'skipped'
  | 'error'
  | 'unsupported'
  | 'not_applicable'
  | 'unavailable'
  | 'rate_limited'
  | 'complete'
  | 'disabled'
  | 'stale';
type SourceAccumulator = {
  states: Map<SourceState, number>;
  observationDurations: number[];
  timingDurations: number[];
  truncated: number;
  rateLimited: number;
  observationSamples: number;
  timingSamples: number;
  reportedObservationMedians: number[];
  reportedObservationP95s: number[];
  reportedTimingMedians: number[];
  reportedTimingP95s: number[];
  reportTimeline: ReportDurationPoint[];
};
type ReportDurationPoint = Readonly<{
  generatedAt: string;
  observationMedian: number | null;
  observationP95: number | null;
  timingMedian: number | null;
  timingP95: number | null;
}>;
type SourceReliabilityEntry = Readonly<{
  source: string;
  samples: Readonly<{
    states: number;
    observations: number;
    timing: number;
  }>;
  states: Readonly<Record<string, number>>;
  truncationCount: number;
  rateLimitedCount: number;
  rates: Readonly<{
    failure: number | null;
    partial: number | null;
    truncated: number | null;
    rateLimited: number | null;
  }>;
  durationMs: Readonly<{
    observation: DurationSummary | null;
    lookupTiming: DurationSummary | null;
  }>;
  durationTrend: Readonly<{
    reportObservationMedian: DurationSummary | null;
    reportObservationP95: DurationSummary | null;
    reportTimingMedian: DurationSummary | null;
    reportTimingP95: DurationSummary | null;
  }>;
  durationTimeline: readonly ReportDurationPoint[];
}>;
type DurationSummary = Readonly<{
  minimum: number;
  median: number;
  p95: number;
  maximum: number;
}>;
export type SourceReliabilityReport = Readonly<{
  schema: typeof SOURCE_RELIABILITY_REPORT_SCHEMA;
  version: typeof SOURCE_RELIABILITY_REPORT_VERSION;
  generatedAt: string;
  mode: 'offline_local';
  reportsMerged: number;
  documentsReviewed: number;
  sampleWindow: Readonly<{
    earliestGeneratedAt: string | null;
    latestGeneratedAt: string | null;
  }>;
  cohorts: Readonly<{
    lookupModes: Readonly<Record<'fast' | 'deep' | 'unknown', number>>;
  }>;
  sources: readonly SourceReliabilityEntry[];
  totals: Readonly<{
    stateSamples: number;
    observationSamples: number;
    timingSamples: number;
    truncations: number;
    rateLimits: number;
  }>;
  privacy: Readonly<{
    targetsRetained: 0;
    queriesRetained: 0;
    rawEvidenceRetained: 0;
  }>;
  limitations: readonly string[];
}>;

const SOURCE_RE = /^[a-z][a-z0-9_-]{0,39}$/u;
const STATES = new Set<SourceState>([
  'success',
  'partial',
  'not_found',
  'skipped',
  'error',
  'unsupported',
  'not_applicable',
  'unavailable',
  'rate_limited',
  'complete',
  'disabled',
  'stale',
]);
const LOOKUP_SCHEMAS = new Set([
  'whoisleuth.cli.lookup',
  'whoisleuth.cli.bulk',
  'whoisleuth.cli.bulk.item',
]);
const REPORT_KEYS = new Set([
  'schema',
  'version',
  'generatedAt',
  'mode',
  'reportsMerged',
  'documentsReviewed',
  'sampleWindow',
  'cohorts',
  'sources',
  'totals',
  'privacy',
  'limitations',
]);
const SAMPLE_WINDOW_KEYS = new Set(['earliestGeneratedAt', 'latestGeneratedAt']);
const COHORT_KEYS = new Set(['lookupModes']);
const LOOKUP_MODE_KEYS = new Set(['fast', 'deep', 'unknown']);
const PRIVACY_KEYS = new Set(['targetsRetained', 'queriesRetained', 'rawEvidenceRetained']);
const SOURCE_ENTRY_KEYS = new Set([
  'source',
  'samples',
  'states',
  'truncationCount',
  'rateLimitedCount',
  'rates',
  'durationMs',
  'durationTrend',
  'durationTimeline',
]);
const SAMPLE_KEYS = new Set(['states', 'observations', 'timing']);
const RATE_KEYS = new Set(['failure', 'partial', 'truncated', 'rateLimited']);
const DURATION_KEYS = new Set(['observation', 'lookupTiming']);
const DURATION_TREND_KEYS = new Set([
  'reportObservationMedian',
  'reportObservationP95',
  'reportTimingMedian',
  'reportTimingP95',
]);
const TOTAL_KEYS = new Set([
  'stateSamples',
  'observationSamples',
  'timingSamples',
  'truncations',
  'rateLimits',
]);
const TIMELINE_KEYS = new Set([
  'generatedAt',
  'observationMedian',
  'observationP95',
  'timingMedian',
  'timingP95',
]);
const TIMING_SOURCES = new Set([
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
]);
const BASE_REPORT_LIMITATIONS = Object.freeze([
  'This local report summarizes only source-health metadata present in the supplied files and does not contact or rank providers.',
  'Timing measurements from concurrent Lookup sources overlap and must not be added together as total wall-clock time.',
  'Provider result states and their observation-health states are counted separately because they describe different contracts.',
  'Missing timing or observation envelopes remain unmeasured rather than being treated as fast, complete, or reliable.',
  'Failure rates count explicit error and unavailable states. Partial, truncated, and rate-limited rates remain separate so different source-health conditions are not collapsed.',
]);
const MERGED_REPORT_LIMITATION = 'Merged duration timelines preserve only report generation times and source-level medians and p95 values; they are not reconstructed per-target timing samples.';

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function assertExactKeys(
  value: UnknownRecord,
  expected: ReadonlySet<string>,
  label: string,
): void {
  if (Object.keys(value).length !== expected.size
    || Object.keys(value).some((key) => !expected.has(key))) {
    throw new TypeError(`${label} must use only the documented fields.`);
  }
}

function safeSource(value: unknown): string | null {
  return typeof value === 'string' && SOURCE_RE.test(value) ? value : null;
}

function safeState(value: unknown): SourceState | null {
  return typeof value === 'string' && STATES.has(value as SourceState)
    ? value as SourceState
    : null;
}

function boundedDuration(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 120_000
    ? Math.round(value)
    : null;
}

function parseValues(raw: string): UnknownRecord[] {
  if (typeof raw !== 'string') throw new TypeError('Source reliability input must be UTF-8 JSON text.');
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes === 0 || bytes > MAX_SOURCE_RELIABILITY_INPUT_BYTES) {
    throw new TypeError(`Source reliability input must be between 1 byte and ${MAX_SOURCE_RELIABILITY_INPUT_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError('Source reliability input must be valid JSON.');
  }
  const values = Array.isArray(parsed) ? parsed : [parsed];
  if (values.length === 0 || values.length > MAX_SOURCE_RELIABILITY_DOCUMENTS) {
    throw new TypeError(`Source reliability input supports 1 to ${MAX_SOURCE_RELIABILITY_DOCUMENTS} documents.`);
  }
  return values.map((value) => {
    const document = record(value);
    if (!document) throw new TypeError('Source reliability input must contain JSON objects.');
    return document;
  });
}

function parseLookupDocuments(values: readonly UnknownRecord[]): UnknownRecord[] {
  return values.map((document) => {
    if (!LOOKUP_SCHEMAS.has(String(document.schema)) || document.version !== 1) {
      throw new TypeError('Source reliability input requires only version 1 CLI lookup, Bulk, or Bulk-item documents, or only source reliability reports.');
    }
    return document;
  });
}

function accumulator(store: Map<string, SourceAccumulator>, source: string): SourceAccumulator | null {
  const existing = store.get(source);
  if (existing) return existing;
  if (store.size >= MAX_SOURCE_RELIABILITY_SOURCES) return null;
  const created: SourceAccumulator = {
    states: new Map(),
    observationDurations: [],
    timingDurations: [],
    truncated: 0,
    rateLimited: 0,
    observationSamples: 0,
    timingSamples: 0,
    reportedObservationMedians: [],
    reportedObservationP95s: [],
    reportedTimingMedians: [],
    reportedTimingP95s: [],
    reportTimeline: [],
  };
  store.set(source, created);
  return created;
}

function addState(store: Map<string, SourceAccumulator>, source: string, state: SourceState): void {
  const item = accumulator(store, source);
  if (!item) return;
  item.states.set(state, (item.states.get(state) ?? 0) + 1);
  if (state === 'rate_limited') item.rateLimited += 1;
}

function collectTiming(document: UnknownRecord, store: Map<string, SourceAccumulator>): void {
  const diagnostics = record(document.diagnostics);
  const timing = record(diagnostics?.timing);
  if (timing?.version !== 1 || !Array.isArray(timing.sources)) return;
  for (const rawEntry of timing.sources.slice(0, 16)) {
    const entry = record(rawEntry);
    const source = safeSource(entry?.source);
    const duration = boundedDuration(entry?.durationMs);
    if (!source || !TIMING_SOURCES.has(source) || duration === null) continue;
    const item = accumulator(store, source);
    if (!item) continue;
    item.timingDurations.push(duration);
    item.timingSamples += 1;
  }
}

function collectDiagnostics(document: UnknownRecord, store: Map<string, SourceAccumulator>): void {
  const diagnostics = record(document.diagnostics);
  if (!diagnostics) return;
  const fixed: Array<[string, unknown]> = [
    ['rdap', record(diagnostics.rdap)?.status],
    ['registrar_rdap', record(record(diagnostics.rdap)?.registrar)?.status],
    ['whois', record(diagnostics.whois)?.status],
    ['availability', record(diagnostics.availability)?.status],
    ['reverse_dns', record(diagnostics.reverseDns)?.status],
    ['network_context', record(diagnostics.network)?.status],
    ['security_txt', record(diagnostics.securityTxt)?.status],
    ['sslbl', record(diagnostics.sslbl)?.status],
  ];
  for (const [source, value] of fixed) {
    const state = safeState(value);
    if (state) addState(store, source, state);
  }
}

function collectObservation(value: UnknownRecord, store: Map<string, SourceAccumulator>): void {
  if (value.version !== 1
    || typeof value.observedAt !== 'string'
    || typeof value.complete !== 'boolean'
    || typeof value.truncated !== 'boolean'
    || !Array.isArray(value.limitations)) return;
  const source = safeSource(value.source);
  const state = safeState(value.status);
  if (!source || !state) return;
  const item = accumulator(store, source);
  if (!item) return;
  item.observationSamples += 1;
  addState(store, source, state);
  const duration = boundedDuration(value.durationMs);
  if (duration !== null) item.observationDurations.push(duration);
  if (value.truncated === true) item.truncated += 1;
}

function traverse(document: UnknownRecord, store: Map<string, SourceAccumulator>): void {
  let visited = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value: document, depth: 0 }];
  while (stack.length) {
    const current = stack.pop();
    if (!current || current.depth > 12 || visited >= MAX_SOURCE_RELIABILITY_TRAVERSAL_NODES) continue;
    visited += 1;
    const object = record(current.value);
    if (object) {
      collectDiagnostics(object, store);
      collectTiming(object, store);
      collectObservation(object, store);
      if (object.state === 'rate_limited') {
        const source = safeSource(record(object.observation)?.source);
        if (source) addState(store, source, 'rate_limited');
      }
      for (const child of Object.values(object).slice(0, 200)) {
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    } else if (Array.isArray(current.value)) {
      for (const child of current.value.slice(0, 1_000)) {
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
}

function percentile(sorted: readonly number[], ratio: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function durationSummary(values: readonly number[]): DurationSummary | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Object.freeze({
    minimum: sorted[0] ?? 0,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    maximum: sorted.at(-1) ?? 0,
  });
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function reportTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64) {
    throw new TypeError('Source reliability report has an invalid generation time.');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError('Source reliability report has an invalid generation time.');
  return new Date(parsed).toISOString();
}

function optionalReportTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  try {
    return reportTimestamp(value);
  } catch {
    throw new TypeError(`Source reliability report has an invalid ${label}.`);
  }
}

function safeCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1_000_000_000) {
    throw new TypeError(`Source reliability report has an invalid ${label}.`);
  }
  return Number(value);
}

function safeRate(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || value > 1
    || Number(value.toFixed(4)) !== value) {
    throw new TypeError(`Source reliability report has an invalid ${label}.`);
  }
  return value;
}

function collectReportedDuration(
  value: unknown,
  medians: number[],
  p95s: number[],
  label: string,
): void {
  if (value === null) return;
  const summary = record(value);
  const minimum = boundedDuration(summary?.minimum);
  const median = boundedDuration(summary?.median);
  const p95 = boundedDuration(summary?.p95);
  const maximum = boundedDuration(summary?.maximum);
  if (minimum === null || median === null || p95 === null || maximum === null
    || minimum > median || median > p95 || p95 > maximum) {
    throw new TypeError(`Source reliability report has an invalid ${label} duration summary.`);
  }
  medians.push(median);
  p95s.push(p95);
}

function reportedDurationPoint(value: unknown): Readonly<{
  median: number | null;
  p95: number | null;
}> {
  if (value === null || value === undefined) return Object.freeze({ median: null, p95: null });
  const summary = record(value);
  const minimum = boundedDuration(summary?.minimum);
  const median = boundedDuration(summary?.median);
  const p95 = boundedDuration(summary?.p95);
  const maximum = boundedDuration(summary?.maximum);
  if (minimum === null || median === null || p95 === null || maximum === null
    || minimum > median || median > p95 || p95 > maximum) {
    throw new TypeError('Source reliability report has an invalid duration summary.');
  }
  return Object.freeze({ median, p95 });
}

function nullableTimelineDuration(value: unknown, label: string): number | null {
  if (value === null) return null;
  const duration = boundedDuration(value);
  if (duration === null) {
    throw new TypeError(`Source reliability report has an invalid ${label}.`);
  }
  return duration;
}

function timelineDurationPair(
  medianValue: unknown,
  p95Value: unknown,
  label: string,
): Readonly<{ median: number | null; p95: number | null }> {
  const median = nullableTimelineDuration(medianValue, `${label} median`);
  const p95 = nullableTimelineDuration(p95Value, `${label} p95`);
  if ((median === null) !== (p95 === null)
    || (median !== null && p95 !== null && median > p95)) {
    throw new TypeError(`Source reliability report has an invalid ${label} duration pair.`);
  }
  return Object.freeze({ median, p95 });
}

function collectReport(report: UnknownRecord, store: Map<string, SourceAccumulator>): {
  documentsReviewed: number;
  lookupModes: Readonly<Record<'fast' | 'deep' | 'unknown', number>>;
  sampleDates: readonly string[];
} {
  if (report.schema !== SOURCE_RELIABILITY_REPORT_SCHEMA
    || report.version !== SOURCE_RELIABILITY_REPORT_VERSION
    || report.mode !== 'offline_local'
    || !Array.isArray(report.sources)
    || report.sources.length > MAX_SOURCE_RELIABILITY_SOURCES) {
    throw new TypeError('Source reliability report input has an unsupported schema or shape.');
  }
  assertExactKeys(report, REPORT_KEYS, 'Source reliability report');
  const privacy = record(report.privacy);
  if (!privacy) {
    throw new TypeError('Source reliability report has an invalid privacy declaration.');
  }
  assertExactKeys(privacy, PRIVACY_KEYS, 'Source reliability report privacy declaration');
  if (privacy.targetsRetained !== 0
    || privacy.queriesRetained !== 0
    || privacy.rawEvidenceRetained !== 0) {
    throw new TypeError('Source reliability reports must retain zero targets, queries, and raw evidence.');
  }
  const generatedAt = reportTimestamp(report.generatedAt);
  const reportsMerged = safeCount(report.reportsMerged, 'merged-report count');
  const documentsReviewed = safeCount(report.documentsReviewed, 'document count');
  const sampleWindow = record(report.sampleWindow);
  if (!sampleWindow) {
    throw new TypeError('Source reliability report has an invalid sample window.');
  }
  assertExactKeys(sampleWindow, SAMPLE_WINDOW_KEYS, 'Source reliability report sample window');
  const earliestGeneratedAt = optionalReportTimestamp(
    sampleWindow.earliestGeneratedAt,
    'sample-window start',
  );
  const latestGeneratedAt = optionalReportTimestamp(
    sampleWindow.latestGeneratedAt,
    'sample-window end',
  );
  if ((earliestGeneratedAt === null) !== (latestGeneratedAt === null)
    || (earliestGeneratedAt !== null
      && latestGeneratedAt !== null
      && earliestGeneratedAt > latestGeneratedAt)) {
    throw new TypeError('Source reliability report has an inconsistent sample window.');
  }
  const cohorts = record(report.cohorts);
  if (!cohorts) throw new TypeError('Source reliability report has invalid lookup cohorts.');
  assertExactKeys(cohorts, COHORT_KEYS, 'Source reliability report cohorts');
  const rawModes = record(cohorts?.lookupModes);
  if (!rawModes) throw new TypeError('Source reliability report has invalid lookup cohorts.');
  assertExactKeys(rawModes, LOOKUP_MODE_KEYS, 'Source reliability report lookup cohorts');
  const lookupModes = Object.freeze({
    fast: safeCount(rawModes?.fast ?? 0, 'fast lookup cohort count'),
    deep: safeCount(rawModes?.deep ?? 0, 'deep lookup cohort count'),
    unknown: safeCount(rawModes?.unknown ?? 0, 'unknown lookup cohort count'),
  });
  if (lookupModes.fast + lookupModes.deep + lookupModes.unknown !== documentsReviewed) {
    throw new TypeError('Source reliability report has inconsistent lookup cohort counts.');
  }
  const totals = record(report.totals);
  if (!totals) throw new TypeError('Source reliability report has invalid totals.');
  assertExactKeys(totals, TOTAL_KEYS, 'Source reliability report totals');
  const expectedTotals = {
    stateSamples: 0,
    observationSamples: 0,
    timingSamples: 0,
    truncations: 0,
    rateLimits: 0,
  };
  if (!Array.isArray(report.limitations)
    || report.limitations.length !== BASE_REPORT_LIMITATIONS.length + (reportsMerged > 0 ? 1 : 0)
    || report.limitations.some((value, index) => (
      value !== [...BASE_REPORT_LIMITATIONS, ...(reportsMerged > 0 ? [MERGED_REPORT_LIMITATION] : [])][index]
    ))) {
    throw new TypeError('Source reliability report has an invalid limitations declaration.');
  }
  const seenSources = new Set<string>();
  for (const rawSource of report.sources) {
    const sourceRecord = record(rawSource);
    const source = safeSource(sourceRecord?.source);
    const samples = record(sourceRecord?.samples);
    const states = record(sourceRecord?.states);
    const durationMs = record(sourceRecord?.durationMs);
    if (!sourceRecord || !source || !samples || !states || !durationMs) {
      throw new TypeError('Source reliability report contains an invalid source entry.');
    }
    if (seenSources.has(source)) {
      throw new TypeError(`Source reliability report repeats the ${source} source.`);
    }
    seenSources.add(source);
    assertExactKeys(sourceRecord, SOURCE_ENTRY_KEYS, `Source reliability report ${source} entry`);
    assertExactKeys(samples, SAMPLE_KEYS, `Source reliability report ${source} samples`);
    assertExactKeys(durationMs, DURATION_KEYS, `Source reliability report ${source} durations`);
    const rates = record(sourceRecord.rates);
    const durationTrend = record(sourceRecord.durationTrend);
    if (!rates || !durationTrend) {
      throw new TypeError(`Source reliability report contains invalid ${source} summaries.`);
    }
    assertExactKeys(rates, RATE_KEYS, `Source reliability report ${source} rates`);
    assertExactKeys(durationTrend, DURATION_TREND_KEYS, `Source reliability report ${source} duration trend`);
    for (const value of Object.values(durationTrend)) reportedDurationPoint(value);
    const item = accumulator(store, source);
    if (!item) throw new TypeError('Source reliability report exceeds the source limit.');
    const observationSamples = safeCount(samples.observations, `${source} observation sample count`);
    const timingSamples = safeCount(samples.timing, `${source} timing sample count`);
    const truncationCount = safeCount(sourceRecord.truncationCount, `${source} truncation count`);
    const rateLimitedCount = safeCount(sourceRecord.rateLimitedCount, `${source} rate-limit count`);
    item.observationSamples += observationSamples;
    item.timingSamples += timingSamples;
    item.truncated += truncationCount;
    item.rateLimited += rateLimitedCount;
    let stateSamples = 0;
    const normalizedStates: Partial<Record<SourceState, number>> = {};
    for (const [rawState, rawCount] of Object.entries(states)) {
      const state = safeState(rawState);
      if (!state) throw new TypeError(`Source reliability report contains an invalid ${source} state.`);
      const count = safeCount(rawCount, `${source} ${state} state count`);
      stateSamples += count;
      normalizedStates[state] = count;
      item.states.set(state, (item.states.get(state) ?? 0) + count);
    }
    if (stateSamples !== safeCount(samples.states, `${source} state sample count`)) {
      throw new TypeError(`Source reliability report has inconsistent ${source} state counts.`);
    }
    if (truncationCount > observationSamples) {
      throw new TypeError(`Source reliability report has inconsistent ${source} truncation counts.`);
    }
    if (rateLimitedCount !== (normalizedStates.rate_limited ?? 0)) {
      throw new TypeError(`Source reliability report has inconsistent ${source} rate-limit counts.`);
    }
    const observationPoint = reportedDurationPoint(durationMs.observation);
    const timingPoint = reportedDurationPoint(durationMs.lookupTiming);
    const expectedRates = {
      failure: ratio(
        (normalizedStates.error ?? 0) + (normalizedStates.unavailable ?? 0),
        stateSamples,
      ),
      partial: ratio(normalizedStates.partial ?? 0, stateSamples),
      truncated: ratio(truncationCount, observationSamples),
      rateLimited: ratio(rateLimitedCount, stateSamples),
    };
    for (const [name, expected] of Object.entries(expectedRates)) {
      const observed = safeRate(rates[name], `${source} ${name} rate`);
      if (observed !== expected) {
        throw new TypeError(`Source reliability report has an inconsistent ${source} ${name} rate.`);
      }
    }
    if (!Array.isArray(sourceRecord.durationTimeline)
      || sourceRecord.durationTimeline.length > MAX_SOURCE_RELIABILITY_DOCUMENTS) {
      throw new TypeError(`Source reliability report contains an invalid ${source} duration timeline.`);
    }
    const rawTimeline = sourceRecord.durationTimeline;
    if (item.reportTimeline.length + rawTimeline.length > MAX_SOURCE_RELIABILITY_DOCUMENTS) {
      throw new TypeError(`Merged source reliability reports exceed the ${source} duration-timeline limit.`);
    }
    if (rawTimeline.length) {
      for (const rawPoint of rawTimeline) {
        const point = record(rawPoint);
        if (!point) throw new TypeError(`Source reliability report contains an invalid ${source} duration timeline.`);
        assertExactKeys(point, TIMELINE_KEYS, `Source reliability report ${source} duration point`);
        const observation = timelineDurationPair(
          point.observationMedian,
          point.observationP95,
          `${source} observation`,
        );
        const timing = timelineDurationPair(
          point.timingMedian,
          point.timingP95,
          `${source} lookup timing`,
        );
        item.reportTimeline.push(Object.freeze({
          generatedAt: reportTimestamp(point.generatedAt),
          observationMedian: observation.median,
          observationP95: observation.p95,
          timingMedian: timing.median,
          timingP95: timing.p95,
        }));
        if (observation.median !== null && observation.p95 !== null) {
          item.reportedObservationMedians.push(observation.median);
          item.reportedObservationP95s.push(observation.p95);
        }
        if (timing.median !== null && timing.p95 !== null) {
          item.reportedTimingMedians.push(timing.median);
          item.reportedTimingP95s.push(timing.p95);
        }
      }
    } else if (observationPoint.median !== null || timingPoint.median !== null) {
      collectReportedDuration(
        durationMs.observation,
        item.reportedObservationMedians,
        item.reportedObservationP95s,
        `${source} observation`,
      );
      collectReportedDuration(
        durationMs.lookupTiming,
        item.reportedTimingMedians,
        item.reportedTimingP95s,
        `${source} lookup timing`,
      );
      item.reportTimeline.push(Object.freeze({
        generatedAt,
        observationMedian: observationPoint.median,
        observationP95: observationPoint.p95,
        timingMedian: timingPoint.median,
        timingP95: timingPoint.p95,
      }));
    }
    expectedTotals.stateSamples += stateSamples;
    expectedTotals.observationSamples += observationSamples;
    expectedTotals.timingSamples += timingSamples;
    expectedTotals.truncations += truncationCount;
    expectedTotals.rateLimits += rateLimitedCount;
  }
  for (const [name, expected] of Object.entries(expectedTotals)) {
    if (safeCount(totals[name], `${name} total`) !== expected) {
      throw new TypeError(`Source reliability report has an inconsistent ${name} total.`);
    }
  }
  return {
    documentsReviewed,
    lookupModes,
    sampleDates: earliestGeneratedAt && latestGeneratedAt
      ? Object.freeze([earliestGeneratedAt, latestGeneratedAt])
      : Object.freeze([generatedAt]),
  };
}

export function buildSourceReliabilityReport(
  raw: string,
  generatedAt: string = new Date().toISOString(),
): SourceReliabilityReport {
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp)) throw new TypeError('Source reliability report time must be valid.');
  const values = parseValues(raw);
  const store = new Map<string, SourceAccumulator>();
  const reportInputs = values.every((value) => value.schema === SOURCE_RELIABILITY_REPORT_SCHEMA);
  let documentsReviewed = 0;
  let reportsMerged = 0;
  const sampleDates: string[] = [];
  const lookupModes = { fast: 0, deep: 0, unknown: 0 };
  if (reportInputs) {
    if (new Set(values.map((value) => canonicalArtifactJson(value))).size !== values.length) {
      throw new TypeError('Source reliability input contains a duplicate report.');
    }
    reportsMerged = values.length;
    for (const report of values) {
      const collected = collectReport(report, store);
      documentsReviewed += collected.documentsReviewed;
      sampleDates.push(...collected.sampleDates);
      lookupModes.fast += collected.lookupModes.fast;
      lookupModes.deep += collected.lookupModes.deep;
      lookupModes.unknown += collected.lookupModes.unknown;
      if (!Number.isSafeInteger(documentsReviewed) || documentsReviewed > 1_000_000_000) {
        throw new TypeError('Merged source reliability report document count is too large.');
      }
    }
  } else {
    const documents = parseLookupDocuments(values);
    documentsReviewed = documents.length;
    for (const document of documents) {
      const mode = document.mode === 'fast' || document.mode === 'deep' ? document.mode : 'unknown';
      lookupModes[mode] += 1;
      if (typeof document.generatedAt === 'string') {
        try {
          sampleDates.push(reportTimestamp(document.generatedAt));
        } catch {
          // Invalid or missing document dates remain unmeasured.
        }
      }
      traverse(document, store);
    }
  }
  sampleDates.sort();
  const sources = Object.freeze([...store.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, item]): SourceReliabilityEntry => {
      const states = Object.freeze(Object.fromEntries(
        [...item.states.entries()].sort(([left], [right]) => left.localeCompare(right)),
      ));
      const stateSamples = [...item.states.values()].reduce((sum, count) => sum + count, 0);
      const failureCount = (item.states.get('error') ?? 0) + (item.states.get('unavailable') ?? 0);
      const partialCount = item.states.get('partial') ?? 0;
      return Object.freeze({
        source,
        samples: Object.freeze({
          states: stateSamples,
          observations: item.observationSamples,
          timing: item.timingSamples,
        }),
        states,
        truncationCount: item.truncated,
        rateLimitedCount: item.rateLimited,
        rates: Object.freeze({
          failure: ratio(failureCount, stateSamples),
          partial: ratio(partialCount, stateSamples),
          truncated: ratio(item.truncated, item.observationSamples),
          rateLimited: ratio(item.rateLimited, stateSamples),
        }),
        durationMs: Object.freeze({
          observation: durationSummary(item.observationDurations),
          lookupTiming: durationSummary(item.timingDurations),
        }),
        durationTrend: Object.freeze({
          reportObservationMedian: durationSummary(item.reportedObservationMedians),
          reportObservationP95: durationSummary(item.reportedObservationP95s),
          reportTimingMedian: durationSummary(item.reportedTimingMedians),
          reportTimingP95: durationSummary(item.reportedTimingP95s),
        }),
        durationTimeline: Object.freeze([...item.reportTimeline]
          .sort((left, right) => left.generatedAt.localeCompare(right.generatedAt))
          .slice(-MAX_SOURCE_RELIABILITY_DOCUMENTS)),
      });
    }));
  return Object.freeze({
    schema: SOURCE_RELIABILITY_REPORT_SCHEMA,
    version: SOURCE_RELIABILITY_REPORT_VERSION,
    generatedAt: new Date(timestamp).toISOString(),
    mode: 'offline_local',
    reportsMerged,
    documentsReviewed,
    sampleWindow: Object.freeze({
      earliestGeneratedAt: sampleDates[0] ?? null,
      latestGeneratedAt: sampleDates.at(-1) ?? null,
    }),
    cohorts: Object.freeze({
      lookupModes: Object.freeze({ ...lookupModes }),
    }),
    sources,
    totals: Object.freeze({
      stateSamples: sources.reduce((sum, source) => sum + source.samples.states, 0),
      observationSamples: sources.reduce((sum, source) => sum + source.samples.observations, 0),
      timingSamples: sources.reduce((sum, source) => sum + source.samples.timing, 0),
      truncations: sources.reduce((sum, source) => sum + source.truncationCount, 0),
      rateLimits: sources.reduce((sum, source) => sum + source.rateLimitedCount, 0),
    }),
    privacy: Object.freeze({
      targetsRetained: 0,
      queriesRetained: 0,
      rawEvidenceRetained: 0,
    }),
    limitations: Object.freeze([
      ...BASE_REPORT_LIMITATIONS,
      ...(reportsMerged ? [MERGED_REPORT_LIMITATION] : []),
    ]),
  });
}

export function formatSourceReliabilityReport(report: SourceReliabilityReport): string {
  const lines = [
    'WHOISleuth source reliability report',
    `Documents: ${report.documentsReviewed}`,
    `Reports merged: ${report.reportsMerged}`,
    `Sample window: ${report.sampleWindow.earliestGeneratedAt ?? 'unmeasured'} to ${report.sampleWindow.latestGeneratedAt ?? 'unmeasured'}`,
    `Sources: ${report.sources.length}`,
    `Lookup cohorts: fast ${report.cohorts.lookupModes.fast} · deep ${report.cohorts.lookupModes.deep} · unknown ${report.cohorts.lookupModes.unknown}`,
    `Samples: ${report.totals.stateSamples} states · ${report.totals.observationSamples} observations · ${report.totals.timingSamples} timings`,
    `Exceptions: ${report.totals.truncations} truncated · ${report.totals.rateLimits} rate-limited`,
  ];
  for (const source of report.sources) {
    const states = Object.entries(source.states).map(([state, count]) => `${state} ${count}`).join(', ') || 'none';
    const timing = source.durationMs.lookupTiming;
    const timingTrend = source.durationTrend.reportTimingMedian;
    lines.push(
      `${source.source}: ${states}; truncated ${source.truncationCount}; rate-limited ${source.rateLimitedCount}`
        + `; failure rate ${source.rates.failure ?? 'unmeasured'}; partial rate ${source.rates.partial ?? 'unmeasured'}`
        + (timing ? `; timing median ${timing.median} ms / p95 ${timing.p95} ms` : '')
        + (timingTrend ? `; report-median distribution ${timingTrend.minimum}-${timingTrend.maximum} ms` : '')
        + (source.durationTimeline.length ? `; timeline points ${source.durationTimeline.length}` : ''),
    );
  }
  lines.push('Privacy: targets 0 · queries 0 · raw evidence 0');
  for (const limitation of report.limitations) lines.push(`Limitation: ${limitation}`);
  return `${lines.join('\n')}\n`;
}
