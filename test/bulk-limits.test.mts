import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_DEEP_BULK_CONCURRENCY,
  MAX_DEEP_BULK_QUERIES,
  MAX_FAST_BULK_CONCURRENCY,
  MAX_FAST_BULK_QUERIES,
  bulkConcurrencyLimit,
  bulkQueryLimit,
} from '../lib/bulk-limits.mts';

test('keeps browser and CLI collection ceilings explicit and mode-specific', () => {
  assert.equal(MAX_FAST_BULK_QUERIES, 500);
  assert.equal(MAX_DEEP_BULK_QUERIES, 50);
  assert.equal(MAX_FAST_BULK_CONCURRENCY, 8);
  assert.equal(MAX_DEEP_BULK_CONCURRENCY, 3);
  assert.equal(bulkQueryLimit('fast'), 500);
  assert.equal(bulkQueryLimit('deep'), 50);
  assert.equal(bulkConcurrencyLimit('fast'), 8);
  assert.equal(bulkConcurrencyLimit('deep'), 3);
});
