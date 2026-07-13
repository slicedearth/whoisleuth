const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let model;
before(async () => {
  model = await import('../frontend/src/lib/analysis/case-model.js');
});

const ISO = '2026-05-01T00:00:00.000Z';
const LATER = '2026-06-01T00:00:00.000Z';
const LATEST = '2026-07-01T00:00:00.000Z';
const NOW = '2026-07-12T00:00:00.000Z';
const SAFE = /^[A-Za-z0-9_-]{1,64}$/;

// A material deep capture (explicit depth + deep-scan signals) used across the
// comparison and dedup suites.
function deepEvidence(overrides = {}) {
  return {
    scanDepth: 'deep',
    availability: 'registered',
    riskModelVersion: 1,
    riskScore: 40,
    registrar: 'Example Registrar',
    activityStatus: 'active',
    hasMx: true,
    ...overrides,
  };
}

describe('domain normalization', () => {
  test('lowercases, trims, and strips a single terminal root dot', () => {
    assert.equal(model.normalizeDomain('  Example.COM.  '), 'example.com');
    assert.equal(model.normalizeDomain('EXAMPLE.com'), 'example.com');
  });

  test('safely strips scheme, userinfo, port, path, query, and fragment', () => {
    assert.equal(model.normalizeDomain('https://bad.example/login?a=1#x'), 'bad.example');
    assert.equal(model.normalizeDomain('http://bad.example/'), 'bad.example');
    assert.equal(model.normalizeDomain('example.com:443'), 'example.com');
    assert.equal(model.normalizeDomain('user:pass@example.com'), 'example.com');
  });

  test('canonicalizes Unicode and punycode to the same value', () => {
    assert.equal(model.normalizeDomain('café.example'), 'xn--caf-dma.example');
    assert.equal(model.normalizeDomain('xn--caf-dma.example'), 'xn--caf-dma.example');
    assert.equal(model.normalizeDomain('café.example'), model.normalizeDomain('CAFÉ.example'));
  });

  test('preserves syntactically valid .invalid hostnames for offline use', () => {
    assert.equal(model.normalizeDomain('bad-domain-1.invalid'), 'bad-domain-1.invalid');
  });

  test('rejects IPs, ASNs, and non-hostname junk', () => {
    for (const value of ['not a domain', '127.0.0.1', '10.0.0.1', '::1', '[::1]', 'AS123', 'as123', 'localhost']) {
      assert.equal(model.normalizeDomain(value), '', `expected ${value} to be rejected`);
    }
  });

  test('rejects underscores, empty/overlong/hyphen-edged labels, and control characters', () => {
    for (const value of ['foo_bar.com', 'a..b.com', 'example.com..', '-lead.example', 'trail-.example', 'a'.repeat(64) + '.example', 'bad\tdomain.com', 'bad domain.com']) {
      assert.equal(model.normalizeDomain(value), '', `expected ${value} to be rejected`);
    }
  });

  test('rejects empty values and anything over the length bound', () => {
    assert.equal(model.normalizeDomain(''), '');
    assert.equal(model.normalizeDomain('   '), '');
    assert.equal(model.normalizeDomain(null), '');
    assert.equal(model.normalizeDomain('a'.repeat(254) + '.example'), '');
  });
});

describe('status and disposition validation', () => {
  test('accepts every documented machine value', () => {
    for (const status of ['new', 'reviewing', 'monitoring', 'escalated', 'resolved']) {
      assert.equal(model.isValidStatus(status), true);
    }
    for (const disp of ['unreviewed', 'suspicious', 'confirmed_abuse', 'false_positive', 'expected', 'closed_no_action']) {
      assert.equal(model.isValidDisposition(disp), true);
    }
  });

  test('rejects unknown or display-label values', () => {
    assert.equal(model.isValidStatus('New'), false);
    assert.equal(model.isValidStatus('archived'), false);
    assert.equal(model.isValidDisposition('Confirmed abuse'), false);
  });

  test('normalizeCase falls back to defaults for invalid status/disposition/source', () => {
    const record = model.normalizeCase(
      { domain: 'bad.example', status: 'archived', disposition: 'nope', source: 'satellite' },
      undefined,
      ISO,
    );
    assert.equal(record.status, 'new');
    assert.equal(record.disposition, 'unreviewed');
    assert.equal(record.source, 'unknown');
  });
});

describe('case creation and updates', () => {
  test('createCase produces a normalized record with matching timestamps', () => {
    const record = model.createCase(
      { domain: 'HTTPS://New.Example/path', status: 'reviewing', disposition: 'suspicious', source: 'lookup', tags: ['Phish'], note: '  first note  ' },
      ISO,
    );
    assert.equal(record.domain, 'new.example');
    assert.equal(record.status, 'reviewing');
    assert.equal(record.disposition, 'suspicious');
    assert.equal(record.source, 'lookup');
    assert.deepEqual(record.tags, ['Phish']);
    assert.equal(record.notes.length, 1);
    assert.equal(record.notes[0].body, 'first note');
    assert.equal(record.createdAt, ISO);
    assert.equal(record.updatedAt, ISO);
    assert.deepEqual(record.evidenceHistory, []);
  });

  test('createCase rejects an invalid domain', () => {
    assert.throws(() => model.createCase({ domain: '   ' }), /valid domain/i);
  });

  test('updateCase changes fields, appends a note, and bumps updatedAt', () => {
    const { cases } = model.openOrCreateCase([], { domain: 'bad.example' }, ISO);
    const { record } = model.updateCase(cases, cases[0].id, { status: 'escalated', disposition: 'confirmed_abuse', note: 'escalating' }, LATER);
    assert.equal(record.status, 'escalated');
    assert.equal(record.disposition, 'confirmed_abuse');
    assert.equal(record.notes.at(-1).body, 'escalating');
    assert.equal(record.updatedAt, LATER);
    assert.equal(record.createdAt, ISO);
  });

  test('updateCase rejects an empty note and a missing case', () => {
    const { cases } = model.openOrCreateCase([], { domain: 'bad.example' }, ISO);
    assert.throws(() => model.updateCase(cases, cases[0].id, { note: '   ' }), /empty/i);
    assert.throws(() => model.updateCase(cases, 'nope', { status: 'resolved' }), /no longer exists/i);
  });
});

describe('duplicate-domain handling', () => {
  test('openOrCreateCase opens the existing case instead of duplicating', () => {
    const first = model.openOrCreateCase([], { domain: 'dup.example' }, ISO);
    assert.equal(first.created, true);
    const second = model.openOrCreateCase(first.cases, { domain: 'DUP.example.' }, LATER);
    assert.equal(second.created, false);
    assert.equal(second.cases.length, 1);
    assert.equal(second.record.id, first.record.id);
  });

  test('normalizeCaseStore keeps a single case per domain, most recent wins', () => {
    const store = model.normalizeCaseStore([
      { domain: 'dup.example', status: 'new', updatedAt: ISO },
      { domain: 'DUP.example', status: 'resolved', updatedAt: LATER },
    ]);
    assert.equal(store.cases.length, 1);
    assert.equal(store.cases[0].status, 'resolved');
  });
});

describe('case ids are unique, stable, and safe', () => {
  test('repairs unsafe ids into the safe format', () => {
    const store = model.normalizeCaseStore([
      { domain: 'a.example', id: 'has spaces and !@#', updatedAt: ISO },
      { domain: 'b.example', id: '', updatedAt: ISO },
      { domain: 'c.example', id: 'x'.repeat(200), updatedAt: ISO },
    ]);
    for (const record of store.cases) assert.match(record.id, SAFE);
  });

  test('gives two different domains distinct ids even when the import reused one', () => {
    const store = model.normalizeCaseStore([
      { domain: 'a.example', id: 'dup', updatedAt: ISO },
      { domain: 'b.example', id: 'dup', updatedAt: ISO },
    ]);
    assert.equal(store.cases.length, 2);
    assert.notEqual(store.cases[0].id, store.cases[1].id);
    assert.equal(new Set(store.cases.map((c) => c.id)).size, 2);
  });

  test('produces the same repaired ids across repeated normalization', () => {
    const raw = [
      { domain: 'a.example', id: 'dup', updatedAt: ISO },
      { domain: 'b.example', id: 'dup', updatedAt: LATER },
      { domain: 'c.example', id: 'bad id!', updatedAt: ISO },
    ];
    const first = model.normalizeCaseStore(raw).cases;
    const second = model.normalizeCaseStore(first).cases;
    const third = model.normalizeCaseStore(second).cases;
    const ids = (cases) => cases.map((c) => `${c.domain}:${c.id}`).sort();
    assert.deepEqual(ids(second), ids(first));
    assert.deepEqual(ids(third), ids(first));
  });

  test('editing and deleting target the intended repaired record', () => {
    const cases = model.normalizeCaseStore([
      { domain: 'a.example', id: 'dup', status: 'new', updatedAt: ISO },
      { domain: 'b.example', id: 'dup', status: 'new', updatedAt: ISO },
    ]).cases;
    const target = cases.find((c) => c.domain === 'b.example');
    const other = cases.find((c) => c.domain === 'a.example');
    const updated = model.updateCase(cases, target.id, { status: 'escalated' }, LATER).cases;
    assert.equal(updated.find((c) => c.domain === 'b.example').status, 'escalated');
    assert.equal(updated.find((c) => c.domain === 'a.example').status, 'new');

    const afterDelete = updated.filter((c) => c.id !== other.id);
    assert.equal(afterDelete.length, 1);
    assert.equal(afterDelete[0].domain, 'b.example');
  });
});

describe('imports cannot reset local analyst decisions', () => {
  function localCase() {
    return model.normalizeCaseStore([
      {
        domain: 'shared.example',
        id: 'local-1',
        status: 'escalated',
        disposition: 'confirmed_abuse',
        source: 'bulk',
        evidence: { availability: 'registered', riskScore: 90, capturedAt: LATER },
        tags: ['local'],
        notes: [{ id: 'ln', body: 'local note', createdAt: LATER }],
        createdAt: ISO,
        updatedAt: LATER,
      },
    ]).cases;
  }

  test('a minimal import (domain only) cannot reset status, disposition, source, or evidence', () => {
    const result = model.mergeCases(localCase(), [{ domain: 'shared.example' }]);
    const merged = result.cases[0];
    assert.equal(merged.status, 'escalated');
    assert.equal(merged.disposition, 'confirmed_abuse');
    assert.equal(merged.source, 'bulk');
    assert.equal(model.latestCaseEvidence(merged).availability, 'registered');
    assert.equal(merged.evidenceHistory.length, 1);
    assert.equal(result.updated, 1);
  });

  test('a malformed import with junk scalars and no updatedAt cannot reset local fields', () => {
    const result = model.mergeCases(localCase(), [
      { domain: 'shared.example', status: 'ARCHIVED', disposition: 'nope', source: 'satellite', evidence: 'garbage' },
    ]);
    const merged = result.cases[0];
    assert.equal(merged.status, 'escalated');
    assert.equal(merged.disposition, 'confirmed_abuse');
    assert.equal(merged.source, 'bulk');
    assert.equal(model.latestCaseEvidence(merged).availability, 'registered');
    assert.equal(merged.evidenceHistory.length, 1);
  });

  test('a partial import that is newer but omits a field cannot blank that field', () => {
    const result = model.mergeCases(localCase(), [
      { domain: 'shared.example', disposition: 'false_positive', updatedAt: '2026-07-01T00:00:00.000Z' },
    ]);
    const merged = result.cases[0];
    assert.equal(merged.status, 'escalated'); // omitted -> unchanged
    assert.equal(merged.disposition, 'false_positive'); // present + newer -> wins
  });

  test('a valid newer exported record still wins per field', () => {
    const result = model.mergeCases(localCase(), [
      { domain: 'shared.example', status: 'resolved', disposition: 'closed_no_action', source: 'monitor', updatedAt: '2026-07-01T00:00:00.000Z' },
    ]);
    const merged = result.cases[0];
    assert.equal(merged.status, 'resolved');
    assert.equal(merged.disposition, 'closed_no_action');
    assert.equal(merged.source, 'monitor');
  });

  test('an older valid record does not win', () => {
    const result = model.mergeCases(localCase(), [
      { domain: 'shared.example', status: 'new', disposition: 'unreviewed', source: 'lookup', updatedAt: ISO },
    ]);
    const merged = result.cases[0];
    assert.equal(merged.status, 'escalated');
    assert.equal(merged.disposition, 'confirmed_abuse');
    assert.equal(merged.source, 'bulk');
  });

  test('tags and notes still merge additively regardless of timestamp', () => {
    const result = model.mergeCases(localCase(), [
      { domain: 'shared.example', tags: ['imported'], notes: [{ id: 'imp', body: 'imported note', createdAt: ISO }], updatedAt: ISO },
    ]);
    const merged = result.cases[0];
    assert.deepEqual(new Set(merged.tags), new Set(['local', 'imported']));
    assert.equal(merged.notes.length, 2);
  });
});

describe('note and tag limits', () => {
  test('tags are deduped case-insensitively, length-capped, and count-bounded', () => {
    const tags = Array.from({ length: 40 }, (_, i) => `tag-${i}`);
    const record = model.normalizeCase({ domain: 'bad.example', tags: [...tags, 'TAG-0', 'x'.repeat(80)] }, undefined, ISO);
    assert.equal(record.tags.length, model.MAX_TAGS_PER_CASE);
    assert.equal(record.tags.filter((t) => t.toLowerCase() === 'tag-0').length, 1);
    assert.ok(record.tags.every((t) => t.length <= model.MAX_TAG_LENGTH));
  });

  test('note bodies are trimmed and length-capped', () => {
    const record = model.createCase({ domain: 'bad.example', note: 'a'.repeat(5000) }, ISO);
    assert.equal(record.notes[0].body.length, model.MAX_NOTE_LENGTH);
  });

  test('updateCase refuses to exceed the per-case note bound', () => {
    let cases = model.openOrCreateCase([], { domain: 'bad.example' }, ISO).cases;
    for (let i = 0; i < model.MAX_NOTES_PER_CASE; i++) {
      cases = model.updateCase(cases, cases[0].id, { note: `note ${i}` }, ISO).cases;
    }
    assert.throws(() => model.updateCase(cases, cases[0].id, { note: 'one too many' }, ISO), /limited to/i);
  });

  test('store is bounded to MAX_CASES', () => {
    const many = Array.from({ length: model.MAX_CASES + 25 }, (_, i) => ({ domain: `case-${i}.example`, updatedAt: ISO }));
    const store = model.normalizeCaseStore(many);
    assert.equal(store.cases.length, model.MAX_CASES);
  });

  test('openOrCreateCase refuses to grow past MAX_CASES', () => {
    const full = model.normalizeCaseStore(
      Array.from({ length: model.MAX_CASES }, (_, i) => ({ domain: `case-${i}.example`, updatedAt: ISO })),
    ).cases;
    assert.throws(() => model.openOrCreateCase(full, { domain: 'overflow.example' }, ISO), /limited to/i);
  });
});

describe('evidence migration (v1 -> v2)', () => {
  function v1Case(evidence, extra = {}) {
    return { domain: 'mig.example', source: 'lookup', createdAt: ISO, updatedAt: LATER, evidence, ...extra };
  }

  test('a v1 evidence object migrates into a one-entry history', () => {
    const record = model.normalizeCase(v1Case({ availability: 'registered', riskScore: 80, registrar: 'Reg', activityStatus: 'active', capturedAt: ISO }), undefined, NOW);
    assert.equal(record.evidenceHistory.length, 1);
    const snap = record.evidenceHistory[0];
    assert.equal(snap.availability, 'registered');
    assert.equal(snap.riskScore, 80);
    assert.equal(snap.registrar, 'Reg');
    assert.equal(snap.capturedAt, ISO);
    assert.equal(snap.firstCapturedAt, ISO);
    assert.equal(snap.source, 'lookup'); // inferred from the case source
    assert.equal(snap.scanDepth, 'unknown'); // legacy evidence has no trustworthy depth
  });

  test('all analyst-authored fields survive the migration', () => {
    const record = model.normalizeCase(
      v1Case({ availability: 'registered' }, {
        status: 'escalated', disposition: 'confirmed_abuse', tags: ['keep'],
        notes: [{ id: 'n1', body: 'analyst note', createdAt: ISO }], id: 'stable-1',
      }),
      undefined,
      NOW,
    );
    assert.equal(record.id, 'stable-1');
    assert.equal(record.domain, 'mig.example');
    assert.equal(record.status, 'escalated');
    assert.equal(record.disposition, 'confirmed_abuse');
    assert.deepEqual(record.tags, ['keep']);
    assert.equal(record.notes[0].body, 'analyst note');
    assert.equal(record.source, 'lookup');
    assert.equal(record.createdAt, ISO);
    assert.equal(record.updatedAt, LATER);
  });

  test('a valid capturedAt survives; an invalid one falls back deterministically to updatedAt', () => {
    const good = model.normalizeCase(v1Case({ availability: 'registered', capturedAt: ISO }), undefined, NOW);
    assert.equal(good.evidenceHistory[0].capturedAt, ISO);
    const bad = model.normalizeCase(v1Case({ availability: 'registered', capturedAt: 'not-a-date' }), undefined, NOW);
    assert.equal(bad.evidenceHistory[0].capturedAt, LATER); // case updatedAt
  });

  test('migration is idempotent and does not duplicate history on a second load', () => {
    const once = model.normalizeCase(v1Case({ availability: 'registered', riskScore: 55, capturedAt: ISO }), undefined, NOW);
    const twice = model.normalizeCase(once, undefined, NOW);
    assert.equal(twice.evidenceHistory.length, 1);
    assert.deepEqual(twice.evidenceHistory, once.evidenceHistory);
  });

  test('a v2 record normalizes without inventing extra snapshots', () => {
    const v2 = model.normalizeCase(v1Case({ availability: 'registered', capturedAt: ISO }), undefined, NOW);
    // Re-feed the same v2 record but with a duplicate-material snapshot appended.
    const dupInput = { ...v2, evidenceHistory: [v2.evidenceHistory[0], { ...v2.evidenceHistory[0], capturedAt: LATER }] };
    const renorm = model.normalizeCase(dupInput, undefined, NOW);
    assert.equal(renorm.evidenceHistory.length, 1);
    assert.equal(renorm.evidenceHistory[0].firstCapturedAt, ISO);
    assert.equal(renorm.evidenceHistory[0].capturedAt, LATER);
  });

  test('the legacy `evidence` field is absent from normalized v2 output', () => {
    const record = model.normalizeCase(v1Case({ availability: 'registered' }), undefined, NOW);
    assert.equal('evidence' in record, false);
    assert.ok(Array.isArray(record.evidenceHistory));
  });
});

describe('snapshot normalization', () => {
  test('bounds scalars, arrays, and factor families', () => {
    const snap = model.normalizeSnapshot(
      {
        availability: 'registered',
        registrar: 'r'.repeat(500),
        pageTitle: 't'.repeat(500),
        websiteProbeDetail: 'd'.repeat(500),
        nameservers: Array.from({ length: 30 }, (_, i) => `ns${i}.example`),
        mutationTypes: Array.from({ length: 40 }, (_, i) => `mut-${i}`),
        riskFactors: Array.from({ length: 40 }, (_, i) => ({ label: `f${i}`, points: i })),
        opportunityFactors: Array.from({ length: 40 }, (_, i) => ({ label: `o${i}`, delta: -i })),
      },
      { fallback: ISO },
    );
    assert.ok(snap.registrar.length <= model.MAX_EVIDENCE_STRING_LENGTH);
    assert.ok(snap.pageTitle.length <= model.MAX_EVIDENCE_TITLE_LENGTH);
    assert.ok(snap.websiteProbeDetail.length <= model.MAX_EVIDENCE_DETAIL_LENGTH);
    assert.equal(snap.nameservers.length, model.MAX_EVIDENCE_NAMESERVERS);
    assert.equal(snap.mutationTypes.length, model.MAX_EVIDENCE_MUTATIONS);
    assert.equal(snap.riskFactors.length, model.MAX_EVIDENCE_FACTORS);
    assert.equal(snap.opportunityFactors.length, model.MAX_EVIDENCE_FACTORS);
    // The scoring module's `delta` is accepted and stored as `points`.
    assert.equal(snap.opportunityFactors[0].points, 0);
  });

  test('clamps scores to 0-100', () => {
    const high = model.normalizeSnapshot({ riskScore: 5000, opportunityScore: 250.7 }, { fallback: ISO });
    assert.equal(high.riskScore, 100);
    assert.equal(high.opportunityScore, 100);
    const low = model.normalizeSnapshot({ riskScore: -20 }, { fallback: ISO });
    assert.equal(low.riskScore, 0);
  });

  test('retains only a bounded risk model version attached to risk evidence', () => {
    const current = model.normalizeSnapshot({ availability: 'registered', riskModelVersion: 1, riskScore: 42 }, { fallback: ISO });
    assert.equal(current.riskModelVersion, 1);
    const malformed = model.normalizeSnapshot({ availability: 'registered', riskModelVersion: '1', riskScore: 42 }, { fallback: ISO });
    assert.equal(malformed.riskModelVersion, null);
    const orphaned = model.normalizeSnapshot({ availability: 'registered', riskModelVersion: 1 }, { fallback: ISO });
    assert.equal(orphaned.riskModelVersion, null);
  });

  test('preserves null vs false for booleans', () => {
    const snap = model.normalizeSnapshot({ availability: 'registered', hasMx: false, hasSpf: true }, { fallback: ISO });
    assert.equal(snap.hasMx, false); // an observed "no MX", not missing data
    assert.equal(snap.hasSpf, true);
    assert.equal(snap.hasDmarc, null); // absent -> null, never coerced to false
  });

  test('retains only the bounded compact HTTP summary in deep evidence', () => {
    const snap = model.normalizeSnapshot({
      scanDepth: 'deep',
      availability: 'registered',
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpFinalOrigin: 'https://login.example.test/private/path?token=secret',
      httpResponseStatus: 200,
      httpTransportSecurity: 'https',
      httpRedirectCount: 2,
      httpCrossOriginRedirect: true,
      httpHttpsDowngrade: false,
      httpContentType: 'text/html; charset=utf-8',
      httpSecurityHeaders: ['hsts', 'hsts', 'unknown', 'frame-protection'],
      redirects: [{ from: 'https://example.test', to: 'https://login.example.test' }],
      rawHeaders: { server: 'secret' },
    }, { fallback: ISO });

    assert.equal(snap.httpFinalOrigin, 'https://login.example.test');
    assert.equal(snap.httpResponseStatus, 200);
    assert.equal(snap.httpRedirectCount, 2);
    assert.equal(snap.httpCrossOriginRedirect, true);
    assert.deepEqual(snap.httpSecurityHeaders, ['frame-protection', 'hsts']);
    assert.equal('redirects' in snap, false);
    assert.equal('rawHeaders' in snap, false);
    assert.equal(JSON.stringify(snap).includes('secret'), false);
  });

  test('fast evidence cannot retain compact HTTP fields as observed values', () => {
    const snap = model.normalizeSnapshot({
      scanDepth: 'fast', availability: 'registered', httpSummaryVersion: 1, httpEvidenceStatus: 'success', httpResponseStatus: 200,
    }, { fallback: ISO });
    assert.equal(snap.httpEvidenceStatus, null);
    assert.equal(snap.httpResponseStatus, null);
    assert.equal(snap.httpSecurityHeaders, null);
  });

  test('normalizes nameservers case-insensitively, strips terminal dots, dedups, and sorts', () => {
    const snap = model.normalizeSnapshot({ nameservers: ['B.NS.example.', 'a.ns.example', 'A.NS.example', 'a.ns.example.'] }, { fallback: ISO });
    assert.deepEqual(snap.nameservers, ['a.ns.example', 'b.ns.example']);
  });

  test('drops a snapshot that carries no material evidence', () => {
    assert.equal(model.normalizeSnapshot({}, { fallback: ISO }), null);
    assert.equal(model.normalizeSnapshot({ availability: 'unknown' }, { fallback: ISO }), null);
    assert.equal(model.normalizeSnapshot({ confidence: 'high' }, { fallback: ISO }), null);
    assert.notEqual(model.normalizeSnapshot({ availability: 'registered' }, { fallback: ISO }), null);
    // Material, but no placeable time and no fallback -> skipped.
    assert.equal(model.normalizeSnapshot({ availability: 'registered' }, {}), null);
  });

  test('discards unknown properties', () => {
    const snap = model.normalizeSnapshot({ availability: 'registered', rawWhois: 'x'.repeat(9999), cookies: 'y', foo: 1 }, { fallback: ISO });
    assert.equal('rawWhois' in snap, false);
    assert.equal('cookies' in snap, false);
    assert.equal('foo' in snap, false);
  });

  test('produces stable, DOM-safe ids and fingerprints', () => {
    const a = model.normalizeSnapshot(deepEvidence(), { fallback: ISO });
    const b = model.normalizeSnapshot(deepEvidence(), { fallback: LATER, source: 'bulk' });
    assert.equal(a.fingerprint, b.fingerprint); // identity ignores time and source
    assert.equal(a.id, b.id);
    assert.match(a.id, SAFE);
  });

  test('validates scanDepth as a machine enum and defaults to unknown', () => {
    assert.equal(model.normalizeSnapshot({ availability: 'registered', scanDepth: 'deep' }, { fallback: ISO }).scanDepth, 'deep');
    assert.equal(model.normalizeSnapshot({ availability: 'registered', scanDepth: 'fast' }, { fallback: ISO }).scanDepth, 'fast');
    assert.equal(model.normalizeSnapshot({ availability: 'registered', scanDepth: 'turbo' }, { fallback: ISO }).scanDepth, 'unknown');
    assert.equal(model.normalizeSnapshot({ availability: 'registered' }, { fallback: ISO }).scanDepth, 'unknown');
  });

  test('a fast capture stores unevaluated deep signals as null, not false', () => {
    // A profile default of `false` for a fast scan is unevaluated, not observed.
    const fast = model.normalizeSnapshot(
      { scanDepth: 'fast', availability: 'registered', riskScore: 20, faviconMatch: false, hasMx: false, hasPasswordField: false },
      { fallback: ISO },
    );
    assert.equal(fast.faviconMatch, null);
    assert.equal(fast.hasMx, null);
    assert.equal(fast.hasPasswordField, null);
    assert.equal(fast.riskScore, 20); // a fast risk score is still kept
    // An unknown-depth capture is trusted: an observed false stays false.
    const unknown = model.normalizeSnapshot({ availability: 'registered', hasMx: false }, { fallback: ISO });
    assert.equal(unknown.hasMx, false);
  });

  test('captures of different depth are not confused (distinct fingerprints)', () => {
    const fast = model.normalizeSnapshot({ scanDepth: 'fast', availability: 'registered' }, { fallback: ISO });
    const deep = model.normalizeSnapshot({ scanDepth: 'deep', availability: 'registered' }, { fallback: ISO });
    assert.notEqual(fast.fingerprint, deep.fingerprint);
  });

  test('factor pairs are deduplicated and sorted so input order cannot shift the fingerprint', () => {
    const a = model.normalizeSnapshot({ availability: 'registered', riskFactors: [{ label: 'A', points: 40 }, { label: 'B', points: 30 }, { label: 'A', points: 40 }] }, { fallback: ISO });
    const b = model.normalizeSnapshot({ availability: 'registered', riskFactors: [{ label: 'B', points: 30 }, { label: 'A', points: 40 }] }, { fallback: ISO });
    assert.deepEqual(a.riskFactors, [{ label: 'A', points: 40 }, { label: 'B', points: 30 }]); // deduped + sorted (points desc)
    assert.equal(a.fingerprint, b.fingerprint); // order-independent
  });
});

describe('snapshot deduplication and timeline advance', () => {
  test('re-capturing identical evidence does not append a new entry', () => {
    let cases = model.openOrCreateCase([], { domain: 'dedup.example', source: 'lookup', evidence: deepEvidence() }, ISO).cases;
    cases = model.updateCase(cases, cases[0].id, { evidence: deepEvidence() }, LATER).cases;
    assert.equal(cases[0].evidenceHistory.length, 1);
  });

  test('a later identical capture advances capturedAt but keeps firstCapturedAt', () => {
    let cases = model.openOrCreateCase([], { domain: 'dedup.example', source: 'lookup', evidence: deepEvidence() }, ISO).cases;
    cases = model.updateCase(cases, cases[0].id, { evidence: deepEvidence() }, LATER).cases;
    const snap = cases[0].evidenceHistory[0];
    assert.equal(snap.firstCapturedAt, ISO);
    assert.equal(snap.capturedAt, LATER);
  });

  test('an older identical observation cannot move capturedAt backwards', () => {
    const history = model.normalizeEvidenceHistory(
      [
        { ...deepEvidence(), capturedAt: LATER },
        { ...deepEvidence(), capturedAt: ISO },
      ],
      { source: 'lookup' },
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].firstCapturedAt, ISO);
    assert.equal(history[0].capturedAt, LATER);
  });

  test('materially different evidence creates a second snapshot', () => {
    let cases = model.openOrCreateCase([], { domain: 'dedup.example', source: 'lookup', evidence: deepEvidence({ riskScore: 40 }) }, ISO).cases;
    cases = model.updateCase(cases, cases[0].id, { evidence: deepEvidence({ riskScore: 85 }) }, LATER).cases;
    assert.equal(cases[0].evidenceHistory.length, 2);
  });

  test('dedup compares full material, so a near-identical capture stays distinct', () => {
    const history = model.normalizeEvidenceHistory(
      [
        { ...deepEvidence(), nameservers: ['a.ns.example'], capturedAt: ISO },
        { ...deepEvidence(), nameservers: ['b.ns.example'], capturedAt: LATER },
      ],
      { source: 'lookup' },
    );
    assert.equal(history.length, 2);
    assert.notEqual(history[0].fingerprint, history[1].fingerprint);
  });

  test('a more informative source wins when identical evidence is re-seen', () => {
    const history = model.normalizeEvidenceHistory(
      [
        { ...deepEvidence(), capturedAt: ISO, source: 'import' },
        { ...deepEvidence(), capturedAt: LATER, source: 'lookup' },
      ],
      { source: 'unknown' },
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].source, 'lookup');
  });

  test('a rank tie resolves deterministically regardless of input order', () => {
    // lookup and bulk share a rank; the later observation wins, independent of order.
    const forward = model.normalizeEvidenceHistory(
      [{ ...deepEvidence(), capturedAt: ISO, source: 'bulk' }, { ...deepEvidence(), capturedAt: LATER, source: 'lookup' }],
      { source: 'unknown' },
    );
    const reversed = model.normalizeEvidenceHistory(
      [{ ...deepEvidence(), capturedAt: LATER, source: 'lookup' }, { ...deepEvidence(), capturedAt: ISO, source: 'bulk' }],
      { source: 'unknown' },
    );
    assert.equal(forward[0].source, 'lookup');
    assert.equal(reversed[0].source, 'lookup');
    assert.equal(forward[0].source, reversed[0].source);
  });

  test('a rank-and-time tie falls back to a stable lexical source', () => {
    const forward = model.normalizeEvidenceHistory(
      [{ ...deepEvidence(), capturedAt: ISO, source: 'lookup' }, { ...deepEvidence(), capturedAt: ISO, source: 'bulk' }],
      { source: 'unknown' },
    );
    const reversed = model.normalizeEvidenceHistory(
      [{ ...deepEvidence(), capturedAt: ISO, source: 'bulk' }, { ...deepEvidence(), capturedAt: ISO, source: 'lookup' }],
      { source: 'unknown' },
    );
    assert.equal(forward[0].source, 'bulk'); // 'bulk' < 'lookup'
    assert.equal(reversed[0].source, 'bulk');
  });

  test('identical factor sets in different order deduplicate to one entry', () => {
    const history = model.normalizeEvidenceHistory(
      [
        { ...deepEvidence(), riskFactors: [{ label: 'A', points: 40 }, { label: 'B', points: 30 }], capturedAt: ISO },
        { ...deepEvidence(), riskFactors: [{ label: 'B', points: 30 }, { label: 'A', points: 40 }], capturedAt: LATER },
      ],
      { source: 'lookup' },
    );
    assert.equal(history.length, 1);
  });
});

describe('evidence history retention', () => {
  test('history never exceeds the per-case bound and keeps the newest', () => {
    const raws = Array.from({ length: model.MAX_EVIDENCE_SNAPSHOTS_PER_CASE + 10 }, (_, i) => ({
      availability: 'registered',
      riskScore: i, // distinct material each time
      capturedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    }));
    const history = model.normalizeEvidenceHistory(raws, { source: 'lookup' });
    assert.equal(history.length, model.MAX_EVIDENCE_SNAPSHOTS_PER_CASE);
    // Newest survive: the retained window ends at the newest capture.
    assert.equal(history.at(-1).capturedAt, raws.at(-1).capturedAt);
    assert.equal(history.at(-1).riskScore, raws.at(-1).riskScore);
  });

  test('retention is deterministic across repeated normalization', () => {
    const raws = Array.from({ length: 40 }, (_, i) => ({
      availability: 'registered',
      riskScore: i,
      capturedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    }));
    const once = model.normalizeEvidenceHistory(raws, { source: 'lookup' });
    const twice = model.normalizeEvidenceHistory(once, { source: 'lookup' });
    assert.deepEqual(twice, once);
  });
});

describe('importing evidence history', () => {
  test('a v1 export imports its evidence as one snapshot without stamping it "now"', () => {
    const payload = {
      version: 1,
      cases: [{ domain: 'v1.example', source: 'lookup', evidence: { availability: 'registered', riskScore: 70 }, createdAt: ISO, updatedAt: ISO }],
    };
    const result = model.mergeCases([], payload);
    const record = result.cases[0];
    assert.equal(record.evidenceHistory.length, 1);
    // No capturedAt in the evidence -> falls back to the imported (older) timestamp, not "now".
    assert.equal(record.evidenceHistory[0].capturedAt, ISO);
    assert.equal(record.evidenceHistory[0].source, 'import');
  });

  test('a v2 export round-trips its history and re-imports idempotently', () => {
    const source = model.openOrCreateCase([], { domain: 'rt.example', source: 'lookup', evidence: deepEvidence() }, ISO).cases;
    const withSecond = model.updateCase(source, source[0].id, { evidence: deepEvidence({ riskScore: 90 }) }, LATER).cases;
    const payload = model.buildCaseExport(withSecond, LATEST);
    assert.equal(payload.version, model.CASE_SCHEMA_VERSION);

    const first = model.mergeCases([], payload);
    assert.equal(first.cases[0].evidenceHistory.length, 2);
    const second = model.mergeCases(first.cases, payload);
    assert.equal(second.cases[0].evidenceHistory.length, 2);
    assert.deepEqual(second.cases[0].evidenceHistory, first.cases[0].evidenceHistory);
  });

  test('the same material with a different snapshot id deduplicates on import', () => {
    const local = model.normalizeCaseStore([
      { domain: 'shared.example', evidenceHistory: [{ ...deepEvidence(), id: 'ev-local', capturedAt: ISO }], updatedAt: ISO },
    ]).cases;
    const imported = [{ domain: 'shared.example', evidenceHistory: [{ ...deepEvidence(), id: 'ev-imported', capturedAt: LATER }], updatedAt: LATER }];
    const merged = model.mergeCases(local, imported).cases[0];
    assert.equal(merged.evidenceHistory.length, 1);
    assert.equal(merged.evidenceHistory[0].firstCapturedAt, ISO);
    assert.equal(merged.evidenceHistory[0].capturedAt, LATER);
  });

  test('distinct imported evidence merges additively', () => {
    const local = model.normalizeCaseStore([
      { domain: 'shared.example', evidenceHistory: [{ ...deepEvidence({ riskScore: 20 }), capturedAt: ISO }], updatedAt: ISO },
    ]).cases;
    const imported = [{ domain: 'shared.example', evidenceHistory: [{ ...deepEvidence({ riskScore: 88 }), capturedAt: LATER }], updatedAt: LATER }];
    const merged = model.mergeCases(local, imported).cases[0];
    assert.equal(merged.evidenceHistory.length, 2);
  });

  test('malformed snapshots are skipped and never create empty timeline entries', () => {
    const local = model.normalizeCaseStore([{ domain: 'shared.example', updatedAt: ISO }]).cases;
    const imported = [{ domain: 'shared.example', evidenceHistory: [null, 'garbage', {}, { availability: 'unknown' }, { rawWhois: 'x' }], updatedAt: LATER }];
    const merged = model.mergeCases(local, imported).cases[0];
    assert.deepEqual(merged.evidenceHistory, []);
  });

  test('a missing imported timestamp does not become the newest observation', () => {
    const local = model.normalizeCaseStore([
      { domain: 'shared.example', evidenceHistory: [{ ...deepEvidence({ riskScore: 30 }), capturedAt: LATEST }], updatedAt: LATEST },
    ]).cases;
    // Imported snapshot has no capturedAt; the imported record is older (ISO).
    const imported = [{ domain: 'shared.example', evidenceHistory: [{ ...deepEvidence({ riskScore: 95 }) }], createdAt: ISO, updatedAt: ISO }];
    const merged = model.mergeCases(local, imported).cases[0];
    assert.equal(merged.evidenceHistory.length, 2);
    // The local capture (LATEST) is still the latest; the timestamp-less import fell back to ISO.
    assert.equal(model.latestCaseEvidence(merged).riskScore, 30);
    assert.equal(model.latestCaseEvidence(merged).capturedAt, LATEST);
  });

  test('re-importing the same payload is idempotent and keeps the local case id', () => {
    const local = model.normalizeCaseStore([
      { domain: 'shared.example', id: 'local-1', evidenceHistory: [{ ...deepEvidence(), capturedAt: ISO }], updatedAt: ISO },
    ]).cases;
    const payload = model.buildCaseExport(local, LATER);
    const once = model.mergeCases(local, payload).cases[0];
    const twice = model.mergeCases([once], payload).cases[0];
    assert.equal(once.id, 'local-1');
    assert.equal(twice.id, 'local-1');
    assert.equal(twice.evidenceHistory.length, 1);
  });
});

describe('compareCaseEvidence', () => {
  const snap = (overrides, at = ISO) => model.normalizeSnapshot(deepEvidence(overrides), { fallback: at });
  const find = (changes, field) => changes.find((c) => c.field === field);

  test('reports a risk-score increase with a danger tone', () => {
    const changes = model.compareCaseEvidence(snap({ riskScore: 40 }), snap({ riskScore: 85 }));
    const change = find(changes, 'riskScore');
    assert.ok(change);
    assert.equal(change.before, 40);
    assert.equal(change.after, 85);
    assert.equal(change.tone, 'danger');
  });

  test('keeps unversioned or differently-versioned risk scores readable but incomparable', () => {
    const legacy = model.normalizeSnapshot({ scanDepth: 'deep', availability: 'registered', riskScore: 90 }, { fallback: ISO });
    const current = model.normalizeSnapshot({ scanDepth: 'deep', availability: 'registered', riskModelVersion: 1, riskScore: 42 }, { fallback: LATER });
    assert.equal(legacy.riskScore, 90);
    assert.equal(legacy.riskModelVersion, null);
    assert.equal(find(model.compareCaseEvidence(legacy, current), 'riskScore'), undefined);
    assert.deepEqual(model.caseEvidenceIncomparableReasons(legacy, current), ['risk-model']);

    const future = model.normalizeSnapshot({ scanDepth: 'deep', availability: 'registered', riskModelVersion: 2, riskScore: 80 }, { fallback: LATER });
    assert.equal(find(model.compareCaseEvidence(current, future), 'riskScore'), undefined);
    assert.deepEqual(model.caseEvidenceIncomparableReasons(current, future), ['risk-model']);
  });

  test('reports ordinary changes while separately disclosing a risk-model mismatch', () => {
    const legacy = model.normalizeSnapshot({ scanDepth: 'deep', availability: 'registered', registrar: 'Old Registrar', riskScore: 90 }, { fallback: ISO });
    const current = model.normalizeSnapshot({ scanDepth: 'deep', availability: 'registered', registrar: 'New Registrar', riskModelVersion: 1, riskScore: 42 }, { fallback: LATER });
    const changes = model.compareCaseEvidence(legacy, current);
    assert.ok(find(changes, 'registrar'));
    assert.equal(find(changes, 'riskScore'), undefined);
    assert.deepEqual(model.caseEvidenceIncomparableReasons(legacy, current), ['risk-model']);
  });

  test('reports an availability transition into a registered-like state', () => {
    const changes = model.compareCaseEvidence(snap({ availability: 'available' }), snap({ availability: 'registered' }));
    const change = find(changes, 'availability');
    assert.ok(change);
    assert.equal(change.tone, 'danger');
  });

  test('reports mail and web signal changes', () => {
    const changes = model.compareCaseEvidence(snap({ hasMx: false, hasPasswordField: false }), snap({ hasMx: true, hasPasswordField: true }));
    assert.equal(find(changes, 'hasMx').tone, 'warn');
    assert.equal(find(changes, 'hasPasswordField').tone, 'danger');
  });

  test('treats nameservers as a set and reports genuine set changes', () => {
    const changes = model.compareCaseEvidence(
      snap({ nameservers: ['a.ns.example', 'b.ns.example'] }),
      snap({ nameservers: ['c.ns.example', 'b.ns.example'] }),
    );
    assert.ok(find(changes, 'nameservers'));
  });

  test('ignores casing-only and order-only differences', () => {
    const changes = model.compareCaseEvidence(
      snap({ registrar: 'GoDaddy', nameservers: ['A.NS.example', 'b.ns.example'] }),
      snap({ registrar: 'godaddy', nameservers: ['b.ns.example.', 'a.ns.example'] }),
    );
    assert.equal(changes.length, 0);
  });

  test('does not report a favicon removal when the newer capture is a fast scan (regression)', () => {
    // Reproduces the exact failure: a deep capture saw an official favicon
    // match; a later FAST capture carries the profile's default `false`. That
    // must not be read as the favicon match being removed.
    const previous = model.normalizeSnapshot({ scanDepth: 'deep', availability: 'registered', faviconMatch: true, activityStatus: 'active' }, { fallback: ISO });
    const fast = model.normalizeSnapshot({ scanDepth: 'fast', availability: 'registered', faviconMatch: false }, { fallback: LATER });
    assert.equal(fast.faviconMatch, null); // coerced away as unevaluated
    const changes = model.compareCaseEvidence(previous, fast);
    assert.equal(find(changes, 'faviconMatch'), undefined);
    assert.equal(find(changes, 'hasMx'), undefined);
  });

  test('reports a meaningful fast->fast risk-score change', () => {
    const a = model.normalizeSnapshot({ scanDepth: 'fast', availability: 'registered', riskModelVersion: 1, riskScore: 20 }, { fallback: ISO });
    const b = model.normalizeSnapshot({ scanDepth: 'fast', availability: 'registered', riskModelVersion: 1, riskScore: 65 }, { fallback: LATER });
    const change = find(model.compareCaseEvidence(a, b), 'riskScore');
    assert.ok(change);
    assert.equal(change.before, 20);
    assert.equal(change.after, 65);
  });

  test('does not report a risk change caused solely by fast vs deep depth', () => {
    const fast = model.normalizeSnapshot({ scanDepth: 'fast', availability: 'registered', riskModelVersion: 1, riskScore: 20 }, { fallback: ISO });
    const deep = model.normalizeSnapshot({ scanDepth: 'deep', availability: 'registered', riskModelVersion: 1, riskScore: 80, activityStatus: 'active', hasMx: true }, { fallback: LATER });
    assert.equal(find(model.compareCaseEvidence(fast, deep), 'riskScore'), undefined);
  });

  test('reports a deep->deep signal removal', () => {
    const before = model.normalizeSnapshot({ scanDepth: 'deep', availability: 'registered', activityStatus: 'active', faviconMatch: true }, { fallback: ISO });
    const after = model.normalizeSnapshot({ scanDepth: 'deep', availability: 'registered', activityStatus: 'active', faviconMatch: false }, { fallback: LATER });
    const change = find(model.compareCaseEvidence(before, after), 'faviconMatch');
    assert.ok(change);
    assert.equal(change.before, true);
    assert.equal(change.after, false);
    assert.equal(change.tone, 'good');
  });

  test('reports compact HTTP changes only across two deep observations', () => {
    const before = model.normalizeSnapshot({
      scanDepth: 'deep', availability: 'registered',
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success', httpFinalOrigin: 'https://example.test', httpResponseStatus: 200,
      httpTransportSecurity: 'https', httpRedirectCount: 0, httpCrossOriginRedirect: false,
      httpHttpsDowngrade: false, httpContentType: 'text/html', httpSecurityHeaders: ['hsts'],
    }, { fallback: ISO });
    const after = model.normalizeSnapshot({
      scanDepth: 'deep', availability: 'registered',
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'partial', httpFinalOrigin: 'http://other.example.test', httpResponseStatus: 403,
      httpTransportSecurity: 'http', httpRedirectCount: 2, httpCrossOriginRedirect: true,
      httpHttpsDowngrade: true, httpContentType: 'text/plain', httpSecurityHeaders: [],
    }, { fallback: LATER });
    const changes = model.compareCaseEvidence(before, after);
    const byField = new Map(changes.map((change) => [change.field, change]));
    assert.equal(byField.get('httpTransportSecurity').tone, 'danger');
    assert.equal(byField.get('httpHttpsDowngrade').tone, 'danger');
    assert.equal(byField.get('httpCrossOriginRedirect').tone, 'warn');
    assert.deepEqual(byField.get('httpSecurityHeaders').before, ['hsts']);
    assert.deepEqual(byField.get('httpSecurityHeaders').after, []);

    const fast = model.normalizeSnapshot({ scanDepth: 'fast', availability: 'registered' }, { fallback: LATER });
    assert.equal(model.compareCaseEvidence(before, fast).some((change) => change.field.startsWith('http')), false);
  });

  test('reports a factor change even when the total score is unchanged', () => {
    const before = model.normalizeSnapshot({ scanDepth: 'deep', availability: 'registered', activityStatus: 'active', riskModelVersion: 1, riskScore: 70, riskFactors: [{ label: 'A', points: 40 }, { label: 'B', points: 30 }] }, { fallback: ISO });
    const after = model.normalizeSnapshot({ scanDepth: 'deep', availability: 'registered', activityStatus: 'active', riskModelVersion: 1, riskScore: 70, riskFactors: [{ label: 'A', points: 50 }, { label: 'B', points: 20 }] }, { fallback: LATER });
    const changes = model.compareCaseEvidence(before, after);
    assert.equal(find(changes, 'riskScore'), undefined); // total unchanged
    assert.ok(find(changes, 'riskFactors')); // composition changed -> explainable material change
  });

  test('uses stable field ordering and stays bounded', () => {
    const before = snap({ availability: 'available', riskScore: 10, hasMx: false });
    const after = snap({ availability: 'registered', riskScore: 90, hasMx: true });
    const changes = model.compareCaseEvidence(before, after);
    const order = changes.map((c) => c.field);
    assert.deepEqual(order, [...order].sort((a, b) => order.indexOf(a) - order.indexOf(b))); // already in emission order
    assert.equal(order.indexOf('availability') < order.indexOf('riskScore'), true);
    assert.ok(changes.length <= model.MAX_EVIDENCE_CHANGES);
  });

  test('returns nothing for two null/absent snapshots', () => {
    assert.deepEqual(model.compareCaseEvidence(null, snap({})), []);
    assert.deepEqual(model.compareCaseEvidence(snap({}), null), []);
  });
});

describe('serialized store byte budget', () => {
  function notesCase(index, noteCount) {
    const bigText = 'x'.repeat(model.MAX_NOTE_LENGTH);
    return {
      domain: `notes-${index}.example`,
      updatedAt: ISO,
      notes: Array.from({ length: noteCount }, (_, n) => ({ id: `n-${index}-${n}`, body: bigText, createdAt: ISO })),
    };
  }

  function fatSnapshot(index, position) {
    return {
      availability: 'registered',
      riskScore: position, // distinct material per position
      registrar: 'r'.repeat(model.MAX_EVIDENCE_STRING_LENGTH),
      pageTitle: 't'.repeat(model.MAX_EVIDENCE_TITLE_LENGTH),
      websiteProbeDetail: 'd'.repeat(model.MAX_EVIDENCE_DETAIL_LENGTH),
      phishingLanguageMatch: 'p'.repeat(model.MAX_EVIDENCE_STRING_LENGTH),
      nameservers: Array.from({ length: model.MAX_EVIDENCE_NAMESERVERS }, (_, i) => `ns${i}-${'z'.repeat(30)}.example`),
      mutationTypes: Array.from({ length: model.MAX_EVIDENCE_MUTATIONS }, (_, i) => `mutation-${i}-${'m'.repeat(20)}`),
      capturedAt: new Date(Date.UTC(2026, 0, 1, 0, position)).toISOString(),
      hasMx: true,
    };
  }

  test('a normal store is under budget and prunes nothing', () => {
    const cases = model.normalizeCaseStore([{ domain: 'a.example', updatedAt: ISO }]).cases;
    const result = model.enforceStoreBudget(cases);
    assert.equal(result.pruned, 0);
    assert.ok(new TextEncoder().encode(model.serializeCaseStore(result.cases)).length <= model.MAX_CASE_STORE_BYTES);
    // The returned cases are exactly what a persist would serialize.
    assert.deepEqual(result.cases, JSON.parse(model.serializeCaseStore(result.cases)).cases);
  });

  test('fails with a friendly error when analyst notes alone exceed the budget', () => {
    // ~4.4 MB of notes, no evidence to prune.
    const cases = Array.from({ length: 44 }, (_, i) => notesCase(i, model.MAX_NOTES_PER_CASE));
    assert.throws(() => model.enforceStoreBudget(cases), /storage budget/i);
  });

  test('prunes oldest snapshots to fit and reports the count, without touching notes', () => {
    // A note base safely under budget, plus enough fat evidence to push over it.
    const base = Array.from({ length: 30 }, (_, i) => notesCase(i, 40));
    const withEvidence = Array.from({ length: 40 }, (_, i) => ({
      domain: `ev-${i}.example`,
      updatedAt: ISO,
      notes: [{ id: `keep-${i}`, body: 'analyst decision', createdAt: ISO }],
      evidenceHistory: Array.from({ length: model.MAX_EVIDENCE_SNAPSHOTS_PER_CASE }, (_, p) => fatSnapshot(i, p)),
    }));
    const cases = model.normalizeCaseStore([...base, ...withEvidence]).cases;
    assert.ok(new TextEncoder().encode(model.serializeCaseStore(cases)).length > model.MAX_CASE_STORE_BYTES);

    const snapshotsBefore = cases.reduce((sum, c) => sum + c.evidenceHistory.length, 0);
    const result = model.enforceStoreBudget(cases);
    assert.ok(result.pruned > 0);
    assert.ok(new TextEncoder().encode(model.serializeCaseStore(result.cases)).length <= model.MAX_CASE_STORE_BYTES);
    // Analyst-authored notes are all still present.
    const keptNotes = result.cases.reduce((sum, c) => sum + c.notes.length, 0);
    const originalNotes = cases.reduce((sum, c) => sum + c.notes.length, 0);
    assert.equal(keptNotes, originalNotes);
    // Evidence, not notes, absorbed the pruning: the returned data is post-prune.
    const snapshotsAfter = result.cases.reduce((sum, c) => sum + c.evidenceHistory.length, 0);
    assert.ok(snapshotsAfter < snapshotsBefore);
    assert.equal(snapshotsBefore - snapshotsAfter, result.pruned);
    // At least one evidence case still retains its newest snapshot.
    assert.ok(result.cases.some((c) => c.domain.startsWith('ev-') && c.evidenceHistory.length >= 1));
    // A returned record equals its serialized-persisted form (no pre-prune copy).
    const sample = result.cases.find((c) => c.domain.startsWith('ev-'));
    const persisted = JSON.parse(model.serializeCaseStore(result.cases)).cases.find((c) => c.id === sample.id);
    assert.deepEqual(sample, persisted);
  });
});

describe('rejects unsupported future-schema imports', () => {
  function localCases() {
    return model.normalizeCaseStore([{ domain: 'keep.example', status: 'escalated', disposition: 'confirmed_abuse', updatedAt: LATER }]).cases;
  }

  test('a version greater than the supported schema is rejected before merging', () => {
    const local = localCases();
    assert.throws(
      () => model.mergeCases(local, { version: 999, cases: [{ domain: 'new.example' }] }),
      /newer version of WHOISleuth/i,
    );
    // Local cases are untouched (nothing merged, nothing reset).
    assert.equal(local.length, 1);
    assert.equal(local[0].status, 'escalated');
    assert.equal(local[0].disposition, 'confirmed_abuse');
  });

  test('bare arrays and supported versions remain importable', () => {
    const local = localCases();
    assert.equal(model.mergeCases(local, [{ domain: 'bare.example', updatedAt: ISO }]).added, 1);
    assert.equal(model.mergeCases(local, { version: 1, cases: [{ domain: 'v1.example', updatedAt: ISO }] }).added, 1);
    assert.equal(model.mergeCases(local, { version: 2, cases: [{ domain: 'v2.example', updatedAt: ISO }] }).added, 1);
  });
});

describe('imported note normalization is deterministic', () => {
  test('a timestamp-less, id-less imported note uses the record timestamp, not "now", and is idempotent', () => {
    const payload = {
      version: 1,
      cases: [{ domain: 'notes.example', createdAt: ISO, updatedAt: ISO, notes: [{ body: 'a timeless observation' }] }],
    };
    const once = model.mergeCases([], payload).cases[0];
    assert.equal(once.notes.length, 1);
    assert.equal(once.notes[0].createdAt, ISO); // record fallback, never the current time

    // Re-importing the same payload must not create a duplicate or a newer note.
    const twice = model.mergeCases([once], payload).cases[0];
    assert.equal(twice.notes.length, 1);
    assert.deepEqual(twice.notes, once.notes);
  });

  test('an imported note with no placeable timestamp at all is skipped, not stamped', () => {
    const payload = { cases: [{ domain: 'notes.example', notes: [{ body: 'unplaceable' }] }] };
    const merged = model.mergeCases([], payload).cases[0];
    assert.deepEqual(merged.notes, []);
  });

  test('locally-created notes still use the genuine current time', () => {
    const record = model.createCase({ domain: 'local.example', note: 'fresh note' }, NOW);
    assert.equal(record.notes[0].createdAt, NOW);
  });
});

describe('store loading and corruption recovery', () => {
  test('recovers from arrays, envelopes, and junk without throwing', () => {
    assert.deepEqual(model.normalizeCaseStore(null).cases, []);
    assert.deepEqual(model.normalizeCaseStore('nonsense').cases, []);
    assert.deepEqual(model.normalizeCaseStore(42).cases, []);
    assert.deepEqual(model.normalizeCaseStore({ cases: 'not-an-array' }).cases, []);
    const fromArray = model.normalizeCaseStore([{ domain: 'bad.example' }]);
    const fromEnvelope = model.normalizeCaseStore({ version: 1, cases: [{ domain: 'bad.example' }] });
    assert.equal(fromArray.cases.length, 1);
    assert.equal(fromEnvelope.cases.length, 1);
    assert.equal(fromEnvelope.version, model.CASE_SCHEMA_VERSION);
  });

  test('parseStoreVersion reads the declared version or null', () => {
    assert.equal(model.parseStoreVersion({ version: 2, cases: [] }), 2);
    assert.equal(model.parseStoreVersion({ version: 99 }), 99);
    assert.equal(model.parseStoreVersion([]), null);
    assert.equal(model.parseStoreVersion(null), null);
  });

  test('drops malformed records but keeps valid neighbours', () => {
    const store = model.normalizeCaseStore([
      { domain: 'good.example' },
      { domain: '' },
      null,
      'garbage',
      { nope: true },
    ]);
    assert.equal(store.cases.length, 1);
    assert.equal(store.cases[0].domain, 'good.example');
  });

  test('malformed timestamps and notes are repaired, not fatal', () => {
    const store = model.normalizeCaseStore([
      { domain: 'bad.example', createdAt: 'not-a-date', updatedAt: 12345, notes: [{ body: 'kept' }, { body: '' }, null, 'x'] },
    ]);
    assert.equal(store.cases.length, 1);
    assert.equal(store.cases[0].notes.length, 1);
    assert.ok(!Number.isNaN(Date.parse(store.cases[0].createdAt)));
    assert.ok(!Number.isNaN(Date.parse(store.cases[0].updatedAt)));
  });
});

describe('import migration and merge', () => {
  test('adds new cases and merges existing ones by domain', () => {
    const local = model.normalizeCaseStore([{ domain: 'shared.example', status: 'new', updatedAt: ISO }]).cases;
    const imported = [
      { domain: 'shared.example', status: 'escalated', updatedAt: LATER, tags: ['imported'] },
      { domain: 'fresh.example', status: 'reviewing', updatedAt: ISO },
    ];
    const result = model.mergeCases(local, imported);
    assert.equal(result.added, 1);
    assert.equal(result.updated, 1);
    const shared = result.cases.find((c) => c.domain === 'shared.example');
    assert.equal(shared.status, 'escalated');
    assert.deepEqual(shared.tags, ['imported']);
  });

  test('never overwrites newer local scalar data with an older import', () => {
    const local = model.normalizeCaseStore([{ domain: 'shared.example', status: 'escalated', disposition: 'confirmed_abuse', updatedAt: LATER }]).cases;
    const imported = [{ domain: 'shared.example', status: 'new', disposition: 'unreviewed', updatedAt: ISO }];
    const result = model.mergeCases(local, imported);
    const shared = result.cases[0];
    assert.equal(shared.status, 'escalated');
    assert.equal(shared.disposition, 'confirmed_abuse');
  });

  test('unions notes and tags across local and imported records', () => {
    const local = model.normalizeCaseStore([
      { domain: 'shared.example', tags: ['local'], notes: [{ id: 'n1', body: 'local note', createdAt: ISO }], updatedAt: ISO },
    ]).cases;
    const imported = [
      { domain: 'shared.example', tags: ['imported'], notes: [{ id: 'n2', body: 'imported note', createdAt: LATER }], updatedAt: LATER },
    ];
    const result = model.mergeCases(local, imported);
    const shared = result.cases[0];
    assert.deepEqual(new Set(shared.tags), new Set(['local', 'imported']));
    assert.equal(shared.notes.length, 2);
  });

  test('merge is idempotent', () => {
    const local = model.normalizeCaseStore([{ domain: 'shared.example', updatedAt: ISO }]).cases;
    const imported = [{ domain: 'shared.example', tags: ['t'], updatedAt: ISO }];
    const once = model.mergeCases(local, imported).cases;
    const twice = model.mergeCases(once, imported).cases;
    assert.equal(twice.length, 1);
    assert.deepEqual(twice[0].tags, once[0].tags);
  });

  test('skips imported cases that would exceed the store bound', () => {
    const local = model.normalizeCaseStore(
      Array.from({ length: model.MAX_CASES }, (_, i) => ({ domain: `case-${i}.example`, updatedAt: ISO })),
    ).cases;
    const result = model.mergeCases(local, [{ domain: 'overflow.example', updatedAt: ISO }]);
    assert.equal(result.added, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.cases.length, model.MAX_CASES);
  });
});

describe('export shape', () => {
  test('includes schema version, export timestamp, and clean cases', () => {
    const cases = model.normalizeCaseStore([{ domain: 'bad.example', updatedAt: ISO }]).cases;
    const payload = model.buildCaseExport(cases, LATER);
    assert.equal(payload.version, model.CASE_SCHEMA_VERSION);
    assert.equal(payload.exportedAt, LATER);
    assert.equal(payload.cases.length, 1);
    assert.equal(payload.cases[0].domain, 'bad.example');
  });

  test('an exported payload re-imports to an equivalent store', () => {
    const original = model.openOrCreateCase([], { domain: 'roundtrip.example', status: 'monitoring', tags: ['a'], note: 'hi' }, ISO).cases;
    const payload = model.buildCaseExport(original, ISO);
    const reimported = model.mergeCases([], payload).cases;
    assert.equal(reimported.length, 1);
    assert.equal(reimported[0].domain, 'roundtrip.example');
    assert.equal(reimported[0].status, 'monitoring');
    assert.equal(reimported[0].notes.length, 1);
  });
});
