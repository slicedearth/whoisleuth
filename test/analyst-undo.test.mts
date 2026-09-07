import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANALYST_UNDO_WINDOW_MS,
  analystUndoExpired,
  analystUndoRemainingMs,
  createAnalystUndoDescriptor,
  assertAnalystUndoCurrent,
  AnalystUndoConflictError,
} from '../frontend/src/lib/analysis/analyst-undo.ts';

test('undo accepts only the value produced by the submitted mutation', () => {
  assert.doesNotThrow(() => assertAnalystUndoCurrent(['review'], ['review']));
  assert.doesNotThrow(() => assertAnalystUndoCurrent(null, null));
  for (const [current, expected] of [
    [['review', 'later'], ['review']],
    [null, ['review']],
    [['review'], null],
    [{ state: 'reviewed', updatedAt: '2026-09-08T02:00:00Z' }, { state: 'reviewed', updatedAt: '2026-09-08T01:00:00Z' }],
  ]) assert.throws(() => assertAnalystUndoCurrent(current, expected), AnalystUndoConflictError);
});

test('analyst undo descriptors bound labels and expiry', () => {
  const descriptor = createAnalystUndoDescriptor({
    kind: 'case_tags',
    action: `  Updated   ${'x'.repeat(200)}  `,
    affectedRecord: ` ${'example.'.repeat(30)}invalid `,
  }, 1_000, 50_000);

  assert.equal(descriptor.kind, 'case_tags');
  assert.equal(descriptor.createdAt, 1_000);
  assert.equal(descriptor.expiresAt, 1_000 + ANALYST_UNDO_WINDOW_MS);
  assert.equal(descriptor.action.length, 120);
  assert.equal(descriptor.affectedRecord.length, 120);
  assert.equal(analystUndoRemainingMs(descriptor, 2_000), ANALYST_UNDO_WINDOW_MS - 1_000);
  assert.equal(analystUndoExpired(descriptor, descriptor.expiresAt), true);
});

test('analyst undo descriptors reject empty metadata', () => {
  assert.throws(() => createAnalystUndoDescriptor({
    kind: 'local_label',
    action: ' ',
    affectedRecord: 'cluster',
  }), /require a supported local mutation/);
});
