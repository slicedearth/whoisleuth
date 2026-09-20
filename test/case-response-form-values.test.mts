import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoFromUtcInput, utcInputFromIso, list } from '../frontend/src/lib/analysis/case-response-form-values.ts';

test('response input conversion retains instants and distinguishes missing or invalid dates', () => {
  assert.equal(isoFromUtcInput('2026-08-20T09:30'), '2026-08-20T09:30:00.000Z');
  assert.equal(isoFromUtcInput('2024-02-29T09:30:12.3'), '2024-02-29T09:30:12.300Z');
  for (const value of ['', 'not a date', '2026-02-29T09:30', '2026-04-31T09:30', '2026-04-30T24:00',
    '2026-08-20T09:30:00+10:00', '2026-08-20T09:30Z', '2026-08-20', '2026-08-20T09:30:12.1234',
    '0000-01-01T00:00', '10000-01-01T00:00']) {
    assert.equal(isoFromUtcInput(value), null, value);
  }
});

test('response UTC date editing preserves distinct daylight-saving fold instants and subsecond precision', () => {
  for (const instant of ['2026-09-08T01:23:45.678Z', '2026-01-15T04:00:00.001Z',
    '2026-04-04T15:30:12.345Z', '2026-04-04T16:30:12.345Z', '2026-10-03T16:30:00.000Z',
    '0001-01-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z']) {
    const input = utcInputFromIso(instant);
    assert.equal(input, instant.slice(0, -1));
    assert.equal(isoFromUtcInput(input), instant);
  }
  assert.equal(utcInputFromIso('2026-08-20T09:30:00+10:00'), '2026-08-19T23:30:00.000');
  assert.equal(utcInputFromIso(null), '');
  assert.equal(utcInputFromIso('invalid'), '');
  assert.equal(utcInputFromIso('2026-02-29T09:30:00.000Z'), '');
});

test('response limitations retain separate non-empty lines without interpreting their content', () => {
  assert.deepEqual(list('  first observation \r\n\r\n <second observation>\n '), ['first observation', '<second observation>']);
  assert.deepEqual(list(' \n\t'), []);
});
