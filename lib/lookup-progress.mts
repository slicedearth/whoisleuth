// Portable bounded NDJSON Lookup progress contract. Partial events are
// presentation-only; only a validated final ordinary Lookup result may cross
// the persistence boundary.

export const LOOKUP_PROGRESS_SCHEMA = 'whoisleuth.lookup-progress';
export const LOOKUP_PROGRESS_VERSION = 1;
export const MAX_LOOKUP_PROGRESS_SOURCES = 16;
export const MAX_LOOKUP_PROGRESS_EVENTS = MAX_LOOKUP_PROGRESS_SOURCES + 2;
export const MAX_LOOKUP_PROGRESS_FRAGMENT_BYTES = 256 * 1024;
export const MAX_LOOKUP_PROGRESS_FINAL_BYTES = 8 * 1024 * 1024;
export const MAX_LOOKUP_PROGRESS_STREAM_BYTES = 12 * 1024 * 1024;

const SOURCE_IDS = Object.freeze([
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
const SOURCE_ID_SET = new Set<string>(SOURCE_IDS);
const SOURCE_STATES = new Set([
  'success',
  'partial',
  'not_found',
  'skipped',
  'error',
  'unsupported',
  'unavailable',
  'rate_limited',
]);
const SOURCE_ID_RE = /^[a-z][a-z0-9_]{0,39}$/u;

type LookupProgressSource = typeof SOURCE_IDS[number];
type LookupProgressState =
  | 'success'
  | 'partial'
  | 'not_found'
  | 'skipped'
  | 'error'
  | 'unsupported'
  | 'unavailable'
  | 'rate_limited';
type LookupProgressStartEvent = Readonly<{
  schema: typeof LOOKUP_PROGRESS_SCHEMA;
  version: typeof LOOKUP_PROGRESS_VERSION;
  event: 'start';
  sequence: 0;
  mode: 'fast' | 'deep';
  sources: readonly LookupProgressSource[];
  persistence: 'prohibited';
}>;
type LookupProgressSourceEvent = Readonly<{
  schema: typeof LOOKUP_PROGRESS_SCHEMA;
  version: typeof LOOKUP_PROGRESS_VERSION;
  event: 'source';
  sequence: number;
  source: LookupProgressSource;
  state: LookupProgressState;
  complete: boolean;
  truncated: boolean;
  fragment: unknown;
  persistence: 'prohibited';
}>;
type LookupProgressFinalEvent = Readonly<{
  schema: typeof LOOKUP_PROGRESS_SCHEMA;
  version: typeof LOOKUP_PROGRESS_VERSION;
  event: 'final';
  sequence: number;
  sources: readonly LookupProgressSource[];
  result: unknown;
  persistence: 'authoritative_after_validation';
}>;
type LookupProgressEvent =
  | LookupProgressStartEvent
  | LookupProgressSourceEvent
  | LookupProgressFinalEvent;
type LookupProgressSettledSource = Readonly<{
  source: LookupProgressSource;
  state: LookupProgressState;
  complete: boolean;
  truncated: boolean;
  fragment: unknown;
}>;
type LookupProgressSnapshot = Readonly<{
  started: boolean;
  mode: 'fast' | 'deep' | null;
  plannedSources: readonly LookupProgressSource[];
  settledSources: readonly LookupProgressSettledSource[];
  finalReceived: boolean;
  persistable: false;
}>;
type LookupProgressReducerOptions = Readonly<{
  validateFinalResult: (
    result: unknown,
    settledSources: readonly LookupProgressSettledSource[],
  ) => boolean;
}>;
type UnknownRecord = Record<string, unknown>;

const TEXT_ENCODER = new TextEncoder();

function byteLength(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength;
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function exactKeys(value: UnknownRecord, expected: readonly string[], label: string): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new TypeError(`${label} has an invalid field set.`);
  }
}

function sequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= MAX_LOOKUP_PROGRESS_EVENTS) {
    throw new TypeError('Lookup progress sequence is invalid.');
  }
  return Number(value);
}

function source(value: unknown): LookupProgressSource {
  if (typeof value !== 'string' || !SOURCE_ID_RE.test(value) || !SOURCE_ID_SET.has(value)) {
    throw new TypeError('Lookup progress source is invalid.');
  }
  return value as LookupProgressSource;
}

function sources(value: unknown): LookupProgressSource[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LOOKUP_PROGRESS_SOURCES) {
    throw new TypeError('Lookup progress sources are missing or exceed their bound.');
  }
  const normalized = value.map(source);
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError('Lookup progress sources contain duplicates.');
  }
  return normalized;
}

function cloneBounded(value: unknown, maximumBytes: number, label: string): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError(`${label} is not JSON serializable.`);
  }
  if (serialized === undefined || byteLength(serialized) > maximumBytes) {
    throw new TypeError(`${label} exceeds its ${maximumBytes}-byte bound.`);
  }
  return JSON.parse(serialized);
}

export function createLookupProgressStart(
  mode: 'fast' | 'deep',
  rawSources: readonly LookupProgressSource[],
): LookupProgressStartEvent {
  const planned = sources(rawSources);
  return Object.freeze({
    schema: LOOKUP_PROGRESS_SCHEMA,
    version: LOOKUP_PROGRESS_VERSION,
    event: 'start',
    sequence: 0,
    mode,
    sources: Object.freeze(planned),
    persistence: 'prohibited',
  });
}

export function createLookupProgressSource(
  sequenceValue: number,
  sourceValue: LookupProgressSource,
  state: LookupProgressState,
  fragment: unknown,
  options: Readonly<{ complete?: boolean; truncated?: boolean }> = {},
): LookupProgressSourceEvent {
  const normalizedSequence = sequence(sequenceValue);
  if (normalizedSequence === 0 || !SOURCE_STATES.has(state)) {
    throw new TypeError('Lookup source event sequence or state is invalid.');
  }
  return Object.freeze({
    schema: LOOKUP_PROGRESS_SCHEMA,
    version: LOOKUP_PROGRESS_VERSION,
    event: 'source',
    sequence: normalizedSequence,
    source: source(sourceValue),
    state,
    complete: options.complete === true,
    truncated: options.truncated === true,
    fragment: cloneBounded(fragment, MAX_LOOKUP_PROGRESS_FRAGMENT_BYTES, 'Lookup progress fragment'),
    persistence: 'prohibited',
  });
}

export function createLookupProgressFinal(
  sequenceValue: number,
  rawSources: readonly LookupProgressSource[],
  result: unknown,
): LookupProgressFinalEvent {
  const normalizedSequence = sequence(sequenceValue);
  if (normalizedSequence < 2) throw new TypeError('Lookup final event sequence is invalid.');
  return Object.freeze({
    schema: LOOKUP_PROGRESS_SCHEMA,
    version: LOOKUP_PROGRESS_VERSION,
    event: 'final',
    sequence: normalizedSequence,
    sources: Object.freeze(sources(rawSources)),
    result: cloneBounded(result, MAX_LOOKUP_PROGRESS_FINAL_BYTES, 'Final Lookup result'),
    persistence: 'authoritative_after_validation',
  });
}

export function parseLookupProgressEvent(raw: unknown): LookupProgressEvent {
  const value = record(raw);
  if (!value
    || value.schema !== LOOKUP_PROGRESS_SCHEMA
    || value.version !== LOOKUP_PROGRESS_VERSION) {
    throw new TypeError('Lookup progress event uses an unsupported contract.');
  }
  if (value.event === 'start') {
    exactKeys(value, ['schema', 'version', 'event', 'sequence', 'mode', 'sources', 'persistence'], 'Lookup start event');
    if (sequence(value.sequence) !== 0
      || !['fast', 'deep'].includes(String(value.mode))
      || value.persistence !== 'prohibited') {
      throw new TypeError('Lookup start event is invalid.');
    }
    return createLookupProgressStart(value.mode as 'fast' | 'deep', sources(value.sources));
  }
  if (value.event === 'source') {
    exactKeys(value, [
      'schema', 'version', 'event', 'sequence', 'source', 'state',
      'complete', 'truncated', 'fragment', 'persistence',
    ], 'Lookup source event');
    if (typeof value.complete !== 'boolean'
      || typeof value.truncated !== 'boolean'
      || value.persistence !== 'prohibited'
      || typeof value.state !== 'string'
      || !SOURCE_STATES.has(value.state)) {
      throw new TypeError('Lookup source event is invalid.');
    }
    return createLookupProgressSource(
      sequence(value.sequence),
      source(value.source),
      value.state as LookupProgressState,
      value.fragment,
      { complete: value.complete, truncated: value.truncated },
    );
  }
  if (value.event === 'final') {
    exactKeys(value, ['schema', 'version', 'event', 'sequence', 'sources', 'result', 'persistence'], 'Lookup final event');
    if (value.persistence !== 'authoritative_after_validation') {
      throw new TypeError('Lookup final event is invalid.');
    }
    return createLookupProgressFinal(sequence(value.sequence), sources(value.sources), value.result);
  }
  throw new TypeError('Lookup progress event type is invalid.');
}

export function encodeLookupProgressEvent(event: LookupProgressEvent): string {
  return `${JSON.stringify(parseLookupProgressEvent(event))}\n`;
}

export function createLookupProgressReducer(options: LookupProgressReducerOptions) {
  if (typeof options.validateFinalResult !== 'function') {
    throw new TypeError('Lookup progress reducer requires a final-result validator.');
  }
  let planned: LookupProgressSource[] = [];
  let mode: 'fast' | 'deep' | null = null;
  let expectedSequence = 0;
  let finalResult: unknown = null;
  let finalReceived = false;
  const settled = new Map<LookupProgressSource, LookupProgressSettledSource>();

  function apply(rawEvent: unknown): LookupProgressSnapshot {
    const event = parseLookupProgressEvent(rawEvent);
    if (event.sequence !== expectedSequence) {
      throw new TypeError(`Lookup progress sequence ${event.sequence} arrived while ${expectedSequence} was required.`);
    }
    if (event.event === 'start') {
      if (mode !== null) throw new TypeError('Lookup progress stream started more than once.');
      mode = event.mode;
      planned = [...event.sources];
    } else if (event.event === 'source') {
      if (mode === null || finalReceived || !planned.includes(event.source) || settled.has(event.source)) {
        throw new TypeError('Lookup source event is duplicate, unplanned, or out of order.');
      }
      settled.set(event.source, Object.freeze({
        source: event.source,
        state: event.state,
        complete: event.complete,
        truncated: event.truncated,
        fragment: cloneBounded(event.fragment, MAX_LOOKUP_PROGRESS_FRAGMENT_BYTES, 'Lookup progress fragment'),
      }));
    } else {
      if (mode === null || finalReceived
        || event.sources.length !== planned.length
        || event.sources.some((item, index) => item !== planned[index])
        || settled.size !== planned.length) {
        throw new TypeError('Final Lookup event arrived before every planned source settled.');
      }
      const settledSources = planned.map((item) => settled.get(item)).filter(
        (item): item is LookupProgressSettledSource => Boolean(item),
      );
      if (!options.validateFinalResult(event.result, settledSources)) {
        throw new TypeError('Final Lookup result failed its ordinary response validator.');
      }
      finalResult = cloneBounded(event.result, MAX_LOOKUP_PROGRESS_FINAL_BYTES, 'Final Lookup result');
      finalReceived = true;
    }
    expectedSequence += 1;
    return snapshot();
  }

  function snapshot(): LookupProgressSnapshot {
    return Object.freeze({
      started: mode !== null,
      mode,
      plannedSources: Object.freeze([...planned]),
      settledSources: Object.freeze(
        planned.map((item) => settled.get(item)).filter(
          (item): item is LookupProgressSettledSource => Boolean(item),
        ),
      ),
      finalReceived,
      persistable: false,
    });
  }

  function finish(): unknown {
    if (!finalReceived) {
      throw new TypeError('Lookup progress stream ended before a validated final result.');
    }
    return cloneBounded(finalResult, MAX_LOOKUP_PROGRESS_FINAL_BYTES, 'Final Lookup result');
  }

  return Object.freeze({ apply, snapshot, finish });
}

export function createLookupProgressNdjsonDecoder(
  onEvent: (event: LookupProgressEvent) => void,
) {
  if (typeof onEvent !== 'function') throw new TypeError('NDJSON decoder requires an event consumer.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let totalBytes = 0;
  let eventCount = 0;

  function consumeLine(line: string): void {
    if (!line) return;
    if (byteLength(line) > MAX_LOOKUP_PROGRESS_FINAL_BYTES + MAX_LOOKUP_PROGRESS_FRAGMENT_BYTES) {
      throw new TypeError('Lookup progress line exceeds its byte bound.');
    }
    eventCount += 1;
    if (eventCount > MAX_LOOKUP_PROGRESS_EVENTS) {
      throw new TypeError('Lookup progress stream contains too many events.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new TypeError('Lookup progress stream contains malformed JSON.');
    }
    onEvent(parseLookupProgressEvent(parsed));
  }

  function push(chunk: Uint8Array): void {
    if (!(chunk instanceof Uint8Array)) throw new TypeError('NDJSON chunks must be byte arrays.');
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_LOOKUP_PROGRESS_STREAM_BYTES) {
      throw new TypeError('Lookup progress stream exceeds its total byte bound.');
    }
    pending += decoder.decode(chunk, { stream: true });
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      const line = pending.slice(0, newline).replace(/\r$/u, '');
      pending = pending.slice(newline + 1);
      consumeLine(line);
      newline = pending.indexOf('\n');
    }
    if (byteLength(pending) > MAX_LOOKUP_PROGRESS_FINAL_BYTES + MAX_LOOKUP_PROGRESS_FRAGMENT_BYTES) {
      throw new TypeError('Lookup progress line exceeds its byte bound.');
    }
  }

  function finish(): void {
    pending += decoder.decode();
    if (pending) consumeLine(pending.replace(/\r$/u, ''));
    pending = '';
  }

  return Object.freeze({ push, finish });
}

export type {
  LookupProgressEvent,
  LookupProgressFinalEvent,
  LookupProgressReducerOptions,
  LookupProgressSettledSource,
  LookupProgressSnapshot,
  LookupProgressSource,
  LookupProgressSourceEvent,
  LookupProgressStartEvent,
  LookupProgressState,
};
