import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildLookupWatchlistRecord,
  defaultLookupWatchlistName,
  lookupWatchlistsForDomain,
} from '../frontend/src/lib/analysis/lookup-watchlist-handoff.ts';
import { MAX_WATCHLIST_NAME_LENGTH } from '../frontend/src/lib/analysis/watchlist-store.ts';
import { appendWatchlistScan } from '../frontend/src/lib/analysis/watchlist-history.ts';

describe('Lookup watchlist handoff', () => {
  test('builds one bounded comparable record for the exact observed hostname', () => {
    const record = buildLookupWatchlistRecord('Login.Example.Test', {
      availability: 'registered',
      registrar: 'Example Registrar',
      nameservers: ['ns1.example.test'],
      hasMx: true,
      hasPasswordField: true,
      phishingLanguageMatch: 'Account access language observed',
      riskModelVersion: 7,
      riskScore: 81,
      unrelated: 'not retained',
    }, 'deep');

    assert.deepEqual(record, {
      domain: 'login.example.test',
      scanDepth: 'deep',
      registrarName: 'Example Registrar',
      availability: 'registered',
      nameservers: ['ns1.example.test'],
      hasMx: true,
      hasPasswordField: true,
      phishingLanguageMatch: 'Account access language observed',
      riskModelVersion: 7,
      riskScore: 81,
    });
  });

  test('rejects an invalid target and never derives one from evidence fields', () => {
    assert.equal(buildLookupWatchlistRecord('https://example.test/path', {
      inputHostname: 'example.test',
      availability: 'registered',
    }, 'fast'), null);
  });

  test('creates stable names within the watchlist bound', () => {
    assert.equal(defaultLookupWatchlistName('portal.example.test'), 'Monitor · portal.example.test');
    const longDomain = `${'a'.repeat(60)}.${'b'.repeat(60)}.example.test`;
    const first = defaultLookupWatchlistName(longDomain);
    assert.equal(first, defaultLookupWatchlistName(longDomain));
    assert.ok(first.length <= MAX_WATCHLIST_NAME_LENGTH);
    assert.match(first, /^Monitor · .+…[a-z0-9]+$/u);
  });

  test('finds only current exact-hostname membership', () => {
    const current = appendWatchlistScan(null, [{ domain: 'portal.example.test', scanDepth: 'deep' }], {
      checkedAt: '2026-09-03T01:00:00.000Z',
      mode: 'deep',
    }).entry;
    const sibling = appendWatchlistScan(null, [{ domain: 'example.test', scanDepth: 'fast' }], {
      checkedAt: '2026-09-03T01:00:00.000Z',
      mode: 'fast',
    }).entry;
    assert.deepEqual(lookupWatchlistsForDomain({ Current: current, Sibling: sibling }, 'portal.example.test'), ['Current']);
    assert.deepEqual(lookupWatchlistsForDomain({ Current: current, Sibling: sibling }, 'other.example.test'), []);
  });
});
