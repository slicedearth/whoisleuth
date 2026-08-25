// Client-side production-qualification probe for a candidate incremental
// Lookup adapter. This validates one bounded response; it does not enable a
// route or treat partial events as persistable evidence.

import { canonicalArtifactJson } from '../packages/evidence/artifact-integrity.mts';
import {
  createLookupProgressNdjsonDecoder,
  createLookupProgressReducer,
  type LookupProgressEvent,
} from './lookup-progress.mts';

export const LOOKUP_PROGRESS_MEDIA_TYPE = 'application/x-ndjson';
export const MAX_LOOKUP_PROGRESS_QUALIFICATION_TIMEOUT_MS = 120_000;
export const MAX_LOOKUP_PROGRESS_QUALIFICATION_READ_DELAY_MS = 2_000;

type QualificationOptions = Readonly<{
  expectedFinal: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  readDelayMs?: number;
  maximumFirstEventMs?: number;
  minimumEventSpanMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}>;
export type LookupProgressQualificationResult = Readonly<{
  status: 'qualified';
  events: number;
  chunks: number;
  firstEventAfterMs: number;
  finalEventAfterMs: number;
  bufferingDetected: boolean;
  eventSpanMs: number;
  slowConsumerDelayMs: number;
  finalEquivalent: true;
  finalResult: unknown;
}>;

function boundedMilliseconds(value: unknown, maximum: number, label: string): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new TypeError(`${label} must be between 0 and ${maximum} milliseconds.`);
  }
  return Math.round(Number(value));
}

function wait(milliseconds: number): Promise<void> {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

async function readWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal?.aborted) throw new TypeError('Incremental Lookup qualification was aborted.');
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let abortListener: (() => void) | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new TypeError('Incremental Lookup qualification timed out before the final event.')),
      timeoutMs,
    );
  });
  const abortPromise = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    abortListener = () => reject(new TypeError('Incremental Lookup qualification was aborted.'));
    signal.addEventListener('abort', abortListener, { once: true });
  });
  try {
    return await Promise.race([reader.read(), timeoutPromise, abortPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (signal && abortListener) signal.removeEventListener('abort', abortListener);
  }
}

export async function qualifyLookupProgressResponse(
  response: Response,
  options: QualificationOptions,
): Promise<LookupProgressQualificationResult> {
  if (!(response instanceof Response)) throw new TypeError('Qualification requires a Fetch API Response.');
  if (response.status === 401 || response.status === 403) {
    throw new TypeError('Incremental Lookup qualification encountered authentication expiry.');
  }
  if (!response.ok) throw new TypeError(`Incremental Lookup qualification received HTTP ${response.status}.`);
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== LOOKUP_PROGRESS_MEDIA_TYPE) {
    throw new TypeError(`Incremental Lookup qualification requires ${LOOKUP_PROGRESS_MEDIA_TYPE}.`);
  }
  const cacheControl = response.headers.get('cache-control')?.toLowerCase() ?? '';
  if (!cacheControl.split(',').map((value) => value.trim()).includes('no-store')) {
    throw new TypeError('Incremental Lookup qualification requires Cache-Control: no-store.');
  }
  const contentEncoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  if (contentEncoding && contentEncoding !== 'identity') {
    throw new TypeError('Incremental Lookup qualification rejects compressed responses because intermediary buffering cannot be distinguished reliably.');
  }
  if (response.headers.get('x-content-type-options')?.trim().toLowerCase() !== 'nosniff') {
    throw new TypeError('Incremental Lookup qualification requires X-Content-Type-Options: nosniff.');
  }
  if (response.headers.has('content-length')) {
    throw new TypeError('Incremental Lookup qualification rejects fixed-length responses because they do not demonstrate progressive delivery.');
  }
  if (!response.body) throw new TypeError('Incremental Lookup qualification response has no readable body.');

  const timeoutMs = boundedMilliseconds(
    options.timeoutMs ?? 30_000,
    MAX_LOOKUP_PROGRESS_QUALIFICATION_TIMEOUT_MS,
    'Qualification timeout',
  );
  if (timeoutMs < 1) throw new TypeError('Qualification timeout must be at least 1 millisecond.');
  const readDelayMs = boundedMilliseconds(
    options.readDelayMs,
    MAX_LOOKUP_PROGRESS_QUALIFICATION_READ_DELAY_MS,
    'Slow-consumer delay',
  );
  const maximumFirstEventMs = boundedMilliseconds(
    options.maximumFirstEventMs ?? timeoutMs,
    MAX_LOOKUP_PROGRESS_QUALIFICATION_TIMEOUT_MS,
    'Maximum first-event latency',
  );
  const minimumEventSpanMs = boundedMilliseconds(
    options.minimumEventSpanMs,
    MAX_LOOKUP_PROGRESS_QUALIFICATION_TIMEOUT_MS,
    'Minimum event span',
  );
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? wait;
  const startedAt = now();
  let eventCount = 0;
  let chunkCount = 0;
  let firstEventAfterMs: number | null = null;
  let finalEventAfterMs: number | null = null;
  const expectedCanonical = canonicalArtifactJson(options.expectedFinal);
  const reducer = createLookupProgressReducer({
    validateFinalResult(result) {
      return canonicalArtifactJson(result) === expectedCanonical;
    },
  });
  const decoder = createLookupProgressNdjsonDecoder((event: LookupProgressEvent) => {
    eventCount += 1;
    reducer.apply(event);
    if (firstEventAfterMs === null) {
      firstEventAfterMs = Math.max(0, now() - startedAt);
    }
    if (event.event === 'final') {
      finalEventAfterMs = Math.max(0, now() - startedAt);
    }
  });
  const reader = response.body.getReader();
  try {
    while (true) {
      const elapsed = Math.max(0, now() - startedAt);
      if (elapsed >= timeoutMs) {
        throw new TypeError('Incremental Lookup qualification timed out before the final event.');
      }
      const read = await readWithDeadline(
        reader,
        Math.max(1, timeoutMs - elapsed),
        options.signal,
      );
      if (read.done) break;
      chunkCount += 1;
      decoder.push(read.value);
      if (readDelayMs) await sleep(readDelayMs);
    }
    decoder.finish();
    const finalResult = reducer.finish();
    if (canonicalArtifactJson(finalResult) !== expectedCanonical) {
      throw new TypeError('Incremental Lookup final envelope is not equivalent to the ordinary response.');
    }
    if (firstEventAfterMs === null || finalEventAfterMs === null) {
      throw new TypeError('Incremental Lookup qualification did not observe a complete event sequence.');
    }
    const eventSpanMs = Math.max(0, finalEventAfterMs - firstEventAfterMs);
    return Object.freeze({
      status: 'qualified',
      events: eventCount,
      chunks: chunkCount,
      firstEventAfterMs,
      finalEventAfterMs,
      bufferingDetected: firstEventAfterMs > maximumFirstEventMs
        || (minimumEventSpanMs > 0 && eventSpanMs < minimumEventSpanMs),
      eventSpanMs,
      slowConsumerDelayMs: readDelayMs,
      finalEquivalent: true,
      finalResult,
    });
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Cancellation is best-effort after the qualification failure.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
