import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BrowserLocalDataError } from '../frontend/src/lib/browser-local-data.ts';
import { unavailableLocalContextLabels } from '../frontend/src/lib/local-context-load.ts';

test('local-context load classification preserves fulfilled collections and names expected failures', () => {
  const results: PromiseSettledResult<unknown>[] = [
    { status: 'fulfilled', value: ['retained'] },
    { status: 'rejected', reason: new BrowserLocalDataError('LOCAL_DATA_READ_FAILED', 'Unavailable.') },
  ];
  assert.deepEqual(unavailableLocalContextLabels(results, ['cases', 'profiles']), ['profiles']);
  assert.deepEqual((results[0] as PromiseFulfilledResult<unknown>).value, ['retained']);
});

test('local-context load classification does not hide programming failures', () => {
  const failure = new TypeError('Unexpected contract failure');
  assert.throws(
    () => unavailableLocalContextLabels([{ status: 'rejected', reason: failure }], ['profiles']),
    (cause) => cause === failure,
  );
  assert.throws(
    () => unavailableLocalContextLabels([], ['profiles']),
    /same length/iu,
  );
});
