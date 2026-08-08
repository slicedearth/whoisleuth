import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceStatusTone } from '../frontend/src/lib/analysis/evidence-status-tone.ts';

test('maps successful evidence states without turning incomplete collection green', () => {
  for (const state of ['success', 'complete', 'completed', 'supported', 'observed', 'registered', 'available']) {
    assert.equal(evidenceStatusTone(state, { complete: true }), 'complete', state);
  }
  assert.equal(evidenceStatusTone('success', { complete: false }), 'partial');
  for (const state of ['partial', 'warning', 'review', 'inconclusive', 'incomplete', 'limited', 'stale', 'truncated', 'rate_limited']) {
    assert.equal(evidenceStatusTone(state, { complete: true }), 'partial', state);
  }
});

test('keeps unavailable and unmatched states visually neutral', () => {
  for (const state of ['unavailable', 'not found', 'unsupported', 'not applicable', 'skipped', 'disabled', 'omitted']) {
    assert.equal(evidenceStatusTone(state), 'neutral', state);
  }
  assert.equal(evidenceStatusTone('success', { neutral: true }), 'neutral');
  assert.equal(evidenceStatusTone(''), 'neutral');
  assert.equal(evidenceStatusTone('future source state'), 'neutral');
});

test('reserves the error tone for explicit collection failures', () => {
  for (const state of ['error', 'failed', 'conflict', 'invalid_response', 'network error', 'timeout']) {
    assert.equal(evidenceStatusTone(state), 'error', state);
  }
});
