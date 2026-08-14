import { requiredValue } from './value-assertions.mts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { OBSERVATION_VERSION, createObservation, readObservationEnvelope } from '../lib/observation.mts';

test('creates a deterministic bounded observation envelope', () => {
  const result = createObservation({
    status: 'partial', observedAt: '2026-07-13T01:02:03Z', scanMode: 'deep', source: 'dns',
    durationMs: 12.6, complete: false, truncated: true,
    limitations: [' Point-in-time data. ', 'Point-in-time data.', 'x'.repeat(400)],
    diagnostics: {
      z: { status: 'error', error: 'failed\ncontrol', discarded: 2, ignored: 'nope' },
      a: 4,
      'bad key': 'discarded',
    },
  });
  assert.equal(result.version, OBSERVATION_VERSION);
  assert.equal(result.observedAt, '2026-07-13T01:02:03.000Z');
  assert.equal(result.durationMs, 13);
  assert.equal(result.limitations.length, 2);
  assert.equal(requiredValue(result.limitations[1]).length, 300);
  assert.deepEqual(result.diagnostics.a, 4);
  assert.deepEqual(result.diagnostics.z, { status: 'error', error: 'failed control', discarded: 2 });
  assert.equal(Object.hasOwn(result.diagnostics, 'bad key'), false);
});

test('reader distinguishes absent, supported, invalid, and future envelopes', () => {
  assert.equal(readObservationEnvelope(undefined).state, 'absent');
  assert.equal(readObservationEnvelope({ version: 1 }).state, 'invalid');
  assert.equal(readObservationEnvelope({ version: 99 }).state, 'unsupported');
  const supported = readObservationEnvelope(createObservation({
    status: 'success', observedAt: '2026-07-13T00:00:00Z', source: 'dns', complete: true,
  }));
  assert.equal(supported.state, 'supported');
  assert.equal(supported.observation.complete, true);
});

test('creator never emits an observation timestamp its reader rejects', () => {
  for (const observedAt of [
    '0001-01-01T00:00:00Z',
    '2026-07-13T01:02:03+10:00',
    '9999-12-31T23:59:59Z',
    '0001-01-01T00:00:00+14:00',
    '9999-12-31T23:59:59-14:00',
  ]) {
    const observation = createObservation({ status: 'success', observedAt, source: 'test', complete: true });
    assert.equal(readObservationEnvelope(observation).state, 'supported');
  }
});

test('invalid optional values fail safe without inventing scan profiles', () => {
  const result = createObservation({ status: 'made-up', observedAt: 'bad', scanMode: 'interactive', source: '', durationMs: Infinity });
  assert.equal(result.status, 'error');
  assert.equal(result.scanMode, null);
  assert.equal(result.source, 'unknown');
  assert.equal(result.durationMs, null);
  assert.match(result.observedAt, /^\d{4}-\d{2}-\d{2}T/);
});
