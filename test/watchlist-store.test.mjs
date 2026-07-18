import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertWatchlistStoreBudget,
  buildWatchlistExport,
  MAX_WATCHLIST_INPUTS,
  MAX_WATCHLIST_NAME_LENGTH,
  MAX_WATCHLIST_STORE_BYTES,
  mergeWatchlistStores,
  normalizeWatchlistName,
  normalizeWatchlistStore,
  serializeWatchlistStore,
  WATCHLIST_SCHEMA,
  WATCHLIST_SCHEMA_VERSION,
  watchlistStoreVersion,
} from '../frontend/src/lib/analysis/watchlist-store.js';

const NOW = '2026-07-14T08:00:00.000Z';

function entry(overrides = {}) {
  return {
    updatedAt: NOW,
    results: [{ domain: 'example.invalid', availability: 'registered', scanDepth: 'fast', mutationTypes: ['omission'] }],
    baseline: [],
    history: [],
    ...overrides,
  };
}

test('normalizes watchlist names and blocks prototype and control keys', () => {
  assert.equal(normalizeWatchlistName('  Priority domains  '), 'Priority domains');
  assert.equal(normalizeWatchlistName('__proto__'), '');
  assert.equal(normalizeWatchlistName('bad\nname'), '');
  assert.equal(normalizeWatchlistName('N'.repeat(MAX_WATCHLIST_NAME_LENGTH + 1)), '');
});

test('internal watchlist maps normalize without confusing a list named watchlists for an envelope', () => {
  const source = { watchlists: entry() };
  const store = normalizeWatchlistStore(source);
  assert.equal(store.version, WATCHLIST_SCHEMA_VERSION);
  assert.ok(store.watchlists.watchlists);
});

test('versioned stores retain only bounded known evidence fields', () => {
  const source = { schema: WATCHLIST_SCHEMA, version: 2, watchlists: { Priority: entry({ results: [{ domain: 'example.invalid', availability: 'registered', private: 'drop me' }] }) } };
  const before = structuredClone(source);
  const parsed = JSON.parse(serializeWatchlistStore(source.watchlists));
  assert.deepEqual(source, before);
  assert.equal(parsed.version, WATCHLIST_SCHEMA_VERSION);
  assert.equal(parsed.schema, WATCHLIST_SCHEMA);
  assert.equal(parsed.watchlists.Priority.results[0].private, undefined);
});

test('store recovery caps input collection work and retained watchlists', () => {
  const source = Object.fromEntries(Array.from({ length: MAX_WATCHLIST_INPUTS + 10 }, (_, index) => [`List ${index}`, entry()]));
  const store = normalizeWatchlistStore(source);
  assert.equal(Object.keys(store.watchlists).length, 100);
});

test('imports add, replace, and skip malformed or over-limit records deterministically', () => {
  const local = { Local: entry() };
  const result = mergeWatchlistStores(local, {
    schema: 'whoisleuth.watchlists', version: 2, watchlists: {
      Local: entry({ results: [{ domain: 'updated.invalid' }] }),
      Added: entry({ results: [{ domain: 'added.invalid' }] }),
      Invalid: { results: 'not an array' },
    },
  });
  assert.deepEqual({ added: result.added, updated: result.updated, skipped: result.skipped }, { added: 1, updated: 1, skipped: 1 });
  assert.equal(result.watchlists.Local.results[0].domain, 'updated.invalid');
  assert.equal(result.watchlists.Added.results[0].domain, 'added.invalid');
});

test('imports reject unrelated, malformed, and future schemas', () => {
  assert.throws(() => mergeWatchlistStores({}, []), /not a WHOISleuth watchlist export/i);
  assert.throws(() => mergeWatchlistStores({}, { Priority: entry() }), /not a WHOISleuth watchlist export/i);
  assert.throws(() => mergeWatchlistStores({}, { schema: 'whoisleuth.cases', watchlists: {} }), /not a WHOISleuth watchlist export/);
  assert.throws(() => mergeWatchlistStores({}, { schema: WATCHLIST_SCHEMA, version: 1, watchlists: {} }), /using schema 2/);
  assert.throws(() => mergeWatchlistStores({}, { schema: 'whoisleuth.watchlists', version: 3, watchlists: {} }), /newer schema 3/);
  assert.equal(watchlistStoreVersion({ schema: WATCHLIST_SCHEMA, version: 2.5, watchlists: {} }), 2.5);
});

test('a normal store remains below its dedicated UTF-8 byte budget', () => {
  const store = assertWatchlistStoreBudget({ Priority: entry() });
  assert.ok(new TextEncoder().encode(JSON.stringify(store)).byteLength <= MAX_WATCHLIST_STORE_BYTES);
});

test('oversized normalized evidence fails before browser storage is touched', () => {
  const results = Array.from({ length: 2000 }, (_, index) => ({
    domain: `item-${index}.invalid`,
    availability: 'registered',
    scanDepth: 'deep',
    registrarName: 'R'.repeat(300),
    pageTitle: 'T'.repeat(200),
    phishingLanguageMatch: 'P'.repeat(200),
    nameservers: Array.from({ length: 12 }, (_, ns) => `ns-${ns}-${index}.invalid`),
  }));
  assert.throws(() => assertWatchlistStoreBudget({ Large: entry({ results }) }), /Watchlist storage is full/);
});

test('portable exports carry schema identity and normalized watchlists', () => {
  const result = buildWatchlistExport({ Priority: entry() }, NOW);
  assert.equal(result.schema, 'whoisleuth.watchlists');
  assert.equal(result.version, WATCHLIST_SCHEMA_VERSION);
  assert.equal(result.exportedAt, NOW);
  assert.equal(result.watchlists.Priority.results[0].domain, 'example.invalid');
});
