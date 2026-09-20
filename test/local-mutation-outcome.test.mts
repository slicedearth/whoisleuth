import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserLocalDataError } from '../frontend/src/lib/browser-local-data.ts';
import {
  assertLocalRecordCurrent,
  LocalRecordConflictError,
  clearsLocalMutationDraft,
  failedLocalMutationOutcome,
  summarizeLocalMutationOutcomes,
} from '../frontend/src/lib/local-mutation-outcome.ts';

test('submitted records detect same-clock changes, deletion and different owners', () => {
  const expected = { id: 'fixture-record', updatedAt: '2026-01-01T00:00:00.000Z', name: 'Reviewed', conditions: [{ field: 'availability', value: 'registered' }] };
  assert.doesNotThrow(() => assertLocalRecordCurrent(structuredClone(expected), expected, 'record'));
  for (const current of [
    null,
    undefined,
    { ...expected, id: 'other-record' },
    { ...expected, name: 'Changed without a new clock' },
    { ...expected, conditions: [{ field: 'availability', value: 'unregistered' }] },
  ]) {
    assert.throws(() => assertLocalRecordCurrent(current, expected, 'record'), LocalRecordConflictError);
  }
  assert.equal(expected.name, 'Reviewed');
});

test('field edits compare the submitted fields and owner without blocking unrelated changes', () => {
  const expected = { id: 'fixture-campaign', name: 'Reviewed', description: 'Scope', domains: ['first.example'] };
  const current = { ...expected, domains: ['first.example', 'second.example'] };
  assert.doesNotThrow(() => assertLocalRecordCurrent(current, expected, 'campaign', ['name', 'description']));
  assert.throws(() => assertLocalRecordCurrent({ ...current, name: 'Peer edit' }, expected, 'campaign', ['name', 'description']), LocalRecordConflictError);
  assert.throws(() => assertLocalRecordCurrent({ ...current, id: 'other-campaign' }, expected, 'campaign', ['name']), LocalRecordConflictError);
  assert.throws(() => assertLocalRecordCurrent(current, expected, 'campaign'), LocalRecordConflictError);
  const extended = { ...expected, retainedNote: 'A new field' };
  assert.throws(() => assertLocalRecordCurrent<typeof expected>(extended, expected, 'campaign'), LocalRecordConflictError);
  assert.deepEqual(current.domains, ['first.example', 'second.example']);
});

test('record comparison is independent of top-level property insertion order', () => {
  const expected = { id: 'fixture-record', name: 'Reviewed', enabled: true };
  assert.doesNotThrow(() => assertLocalRecordCurrent({ enabled: true, name: 'Reviewed', id: 'fixture-record' }, expected, 'record'));
  assert.doesNotThrow(() => assertLocalRecordCurrent(null, null, 'new record'));
});

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
