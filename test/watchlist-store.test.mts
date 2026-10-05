import { requiredValue } from './value-assertions.mts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertWatchlistStoreBudget,
  buildWatchlistExport,
  MAX_WATCHLIST_INPUTS,
  MAX_WATCHLIST_NAME_LENGTH,
  MAX_WATCHLISTS,
  MAX_WATCHLIST_STORE_BYTES,
  mergeWatchlistStores,
  normalizeWatchlistName,
  normalizeWatchlistStore,
  serializeWatchlistStore,
  WATCHLIST_SCHEMA,
  WATCHLIST_SCHEMA_VERSION,
  watchlistStoreVersion,
  planWatchlistUpdate,
  applyReviewedWatchlistUpdate,
  planHostedWatchlistRestore,
  applyReviewedHostedWatchlistRestore,
} from '../frontend/src/lib/analysis/watchlist-store.ts';
import { mergeHostedWatchlist, resolveWatchlistMutationTarget } from '../frontend/src/lib/watchlists.ts';
import { watchlistActiveDomains, MAX_WATCHLIST_DOMAINS } from '../packages/workspace/watchlist-history.mts';

const NOW = '2026-07-14T08:00:00.000Z';

test('Monitor membership review distinguishes scoped evidence from complete replacement', () => {
  const a = { domain: 'first.example', availability: 'registered', scanDepth: 'fast' as const };
  const b = { domain: 'second.example', availability: 'registered', scanDepth: 'fast' as const };
  const c = { domain: 'third.example', availability: 'registered', scanDepth: 'fast' as const };
  const original = normalizeWatchlistStore({ Review: entry({ results: [a, b] }) }).watchlists;
  const merge = planWatchlistUpdate(original, ' review ', [c], 'fast', 'merge');
  assert.equal(merge.name, 'Review');
  assert.deepEqual(merge.retained, ['first.example', 'second.example']);
  assert.deepEqual(merge.added, ['third.example']);
  assert.deepEqual(merge.removed, []);
  const applied = applyReviewedWatchlistUpdate(original, merge, '2026-07-15T08:00:00.000Z');
  const stored = JSON.parse(serializeWatchlistStore(applied.watchlists)).watchlists.Review;
  assert.deepEqual(stored.results.map((record: { domain: string }) => record.domain), ['first.example', 'second.example', 'third.example']);
  assert.equal(stored.history.at(-1).resultCount, 1);
  assert.equal(stored.history.length, original.Review!.history.length + 1);
  assert.deepEqual(stored.baseline.map((record: { domain: string }) => record.domain), ['first.example', 'second.example', 'third.example']);
  const replace = planWatchlistUpdate(original, 'Review', [c], 'fast', 'replace');
  assert.deepEqual(replace.retained, []);
  assert.deepEqual(replace.removed, ['first.example', 'second.example']);
  const replaced = applyReviewedWatchlistUpdate(original, replace, '2026-07-15T08:00:00.000Z').watchlists.Review!;
  assert.deepEqual(replaced.results.map(record => record.domain), ['third.example']);
  const reloaded = normalizeWatchlistStore(JSON.parse(serializeWatchlistStore({ Review: replaced }))).watchlists.Review!;
  assert.deepEqual(watchlistActiveDomains(reloaded), ['third.example']);
  assert.deepEqual(reloaded.domainMetadata.map(record => record.domain), ['third.example']);
  assert.equal(replaced.history.length, original.Review!.history.length + 1);
  const refresh = planWatchlistUpdate(original, 'Review', [{ ...a, availability: 'available' }], 'fast', 'merge');
  const refreshed = applyReviewedWatchlistUpdate(original, refresh, '2026-07-15T08:00:00.000Z');
  assert.equal(refreshed.watchlists.Review!.results[1]!.domain, 'second.example');
  assert.equal(refreshed.watchlists.Review!.history.at(-1)!.resultCount, 1);
  assert.ok(refreshed.changes.some(change => change.domain === 'first.example' && change.field === 'availability'));
});

test('Monitor preview, reload and capacity include candidate-only membership and retain exact contexts', () => {
  const observed = { domain: 'observed.example', availability: 'registered', scanDepth: 'fast' as const };
  const context = { brandProfileId: 'brand-1', priority: 'p2', reason: 'Retain this Brand context', changedAt: NOW, reviewDueAt: null };
  const original = normalizeWatchlistStore({ Review: entry({ results: [observed],
    domainMetadata: [{ domain: 'candidate.example', contexts: [context], candidate: null }] }) }).watchlists;
  const input = [{ ...observed, domain: 'candidate.example' }];
  const merge = planWatchlistUpdate(original, 'Review', input, 'fast', 'merge');
  assert.deepEqual(merge.retained, ['candidate.example', 'observed.example']);
  assert.deepEqual(merge.added, []);
  const replacement = planWatchlistUpdate(original, 'Review', input, 'fast', 'replace');
  assert.deepEqual(replacement.removed, ['observed.example']);
  const saved = applyReviewedWatchlistUpdate(original, replacement, NOW).watchlists;
  const restored = mergeWatchlistStores({}, buildWatchlistExport(saved)).watchlists.Review!;
  assert.deepEqual(watchlistActiveDomains(restored), ['candidate.example']);
  assert.deepEqual(restored.domainMetadata[0]!.contexts, [context]);
  const drift = structuredClone(original);
  drift.Review!.domainMetadata.push({ domain: 'peer.example', contexts: [], candidate: null });
  assert.throws(() => applyReviewedWatchlistUpdate(drift, replacement, NOW), /changed after review/);
  const full = normalizeWatchlistStore({ Review: entry({ results: [], domainMetadata: Array.from({ length: MAX_WATCHLIST_DOMAINS }, (_, i) => ({ domain: `candidate-${i}.example`, contexts: [], candidate: null })) }) }).watchlists;
  assert.throws(() => planWatchlistUpdate(full, 'Review', [observed], 'fast', 'merge'), /domain limit/);
  assert.throws(() => normalizeWatchlistStore({ Review: { ...full.Review!, results: [observed] } }), /active domains/);
  assert.throws(() => mergeHostedWatchlist(full, 'Review', entry({ results: [observed] }) as never), /active domains/);
  const replaceFull = planWatchlistUpdate(full, 'Review', [observed], 'fast', 'replace');
  assert.equal(replaceFull.removed.length, MAX_WATCHLIST_DOMAINS);
  assert.deepEqual(watchlistActiveDomains(applyReviewedWatchlistUpdate(full, replaceFull, NOW).watchlists.Review!), ['observed.example']);
});

test('Monitor consent rejects destination evidence or membership drift but preserves unrelated watchlists', () => {
  const original = normalizeWatchlistStore({ Review: entry(), Unrelated: entry() }).watchlists;
  const input = [{ domain: 'new.example', availability: 'registered', scanDepth: 'fast' as const }];
  const reviewed = planWatchlistUpdate(original, 'Review', input, 'fast', 'replace');
  input[0]!.domain = 'later.example';
  assert.equal(reviewed.input[0]?.domain, 'new.example');
  assert.equal(Object.isFrozen(reviewed.previous?.results[0]), true);
  for (const drift of ['membership', 'evidence', 'deleted'] as const) {
    const changed = structuredClone(original);
    if (drift === 'membership') changed.Review!.results.push({ ...changed.Review!.results[0]!, domain: 'peer.example' });
    if (drift === 'evidence') changed.Review!.results[0]!.registrarName = 'Later registrar';
    if (drift === 'deleted') delete changed.Review;
    assert.throws(() => applyReviewedWatchlistUpdate(changed, reviewed, NOW), /changed after review/u);
  }
  const unrelated = structuredClone(original);
  unrelated.Unrelated!.results[0]!.registrarName = 'Unrelated change';
  const result = applyReviewedWatchlistUpdate(unrelated, reviewed, NOW);
  assert.deepEqual(result.watchlists.Unrelated, normalizeWatchlistStore(unrelated).watchlists.Unrelated);
});

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

test('current envelopes and internal maps require explicit timestamp zones', () => {
  const zoneLess = entry({
    updatedAt: '2026-01-15T12:00:00.000',
    history: [{
      checkedAt: '2026-01-15T12:00:00.000',
      mode: 'fast',
      resultCount: 1,
      conclusiveCount: 1,
      changeCount: 0,
      omittedChanges: 0,
      changes: [],
    }],
  });
  const current = normalizeWatchlistStore({
    schema: WATCHLIST_SCHEMA,
    version: WATCHLIST_SCHEMA_VERSION,
    watchlists: { Priority: zoneLess },
  }).watchlists.Priority;
  assert.equal(current?.updatedAt, null);
  assert.equal(current?.history[0]?.checkedAt, null);
  const internal = normalizeWatchlistStore({ Priority: zoneLess }).watchlists.Priority;
  assert.equal(internal?.updatedAt, null);
  assert.equal(internal?.history[0]?.checkedAt, null);
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
      Local: entry({ results: [{ domain: 'updated.invalid' }], updatedAt: '2026-09-01T00:00:00.000Z' }),
      Added: entry({ results: [{ domain: 'added.invalid' }] }),
      Invalid: { results: 'not an array' },
    },
  });
  assert.deepEqual({ added: result.added, updated: result.updated, skipped: result.skipped }, { added: 1, updated: 1, skipped: 1 });
  const updated = requiredValue(result.watchlists.Local);
  const added = requiredValue(result.watchlists.Added);
  assert.equal(requiredValue(updated.results[0]).domain, 'updated.invalid');
  assert.equal(requiredValue(added.results[0]).domain, 'added.invalid');
});

test('imports preserve newer or equally dated local watchlist observations and history', () => {
  const local = { Local: entry() };
  const expected = normalizeWatchlistStore(local).watchlists;
  const before = structuredClone(local);
  for (const updatedAt of ['2025-01-01T00:00:00Z', NOW, 'invalid', undefined]) {
    const result = mergeWatchlistStores(local, {
      schema: WATCHLIST_SCHEMA, version: WATCHLIST_SCHEMA_VERSION,
      watchlists: { Local: entry({ updatedAt, results: [{ domain: 'older.example' }] }) },
    });
    assert.deepEqual(result.watchlists, expected);
    assert.deepEqual({ added: result.added, updated: result.updated, skipped: result.skipped }, { added: 0, updated: 0, skipped: 1 });
    assert.deepEqual(local, before);
  }
});

test('imports reject unrelated, malformed, and future schemas', () => {
  assert.throws(() => mergeWatchlistStores({}, []), /not a WHOISleuth watchlist export/i);
  assert.throws(() => mergeWatchlistStores({}, { Priority: entry() }), /not a WHOISleuth watchlist export/i);
  assert.throws(() => mergeWatchlistStores({}, { schema: 'whoisleuth.cases', watchlists: {} }), /not a WHOISleuth watchlist export/);
  assert.throws(() => mergeWatchlistStores({}, { schema: WATCHLIST_SCHEMA, version: 1, watchlists: {} }), /supported WHOISleuth watchlist export/);
  assert.throws(() => mergeWatchlistStores({}, { schema: 'whoisleuth.watchlists', version: WATCHLIST_SCHEMA_VERSION + 1, watchlists: {} }), /newer schema/);
  assert.equal(watchlistStoreVersion({ schema: WATCHLIST_SCHEMA, version: 2.5, watchlists: {} }), 2.5);
});

test('unknown local or incoming update times cannot authorise replacing a watchlist', () => {
  for (const [localTime, incomingTime] of [[null, NOW], [NOW, null], [null, null]]) {
    const local = { Local: entry({ updatedAt: localTime }) };
    const result = mergeWatchlistStores(local, { schema: WATCHLIST_SCHEMA, version: WATCHLIST_SCHEMA_VERSION,
      watchlists: { Local: entry({ updatedAt: incomingTime, results: [{ domain: 'different.example' }] }) } });
    assert.equal(result.updated, 0);
    assert.equal(result.skipped, 1);
    assert.deepEqual(result.watchlists, normalizeWatchlistStore(local).watchlists);
  }
});

test('unknown history times survive current serialisation and export while genuine epoch times remain exact', () => {
  for (const version of [2, 3, 4]) {
    const input = { schema: WATCHLIST_SCHEMA, version, watchlists: {
      Unknown: entry({ updatedAt: 'invalid' }), Epoch: entry({ updatedAt: '1970-01-01T00:00:00.000Z' }),
    } };
    const normalized = normalizeWatchlistStore(input);
    assert.equal(normalized.watchlists.Unknown?.updatedAt, null);
    assert.equal(normalized.watchlists.Unknown?.history[0]?.checkedAt, null);
    assert.equal(normalized.watchlists.Epoch?.history[0]?.checkedAt, '1970-01-01T00:00:00.000Z');
    assert.deepEqual(JSON.parse(serializeWatchlistStore(normalized)), normalized);
    const exported = buildWatchlistExport(normalized, NOW);
    assert.equal(exported.version, WATCHLIST_SCHEMA_VERSION);
    assert.deepEqual(mergeWatchlistStores({}, exported).watchlists, normalized.watchlists);
  }
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
  const priority = requiredValue(result.watchlists.Priority);
  assert.equal(requiredValue(priority.results[0]).domain, 'example.invalid');
  assert.throws(
    () => buildWatchlistExport({ Priority: entry() }, '2026-07-14T08:00:00'),
    /explicit timezone/u,
  );
});

test('hosted restore merges against the transaction-current collection', () => {
  const staleSnapshot = { Alpha: entry() };
  const transactionCurrent = normalizeWatchlistStore({
    ...staleSnapshot,
    Beta: entry({ results: [{ domain: 'beta.invalid' }] }),
  }).watchlists;
  const hostedEntry = requiredValue(normalizeWatchlistStore({
    hosted: entry({ results: [{ domain: 'hosted.invalid' }] }),
  }).watchlists.hosted);
  const restored = mergeHostedWatchlist(
    transactionCurrent,
    'hosted',
    hostedEntry,
  );

  assert.deepEqual(Object.keys(restored).sort(), ['Alpha', 'Beta', 'hosted']);
  assert.equal(requiredValue(requiredValue(restored.Beta).results[0]).domain, 'beta.invalid');
  assert.equal(requiredValue(requiredValue(restored.hosted).results[0]).domain, 'hosted.invalid');

  const replacement = requiredValue(normalizeWatchlistStore({ Hosted: entry() }).watchlists.Hosted);
  const replaced = mergeHostedWatchlist(restored, 'Hosted', replacement);
  assert.equal(Object.hasOwn(replaced, 'hosted'), true);
  assert.equal(Object.hasOwn(replaced, 'Hosted'), false);
  assert.equal(Object.hasOwn(replaced, 'Beta'), true);
});

test('hosted restore preserves capacity errors while allowing additions and replacements at the boundary', () => {
  const hostedEntry = requiredValue(normalizeWatchlistStore({ Hosted: entry() }).watchlists.Hosted);
  const collection = (count: number) => normalizeWatchlistStore(Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`List ${index + 1}`, entry()]),
  )).watchlists;

  const withRoom = mergeHostedWatchlist(collection(MAX_WATCHLISTS - 1), 'Hosted', hostedEntry);
  assert.equal(Object.keys(withRoom).length, MAX_WATCHLISTS);
  assert.ok(withRoom.Hosted);

  assert.throws(
    () => mergeHostedWatchlist(collection(MAX_WATCHLISTS), 'Hosted', hostedEntry),
    /Watchlist storage is full/iu,
  );

  const existingEntry = requiredValue(normalizeWatchlistStore({
    hosted: entry({ results: [{ domain: 'old.invalid' }] }),
  }).watchlists.hosted);
  const fullWithExisting = {
    ...collection(MAX_WATCHLISTS - 1),
    hosted: existingEntry,
  };
  const replaced = mergeHostedWatchlist(fullWithExisting, 'Hosted', hostedEntry);
  assert.equal(Object.keys(replaced).length, MAX_WATCHLISTS);
  assert.equal(Object.hasOwn(replaced, 'Hosted'), false);
  assert.ok(replaced.hosted);
});

test('hosted restore reviews the actual membership union and revalidates its destination only', () => {
  const original = normalizeWatchlistStore({ Review: entry({ results: [{domain:'a.example'}, {domain:'b.example'}],
    domainMetadata: [{ domain:'a.example',contexts:[{brandProfileId:'brand-one',priority:'p2',reason:'Keep context',changedAt:NOW,reviewDueAt:null}],candidate:null },
      {domain:'candidate.example',contexts:[],candidate:null}] }), Other:entry() }).watchlists;
  const before=structuredClone(original);
  const snapshot=entry({results:[{domain:'c.example'},{domain:'a.example'}]});
  const plan=planHostedWatchlistRestore(original,'review',snapshot);
  assert.equal(plan.name,'Review'); assert.equal(plan.capacity,2000);
  assert.deepEqual(plan.retained,['a.example','b.example','candidate.example']);
  assert.deepEqual(plan.added,['c.example']); assert.deepEqual(plan.removed,[]);
  assert.ok(Object.isFrozen(plan.snapshot));
  const saved=applyReviewedHostedWatchlistRestore(original,plan);
  const reloaded=normalizeWatchlistStore(JSON.parse(serializeWatchlistStore(saved))).watchlists;
  assert.deepEqual(watchlistActiveDomains(reloaded.Review!).sort(),[...plan.retained,...plan.added].sort());
  assert.deepEqual(reloaded.Review!.domainMetadata.find(row=>row.domain==='a.example'),before.Review!.domainMetadata.find(row=>row.domain==='a.example'));
  assert.deepEqual(reloaded.Other,before.Other); assert.deepEqual(original,before);
  const changed=structuredClone(original); changed.Review!.domainMetadata.push({domain:'peer.example',contexts:[],candidate:null});
  assert.throws(()=>applyReviewedHostedWatchlistRestore(changed,plan),/changed after review/);
  changed.Review=original.Review!; changed.Other=normalizeWatchlistStore({Other:entry({results:[{domain:'peer-other.example'}]})}).watchlists.Other!;
  assert.deepEqual(applyReviewedHostedWatchlistRestore(changed,plan).Other,changed.Other);
});

test('Bulk watchlist admission rejects a new 101st list without changing retained lists', () => {
  const full = normalizeWatchlistStore(Object.fromEntries(
    Array.from({ length: MAX_WATCHLISTS }, (_, index) => [`List ${index + 1}`, entry()]),
  )).watchlists;
  const before = structuredClone(full);
  assert.throws(
    () => resolveWatchlistMutationTarget(full, 'One more list'),
    /Watchlist storage is full/iu,
  );
  assert.deepEqual(full, before);

  const replacement = resolveWatchlistMutationTarget(full, 'list 1');
  assert.equal(replacement.name, 'List 1');
  assert.equal(replacement.previous, full['List 1']);
});
