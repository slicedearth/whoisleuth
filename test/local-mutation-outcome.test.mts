import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserLocalDataError } from '../frontend/src/lib/browser-local-data.ts';
import {
  clearsLocalMutationDraft,
  failedLocalMutationOutcome,
  summarizeLocalMutationOutcomes,
} from '../frontend/src/lib/local-mutation-outcome.ts';

test('only a confirmed committed local mutation clears an analyst draft', () => {
  assert.equal(clearsLocalMutationDraft('committed'), true);
  assert.equal(clearsLocalMutationDraft('rejected'), false);
  assert.equal(clearsLocalMutationDraft('unknown'), false);
  assert.equal(clearsLocalMutationDraft('stale'), false);
});

test('commit-unknown storage failures remain distinct from rejected writes', () => {
  assert.equal(
    failedLocalMutationOutcome(new BrowserLocalDataError(
      'LOCAL_DATA_COMMIT_UNKNOWN',
      'The write may have committed.',
    )),
    'unknown',
  );
  assert.equal(
    failedLocalMutationOutcome(new BrowserLocalDataError(
      'LOCAL_DATA_QUOTA',
      'The write was rejected.',
    )),
    'rejected',
  );
  assert.equal(failedLocalMutationOutcome(new Error('Rejected')), 'rejected');
});

test('batch mutation summaries retain all and partial storage failures', () => {
  assert.deepEqual(
    summarizeLocalMutationOutcomes(['rejected', 'rejected']),
    { committed: 0, rejected: 2, unknown: 0, stale: 0 },
  );
  assert.deepEqual(
    summarizeLocalMutationOutcomes(['committed', 'rejected', 'unknown']),
    { committed: 1, rejected: 1, unknown: 1, stale: 0 },
  );
});
