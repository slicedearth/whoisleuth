const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let history;
before(async () => {
  history = await import('../frontend/src/lib/analysis/watchlist-history.js');
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

  test('retains legacy risk scores but compares only matching explicit model versions', () => {
    const legacy = history.appendWatchlistScan(null, [{
      domain: 'brand.example', availability: 'registered', scanDepth: 'deep', riskScore: 95,
    }], { mode: 'deep' }).entry;
    assert.equal(legacy.baseline[0].riskScore, 95);
    assert.equal(legacy.baseline[0].riskModelVersion, null);

    const current = history.appendWatchlistScan(legacy, [{
      domain: 'brand.example', availability: 'registered', scanDepth: 'deep', riskModelVersion: 1, riskScore: 42,
    }], { mode: 'deep' });
    assert.equal(current.changes.some((change) => change.field === 'riskScore'), false);
    assert.equal(current.entry.baseline[0].riskModelVersion, 1);
    assert.equal(current.entry.baseline[0].riskScore, 42);

    const comparable = history.appendWatchlistScan(current.entry, [{
      domain: 'brand.example', availability: 'registered', scanDepth: 'deep', riskModelVersion: 1, riskScore: 80,
    }], { mode: 'deep' });
    const riskChange = comparable.changes.find((change) => change.field === 'riskScore');
    assert.ok(riskChange);
    assert.equal(riskChange.kind, 'high_risk');
  });

  test('stores and compares compact HTTP facts without retaining rich response material', () => {
    const first = history.appendWatchlistScan(null, [{
      domain: 'brand.example', availability: 'registered', scanDepth: 'deep',
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success', httpFinalOrigin: 'https://brand.example/private/path', httpResponseStatus: 200,
      httpTransportSecurity: 'https', httpRedirectCount: 0, httpCrossOriginRedirect: false,
      httpHttpsDowngrade: false, httpContentType: 'text/html', httpSecurityHeaders: ['hsts'],
      rawHeaders: { server: 'secret' }, redirects: [{ to: 'https://brand.example/private/path' }],
    }], { mode: 'deep' }).entry;

    assert.equal(first.baseline[0].httpFinalOrigin, 'https://brand.example');
    assert.equal('rawHeaders' in first.baseline[0], false);
    assert.equal('redirects' in first.baseline[0], false);

    const second = history.appendWatchlistScan(first, [{
      domain: 'brand.example', availability: 'registered', scanDepth: 'deep',
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success', httpFinalOrigin: 'http://other.example', httpResponseStatus: 403,
      httpTransportSecurity: 'http', httpRedirectCount: 1, httpCrossOriginRedirect: true,
      httpHttpsDowngrade: true, httpContentType: 'text/plain', httpSecurityHeaders: [],
    }], { mode: 'deep' });
    const byField = new Map(second.changes.map((change) => [change.field, change]));
    assert.equal(byField.get('httpFinalOrigin').kind, 'infrastructure_changed');
    assert.equal(byField.get('httpTransportSecurity').tone, 'danger');
    assert.equal(byField.get('httpHttpsDowngrade').kind, 'risk_signal_added');
    assert.deepEqual(byField.get('httpSecurityHeaders').after, []);

    const fast = history.appendWatchlistScan(second.entry, [{
      domain: 'brand.example', availability: 'registered', scanDepth: 'fast',
    }], { mode: 'fast' });
    assert.equal(fast.changes.some((change) => change.field.startsWith('http')), false);
    assert.equal(fast.entry.baseline[0].httpFinalOrigin, 'http://other.example');
  });

  test('prunes domains absent from a replacement snapshot (no unbounded baseline growth)', () => {
    const first = history.appendWatchlistScan(null, [
      { domain: 'a.example', availability: 'registered', scanDepth: 'fast' },
      { domain: 'b.example', availability: 'registered', scanDepth: 'fast' },
    ], { mode: 'fast' }).entry;
    // Reuse the same watchlist with a different candidate set {b, c}.
    const second = history.appendWatchlistScan(first, [
      { domain: 'b.example', availability: 'registered', scanDepth: 'fast' },
      { domain: 'c.example', availability: 'registered', scanDepth: 'fast' },
    ], { mode: 'fast' }).entry;
    assert.deepEqual(second.baseline.map((r) => r.domain).sort(), ['b.example', 'c.example']);
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

  test('stored results retain only bounded known evidence and rescan provenance', () => {
    const nameservers = Array.from({ length: history.MAX_WATCHLIST_NAMESERVERS + 5 }, (_, index) => `ns-${index}.example`);
    const mutationTypes = Array.from({ length: history.MAX_WATCHLIST_MUTATION_TYPES + 5 }, (_, index) => `TYPE-${index}`);
    const [stored] = history.compactWatchlistResults([{
      domain: 'HTTPS://Brand.Example/private',
      availability: 'registered',
      scanDepth: 'deep',
      registrarName: 'R'.repeat(500),
      nameservers,
      pageTitle: 'T'.repeat(500),
      mutationTypes,
      unknown: { secret: true },
      rawHeaders: { authorization: 'secret' },
    }]);
    assert.equal(stored.domain, 'brand.example');
    assert.equal(stored.registrarName.length, 300);
    assert.equal(stored.pageTitle.length, 200);
    assert.equal(stored.nameservers.length, history.MAX_WATCHLIST_NAMESERVERS);
    assert.equal(stored.mutationTypes.length, history.MAX_WATCHLIST_MUTATION_TYPES);
    assert.equal(stored.unknown, undefined);
    assert.equal(stored.rawHeaders, undefined);
  });

  test('result normalization bounds hostile input before retaining valid records', () => {
    const values = Array.from({ length: history.MAX_WATCHLIST_INPUT_RECORDS + 1 }, (_, index) => ({
      domain: index < history.MAX_WATCHLIST_INPUT_RECORDS ? 'not valid' : 'late.example',
    }));
    assert.deepEqual(history.compactWatchlistResults(values), []);
  });

  test('stored results deduplicate canonical domains without mutating input', () => {
    const values = [
      { domain: 'DUPLICATE.EXAMPLE.', availability: 'registered' },
      { domain: 'duplicate.example', availability: 'available' },
    ];
    const before = structuredClone(values);
    const result = history.compactWatchlistResults(values);
    assert.equal(result.length, 1);
    assert.equal(result[0].domain, 'duplicate.example');
    assert.equal(result[0].availability, 'registered');
    assert.deepEqual(values, before);
  });

  test('imported history values are revalidated and bounded at the display boundary', () => {
    const changes = Array.from({ length: history.MAX_WATCHLIST_CHANGES_PER_EVENT + 5 }, (_, index) => ({
      domain: `item-${index}.example`,
      field: 'pageTitle',
      before: 'Old',
      after: 'N'.repeat(500),
      kind: index === 0 ? 'risk_signal_added' : 'invented-kind',
      tone: index === 0 ? 'danger' : 'invented-tone',
      secret: 'drop me',
    }));
    const entry = history.normalizeWatchlistEntry({
      updatedAt: 'not a date',
      results: [{ domain: 'brand.example', availability: 'registered' }],
      history: [{
        checkedAt: 'not a date', mode: 'invalid', resultCount: -1,
        conclusiveCount: 999999, changeCount: 999999, omittedChanges: -1, changes,
      }],
    });
    assert.equal(entry.updatedAt, '1970-01-01T00:00:00.000Z');
    assert.equal(entry.history[0].checkedAt, '1970-01-01T00:00:00.000Z');
    assert.equal(entry.history[0].mode, 'saved');
    assert.equal(entry.history[0].resultCount, 1);
    assert.equal(entry.history[0].conclusiveCount, 0);
    assert.equal(entry.history[0].changeCount, history.MAX_WATCHLIST_CHANGES_PER_EVENT);
    assert.equal(entry.history[0].changes.length, history.MAX_WATCHLIST_CHANGES_PER_EVENT);
    assert.equal(entry.history[0].changes[0].after.length, 200);
    assert.equal(entry.history[0].changes[1].kind, 'field_changed');
    assert.equal(entry.history[0].changes[1].tone, 'neutral');
    assert.equal(entry.history[0].changes[0].secret, undefined);
  });

  test('append stores the compact snapshot rather than caller-owned raw objects', () => {
    const raw = [{ domain: 'brand.example', availability: 'registered', mutationTypes: ['omission'], rawHtml: '<secret>' }];
    const result = history.appendWatchlistScan(null, raw, { checkedAt: '2026-07-14T00:00:00.000Z', mode: 'fast' });
    assert.equal(result.entry.results[0].rawHtml, undefined);
    assert.deepEqual(result.entry.results[0].mutationTypes, ['omission']);
    assert.equal(raw[0].rawHtml, '<secret>');
  });
});
