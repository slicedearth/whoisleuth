// Covers the shared lookup cache's size bounds - entry count (MAX_ENTRIES) and
// total bytes (MAX_TOTAL_BYTES). MAX_ENTRIES alone doesn't stop a hostile or
// compromised registry from serving many distinct domains a near-maximum-
// size response each (RDAP: 2MB, WHOIS: 200KB/hop) - that could otherwise
// retain gigabytes well before entry count ever reaches MAX_ENTRIES.

const test = require('node:test');
const assert = require('node:assert/strict');
const { cached, MAX_ENTRIES, MAX_TOTAL_BYTES, _storeSize, _storeBytes } = require('../lib/lookup-cache.mts');

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

test('the cache never exceeds MAX_TOTAL_BYTES, even with entry count well under MAX_ENTRIES', async () => {
  const bigValue = () => ({ blob: 'x'.repeat(5 * 1024 * 1024) }); // ~5MB each
  for (let i = 0; i < 25; i += 1) {
    // 25 * 5MB = 125MB, comfortably over MAX_TOTAL_BYTES (100MB), while
    // entry count (25) stays nowhere near MAX_ENTRIES (3000) - this is the
    // scenario MAX_ENTRIES alone can't bound.
    // eslint-disable-next-line no-await-in-loop
    await cached(`lookup-cache-test:big:${i}`, bigValue);
  }
  assert.ok(_storeBytes() <= MAX_TOTAL_BYTES, `expected total bytes <= ${MAX_TOTAL_BYTES}, got ${_storeBytes()}`);
});

test('a large insert evicts the oldest entry to stay under the byte budget', async () => {
  let earlyFactoryCalls = 0;
  const earlyFactory = async () => {
    earlyFactoryCalls += 1;
    return { small: true };
  };
  await cached('lookup-cache-test:evict-check:early', earlyFactory);

  for (let i = 0; i < 25; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await cached(`lookup-cache-test:evict-check:big:${i}`, async () => ({ blob: 'x'.repeat(5 * 1024 * 1024) }));
  }

  await cached('lookup-cache-test:evict-check:early', earlyFactory);
  assert.equal(earlyFactoryCalls, 2, 'the early small entry should have been evicted (byte budget), then re-fetched');
});
