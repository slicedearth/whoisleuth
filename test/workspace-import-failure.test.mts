import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BrowserLocalDataError } from '../frontend/src/lib/browser-local-data.ts';
import { rethrowUnknownWorkspaceCommit } from '../frontend/src/lib/analysis/workspace-import-outcome.ts';

test('preserves an unknown workspace-import commit outcome exactly', () => {
  const commitUnknown = new BrowserLocalDataError(
    'LOCAL_DATA_COMMIT_UNKNOWN',
    'The browser-local update may have committed. Reload before retrying.',
  );
  assert.throws(
    () => rethrowUnknownWorkspaceCommit(commitUnknown),
    (cause: unknown) => {
      assert.equal(cause, commitUnknown);
      assert.ok(cause instanceof BrowserLocalDataError);
      assert.equal(cause.code, 'LOCAL_DATA_COMMIT_UNKNOWN');
      assert.equal(cause.message, 'The browser-local update may have committed. Reload before retrying.');
      return true;
    },
  );
  assert.doesNotThrow(() => rethrowUnknownWorkspaceCommit(new Error('Rolled back failure')));
});
