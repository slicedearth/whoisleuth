import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureAttemptDescription, captureChannelSummary, captureCoverageIsPartial, emptyCaptureCoverage, readCaptureCoverage, type CaptureRequestAttempt } from '../packages/investigation/capture-coverage.mts';
import { comparePageBehaviour, readPageBehaviour } from '../packages/investigation/page-behaviour.mts';

const supplied: CaptureRequestAttempt = { position: 1, channel: 'fetch', method: 'read', origin: 'https://api.example.test', state: 'observed', reason: null, collectionStarted: true };

test('capture coverage separates observations, response refusals, failed collection and unexercised surfaces', () => {
  const coverage = readCaptureCoverage({ ...emptyCaptureCoverage(), attempts: [supplied,
    { ...supplied, position: 2, channel: 'beacon', method: 'non_read', origin: null, state: 'refused', reason: 'method', collectionStarted: false },
    { ...supplied, position: 3, channel: 'xhr', state: 'unavailable', reason: 'address_or_transport' },
  ] });
  assert.deepEqual(coverage.disabledSurfaces, ['service_workers', 'dedicated_workers', 'shared_workers', 'websockets', 'webrtc', 'webtransport', 'downloads']);
  assert.equal(coverage.interactions, 'not_exercised');
  assert.equal(captureCoverageIsPartial(coverage), true);
  const summaries = captureChannelSummary(coverage);
  assert.deepEqual(summaries.find(row => row.channel === 'fetch'), { channel: 'fetch', observed: 1, refused: 0, unavailable: 0, coverage: 'recorded' });
  assert.equal(summaries.find(row => row.channel === 'beacon')!.refused, 1);
  assert.equal(summaries.find(row => row.channel === 'xhr')!.unavailable, 1);
  assert.equal(summaries.find(row => row.channel === 'font')!.coverage, 'not_observed');
  assert.equal(captureChannelSummary({ ...coverage, omittedAttempts: 1 }).find(row => row.channel === 'font')!.coverage, 'unknown');
  assert.equal(captureAttemptDescription(coverage.attempts[1]!), 'Response refused · non-read method · collector not started');
  assert.equal(captureAttemptDescription({ ...supplied, state: 'refused', reason: 'response_bound' }), 'Response refused · response byte limit · collector started');
});

test('capture coverage rejects raw destinations, contradictory declarations and unbounded or unordered ledgers', () => {
  for (const bad of [
    { ...supplied, origin: 'https://api.example.test/private?token=sentinel' },
    { ...supplied, origin: 'https://user:sentinel@api.example.test' },
    { ...supplied, state: 'observed', collectionStarted: false },
    { ...supplied, reason: 'method', state: 'refused', method: 'non_read' },
    { ...supplied, state: 'unavailable', reason: null },
    { ...supplied, state: 'refused', reason: 'shutdown' },
    { ...supplied, headers: { private: 'sentinel' } },
  ]) assert.throws(() => readCaptureCoverage({ ...emptyCaptureCoverage(), attempts: [bad] }));
  assert.throws(() => readCaptureCoverage({ ...emptyCaptureCoverage(), attempts: [supplied, supplied] }));
  assert.throws(() => readCaptureCoverage({ ...emptyCaptureCoverage(), attempts: Array.from({ length: 501 }, (_, i) => ({ ...supplied, position: i + 1 })) }));
  assert.throws(() => readCaptureCoverage({ ...emptyCaptureCoverage(), disabledSurfaces: ['websockets'] }));
  assert.throws(() => readCaptureCoverage({ ...emptyCaptureCoverage(), interactions: 'complete' }));
  assert.throws(() => readCaptureCoverage({ ...emptyCaptureCoverage(), omittedAttempts: -1 }));
  assert.throws(() => readCaptureCoverage({ ...emptyCaptureCoverage(), directConnectionRefusals: 1_000_001 }));
  assert.equal(readCaptureCoverage({ ...emptyCaptureCoverage(), attempts: Array.from({ length: 500 }, (_, i) => ({ ...supplied, position: i + 1 })) }).attempts.length, 500);
});

test('coverage follows page comparison without asserting absence or treating disabled-surface order as a change', () => {
  const first = readPageBehaviour({ version: 1, state: 'observed', requests: [], elements: [], actionHints: [], clipboardWriteAttempts: 0, coverage: { ...emptyCaptureCoverage(), attempts: [supplied] } });
  const reordered = readPageBehaviour({ ...first, coverage: { ...first.coverage, disabledSurfaces: [...first.coverage.disabledSurfaces].reverse() } });
  assert.equal(comparePageBehaviour(first, reordered).state, 'unchanged');
  assert.equal(comparePageBehaviour(first, { ...first, coverage: { ...first.coverage, attempts: [] } }).requestChannelsChanged, true);
  const partial = { ...first, state: 'partial' as const, coverage: { ...first.coverage, directConnectionRefusals: 1 } };
  assert.equal(comparePageBehaviour(first, partial).state, 'inconclusive');
  assert.equal(comparePageBehaviour(first, partial).removalEstablished, false);
  assert.throws(() => readPageBehaviour({ ...partial, state: 'observed' }), /Partial/u);
});
