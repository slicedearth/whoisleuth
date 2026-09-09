import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoFromLocal, localFromIso, list } from '../frontend/src/lib/analysis/case-response-form-values.ts';

test('response input conversion retains instants and distinguishes missing or invalid dates', () => {
  assert.equal(isoFromLocal('2026-08-20T09:30:00+10:00'), '2026-08-19T23:30:00.000Z');
  assert.equal(isoFromLocal(''), null);
  assert.equal(isoFromLocal('not a date'), null);
});

test('response date editing preserves seconds and milliseconds in the local timezone', () => {
  for (const instant of ['2026-09-08T01:23:45.678Z', '2026-01-15T04:00:00.001Z']) {
    const local = localFromIso(instant);
    assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/u);
    assert.equal(isoFromLocal(local), instant);
  }
  assert.equal(localFromIso(null), '');
  assert.equal(localFromIso('invalid'), '');
});

test('response limitations retain separate non-empty lines without interpreting their content', () => {
  assert.deepEqual(list('  first observation \r\n\r\n <second observation>\n '), ['first observation', '<second observation>']);
  assert.deepEqual(list(' \n\t'), []);
});
