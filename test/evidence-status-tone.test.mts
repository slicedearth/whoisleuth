import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceStatusTone } from '../frontend/src/lib/analysis/evidence-status-tone.ts';

test('maps successful evidence states without turning incomplete collection green', () => {
  assert.equal(evidenceStatusTone('success', { complete: true }), 'complete');
  assert.equal(evidenceStatusTone('observed', { complete: true }), 'complete');
  assert.equal(evidenceStatusTone('success', { complete: false }), 'partial');
  assert.equal(evidenceStatusTone('partial', { complete: true }), 'partial');
  assert.equal(evidenceStatusTone('rate_limited'), 'partial');
});

test('keeps unavailable and unmatched states visually neutral', () => {
  assert.equal(evidenceStatusTone('unavailable'), 'neutral');
  assert.equal(evidenceStatusTone('not found'), 'neutral');
  assert.equal(evidenceStatusTone('unsupported'), 'neutral');
  assert.equal(evidenceStatusTone('success', { neutral: true }), 'neutral');
  assert.equal(evidenceStatusTone(''), 'neutral');
});

test('reserves the error tone for explicit collection failures', () => {
  assert.equal(evidenceStatusTone('error'), 'error');
  assert.equal(evidenceStatusTone('failed'), 'error');
  assert.equal(evidenceStatusTone('conflict'), 'error');
});
