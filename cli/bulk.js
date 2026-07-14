'use strict';

const { CliUsageError } = require('./arguments');

const MAX_BULK_INPUT_BYTES = 1024 * 1024;
const MAX_FAST_BULK_QUERIES = 500;
const MAX_DEEP_BULK_QUERIES = 50;

async function readTextStreamBounded(stream, limit = MAX_BULK_INPUT_BYTES) {
  if (!stream || stream.isTTY) return '';
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) throw new CliUsageError(`Bulk input is limited to ${limit} bytes.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseBulkQueries(text, { deep = false } = {}) {
  if (typeof text !== 'string') throw new CliUsageError('Bulk input must be newline-delimited text.');
  if (Buffer.byteLength(text, 'utf8') > MAX_BULK_INPUT_BYTES) {
    throw new CliUsageError(`Bulk input is limited to ${MAX_BULK_INPUT_BYTES} bytes.`);
  }
  const limit = deep ? MAX_DEEP_BULK_QUERIES : MAX_FAST_BULK_QUERIES;
  const seen = new Set();
  const queries = [];
  let duplicates = 0;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const line of lines) {
    const query = line.trim();
    if (!query) continue;
    if (query.length > 1024 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(query)) {
      throw new CliUsageError('Bulk input contains an overlong query or unsupported control character.');
    }
    const key = query.toLowerCase();
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    queries.push(query);
    if (queries.length > limit) throw new CliUsageError(`${deep ? 'Deep' : 'Fast'} bulk mode is limited to ${limit} unique queries.`);
  }
  if (!queries.length) throw new CliUsageError('Bulk input did not contain any queries.');
  return { queries, duplicates, limit };
}

async function runBulkLookups(queries, options = {}) {
  const classify = options.classifyQuery;
  const executeLookup = options.runUnifiedLookup;
  if (typeof classify !== 'function' || typeof executeLookup !== 'function') throw new TypeError('Bulk lookup dependencies are required.');
  const concurrency = options.concurrency;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new TypeError('Bulk concurrency is invalid.');
  const results = new Array(queries.length);
  const lookupPromises = new Map();
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= queries.length) return;
      const query = queries[index];
      try {
        const classified = classify(query);
        const lookupKey = `${classified.type}:${classified.value}`;
        let lookupPromise = lookupPromises.get(lookupKey);
        if (!lookupPromise) {
          lookupPromise = Promise.resolve().then(() => executeLookup(classified, {
            fast: options.deep !== true,
            compact: true,
          }));
          lookupPromises.set(lookupKey, lookupPromise);
        }
        const result = await lookupPromise;
        results[index] = { index, query, ok: true, classified, result };
      } catch (error) {
        results[index] = { index, query, ok: false, error: String(error?.message || 'Lookup failed').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || 'Lookup failed' };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queries.length) }, () => worker()));
  return results;
}

module.exports = {
  MAX_BULK_INPUT_BYTES,
  MAX_DEEP_BULK_QUERIES,
  MAX_FAST_BULK_QUERIES,
  parseBulkQueries,
  readTextStreamBounded,
  runBulkLookups,
};
