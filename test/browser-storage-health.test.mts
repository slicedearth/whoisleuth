import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readBrowserStorageHealth, requestBrowserPersistence } from '../frontend/src/lib/browser-storage-health.ts';

describe('browser storage health', () => {
  test('does not replace unavailable readings with zero or a retention promise', async () => {
    assert.deepEqual(await readBrowserStorageHealth(undefined), { persisted: null, usage: null, quota: null, persistenceAvailable: false });
    assert.deepEqual(await readBrowserStorageHealth({ persisted: async () => { throw new Error('Unavailable'); }, estimate: async () => ({ usage: NaN, quota: Infinity }) }),
      { persisted: null, usage: null, quota: null, persistenceAvailable: false });
  });
  test('reports independent measurements and never requests persistence while reading', async () => {
    let requests = 0;
    const source = { persisted: async () => false, estimate: async () => ({ usage: 0, quota: 1024 }), persist: async () => { requests++; return true; } };
    assert.deepEqual(await readBrowserStorageHealth(source), { persisted: false, usage: 0, quota: 1024, persistenceAvailable: true });
    assert.equal(requests, 0); assert.equal(await requestBrowserPersistence(source), true); assert.equal(requests, 1);
  });
  test('distinguishes refusal, unsupported operation and failure', async () => {
    assert.equal(await requestBrowserPersistence(undefined), null);
    assert.equal(await requestBrowserPersistence({ persist: async () => false }), false);
    assert.equal(await requestBrowserPersistence({ persist: async () => { throw new Error('Denied'); } }), null);
    assert.equal((await readBrowserStorageHealth({ estimate: () => { throw new Error('Blocked'); }, persisted: async () => true })).persisted, true);
  });
});
