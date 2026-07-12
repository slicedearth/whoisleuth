const { before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

let history;
before(async () => {
  history = await import('../frontend/src/lib/analysis/ct-history.js');
});

const FIRST = '2026-07-01T00:00:00.000Z';
const SECOND = '2026-07-02T00:00:00.000Z';

function record(store, query, domains, checkedAt, options = {}) {
  return history.recordCtHistorySearch(store, query, domains, {
    checkedAt,
    certificateCount: options.certificateCount ?? domains.length,
    truncated: options.truncated ?? false,
  });
}

describe('CT search baselines', () => {
  test('the first complete search creates a baseline without marking everything new', () => {
    const result = record(null, 'Example Brand', ['b.example', 'a.example'], FIRST);
    assert.equal(result.comparison.hasBaseline, false);
    assert.equal(result.comparison.newCount, 0);
    assert.equal(result.comparison.baselineUpdated, true);
    assert.deepStrictEqual(result.store.entries[0].domains, ['a.example', 'b.example']);
    assert.equal(result.store.entries[0].baselineAt, FIRST);
  });

  test('a later complete search reports new canonical domains and advances the baseline', () => {
    const first = record(null, 'example', ['a.example', 'b.example'], FIRST);
    const second = record(first.store, 'example', ['b.example', 'c.example'], SECOND);
    assert.equal(second.comparison.hasBaseline, true);
    assert.equal(second.comparison.previousCheckedAt, FIRST);
    assert.deepStrictEqual(second.comparison.newDomains, ['c.example']);
    assert.deepStrictEqual(second.store.entries[0].domains, ['b.example', 'c.example']);
    assert.equal(second.store.entries[0].history.at(-1).newCount, 1);
  });

  test('query matching is case-insensitive and whitespace-normalized', () => {
    const first = record(null, '  Example   Brand ', ['a.example'], FIRST);
    const second = record(first.store, 'example brand', ['a.example', 'b.example'], SECOND);
    assert.equal(second.store.entries.length, 1);
    assert.equal(second.store.entries[0].query, 'example brand');
    assert.deepStrictEqual(second.comparison.newDomains, ['b.example']);
  });

  test('a capped search is compared but cannot replace a complete baseline', () => {
    const first = record(null, 'example', ['a.example', 'b.example'], FIRST);
    const capped = record(first.store, 'example', ['b.example', 'c.example'], SECOND, { truncated: true });
    assert.deepStrictEqual(capped.comparison.newDomains, ['c.example']);
    assert.equal(capped.comparison.baselineUpdated, false);
    assert.equal(capped.store.entries[0].baselineAt, FIRST);
    assert.deepStrictEqual(capped.store.entries[0].domains, ['a.example', 'b.example']);
    assert.equal(capped.store.entries[0].history.at(-1).truncated, true);
  });

  test('a first capped search does not create a partial baseline', () => {
    const capped = record(null, 'example', ['a.example'], FIRST, { truncated: true });
    assert.equal(capped.store.entries[0].baselineAt, null);
    assert.deepStrictEqual(capped.store.entries[0].domains, []);
    const complete = record(capped.store, 'example', ['a.example', 'b.example'], SECOND);
    assert.equal(complete.comparison.hasBaseline, false);
    assert.deepStrictEqual(complete.comparison.newDomains, []);
    assert.equal(complete.store.entries[0].baselineAt, SECOND);
  });

  test('domain input is validated, canonicalized, deduplicated, and bounded', () => {
    const domains = ['HTTPS://A.EXAMPLE/path', 'a.example', 'bad host', '127.0.0.1'];
    for (let index = 0; index < history.MAX_CT_HISTORY_DOMAINS + 20; index++) domains.push(`d${index}.example`);
    const result = record(null, 'example', domains, FIRST);
    assert.equal(result.store.entries[0].domains.length, history.MAX_CT_HISTORY_DOMAINS);
    assert.ok(result.store.entries[0].domains.includes('a.example'));
    assert.ok(!result.store.entries[0].domains.includes('bad host'));
  });
});

describe('CT history retention and recovery', () => {
  test('per-query check history keeps only the newest bounded events', () => {
    let store = null;
    for (let index = 0; index < history.MAX_CT_HISTORY_EVENTS + 3; index++) {
      store = record(store, 'example', [`d${index}.example`], new Date(Date.UTC(2026, 0, index + 1)).toISOString()).store;
    }
    const events = store.entries[0].history;
    assert.equal(events.length, history.MAX_CT_HISTORY_EVENTS);
    assert.equal(events.at(-1).checkedAt, new Date(Date.UTC(2026, 0, history.MAX_CT_HISTORY_EVENTS + 3)).toISOString());
  });

  test('the store keeps only the most recently updated search queries', () => {
    let store = null;
    for (let index = 0; index < history.MAX_CT_HISTORY_SEARCHES + 3; index++) {
      store = record(store, `query ${index}`, [`d${index}.example`], new Date(Date.UTC(2026, 0, index + 1)).toISOString()).store;
    }
    assert.equal(store.entries.length, history.MAX_CT_HISTORY_SEARCHES);
    assert.equal(store.entries[0].query, `query ${history.MAX_CT_HISTORY_SEARCHES + 2}`);
    assert.equal(store.entries.some((entry) => entry.query === 'query 0'), false);
  });

  test('malformed entries and unknown fields are discarded without throwing', () => {
    const store = history.normalizeCtHistoryStore({
      version: 1,
      evil: true,
      entries: [
        null,
        { query: 'bad\nquery', updatedAt: FIRST },
        { query: 'valid', baselineAt: FIRST, updatedAt: FIRST, domains: ['A.EXAMPLE'], history: [{ checkedAt: FIRST, resultCount: 1, unknown: 'x' }], unknown: 'x' },
      ],
    });
    assert.equal(store.entries.length, 1);
    assert.deepStrictEqual(store.entries[0].domains, ['a.example']);
    assert.deepStrictEqual(Object.keys(store.entries[0]).sort(), ['baselineAt', 'domains', 'history', 'query', 'updatedAt']);
    assert.deepStrictEqual(Object.keys(store.entries[0].history[0]).sort(), ['certificateCount', 'checkedAt', 'newCount', 'newDomains', 'resultCount', 'truncated']);
  });

  test('duplicate query entries resolve to the most recently updated record', () => {
    const store = history.normalizeCtHistoryStore({ entries: [
      { query: 'example', baselineAt: FIRST, updatedAt: FIRST, domains: ['old.example'], history: [] },
      { query: 'EXAMPLE', baselineAt: SECOND, updatedAt: SECOND, domains: ['new.example'], history: [] },
    ] });
    assert.equal(store.entries.length, 1);
    assert.deepStrictEqual(store.entries[0].domains, ['new.example']);
  });

  test('deleting one query leaves other history intact', () => {
    const one = record(null, 'one', ['one.example'], FIRST);
    const two = record(one.store, 'two', ['two.example'], SECOND);
    const remaining = history.deleteCtHistoryEntry(two.store, ' ONE ');
    assert.deepStrictEqual(remaining.entries.map((entry) => entry.query), ['two']);
  });

  test('future schema versions can be detected by the storage wrapper', () => {
    assert.equal(history.ctHistoryStoreVersion({ version: 2 }), 2);
    assert.equal(history.ctHistoryStoreVersion({ version: '2' }), null);
    assert.equal(history.ctHistoryStoreVersion(null), null);
  });

  test('new-domain details are bounded while the full count is retained', () => {
    const baseline = record(null, 'example', ['baseline.example'], FIRST);
    const domains = Array.from({ length: history.MAX_CT_HISTORY_NEW_DOMAINS + 20 }, (_, index) => `new-${index}.example`);
    const next = record(baseline.store, 'example', domains, SECOND);
    const event = next.store.entries[0].history.at(-1);
    assert.equal(next.comparison.newCount, domains.length);
    assert.equal(event.newCount, domains.length);
    assert.equal(event.newDomains.length, history.MAX_CT_HISTORY_NEW_DOMAINS);
  });

  test('the serialized store stays within its dedicated byte budget', () => {
    const suffix = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(61)}`;
    const domains = Array.from({ length: history.MAX_CT_HISTORY_DOMAINS }, (_, index) => {
      const prefix = `d${index}`.padEnd(63, 'x');
      return `${prefix}.${suffix}`;
    });
    let store = null;
    for (let index = 0; index < history.MAX_CT_HISTORY_SEARCHES; index++) {
      store = record(store, `large query ${index}`, domains, new Date(Date.UTC(2026, 0, index + 1)).toISOString()).store;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(store)).length;
    assert.ok(bytes <= history.MAX_CT_HISTORY_STORE_BYTES);
    assert.ok(store.entries.length < history.MAX_CT_HISTORY_SEARCHES);
    assert.equal(store.entries[0].domains.length, history.MAX_CT_HISTORY_DOMAINS);
  });
});
