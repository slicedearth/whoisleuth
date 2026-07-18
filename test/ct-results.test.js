const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let normalizeCtResponse;
let normalizeCtProvenance;
let mergeCtProvenance;
let ctCandidateMatchesFilter;
let bounds;
before(async () => {
  const mod = await import('../frontend/src/lib/analysis/ct-results.js');
  normalizeCtResponse = mod.normalizeCtResponse;
  normalizeCtProvenance = mod.normalizeCtProvenance;
  mergeCtProvenance = mod.mergeCtProvenance;
  ctCandidateMatchesFilter = mod.ctCandidateMatchesFilter;
  bounds = mod;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function match(overrides = {}) {
  return {
    domain: 'example.com',
    hostnames: ['a.example.com'],
    firstObservedAt: '2026-01-01T00:00:00.000Z',
    lastObservedAt: '2026-06-01T00:00:00.000Z',
    certificateCount: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Valid structured response
// ---------------------------------------------------------------------------

describe('structured response', () => {
  test('normalizes a valid structured response', () => {
    const result = normalizeCtResponse(
      { keyword: 'example', domains: ['a.example.com'], certCount: 42, truncated: false, matches: [match()] },
      'example',
    );
    assert.equal(result.certCount, 42);
    assert.equal(result.truncated, false);
    assert.equal(result.candidates.length, 1);
    const candidate = result.candidates[0];
    assert.equal(candidate.domain, 'example.com');
    assert.equal(candidate.source, 'example');
    assert.deepStrictEqual(candidate.mutationTypes, ['certificate_transparency']);
    assert.deepStrictEqual(candidate.certificateTransparency.hostnames, ['a.example.com']);
    assert.equal(candidate.certificateTransparency.certificateCount, 3);
  });

  test('one candidate per canonical domain (merge across duplicate matches)', () => {
    const result = normalizeCtResponse(
      {
        matches: [
          match({ domain: 'example.com', hostnames: ['a.example.com'], firstObservedAt: '2026-03-01T00:00:00Z', lastObservedAt: '2026-04-01T00:00:00Z', certificateCount: 2 }),
          match({ domain: 'example.com', hostnames: ['b.example.com', 'a.example.com'], firstObservedAt: '2026-01-01T00:00:00Z', lastObservedAt: '2026-05-01T00:00:00Z', certificateCount: 5 }),
        ],
      },
      'src',
    );
    assert.equal(result.candidates.length, 1);
    const ct = result.candidates[0].certificateTransparency;
    // union of hostnames, deduped + sorted
    assert.deepStrictEqual(ct.hostnames, ['a.example.com', 'b.example.com']);
    // earliest first observation
    assert.equal(ct.firstObservedAt, '2026-01-01T00:00:00.000Z');
    // latest last observation
    assert.equal(ct.lastObservedAt, '2026-05-01T00:00:00.000Z');
    // highest count, never a sum
    assert.equal(ct.certificateCount, 5);
  });

  test('newest last-observation first, null timestamps last, alpha tiebreak', () => {
    const result = normalizeCtResponse(
      {
        matches: [
          match({ domain: 'older.com', lastObservedAt: '2026-01-01T00:00:00Z' }),
          match({ domain: 'newer.com', lastObservedAt: '2026-09-01T00:00:00Z' }),
          match({ domain: 'zeta.com', lastObservedAt: null, firstObservedAt: null }),
          match({ domain: 'alpha.com', lastObservedAt: null, firstObservedAt: null }),
        ],
      },
      'src',
    );
    assert.deepStrictEqual(
      result.candidates.map((c) => c.domain),
      ['newer.com', 'older.com', 'alpha.com', 'zeta.com'],
    );
  });

  test('hostnames are normalized, deduped, sorted, and bounded', () => {
    const hostnames = [];
    for (let i = 0; i < 60; i++) hostnames.push(`h${String(i).padStart(2, '0')}.example.com`);
    hostnames.push('H00.EXAMPLE.COM'); // dup after lowercasing
    hostnames.push('not a hostname');
    const result = normalizeCtResponse({ matches: [match({ hostnames })] }, 'src');
    const out = result.candidates[0].certificateTransparency.hostnames;
    assert.equal(out.length, bounds.MAX_CT_HOSTNAMES);
    assert.deepStrictEqual([...out], [...out].sort());
    assert.equal(new Set(out).size, out.length);
  });

  test('malformed match domain drops that candidate only', () => {
    const result = normalizeCtResponse(
      { matches: [match({ domain: 'not a domain' }), match({ domain: 'good.com' })] },
      'src',
    );
    assert.deepStrictEqual(result.candidates.map((c) => c.domain), ['good.com']);
  });

  test('malformed hostname is dropped, candidate survives', () => {
    const result = normalizeCtResponse(
      { matches: [match({ hostnames: ['ok.example.com', 'bad host', 123] })] },
      'src',
    );
    assert.deepStrictEqual(result.candidates[0].certificateTransparency.hostnames, ['ok.example.com']);
  });

  test('malformed and overlong timestamps become null, candidate survives', () => {
    const long = '2026-01-01T00:00:00.000Z'.padEnd(200, '0');
    const result = normalizeCtResponse(
      { matches: [match({ firstObservedAt: 'not-a-date', lastObservedAt: long })] },
      'src',
    );
    const ct = result.candidates[0].certificateTransparency;
    assert.equal(ct.firstObservedAt, null);
    assert.equal(ct.lastObservedAt, null);
    // hostnames/count still carry the candidate
    assert.equal(result.candidates[0].domain, 'example.com');
  });

  test('malformed, negative, non-finite, and excessive certificate counts clamp', () => {
    assert.equal(normalizeCtResponse({ matches: [match({ certificateCount: -5 })] }, 's').candidates[0].certificateTransparency.certificateCount, 0);
    assert.equal(normalizeCtResponse({ matches: [match({ certificateCount: Infinity })] }, 's').candidates[0].certificateTransparency.certificateCount, 0);
    assert.equal(normalizeCtResponse({ matches: [match({ certificateCount: NaN })] }, 's').candidates[0].certificateTransparency.certificateCount, 0);
    assert.equal(normalizeCtResponse({ matches: [match({ certificateCount: '3' })] }, 's').candidates[0].certificateTransparency.certificateCount, 0);
    assert.equal(
      normalizeCtResponse({ matches: [match({ certificateCount: 9e12 })] }, 's').candidates[0].certificateTransparency.certificateCount,
      bounds.MAX_CT_CERTIFICATE_COUNT,
    );
  });

  test('candidate list is bounded', () => {
    const matches = [];
    for (let i = 0; i < bounds.MAX_CT_CANDIDATES + 25; i++) matches.push(match({ domain: `d${i}.com` }));
    const result = normalizeCtResponse({ matches }, 's');
    assert.equal(result.candidates.length, bounds.MAX_CT_CANDIDATES);
  });

  test('unknown keys are discarded', () => {
    const result = normalizeCtResponse({ matches: [match({ evil: 'x', __proto__: {} })] }, 's');
    assert.deepStrictEqual(Object.keys(result.candidates[0].certificateTransparency).sort(), [
      'certificateCount', 'firstObservedAt', 'hostnames', 'lastObservedAt',
    ]);
    assert.ok(!('evil' in result.candidates[0]));
  });

  test('does not mutate the input response', () => {
    const response = { certCount: 2, truncated: true, matches: [match()] };
    const copy = JSON.parse(JSON.stringify(response));
    normalizeCtResponse(response, 'src');
    assert.deepStrictEqual(response, copy);
  });

  test('valid empty matches array is authoritative', () => {
    const result = normalizeCtResponse({ domains: ['a.example.com', 'b.example.com'], matches: [] }, 's');
    assert.deepStrictEqual(result.candidates, []);
  });
});

// ---------------------------------------------------------------------------
// Input-processing caps (bound work, not just output) + local truncation
// ---------------------------------------------------------------------------

describe('input-processing caps', () => {
  test('an oversized matches array is capped and reports truncation', () => {
    const matches = [];
    for (let i = 0; i < bounds.MAX_CT_INPUT_MATCHES + 100; i++) matches.push(match({ domain: `d${i}.com`, lastObservedAt: null, firstObservedAt: null }));
    const result = normalizeCtResponse({ matches }, 's');
    assert.equal(result.truncated, true);
    assert.ok(result.candidates.length <= bounds.MAX_CT_CANDIDATES);
  });

  test('a match with an oversized hostname array reports truncation', () => {
    const hostnames = [];
    for (let i = 0; i < bounds.MAX_CT_INPUT_HOSTNAMES + 10; i++) hostnames.push(`h${i}.example.com`);
    const result = normalizeCtResponse({ matches: [match({ hostnames })] }, 's');
    assert.equal(result.truncated, true);
    assert.equal(result.candidates[0].certificateTransparency.hostnames.length, bounds.MAX_CT_HOSTNAMES);
  });

  test('backend truncated flag is preserved even without a local cap hit', () => {
    assert.equal(normalizeCtResponse({ matches: [match()], truncated: true }, 's').truncated, true);
  });
});

// ---------------------------------------------------------------------------
// Malformed responses
// ---------------------------------------------------------------------------

describe('malformed response handling', () => {
  test('missing or malformed matches fails clearly', () => {
    assert.throws(() => normalizeCtResponse({}, 's'), /malformed/i);
    assert.throws(() => normalizeCtResponse({ domains: ['old.example.com'] }, 's'), /malformed/i);
    assert.throws(() => normalizeCtResponse({ matches: 'nope' }, 's'), /malformed/i);
    assert.throws(() => normalizeCtResponse({ matches: null }, 's'), /malformed/i);
    assert.throws(() => normalizeCtResponse({ matches: { 0: match() } }, 's'), /malformed/i);
  });

  test('structured matches ignore unrelated top-level fields', () => {
    const result = normalizeCtResponse(
      { domains: ['unrelated.example.com'], matches: [match({ domain: 'structured.com' })] },
      's',
    );
    assert.deepStrictEqual(result.candidates.map((c) => c.domain), ['structured.com']);
  });
});

// ---------------------------------------------------------------------------
// Provenance validation used by the candidate handoff
// ---------------------------------------------------------------------------

describe('normalizeCtProvenance (handoff revalidation)', () => {
  test('non-object input is dropped', () => {
    assert.equal(normalizeCtProvenance('nope'), null);
    assert.equal(normalizeCtProvenance(null), null);
    assert.equal(normalizeCtProvenance(42), null);
  });

  test('empty-after-clean input is dropped', () => {
    assert.equal(normalizeCtProvenance({ hostnames: ['bad host'], firstObservedAt: 'x', certificateCount: -1 }), null);
  });

  test('round-trip is idempotent (save then load)', () => {
    const once = normalizeCtProvenance({
      hostnames: ['b.example.com', 'a.example.com', 'a.example.com'],
      firstObservedAt: '2026-01-01T00:00:00Z',
      lastObservedAt: '2026-02-01T00:00:00Z',
      certificateCount: 4,
      extra: 'discard-me',
    });
    const twice = normalizeCtProvenance(once);
    assert.deepStrictEqual(twice, once);
    assert.deepStrictEqual(once.hostnames, ['a.example.com', 'b.example.com']);
    assert.deepStrictEqual(Object.keys(once).sort(), ['certificateCount', 'firstObservedAt', 'hostnames', 'lastObservedAt']);
  });

  test('contradictory first/last observation ordering is corrected', () => {
    const ct = normalizeCtProvenance({ firstObservedAt: '2026-06-01T00:00:00Z', lastObservedAt: '2026-01-01T00:00:00Z' });
    assert.equal(ct.firstObservedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(ct.lastObservedAt, '2026-06-01T00:00:00.000Z');
  });
});

describe('mergeCtProvenance', () => {
  test('null-safe union', () => {
    const a = { hostnames: ['a.example.com'], firstObservedAt: '2026-02-01T00:00:00.000Z', lastObservedAt: '2026-03-01T00:00:00.000Z', certificateCount: 2 };
    assert.equal(mergeCtProvenance(a, null), a);
    assert.equal(mergeCtProvenance(null, a), a);
    assert.equal(mergeCtProvenance(null, null), null);
  });
});

// ---------------------------------------------------------------------------
// Filter helper
// ---------------------------------------------------------------------------

describe('ctCandidateMatchesFilter', () => {
  const candidate = { domain: 'example.com', certificateTransparency: { hostnames: ['login.example.com'], firstObservedAt: null, lastObservedAt: null, certificateCount: 1 } };
  test('empty filter matches', () => assert.equal(ctCandidateMatchesFilter(candidate, ''), true));
  test('matches canonical domain', () => assert.equal(ctCandidateMatchesFilter(candidate, 'example.c'), true));
  test('matches observed hostname', () => assert.equal(ctCandidateMatchesFilter(candidate, 'login'), true));
  test('non-match', () => assert.equal(ctCandidateMatchesFilter(candidate, 'zzz'), false));
  test('candidate without CT metadata still filters by domain', () => {
    assert.equal(ctCandidateMatchesFilter({ domain: 'plain.com' }, 'plain'), true);
    assert.equal(ctCandidateMatchesFilter({ domain: 'plain.com' }, 'login'), false);
  });
});
