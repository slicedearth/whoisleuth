import assert from 'node:assert/strict';
import { test } from 'node:test';

import { guardedWorkspaceRollback, guardedWorkspaceSettingsRollback } from '../frontend/src/lib/analysis/workspace-rollback.ts';
import type { AnyLocalDataCollectionDefinition } from '../frontend/src/lib/browser-local-data.ts';

function definition(id: string): AnyLocalDataCollectionDefinition {
  return {
    id, label: id, legacyKey: id, schemaVersion: 1, maximumBytes: 1024, maximumRecords: 10,
    empty: () => [], normalize: (value) => value ?? [], version: () => 1,
    serialize: (value) => JSON.stringify(value), split: () => [], join: () => [],
  };
}

test('workspace rollback restores only the exact documents written by the failed import', () => {
  const definitions = [definition('cases'), definition('profiles')];
  const previous = new Map<string, unknown>([['cases', ['before']], ['profiles', ['before']]]);
  const applied = new Map<string, unknown>([['cases', ['imported']], ['profiles', ['imported']]]);
  assert.deepEqual(
    guardedWorkspaceRollback(definitions, new Map(applied), applied, previous),
    previous,
  );
  const concurrent = new Map(applied);
  concurrent.set('cases', ['newer-tab-edit']);
  assert.throws(
    () => guardedWorkspaceRollback(definitions, concurrent, applied, previous),
    /changed in another tab/iu,
  );
  assert.deepEqual(concurrent.get('cases'), ['newer-tab-edit']);
});

test('workspace settings rollback preserves values changed after the import write', () => {
  const previous = new Map<string, string | null>([['theme', 'dark'], ['profile', 'before']]);
  const applied = new Map<string, string | null>([['theme', 'light'], ['profile', 'imported']]);
  const ordinary = guardedWorkspaceSettingsRollback(new Map(applied), applied, previous);
  assert.equal(ordinary.fullyRestored, true);
  assert.deepEqual(ordinary.settings, previous);

  const concurrent = new Map(applied);
  concurrent.set('theme', 'system');
  const guarded = guardedWorkspaceSettingsRollback(concurrent, applied, previous);
  assert.equal(guarded.fullyRestored, false);
  assert.equal(guarded.settings.get('theme'), 'system');
  assert.equal(guarded.settings.get('profile'), 'before');

  const partiallyApplied = new Map<string, string | null>([['theme', 'dark'], ['profile', 'imported']]);
  const partial = guardedWorkspaceSettingsRollback(partiallyApplied, applied, previous);
  assert.equal(partial.fullyRestored, true);
  assert.deepEqual(partial.settings, previous);
});
