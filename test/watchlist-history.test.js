const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let history;
before(async () => {
  history = await import('../public/js/watchlist-history.js');
});

describe('watchlist history', () => {
  test('upgrades the old latest-snapshot schema without losing results', () => {
    const oldEntry = {
      updatedAt: '2026-01-01T00:00:00.000Z',
      results: [{ domain: 'brand.example', availability: 'available', registrarName: 'Example Registrar' }],
    };
    const normalized = history.normalizeWatchlistEntry(oldEntry);
    assert.equal(normalized.results.length, 1);
    assert.equal(normalized.baseline[0].domain, 'brand.example');
    assert.equal(normalized.history.length, 1);
    assert.equal(normalized.history[0].changeCount, 0);
  });

  test('records material registration, infrastructure, and risk-signal changes', () => {
    const first = history.appendWatchlistScan(null, [{
      domain: 'brand.example', availability: 'available', registrarName: 'Old Registrar',
      nameservers: 'NS1.OLD.EXAMPLE; NS2.OLD.EXAMPLE', scanDepth: 'deep',
      hasMx: false, hasSpf: false, hasDmarc: false, activityStatus: 'no_site',
      pageTitle: null, faviconHash: null, faviconMatch: false, hasPasswordField: false,
      phishingLanguageMatch: null, reusesOfficialAssets: false,
    }], { checkedAt: '2026-01-01T00:00:00.000Z', mode: 'deep' }).entry;

    const second = history.appendWatchlistScan(first, [{
      domain: 'brand.example', availability: 'registered', registrarName: 'New Registrar',
      nameservers: 'ns1.new.example;ns2.new.example', scanDepth: 'deep',
      hasMx: true, hasSpf: true, hasDmarc: false, activityStatus: 'active',
      pageTitle: 'Brand secure login', faviconHash: 'abc123', faviconMatch: true, hasPasswordField: true,
      phishingLanguageMatch: 'verify your account', reusesOfficialAssets: true,
    }], { checkedAt: '2026-01-02T00:00:00.000Z', mode: 'deep' });

    const fields = new Set(second.changes.map((change) => change.field));
    assert.equal(second.changes.find((change) => change.field === 'availability').kind, 'new_registration');
    assert.equal(second.changes.find((change) => change.field === 'hasPasswordField').kind, 'risk_signal_added');
    assert.equal(second.changes.find((change) => change.field === 'faviconMatch').kind, 'risk_signal_added');
    assert.ok(fields.has('registrarName'));
    assert.ok(fields.has('nameservers'));
    assert.ok(fields.has('hasMx'));
    assert.ok(fields.has('pageTitle'));
    assert.equal(second.entry.history.length, 2);
  });

  test('fast scans retain the previous deep baseline and do not invent removed signals', () => {
    const deep = history.appendWatchlistScan(null, [{
      domain: 'brand.example', availability: 'registered', scanDepth: 'deep',
      hasMx: false, hasSpf: false, hasDmarc: false, activityStatus: 'active',
      pageTitle: 'Original title', faviconHash: null, hasPasswordField: false,
      phishingLanguageMatch: null, reusesOfficialAssets: false,
    }], { mode: 'deep' }).entry;
    const fast = history.appendWatchlistScan(deep, [{
      domain: 'brand.example', availability: 'registered', scanDepth: 'fast',
      hasMx: null, pageTitle: null, hasPasswordField: null,
    }], { mode: 'fast' });
    assert.equal(fast.changes.length, 0);
    assert.equal(fast.entry.baseline[0].pageTitle, 'Original title');

    const nextDeep = history.appendWatchlistScan(fast.entry, [{
      domain: 'brand.example', availability: 'registered', scanDepth: 'deep',
      hasMx: true, hasSpf: false, hasDmarc: false, activityStatus: 'active',
      pageTitle: 'Changed title', faviconHash: null, hasPasswordField: false,
      phishingLanguageMatch: null, reusesOfficialAssets: false,
    }], { mode: 'deep' });
    assert.ok(nextDeep.changes.some((change) => change.field === 'hasMx'));
    assert.ok(nextDeep.changes.some((change) => change.field === 'pageTitle'));
  });

  test('bounds retained events while keeping the latest checks', () => {
    let entry = null;
    for (let index = 0; index < history.MAX_WATCHLIST_HISTORY_EVENTS + 3; index += 1) {
      entry = history.appendWatchlistScan(entry, [{
        domain: 'brand.example', availability: index % 2 ? 'registered' : 'available', scanDepth: 'fast',
      }], { checkedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`, mode: 'fast' }).entry;
    }
    assert.equal(entry.history.length, history.MAX_WATCHLIST_HISTORY_EVENTS);
    assert.equal(entry.history.at(-1).checkedAt, '2026-01-15T00:00:00.000Z');
  });
});
