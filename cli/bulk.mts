import { Buffer } from 'node:buffer';
import { abortable } from '../lib/abort.mts';
import { CliUsageError } from './arguments.mts';
import type { ClassifiedQuery } from '../lib/classify.mts';

const MAX_BULK_INPUT_BYTES = 1024 * 1024;
const MAX_FAST_BULK_QUERIES = 500;
const MAX_DEEP_BULK_QUERIES = 50;

type BoundedTextStream = {
  isTTY?: boolean;
  [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
};

type BulkLookupOptions = {
  concurrency?: unknown;
  deep?: boolean;
  classifyQuery?: (query: string) => ClassifiedQuery;
  runUnifiedLookup?: (
    classified: ClassifiedQuery,
    options: { fast: boolean; compact: true; signal?: AbortSignal },
  ) => unknown | Promise<unknown>;
  onItemSettled?: (result: BulkLookupResult) => void;
  initialResults?: readonly BulkLookupResult[];
  signal?: AbortSignal;
  dnsResolverServers?: readonly string[];
};

type BulkLookupSuccess = {
  index: number;
  query: string;
  ok: true;
  classified: ClassifiedQuery;
  result: unknown;
};

type BulkLookupFailure = {
  index: number;
  query: string;
  ok: false;
  error: string;
};

type BulkLookupResult = BulkLookupSuccess | BulkLookupFailure;

async function readTextStreamBounded(
  stream: BoundedTextStream | null | undefined,
  limit = MAX_BULK_INPUT_BYTES,
): Promise<string> {
  if (!stream || stream.isTTY) return '';
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<unknown>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > limit) throw new CliUsageError(`Bulk input is limited to ${limit} bytes.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseBulkQueries(text: unknown, { deep = false }: { deep?: boolean } = {}): {
  queries: string[];
  duplicates: number;
  limit: number;
} {
  if (typeof text !== 'string') throw new CliUsageError('Bulk input must be newline-delimited text.');
  if (Buffer.byteLength(text, 'utf8') > MAX_BULK_INPUT_BYTES) {
    throw new CliUsageError(`Bulk input is limited to ${MAX_BULK_INPUT_BYTES} bytes.`);
  }
  const limit = deep ? MAX_DEEP_BULK_QUERIES : MAX_FAST_BULK_QUERIES;
  const seen = new Set<string>();
  const queries: string[] = [];
  let duplicates = 0;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const line of lines) {
    const query = line.trim();
    if (!query) continue;
    if (query.length > 1024 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(query)) {
      throw new CliUsageError('Bulk input contains an overlong query or unsupported control character.');
    }
    const key = query.toLowerCase();
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    queries.push(query);
    if (queries.length > limit) {
      throw new CliUsageError(`${deep ? 'Deep' : 'Fast'} bulk mode is limited to ${limit} unique queries.`);
    }
  }
  if (!queries.length) throw new CliUsageError('Bulk input did not contain any queries.');
  return { queries, duplicates, limit };
}

function boundedLookupError(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : undefined;
  return String(message || 'Lookup failed')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300) || 'Lookup failed';
}

async function runBulkLookups(queries: string[], options: BulkLookupOptions = {}): Promise<BulkLookupResult[]> {
  const classify = options.classifyQuery;
  const executeLookup = options.runUnifiedLookup;
  if (typeof classify !== 'function' || typeof executeLookup !== 'function') {
    throw new TypeError('Bulk lookup dependencies are required.');
  }
  const classifyQuery = classify;
  const runUnifiedLookup = executeLookup;
  const concurrency = options.concurrency;
  if (!Number.isSafeInteger(concurrency) || (concurrency as number) < 1 || (concurrency as number) > 8) {
    throw new TypeError('Bulk concurrency is invalid.');
  }
  const results = new Array<BulkLookupResult>(queries.length);
  for (const result of options.initialResults || []) {
    if (!Number.isSafeInteger(result.index) || result.index < 0 || result.index >= queries.length
      || queries[result.index] !== result.query || results[result.index]) {
      throw new TypeError('Initial Bulk results are invalid.');
    }
    results[result.index] = result;
  }
  const lookupPromises = new Map<string, Promise<unknown>>();
  let cursor = 0;
  function notify(result: BulkLookupResult): void {
    try {
      options.onItemSettled?.(result);
    } catch {
      // Presentation callbacks must never change collection results.
    }
  }
  async function worker(): Promise<void> {
    while (true) {
      options.signal?.throwIfAborted();
      const index = cursor++;
      if (index >= queries.length) return;
      if (results[index]) continue;
      const query = queries[index];
      if (query === undefined) return;
      try {
        const classified = classifyQuery(query);
        const lookupKey = `${classified.type}:${classified.value}`;
        let lookupPromise = lookupPromises.get(lookupKey);
        if (!lookupPromise) {
          lookupPromise = Promise.resolve().then(() => runUnifiedLookup(classified, {
            fast: options.deep !== true,
            compact: true,
            ...(options.signal ? { signal: options.signal } : {}),
            ...(options.dnsResolverServers?.length ? { dnsResolverServers: options.dnsResolverServers } : {}),
          }));
          lookupPromises.set(lookupKey, lookupPromise);
        }
        const result = await abortable(() => lookupPromise, options.signal);
        const item: BulkLookupResult = { index, query, ok: true, classified, result };
        results[index] = item;
        notify(item);
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason || new DOMException('Aborted', 'AbortError');
        const item: BulkLookupResult = { index, query, ok: false, error: boundedLookupError(error) };
        results[index] = item;
        notify(item);
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency as number, Math.max(1, queries.length - (options.initialResults?.length || 0))) },
    () => worker(),
  ));
  return results;
}

export {
  MAX_BULK_INPUT_BYTES,
  MAX_DEEP_BULK_QUERIES,
  MAX_FAST_BULK_QUERIES,
  parseBulkQueries,
  readTextStreamBounded,
  runBulkLookups,
};
export type {
  BoundedTextStream,
  BulkLookupFailure,
  BulkLookupOptions,
  BulkLookupResult,
  BulkLookupSuccess,
  ClassifiedQuery,
};
