import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evidenceStatusChipClass,
  evidenceStatusTone,
} from '../frontend/src/lib/analysis/evidence-status-tone.ts';
import { availabilityStatusDisplay } from '../frontend/src/lib/analysis/availability-status-display.ts';

test('separates successful outcomes from factual completion states', () => {
  assert.equal(evidenceStatusTone('success', { complete: true }), 'success');
  for (const state of ['complete', 'completed', 'supported', 'observed', 'provided', 'registered', 'active', 'available']) {
    assert.equal(evidenceStatusTone(state, { complete: true }), 'complete', state);
  }
  assert.equal(evidenceStatusTone('success', { complete: false }), 'partial');
  for (const state of ['partial', 'warning', 'review', 'inconclusive', 'incomplete', 'limited', 'stale', 'truncated', 'rate_limited']) {
    assert.equal(evidenceStatusTone(state, { complete: true }), 'partial', state);
  }
});

test('maps every capture availability state without treating factual states as success', () => {
  assert.deepEqual(availabilityStatusDisplay('available'), { className: 'factual', label: 'Available' });
  assert.deepEqual(availabilityStatusDisplay('registered'), { className: 'factual', label: 'Registered' });
  assert.deepEqual(availabilityStatusDisplay('for_sale'), { className: 'factual', label: 'For sale' });
  assert.deepEqual(availabilityStatusDisplay('for-sale'), { className: 'factual', label: 'For sale' });
  assert.deepEqual(availabilityStatusDisplay('for sale'), { className: 'factual', label: 'For sale' });
  assert.deepEqual(availabilityStatusDisplay('expiring'), { className: 'warn', label: 'Expiring' });
  assert.deepEqual(availabilityStatusDisplay('unknown'), { className: 'unavailable', label: 'Unknown' });
  assert.deepEqual(availabilityStatusDisplay('failed'), { className: 'danger', label: 'Failed' });
  assert.deepEqual(availabilityStatusDisplay('future_state'), { className: 'unavailable', label: 'Future state' });
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

test('maps evidence tones to explicit chip classes', () => {
  assert.equal(evidenceStatusChipClass('success'), 'good');
  assert.equal(evidenceStatusChipClass('complete'), 'factual');
  assert.equal(evidenceStatusChipClass('active'), 'factual');
  assert.equal(evidenceStatusChipClass('partial'), 'warn');
  assert.equal(evidenceStatusChipClass('conflict'), 'danger');
  assert.equal(evidenceStatusChipClass('unsupported'), 'unavailable');
  assert.equal(evidenceStatusChipClass('future source state'), 'unavailable');
});
