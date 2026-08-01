import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { abortable, withTimeout } from '../lib/abort.mts';

describe('bounded asynchronous control', () => {
  test('does not start work when the supplied signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Stopped', 'AbortError'));
    let called = false;
    await assert.rejects(abortable(() => {
      called = true;
      return 'unexpected';
    }, controller.signal), { name: 'AbortError' });
    assert.equal(called, false);
  });

  test('returns completed operations and clears their timeout', async () => {
    assert.equal(await withTimeout(async () => 'complete', 50), 'complete');
  });

  test('stops waiting for an operation at the configured timeout', async () => {
    const startedAt = Date.now();
    await assert.rejects(
      withTimeout(async () => new Promise(() => {}), 10, 'Fixture deadline reached.'),
      /Fixture deadline reached/u,
    );
    assert.ok(Date.now() - startedAt < 1_000);
  });
});
