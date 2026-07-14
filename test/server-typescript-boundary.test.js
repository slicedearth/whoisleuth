const test = require('node:test');
const assert = require('node:assert/strict');

test('the self-hosted TypeScript runtime can load without opening a listener', () => {
  const runtime = require('../server.mts');

  assert.equal(typeof runtime.app, 'function');
  assert.equal(typeof runtime.startServer, 'function');
  assert.equal(typeof runtime.requireAuth, 'function');
  assert.equal(typeof runtime.requireFeature, 'function');
});
