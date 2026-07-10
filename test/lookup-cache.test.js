// Covers lib/lookup-cache.js's size bound - without it, every distinct
// RDAP/WHOIS lookup (including the full raw upstream response) is cached
// with no limit but time, so a single large fast scan landing within one
// TTL window could add thousands of entries before the next sweep runs.

const test = require('node:test');
const assert = require('node:assert/strict');
const { cached, MAX_ENTRIES, _storeSize } = require('../lib/lookup-cache');

test('the cache never grows past MAX_ENTRIES, even when every key is unique', async () => {
  const extra = 50;
  for (let i = 0; i < MAX_ENTRIES + extra; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await cached(`lookup-cache-test:${i}`, async () => ({ i }));
  }
  assert.ok(_storeSize() <= MAX_ENTRIES, `expected store size <= ${MAX_ENTRIES}, got ${_storeSize()}`);
});

test('a cached value is still returned for a key looked up again', async () => {
  let calls = 0;
  const factory = async () => {
    calls += 1;
    return { calls };
  };
  const first = await cached('lookup-cache-test:repeat', factory);
  const second = await cached('lookup-cache-test:repeat', factory);
  assert.equal(calls, 1); // the factory only ran once - the second call was a cache hit
  assert.deepEqual(first, second);
});
