const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let model;
before(async () => {
  model = await import('../frontend/src/lib/analysis/case-model.js');
});

const ISO = '2026-05-01T00:00:00.000Z';
const LATER = '2026-06-01T00:00:00.000Z';

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
  const SAFE = /^[A-Za-z0-9_-]{1,64}$/;

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
        evidence: { availability: 'registered', riskScore: 90 },
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
    assert.equal(merged.evidence.availability, 'registered');
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
    assert.equal(merged.evidence.availability, 'registered');
  });

  test('a partial import that is newer but omits a field cannot blank that field', () => {
    // Newer timestamp, but no status -> local escalated must survive.
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

describe('evidence snapshot stays bounded', () => {
  test('keeps a small scalar set and ignores everything else', () => {
    const record = model.normalizeCase(
      {
        domain: 'bad.example',
        evidence: {
          availability: 'registered',
          riskScore: 88.6,
          registrar: 'Example Registrar',
          activityStatus: 'active',
          rawWhois: 'x'.repeat(100000),
          nameservers: ['a', 'b'],
        },
      },
      undefined,
      ISO,
    );
    assert.deepEqual(Object.keys(record.evidence).sort(), ['activityStatus', 'availability', 'capturedAt', 'registrar', 'riskScore']);
    assert.equal(record.evidence.riskScore, 89);
    assert.ok(record.evidence.registrar.length <= model.MAX_EVIDENCE_STRING_LENGTH);
  });

  test('clamps risk score and drops empty evidence entirely', () => {
    const clamped = model.normalizeCase({ domain: 'bad.example', evidence: { riskScore: 5000 } }, undefined, ISO);
    assert.equal(clamped.evidence.riskScore, 100);
    const empty = model.normalizeCase({ domain: 'bad.example', evidence: { availability: '', registrar: null } }, undefined, ISO);
    assert.equal(empty.evidence, null);
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
    assert.equal(fromEnvelope.version, 1);
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
