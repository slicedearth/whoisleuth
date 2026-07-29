import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BULK_PACING_OPTIONS,
  buildBulkProgressEstimate,
  bulkConcurrency,
  normalizeBulkPacing,
} from '../frontend/src/lib/analysis/bulk-pacing.ts';

test('keeps operator pacing bounded and preserves the established default', () => {
  assert.deepEqual(BULK_PACING_OPTIONS.map((option) => option.id), ['gentle', 'balanced', 'standard']);
  assert.equal(normalizeBulkPacing('unknown'), 'standard');
  assert.equal(bulkConcurrency('fast', 'gentle'), 2);
  assert.equal(bulkConcurrency('deep', 'gentle'), 1);
  assert.equal(bulkConcurrency('fast', 'standard'), 12);
  assert.equal(bulkConcurrency('deep', 'standard'), 4);
});

test('derives a bounded progress estimate only from the current scan', () => {
  assert.deepEqual(buildBulkProgressEstimate(0, 10, 0), {
    completed: 0,
    total: 10,
    remaining: 10,
    percent: 0,
    elapsedMs: 0,
    estimatedRemainingMs: null,
    label: '10 remaining',
  });
  const progress = buildBulkProgressEstimate(4, 10, 2_000);
  assert.equal(progress.percent, 40);
  assert.equal(progress.estimatedRemainingMs, 3_000);
  assert.equal(progress.label, '6 remaining · about 3s remaining');
  assert.equal(buildBulkProgressEstimate(10, 10, 5_000).label, 'Scan complete');
  assert.equal(buildBulkProgressEstimate(99, 10, Number.POSITIVE_INFINITY).completed, 10);
});
