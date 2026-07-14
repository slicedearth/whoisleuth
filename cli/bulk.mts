import { Buffer } from 'node:buffer';
import { CliUsageError } from './arguments.mts';

const MAX_BULK_INPUT_BYTES = 1024 * 1024;
const MAX_FAST_BULK_QUERIES = 500;
const MAX_DEEP_BULK_QUERIES = 50;

type BoundedTextStream = {
  isTTY?: boolean;
  [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
};

type ClassifiedQuery = {
  type: string;
  value: string;
  [key: string]: unknown;
};

type BulkLookupOptions = {
  concurrency?: unknown;
  deep?: boolean;
  classifyQuery?: (query: string) => ClassifiedQuery;
  runUnifiedLookup?: (
    classified: ClassifiedQuery,
    options: { fast: boolean; compact: true },
  ) => unknown | Promise<unknown>;
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
  const lookupPromises = new Map<string, Promise<unknown>>();
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= queries.length) return;
      const query = queries[index];
      try {
        const classified = classifyQuery(query);
        const lookupKey = `${classified.type}:${classified.value}`;
        let lookupPromise = lookupPromises.get(lookupKey);
        if (!lookupPromise) {
          lookupPromise = Promise.resolve().then(() => runUnifiedLookup(classified, {
            fast: options.deep !== true,
            compact: true,
          }));
          lookupPromises.set(lookupKey, lookupPromise);
        }
        const result = await lookupPromise;
        results[index] = { index, query, ok: true, classified, result };
      } catch (error) {
        results[index] = { index, query, ok: false, error: boundedLookupError(error) };
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency as number, queries.length) },
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
