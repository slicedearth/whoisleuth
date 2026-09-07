import assert from 'node:assert/strict';
import test from 'node:test';
import { latestObservationCohort } from '../packages/evidence/latest-observations.mts';

test('latest observations retain equal-time peers and keep unknown dates separate from history', () => {
  const values = [
    { id: 'old', at: '2026-09-07T01:00:00Z' },
    { id: 'first', at: '2026-09-08T11:00:00+10:00' },
    { id: 'second', at: '2026-09-08T01:00:00.000Z' },
    { id: 'unknown', at: null },
    { id: 'invalid', at: '2026-02-30T01:00:00Z' },
  ];
  for (const input of [values, [...values].reverse()]) {
    const cohort = latestObservationCohort(input, (value) => value.at);
    assert.equal(cohort.observedAt, '2026-09-08T01:00:00.000Z');
    assert.deepEqual(new Set(cohort.latest.map((value) => value.id)), new Set(['first', 'second']));
    assert.deepEqual(new Set(cohort.undated.map((value) => value.id)), new Set(['unknown', 'invalid']));
    assert.equal(cohort.superseded, 1);
  }
  assert.deepEqual(latestObservationCohort([], () => null), { observedAt: null, latest: [], undated: [], superseded: 0 });
});
