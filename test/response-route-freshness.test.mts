import assert from 'node:assert/strict';
import test from 'node:test';
import { responseRouteFreshness } from '../packages/cases/response-route-freshness.mts';

test('route freshness preserves clock, source-age and explicit-deadline boundaries', () => {
  const now = '2026-09-08T12:00:00.000Z';
  assert.equal(responseRouteFreshness(now, null, now), 'current');
  assert.equal(responseRouteFreshness('2026-08-09T12:00:00.000Z', null, now), 'current');
  assert.equal(responseRouteFreshness('2026-08-09T11:59:59.999Z', null, now), 'stale');
  assert.equal(responseRouteFreshness('2026-09-08T10:00:00.000Z', now, now), 'stale');
  assert.equal(responseRouteFreshness('2026-07-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', now), 'current');
  assert.equal(responseRouteFreshness('2026-09-09T12:00:00.000Z', null, now), 'stale');
  assert.equal(responseRouteFreshness(null, '2026-10-01T00:00:00.000Z', now), 'unknown');
  assert.equal(responseRouteFreshness(now, 'not-a-date', now), 'unknown');
  assert.equal(responseRouteFreshness(now, null, 'not-a-date'), 'unknown');
});
