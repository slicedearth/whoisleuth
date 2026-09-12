import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evidenceTime } from '../frontend/src/lib/analysis/evidence-time.ts';

test('readable evidence times use UTC and keep the exact source value for copying', () => {
  for (const source of ['2026-04-05T02:30:12.345+11:00', '2026-04-05T01:30:12.345+10:00', '2026-04-04T15:30:12.345Z']) {
    const result = evidenceTime(source);
    assert.equal(result?.exact, source);
    assert.equal(result?.datetime, '2026-04-04T15:30:12.345Z');
    assert.equal(result?.readable, '04 Apr 2026, 15:30:12 UTC');
  }
});

test('missing, ambiguous and invalid evidence times do not acquire an invented instant', () => {
  for (const source of [null, undefined, '', '2026-04-05', '2026-04-05T02:30:12', '2026-02-30T02:00:00Z', '<script>', 'a'.repeat(1000)]) assert.equal(evidenceTime(source), null);
  assert.equal(evidenceTime('0001-01-01T00:00:00.000Z')?.datetime, '0001-01-01T00:00:00.000Z');
  assert.equal(evidenceTime('9999-12-31T23:59:59.999Z')?.datetime, '9999-12-31T23:59:59.999Z');
});
