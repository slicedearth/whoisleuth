import { Buffer } from 'node:buffer';

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
  | 'disabled';
type SourceAccumulator = {
  states: Map<SourceState, number>;
  observationDurations: number[];
  timingDurations: number[];
  truncated: number;
  rateLimited: number;
  observationSamples: number;
  timingSamples: number;
};
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
  durationMs: Readonly<{
    observation: DurationSummary | null;
    lookupTiming: DurationSummary | null;
  }>;
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
  documentsReviewed: number;
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
]);
const LOOKUP_SCHEMAS = new Set([
  'whoisleuth.cli.lookup',
  'whoisleuth.cli.bulk',
  'whoisleuth.cli.bulk.item',
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

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
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

function parseDocuments(raw: string): UnknownRecord[] {
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
    if (!document
      || !LOOKUP_SCHEMAS.has(String(document.schema))
      || document.version !== 1) {
      throw new TypeError('Source reliability input requires version 1 CLI lookup, Bulk, or Bulk-item documents.');
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

export function buildSourceReliabilityReport(
  raw: string,
  generatedAt: string = new Date().toISOString(),
): SourceReliabilityReport {
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp)) throw new TypeError('Source reliability report time must be valid.');
  const documents = parseDocuments(raw);
  const store = new Map<string, SourceAccumulator>();
  for (const document of documents) {
    traverse(document, store);
  }
  const sources = Object.freeze([...store.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, item]): SourceReliabilityEntry => {
      const states = Object.freeze(Object.fromEntries(
        [...item.states.entries()].sort(([left], [right]) => left.localeCompare(right)),
      ));
      return Object.freeze({
        source,
        samples: Object.freeze({
          states: [...item.states.values()].reduce((sum, count) => sum + count, 0),
          observations: item.observationSamples,
          timing: item.timingSamples,
        }),
        states,
        truncationCount: item.truncated,
        rateLimitedCount: item.rateLimited,
        durationMs: Object.freeze({
          observation: durationSummary(item.observationDurations),
          lookupTiming: durationSummary(item.timingDurations),
        }),
      });
    }));
  return Object.freeze({
    schema: SOURCE_RELIABILITY_REPORT_SCHEMA,
    version: SOURCE_RELIABILITY_REPORT_VERSION,
    generatedAt: new Date(timestamp).toISOString(),
    mode: 'offline_local',
    documentsReviewed: documents.length,
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
      'This local report summarizes only source-health metadata present in the supplied files and does not contact or rank providers.',
      'Timing measurements from concurrent Lookup sources overlap and must not be added together as total wall-clock time.',
      'Provider result states and their observation-health states are counted separately because they describe different contracts.',
      'Missing timing or observation envelopes remain unmeasured rather than being treated as fast, complete, or reliable.',
    ]),
  });
}

export function formatSourceReliabilityReport(report: SourceReliabilityReport): string {
  const lines = [
    'WHOISleuth source reliability report',
    `Documents: ${report.documentsReviewed}`,
    `Sources: ${report.sources.length}`,
    `Samples: ${report.totals.stateSamples} states · ${report.totals.observationSamples} observations · ${report.totals.timingSamples} timings`,
    `Exceptions: ${report.totals.truncations} truncated · ${report.totals.rateLimits} rate-limited`,
  ];
  for (const source of report.sources) {
    const states = Object.entries(source.states).map(([state, count]) => `${state} ${count}`).join(', ') || 'none';
    const timing = source.durationMs.lookupTiming;
    lines.push(
      `${source.source}: ${states}; truncated ${source.truncationCount}; rate-limited ${source.rateLimitedCount}`
        + (timing ? `; timing median ${timing.median} ms / p95 ${timing.p95} ms` : ''),
    );
  }
  lines.push('Privacy: targets 0 · queries 0 · raw evidence 0');
  for (const limitation of report.limitations) lines.push(`Limitation: ${limitation}`);
  return `${lines.join('\n')}\n`;
}
