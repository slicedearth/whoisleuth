import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as history from '../frontend/src/lib/analysis/ct-history.ts';
import { normalizeCtResponse } from '../frontend/src/lib/analysis/ct-results.ts';
import { searchCertificateTransparency } from '../lib/ct-search.mts';
import { requiredValue } from './value-assertions.mts';

const FIRST = '2026-07-01T00:00:00.000Z';
const SECOND = '2026-07-02T00:00:00.000Z';
const THIRD = '2026-07-03T00:00:00.000Z';

type NonEmptyStore = Omit<history.CtHistoryStore, 'entries'> & {
  entries: [history.CtHistoryEntry, ...history.CtHistoryEntry[]];
};
type HistoryResult = ReturnType<typeof history.recordCtHistorySearch> & { store: NonEmptyStore };

function nonEmptyStore(store: history.CtHistoryStore): NonEmptyStore {
  assert.ok(store.entries.length > 0);
  return store as NonEmptyStore;
}

function record(
  store: unknown,
  query: unknown,
  domains: readonly unknown[],
  checkedAt: string,
  options: history.RecordCtHistoryOptions = {},
): HistoryResult {
  const result = history.recordCtHistorySearch(store, query, domains, {
    checkedAt,
    certificateCount: options.certificateCount ?? domains.length,
    truncated: options.truncated ?? false,
  });
  return { ...result, store: nonEmptyStore(result.store) };
}

describe('CT search baselines', () => {
  test('the first complete search creates a baseline without marking everything new', () => {
    const result = record(null, 'Example Brand', ['b.example', 'a.example'], FIRST);
    assert.equal(result.store.version, history.CT_HISTORY_SCHEMA_VERSION);
    assert.equal(result.comparison.hasBaseline, false);
    assert.equal(result.comparison.newCount, 0);
    assert.equal(result.comparison.firstObservedCount, 2);
    assert.equal(result.comparison.continuingCount, 0);
    assert.equal(result.comparison.classificationComplete, true);
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
    assert.deepStrictEqual(second.comparison.firstObservedDomains, ['c.example']);
    assert.deepStrictEqual(second.comparison.continuingDomains, ['b.example']);
    assert.deepStrictEqual(second.store.entries[0].domains, ['b.example', 'c.example']);
    assert.equal(requiredValue(second.store.entries[0].history.at(-1)).newCount, 1);
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
    assert.equal(capped.comparison.classificationComplete, false);
    assert.deepStrictEqual(capped.comparison.reappearedDomains, []);
    assert.equal(capped.store.entries[0].baselineAt, FIRST);
    assert.deepStrictEqual(capped.store.entries[0].domains, ['a.example', 'b.example']);
    assert.equal(requiredValue(capped.store.entries[0].history.at(-1)).truncated, true);
  });

  test('a name-less CT source row cannot replace the last complete baseline', async () => {
    const baseline = record(null, 'example', ['retained.example'], FIRST);
    const raw = await searchCertificateTransparency('example', {
      fetcher: async () => new Response('[{}]', { status: 200 }),
    });
    const normalized = normalizeCtResponse({ keyword: 'example', ...raw }, 'example');
    const next = record(
      baseline.store,
      'example',
      normalized.candidates.map((candidate) => candidate.domain),
      SECOND,
      { certificateCount: normalized.certCount, truncated: normalized.truncated },
    );
    assert.equal(normalized.truncated, true);
    assert.deepEqual(next.store.entries[0].domains, ['retained.example']);
    assert.equal(next.comparison.baselineUpdated, false);
    assert.equal(next.comparison.classificationComplete, false);
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
    assert.deepEqual(result.store.entries[0].domains, []);
    assert.equal(result.store.entries[0].baselineAt, null);
    assert.equal(result.comparison.classificationComplete, false);
    assert.equal(result.comparison.baselineUpdated, false);
    assert.equal(requiredValue(result.store.entries[0].history.at(-1)).resultCount, history.MAX_CT_HISTORY_DOMAINS);
  });

  test('distinguishes first, continuing, and reappeared domains using complete retained searches only', () => {
    const first = record(null, 'example', ['a.example', 'b.example'], FIRST);
    const second = record(first.store, 'example', ['b.example'], SECOND);
    const third = record(second.store, 'example', ['a.example', 'b.example', 'c.example'], THIRD);

    assert.deepStrictEqual(second.comparison.continuingDomains, ['b.example']);
    assert.deepStrictEqual(third.comparison.reappearedDomains, ['a.example']);
    assert.deepStrictEqual(third.comparison.continuingDomains, ['b.example']);
    assert.deepStrictEqual(third.comparison.firstObservedDomains, ['c.example']);
    assert.equal(third.store.entries[0].everSeenDomainsComplete, true);
    assert.deepStrictEqual(third.store.entries[0].everSeenDomains, ['a.example', 'b.example', 'c.example']);
  });

  test('does not classify or update the ever-seen set from a capped search', () => {
    const first = record(null, 'example', ['a.example', 'b.example'], FIRST);
    const second = record(first.store, 'example', ['b.example'], SECOND);
    const capped = record(second.store, 'example', ['a.example', 'b.example', 'c.example'], THIRD, { truncated: true });

    assert.equal(capped.comparison.classificationComplete, false);
    assert.equal(capped.comparison.firstObservedCount, 0);
    assert.equal(capped.comparison.reappearedCount, 0);
    assert.equal(capped.comparison.continuingCount, 0);
    assert.deepStrictEqual(capped.store.entries[0].domains, ['b.example']);
    assert.deepStrictEqual(capped.store.entries[0].everSeenDomains, ['a.example', 'b.example']);
  });
});

describe('CT history retention and recovery', () => {
  test('per-query check history keeps only the newest bounded events', () => {
    let store: NonEmptyStore | null = null;
    for (let index = 0; index < history.MAX_CT_HISTORY_EVENTS; index++) {
      store = record(store, 'example', [`d${index}.example`], new Date(Date.UTC(2026, 0, index + 1)).toISOString()).store;
    }
    const atCapacity = requiredValue(store).entries[0];
    assert.equal(atCapacity.history.length, history.MAX_CT_HISTORY_EVENTS);
    assert.equal(atCapacity.discardedCheckCount, 0);
    assert.equal(atCapacity.discardedCheckCountKnown, true);
    assert.equal(atCapacity.discardedCheckCountCapped, false);

    for (let index = history.MAX_CT_HISTORY_EVENTS; index < history.MAX_CT_HISTORY_EVENTS + 3; index++) {
      store = record(store, 'example', [`d${index}.example`], new Date(Date.UTC(2026, 0, index + 1)).toISOString()).store;
    }
    const entry = requiredValue(store).entries[0];
    const events = entry.history;
    assert.equal(events.length, history.MAX_CT_HISTORY_EVENTS);
    assert.equal(requiredValue(events.at(-1)).checkedAt, new Date(Date.UTC(2026, 0, history.MAX_CT_HISTORY_EVENTS + 3)).toISOString());
    assert.equal(entry.discardedCheckCount, 3);
    assert.equal(entry.discardedCheckCountKnown, true);
    assert.equal(entry.discardedCheckCountCapped, false);
  });

  test('the store keeps only the most recently updated search queries', () => {
    let store: NonEmptyStore | null = null;
    for (let index = 0; index < history.MAX_CT_HISTORY_SEARCHES + 3; index++) {
      store = record(store, `query ${index}`, [`d${index}.example`], new Date(Date.UTC(2026, 0, index + 1)).toISOString()).store;
    }
    const retained = requiredValue(store);
    assert.equal(retained.entries.length, history.MAX_CT_HISTORY_SEARCHES);
    assert.equal(retained.entries[0].query, `query ${history.MAX_CT_HISTORY_SEARCHES + 2}`);
    assert.equal(retained.entries.some((entry) => entry.query === 'query 0'), false);
  });

  test('malformed entries and unknown fields are discarded without throwing', () => {
    const store = nonEmptyStore(history.normalizeCtHistoryStore({
      version: history.CT_HISTORY_SCHEMA_VERSION,
      evil: true,
      entries: [
        null,
        { query: 'bad\nquery', updatedAt: FIRST },
        { query: 'valid', baselineAt: FIRST, updatedAt: FIRST, domains: ['A.EXAMPLE'], history: [{ checkedAt: FIRST, resultCount: 1, unknown: 'x' }], unknown: 'x' },
      ],
    }));
    assert.equal(store.entries.length, 1);
    assert.deepStrictEqual(store.entries[0].domains, ['a.example']);
    assert.deepStrictEqual(Object.keys(store.entries[0]).sort(), [
      'baselineAt',
      'discardedCheckCount',
      'discardedCheckCountCapped',
      'discardedCheckCountKnown',
      'domains',
      'everSeenDomains',
      'everSeenDomainsComplete',
      'history',
      'query',
      'updatedAt',
    ]);
    assert.deepStrictEqual(Object.keys(requiredValue(requiredValue(store.entries[0]).history[0])).sort(), [
      'certificateCount', 'checkedAt', 'classificationComplete', 'continuingCount', 'firstObservedCount',
      'firstObservedDomains', 'historyUnknownCount', 'newCount', 'newDomains', 'reappearedCount',
      'reappearedDomains', 'resultCount', 'truncated',
    ]);
  });

  test('duplicate query entries resolve to the most recently updated record', () => {
    const store = nonEmptyStore(history.normalizeCtHistoryStore({ entries: [
      { query: 'example', baselineAt: FIRST, updatedAt: FIRST, domains: ['old.example'], history: [] },
      { query: 'EXAMPLE', baselineAt: SECOND, updatedAt: SECOND, domains: ['new.example'], history: [] },
    ] }));
    assert.equal(store.entries.length, 1);
    assert.deepStrictEqual(store.entries[0].domains, ['new.example']);
  });

  test('persisted history rejects zone-less timestamps identically across host timezones', () => {
    const moduleUrl = new URL('../frontend/src/lib/analysis/ct-history.ts', import.meta.url).href;
    const fixture = {
      version: history.CT_HISTORY_SCHEMA_VERSION,
      entries: [
        {
          query: 'example',
          baselineAt: '2026-01-15T12:00:00.000',
          updatedAt: '2026-01-15T12:00:00.000',
          domains: ['local.example'],
          everSeenDomains: ['local.example'],
          everSeenDomainsComplete: true,
          history: [],
        },
        {
          query: 'example',
          baselineAt: '2026-01-15T05:00:00.000Z',
          updatedAt: '2026-01-15T05:00:00.000Z',
          domains: ['explicit.example'],
          everSeenDomains: ['explicit.example'],
          everSeenDomainsComplete: true,
          history: [],
        },
      ],
    };
    const source = `import { normalizeCtHistoryStore } from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(normalizeCtHistoryStore(${JSON.stringify(fixture)})));`;
    const run = (timezone: string) => execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8',
      env: { ...process.env, TZ: timezone },
    });
    const utc = run('UTC');
    const melbourne = run('Australia/Melbourne');
    assert.equal(melbourne, utc);
    assert.deepEqual(JSON.parse(utc).entries[0]?.domains, ['explicit.example']);
    assert.throws(
      () => history.recordCtHistorySearch(null, 'example', [], { checkedAt: '2026-01-15T12:00:00.000' }),
      /valid Certificate Transparency check timestamp/iu,
    );
  });

  test('deleting one query leaves other history intact', () => {
    const one = record(null, 'one', ['one.example'], FIRST);
    const two = record(one.store, 'two', ['two.example'], SECOND);
    const remaining = history.deleteCtHistoryEntry(two.store, ' ONE ');
    assert.deepStrictEqual(remaining.entries.map((entry) => entry.query), ['two']);
  });

  test('rejects reader-only schemas without partial interpretation', () => {
    for (const version of [1, 2]) {
      const unsupported = { version, entries: [{ query: 'private-query', updatedAt: FIRST }] };
      const before = structuredClone(unsupported);
      assert.throws(
        () => history.normalizeCtHistoryStore(unsupported),
        new RegExp(`schema ${version} is unsupported.*no data was changed`, 'u'),
      );
      assert.deepEqual(unsupported, before);
    }
  });

  test('future schema versions and bounded discarded counts remain explicit', () => {
    assert.equal(history.ctHistoryStoreVersion({ version: 4 }), 4);
    assert.equal(history.ctHistoryStoreVersion({ version: '4' }), null);
    assert.equal(history.ctHistoryStoreVersion(null), null);

    const normalized = nonEmptyStore(history.normalizeCtHistoryStore({
      version: 3,
      entries: [{
        query: 'example',
        baselineAt: FIRST,
        updatedAt: FIRST,
        domains: ['a.example'],
        history: [{ checkedAt: FIRST, resultCount: 1 }],
        everSeenDomains: ['a.example'],
        everSeenDomainsComplete: true,
        discardedCheckCount: history.MAX_CT_HISTORY_DISCARDED_CHECKS + 10,
        discardedCheckCountKnown: true,
      }],
    }));
    assert.equal(normalized.entries[0].discardedCheckCount, history.MAX_CT_HISTORY_DISCARDED_CHECKS);
    assert.equal(normalized.entries[0].discardedCheckCountKnown, true);
    assert.equal(normalized.entries[0].discardedCheckCountCapped, true);
  });

  test('malformed current completeness and retention metadata fails closed', () => {
    const completeEvent = {
      checkedAt: FIRST,
      resultCount: 1,
      certificateCount: 1,
      newCount: 0,
      newDomains: [],
      classificationComplete: true,
      firstObservedCount: 0,
      firstObservedDomains: [],
      continuingCount: 1,
      reappearedCount: 0,
      reappearedDomains: [],
      historyUnknownCount: 0,
    };
    for (const truncated of [undefined, null, 'false']) {
      const normalized = nonEmptyStore(history.normalizeCtHistoryStore({
        version: history.CT_HISTORY_SCHEMA_VERSION,
        entries: [{
          query: 'example', baselineAt: FIRST, updatedAt: FIRST,
          domains: ['a.example'], everSeenDomains: ['a.example'], everSeenDomainsComplete: true,
          discardedCheckCount: 0, discardedCheckCountKnown: true,
          history: [{ ...completeEvent, ...(truncated === undefined ? {} : { truncated }) }],
        }],
      }));
      assert.equal(normalized.entries[0].history[0]?.truncated, true);
      assert.equal(normalized.entries[0].history[0]?.classificationComplete, false);
    }

    const complete = nonEmptyStore(history.normalizeCtHistoryStore({
      version: history.CT_HISTORY_SCHEMA_VERSION,
      entries: [{
        query: 'example', baselineAt: FIRST, updatedAt: FIRST,
        domains: ['a.example'], everSeenDomains: ['a.example'], everSeenDomainsComplete: true,
        discardedCheckCount: 0, discardedCheckCountKnown: true,
        history: [{ ...completeEvent, truncated: false }],
      }],
    }));
    assert.equal(complete.entries[0].history[0]?.truncated, false);
    assert.equal(complete.entries[0].history[0]?.classificationComplete, true);

    for (const discardedCheckCount of [undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const normalized = nonEmptyStore(history.normalizeCtHistoryStore({
        version: history.CT_HISTORY_SCHEMA_VERSION,
        entries: [{
          query: 'example', baselineAt: FIRST, updatedAt: FIRST,
          domains: ['a.example'], everSeenDomains: ['a.example'], everSeenDomainsComplete: true,
          discardedCheckCount, discardedCheckCountKnown: true, history: [],
        }],
      }));
      assert.equal(normalized.entries[0].discardedCheckCount, 0);
      assert.equal(normalized.entries[0].discardedCheckCountKnown, false);
    }

    for (const discardedCheckCount of [0, history.MAX_CT_HISTORY_DISCARDED_CHECKS + 1]) {
      const normalized = nonEmptyStore(history.normalizeCtHistoryStore({
        version: history.CT_HISTORY_SCHEMA_VERSION,
        entries: [{
          query: 'example', baselineAt: FIRST, updatedAt: FIRST,
          domains: ['a.example'], everSeenDomains: ['a.example'], everSeenDomainsComplete: true,
          discardedCheckCount, discardedCheckCountKnown: true, history: [],
        }],
      }));
      assert.equal(normalized.entries[0].discardedCheckCountKnown, true);
      assert.equal(
        normalized.entries[0].discardedCheckCountCapped,
        discardedCheckCount > history.MAX_CT_HISTORY_DISCARDED_CHECKS,
      );
    }
  });

  test('current-schema lossy baselines and fractional counts cannot retain authority', () => {
    const domains = Array.from(
      { length: history.MAX_CT_HISTORY_DOMAINS + 1 },
      (_, index) => `d${String(index).padStart(3, '0')}.example`,
    );
    const normalized = nonEmptyStore(history.normalizeCtHistoryStore({
      version: history.CT_HISTORY_SCHEMA_VERSION,
      entries: [{
        query: 'example',
        baselineAt: FIRST,
        updatedAt: FIRST,
        domains,
        everSeenDomains: domains,
        everSeenDomainsComplete: true,
        discardedCheckCount: 0,
        discardedCheckCountKnown: true,
        history: [{
          checkedAt: FIRST,
          resultCount: 1.5,
          certificateCount: 2.5,
          newCount: 1.5,
          newDomains: ['d000.example'],
          truncated: false,
          classificationComplete: true,
          firstObservedCount: 1.5,
          firstObservedDomains: ['d000.example'],
          continuingCount: 0,
          reappearedCount: 0,
          reappearedDomains: [],
          historyUnknownCount: 0,
        }],
      }],
    }));
    assert.equal(normalized.entries[0].baselineAt, null);
    assert.deepEqual(normalized.entries[0].domains, []);
    assert.equal(normalized.entries[0].everSeenDomainsComplete, false);
    assert.equal(normalized.entries[0].history[0]?.classificationComplete, false);
  });

  test('new-domain details are bounded while the full count is retained', () => {
    const baseline = record(null, 'example', ['baseline.example'], FIRST);
    const domains = Array.from({ length: history.MAX_CT_HISTORY_NEW_DOMAINS + 20 }, (_, index) => `new-${index}.example`);
    const next = record(baseline.store, 'example', domains, SECOND);
    const event = requiredValue(next.store.entries[0].history.at(-1));
    assert.equal(next.comparison.newCount, domains.length);
    assert.equal(event.newCount, domains.length);
    assert.equal(event.newDomains.length, history.MAX_CT_HISTORY_NEW_DOMAINS);
  });

  test('caps the ever-seen set deterministically and exposes classification uncertainty afterward', () => {
    const firstDomains = Array.from({ length: history.MAX_CT_HISTORY_DOMAINS }, (_, index) => `a-${index}.example`);
    const secondDomains = Array.from({ length: history.MAX_CT_HISTORY_DOMAINS }, (_, index) => `b-${index}.example`);
    const thirdDomains = Array.from({ length: history.MAX_CT_HISTORY_DOMAINS }, (_, index) => `c-${index}.example`);
    const first = record(null, 'example', firstDomains, FIRST);
    const second = record(first.store, 'example', secondDomains, SECOND);
    const third = record(second.store, 'example', thirdDomains, THIRD);
    const entry = third.store.entries[0];
    assert.equal(entry.everSeenDomains.length, history.MAX_CT_HISTORY_EVER_SEEN_DOMAINS);
    assert.equal(entry.everSeenDomainsComplete, false);
    assert.ok(thirdDomains.every((domain) => entry.everSeenDomains.includes(domain)));

    const unknown = record(third.store, 'example', ['never-retained.example'], '2026-07-04T00:00:00.000Z');
    assert.deepStrictEqual(unknown.comparison.historyUnknownDomains, ['never-retained.example']);
  });

  test('the serialized store stays within its dedicated byte budget', () => {
    const suffix = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(61)}`;
    const domains = Array.from({ length: history.MAX_CT_HISTORY_DOMAINS }, (_, index) => {
      const prefix = `d${index}`.padEnd(63, 'x');
      return `${prefix}.${suffix}`;
    });
    let store: NonEmptyStore | null = null;
    for (let index = 0; index < history.MAX_CT_HISTORY_SEARCHES; index++) {
      store = record(store, `large query ${index}`, domains, new Date(Date.UTC(2026, 0, index + 1)).toISOString()).store;
    }
    const retained = requiredValue(store);
    const bytes = new TextEncoder().encode(JSON.stringify(retained)).length;
    assert.ok(bytes <= history.MAX_CT_HISTORY_STORE_BYTES);
    assert.ok(retained.entries.length < history.MAX_CT_HISTORY_SEARCHES);
    assert.equal(retained.entries[0].domains.length, history.MAX_CT_HISTORY_DOMAINS);
  });
});
