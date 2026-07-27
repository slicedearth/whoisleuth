import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from '../server.mts';

test('the self-hosted TypeScript runtime can load without opening a listener', () => {
  assert.equal(typeof runtime.app, 'function');
  assert.equal(typeof runtime.startServer, 'function');
  assert.equal(typeof runtime.requireAuth, 'function');
  assert.equal(typeof runtime.requireFeature, 'function');
});
