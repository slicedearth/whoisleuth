import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultBulkSortDirection,
  normalizeBulkPresentationSortKey,
  sortBulkResults,
} from '../frontend/src/lib/analysis/bulk-sort.ts';
import type { BulkSortKey } from '../frontend/src/lib/analysis/bulk-sort.ts';

const rows = Object.freeze([
  Object.freeze({
    domain: 'zulu.example', availability: 'registered', confidence: 'low', risk: 20,
    opportunity: null, activity: 'inactive', registrar: 'Zulu Registrar', mutationTypes: ['dictionary'],
  }),
  Object.freeze({
    domain: 'alpha.example', availability: 'available', confidence: 'high', risk: 80,
    opportunity: 90, activity: 'active', registrar: 'Alpha Registrar', mutationTypes: ['homoglyph'],
  }),
  Object.freeze({
    domain: 'missing.example', availability: 'error', confidence: 'unknown', risk: null,
    opportunity: null, activity: '—', registrar: '—', mutationTypes: [],
  }),
]);

test('defines intuitive initial directions for every Bulk sort key', () => {
  assert.equal(defaultBulkSortDirection('risk'), -1);
  assert.equal(defaultBulkSortDirection('opportunity'), -1);
  assert.equal(defaultBulkSortDirection('confidence'), -1);
  const ascendingKeys: BulkSortKey[] = ['domain', 'availability', 'activity', 'registrar', 'mutation'];
  for (const key of ascendingKeys) {
    assert.equal(defaultBulkSortDirection(key), 1);
  }
});

test('remaps the retired Opportunity presentation sort without changing direction state', () => {
  const legacy = { sortKey: 'opportunity' as const, sortDirection: 1 as const };
  assert.deepEqual({
    sortKey: normalizeBulkPresentationSortKey(legacy.sortKey),
    sortDirection: legacy.sortDirection,
  }, { sortKey: 'risk', sortDirection: 1 });
  assert.equal(normalizeBulkPresentationSortKey('activity'), 'activity');
});

test('sorts numeric and ranked values while keeping missing evidence last', () => {
  assert.deepEqual(sortBulkResults(rows, 'risk', -1).map((row) => row.domain), [
    'alpha.example', 'zulu.example', 'missing.example',
  ]);
  assert.deepEqual(sortBulkResults(rows, 'risk', 1).map((row) => row.domain), [
    'zulu.example', 'alpha.example', 'missing.example',
  ]);
  assert.deepEqual(sortBulkResults(rows, 'confidence', -1).map((row) => row.domain), [
    'alpha.example', 'zulu.example', 'missing.example',
  ]);
});

test('sorts only transiently comparable Risk values and keeps incompatible scores last', () => {
  const sorted = sortBulkResults(rows, 'risk', -1, (row) => (
    row.domain === 'alpha.example' ? null : row.risk
  ));
  assert.deepEqual(sorted.map((row) => row.domain), [
    'zulu.example', 'alpha.example', 'missing.example',
  ]);
});

test('sorts text evidence case-insensitively and does not mutate source rows', () => {
  const original = structuredClone(rows);
  assert.deepEqual(sortBulkResults(rows, 'registrar', 1).map((row) => row.domain), [
    'alpha.example', 'zulu.example', 'missing.example',
  ]);
  assert.deepEqual(sortBulkResults(rows, 'mutation', 1).map((row) => row.domain), [
    'zulu.example', 'alpha.example', 'missing.example',
  ]);
  assert.deepEqual(rows, original);
});
