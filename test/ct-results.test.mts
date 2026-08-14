import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as bounds from '../frontend/src/lib/analysis/ct-results.ts';
import { requiredValue } from './value-assertions.mts';

const {
  ctCandidateMatchesFilter,
  mergeCtProvenance,
  normalizeCtProvenance,
  normalizeCtResponse: normalizeRawCtResponse,
} = bounds;

function normalizeCtResponse(response: Record<string, unknown>, source: string) {
  return normalizeRawCtResponse({
    keyword: source,
    certCount: 100,
    truncated: false,
    certificateGroupsTruncated: false,
    ...response,
  }, source);
}

function normalizeCompleteRawCtResponse(response: Record<string, unknown>, source: string) {
  return normalizeRawCtResponse({
    keyword: source,
    truncated: false,
    certificateGroupsTruncated: false,
    ...response,
  }, source);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function match(overrides: Record<string, unknown> = {}) {
  return {
    domain: 'example.com',
    hostnames: ['a.example.com'],
    firstObservedAt: '2026-01-01T00:00:00.000Z',
    lastObservedAt: '2026-06-01T00:00:00.000Z',
    certificateCount: 3,
    ...overrides,
  };
}

function firstCandidate(result: bounds.CtNormalizationResult): bounds.CtCandidate {
  return requiredValue(result.candidates[0]);
}

function firstCt(result: bounds.CtNormalizationResult): bounds.CtProvenance {
  return requiredValue(firstCandidate(result).certificateTransparency);
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
    assert.deepStrictEqual(result.certificateGroups, []);
    assert.equal(result.certificateGroupsTruncated, false);
    const candidate = firstCandidate(result);
    assert.equal(candidate.domain, 'example.com');
    assert.equal(candidate.source, 'example');
    assert.deepStrictEqual(candidate.mutationTypes, ['certificate_transparency']);
    assert.deepStrictEqual(requiredValue(candidate.certificateTransparency).hostnames, ['a.example.com']);
    assert.equal(requiredValue(candidate.certificateTransparency).certificateCount, 3);
  });

  test('normalizes bounded certificate issuance groups', () => {
    const result = normalizeCtResponse({
      matches: [match()],
      certificateGroups: [{
        certificateKey: 'id:42',
        domains: ['example.com', 'example.net', 'bad host'],
        hostnames: ['login.example.com', 'www.example.net'],
        observedAt: '2026-06-02T00:00:00Z',
        wildcardObserved: true,
        ignored: 'value',
      }],
    }, 'src');
    assert.deepStrictEqual(result.certificateGroups, [{
      certificateKey: 'id:42',
      domains: ['example.com', 'example.net'],
      hostnames: ['login.example.com', 'www.example.net'],
      observedAt: '2026-06-02T00:00:00.000Z',
      wildcardObserved: true,
    }]);
    assert.equal(result.certificateGroupsTruncated, true);
  });

  test('rejects certificate-group cardinality that exceeds the aggregate count', () => {
    assert.throws(() => normalizeCompleteRawCtResponse({
      certCount: 0,
      matches: [],
      certificateGroups: [{ certificateKey: 'id:1', domains: ['one.example'] }],
    }, 'src'), /malformed/i);
    assert.throws(() => normalizeCompleteRawCtResponse({
      certCount: 1,
      matches: [match({ certificateCount: 1 })],
      certificateGroups: [
        { certificateKey: 'id:1', domains: ['one.example'] },
        { certificateKey: 'id:2', domains: ['two.example'] },
      ],
    }, 'src'), /malformed/i);

    const empty = normalizeCompleteRawCtResponse({ certCount: 0, matches: [], certificateGroups: [] }, 'src');
    assert.equal(empty.certCount, 0);
    assert.deepEqual(empty.certificateGroups, []);
    const one = normalizeCompleteRawCtResponse({
      certCount: 1,
      matches: [match({ certificateCount: 1 })],
      certificateGroups: [{ certificateKey: 'id:1', domains: ['one.example'] }],
    }, 'src');
    assert.equal(one.certificateGroups.length, 1);
    assert.equal(one.truncated, false);
  });

  test('drops malformed and duplicate certificate groups and reports bounded truncation', () => {
    const many = Array.from({ length: bounds.MAX_CT_GROUP_INPUT_ITEMS + 1 }, (_, index) => ({
      certificateKey: `id:${index + 1}`,
      domains: [`d${index}.example`],
      hostnames: [`d${index}.example`],
    }));
    const result = normalizeCtResponse({ matches: [match()], certificateGroups: many }, 'src');
    assert.equal(result.certificateGroups.length, bounds.MAX_CT_CERTIFICATE_GROUPS);
    assert.equal(result.certificateGroupsTruncated, true);
    assert.equal(result.truncated, false);
    const malformed = normalizeCtResponse({
      matches: [match()],
      certificateGroups: [{ certificateKey: 'bad key', domains: ['example.com'] }],
    }, 'src');
    assert.deepStrictEqual(malformed.certificateGroups, []);
    assert.equal(malformed.certificateGroupsTruncated, true);

    const malformedContainer = normalizeCtResponse({
      matches: [match()],
      certificateGroups: { certificateKey: 'id:1' },
    }, 'src');
    assert.deepStrictEqual(malformedContainer.certificateGroups, []);
    assert.equal(malformedContainer.certificateGroupsTruncated, true);

    const duplicate = normalizeCtResponse({
      matches: [match()],
      certificateGroups: [
        { certificateKey: 'id:1', domains: ['one.example'], hostnames: ['a.one.example'], observedAt: '2026-06-02T00:00:00Z', wildcardObserved: false },
        { certificateKey: 'id:1', domains: ['two.example'], hostnames: ['b.two.example'], observedAt: '2026-06-01T00:00:00Z', wildcardObserved: true },
      ],
    }, 'src');
    assert.deepStrictEqual(duplicate.certificateGroups, [{
      certificateKey: 'id:1',
      domains: ['one.example', 'two.example'],
      hostnames: ['a.one.example', 'b.two.example'],
      observedAt: '2026-06-01T00:00:00.000Z',
      wildcardObserved: true,
    }]);
    assert.equal(duplicate.certificateGroupsTruncated, false);
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
    const ct = firstCt(result);
    // union of hostnames, deduped + sorted
    assert.deepStrictEqual(ct.hostnames, ['a.example.com', 'b.example.com']);
    // earliest first observation
    assert.equal(ct.firstObservedAt, '2026-01-01T00:00:00.000Z');
    // latest last observation
    assert.equal(ct.lastObservedAt, '2026-05-01T00:00:00.000Z');
    // highest count, never a sum
    assert.equal(ct.certificateCount, 5);
  });

  test('marks duplicate-domain hostname union loss partial', () => {
    const left = Array.from({ length: bounds.MAX_CT_HOSTNAMES }, (_, index) => `a${index}.example.com`);
    const right = Array.from({ length: bounds.MAX_CT_HOSTNAMES }, (_, index) => `b${index}.example.com`);
    const result = normalizeCtResponse({
      matches: [match({ hostnames: left }), match({ hostnames: right })],
    }, 'src');
    assert.equal(firstCt(result).hostnames.length, bounds.MAX_CT_HOSTNAMES);
    assert.equal(result.truncated, true);
  });

  test('newest last-observation first, null timestamps last, alpha tiebreak', () => {
    const result = normalizeCtResponse(
      {
        matches: [
          match({ domain: 'older.example', lastObservedAt: '2026-01-01T00:00:00Z' }),
          match({ domain: 'newer.example', lastObservedAt: '2026-09-01T00:00:00Z' }),
          match({ domain: 'zeta.example', lastObservedAt: null, firstObservedAt: null }),
          match({ domain: 'alpha.example', lastObservedAt: null, firstObservedAt: null }),
        ],
      },
      'src',
    );
    assert.deepStrictEqual(
      result.candidates.map((c) => c.domain),
      ['newer.example', 'older.example', 'alpha.example', 'zeta.example'],
    );
  });

  test('hostnames are normalized, deduped, sorted, and bounded', () => {
    const hostnames = [];
    for (let i = 0; i < 60; i++) hostnames.push(`h${String(i).padStart(2, '0')}.example.com`);
    hostnames.push('H00.EXAMPLE.COM'); // dup after lowercasing
    hostnames.push('not a hostname');
    const result = normalizeCtResponse({ matches: [match({ hostnames })] }, 'src');
    const out = firstCt(result).hostnames;
    assert.equal(out.length, bounds.MAX_CT_HOSTNAMES);
    assert.deepStrictEqual([...out], [...out].sort());
    assert.equal(new Set(out).size, out.length);
    assert.equal(result.truncated, true);
  });

  test('malformed match domain drops that candidate only', () => {
    const result = normalizeCtResponse(
      { matches: [match({ domain: 'not a domain' }), match({ domain: 'good.com' })] },
      'src',
    );
    assert.deepStrictEqual(result.candidates.map((c) => c.domain), ['good.com']);
    assert.equal(result.truncated, true);
  });

  test('malformed hostname is dropped, candidate survives', () => {
    const result = normalizeCtResponse(
      { matches: [match({ hostnames: ['ok.example.com', 'bad host', 123] })] },
      'src',
    );
    assert.deepStrictEqual(firstCt(result).hostnames, ['ok.example.com']);
    assert.equal(result.truncated, true);
  });

  test('rejects URL-shaped source domains and hostnames without reinterpreting them', () => {
    const malformed = [
      'user@matched.example',
      'matched.example/private',
      'matched.example:443',
      'matched.example?query=1',
      'matched.example#fragment',
      'matched.example\\private',
    ];
    for (const value of malformed) {
      const domainResult = normalizeCtResponse({ matches: [match({ domain: value })] }, 'src');
      assert.deepStrictEqual(domainResult.candidates, [], value);
      assert.equal(domainResult.truncated, true, value);
      const hostnameResult = normalizeCtResponse({ matches: [match({ hostnames: [value] })] }, 'src');
      assert.deepStrictEqual(firstCt(hostnameResult).hostnames, [], value);
      assert.equal(hostnameResult.truncated, true, value);
    }
    const valid = normalizeCtResponse({ matches: [match({
      domain: 'BÜCHER.Example.',
      hostnames: ['WWW.BÜCHER.Example.'],
    })] }, 'src');
    assert.equal(firstCandidate(valid).domain, 'xn--bcher-kva.example');
    assert.deepStrictEqual(firstCt(valid).hostnames, ['www.xn--bcher-kva.example']);
  });

  test('rejects percent-encoded and over-bound evidence before URL parsing and marks the result partial', () => {
    for (const value of [
      '%65xample.com',
      'example%2ecom',
      `${'a'.repeat(252)}.example`,
      `${'a'.repeat(1_025)}.example`,
    ]) {
      const domainResult = normalizeCtResponse({ matches: [match({ domain: value })] }, 'src');
      assert.deepStrictEqual(domainResult.candidates, [], value);
      assert.equal(domainResult.truncated, true, value);
      const hostnameResult = normalizeCtResponse({ matches: [match({ hostnames: [value] })] }, 'src');
      assert.deepStrictEqual(firstCt(hostnameResult).hostnames, [], value);
      assert.equal(hostnameResult.truncated, true, value);
    }

    const decomposed = `${`${'e\u0301'.repeat(45)}.`.repeat(3)}example`;
    const canonical = new URL(`http://${decomposed}`).hostname;
    assert.ok(decomposed.length > 253);
    for (const value of [decomposed, `${decomposed}.`]) {
      const result = normalizeCtResponse({ matches: [match({ domain: value, hostnames: [value] })] }, 'src');
      assert.equal(firstCandidate(result).domain, canonical);
      assert.deepStrictEqual(firstCt(result).hostnames, [canonical]);
      assert.equal(result.truncated, false);
    }
  });

  test('malformed match records are omitted with explicit truncation', () => {
    const result = normalizeCtResponse({ matches: [null, match({ domain: 'good.example' })] }, 'src');
    assert.deepStrictEqual(result.candidates.map((candidate) => candidate.domain), ['good.example']);
    assert.equal(result.truncated, true);
  });

  test('malformed and overlong timestamps become null, candidate survives', () => {
    const long = '2026-01-01T00:00:00.000Z'.padEnd(200, '0');
    const result = normalizeCtResponse(
      { matches: [match({ firstObservedAt: 'not-a-date', lastObservedAt: long })] },
      'src',
    );
    const ct = firstCt(result);
    assert.equal(ct.firstObservedAt, null);
    assert.equal(ct.lastObservedAt, null);
    // hostnames/count still carry the candidate
    assert.equal(firstCandidate(result).domain, 'example.com');
    assert.equal(result.truncated, true);
  });

  test('marks malformed certificate-group timestamps and wildcard state incomplete', () => {
    const result = normalizeCtResponse({
      matches: [match()],
      certificateGroups: [{
        certificateKey: 'id:1',
        domains: ['example.com'],
        observedAt: 'not-a-date',
        wildcardObserved: 'false',
      }],
    }, 'src');
    assert.equal(result.certificateGroups[0]?.observedAt, null);
    assert.equal(result.certificateGroups[0]?.wildcardObserved, false);
    assert.equal(result.certificateGroupsTruncated, true);
  });

  test('malformed candidate counts remain unavailable while excessive valid counts are explicitly capped', () => {
    for (const certificateCount of [-5, 0, 0.5, Infinity, NaN, '3', undefined]) {
      const result = normalizeCtResponse({ matches: [match({ certificateCount })] }, 's');
      assert.equal(firstCandidate(result).certificateTransparency, null);
      assert.equal(result.truncated, true);
    }
    const capped = normalizeCompleteRawCtResponse({
      certCount: 9e12,
      matches: [match({ certificateCount: 9e12 })],
    }, 's');
    assert.equal(firstCt(capped).certificateCount, bounds.MAX_CT_CERTIFICATE_COUNT);
    assert.equal(capped.certCount, bounds.MAX_CT_CERTIFICATE_COUNT);
    assert.equal(capped.truncated, true);
  });

  test('candidate list is bounded', () => {
    const matches = [];
    for (let i = 0; i < bounds.MAX_CT_CANDIDATES + 25; i++) matches.push(match({ domain: `d${i}.com` }));
    const result = normalizeCtResponse({ matches }, 's');
    assert.equal(result.candidates.length, bounds.MAX_CT_CANDIDATES);
  });

  test('unknown keys are discarded', () => {
    const result = normalizeCtResponse({ matches: [match({ evil: 'x', __proto__: {} })] }, 's');
    assert.deepStrictEqual(Object.keys(firstCt(result)).sort(), [
      'certificateCount', 'firstObservedAt', 'hostnames', 'lastObservedAt',
    ]);
    assert.ok(!('evil' in firstCandidate(result)));
  });

  test('does not mutate the input response', () => {
    const response = { certCount: 3, truncated: true, matches: [match()] };
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
    assert.equal(firstCt(result).hostnames.length, bounds.MAX_CT_HOSTNAMES);
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
    assert.throws(() => normalizeCompleteRawCtResponse({}, 's'), /malformed/i);
    assert.throws(() => normalizeCompleteRawCtResponse({ certCount: 1, domains: ['old.example.com'] }, 's'), /malformed/i);
    assert.throws(() => normalizeCompleteRawCtResponse({ certCount: 1, matches: 'nope' }, 's'), /malformed/i);
    assert.throws(() => normalizeCompleteRawCtResponse({ certCount: 1, matches: null }, 's'), /malformed/i);
    assert.throws(() => normalizeCompleteRawCtResponse({ certCount: 1, matches: { 0: match() } }, 's'), /malformed/i);
  });

  test('missing or malformed aggregate counts fail rather than becoming a complete zero', () => {
    for (const certCount of [undefined, null, -1, 0.5, Infinity, NaN, '4']) {
      assert.throws(
        () => normalizeCompleteRawCtResponse({ matches: [match()], ...(certCount === undefined ? {} : { certCount }) }, 's'),
        /certificate count/iu,
      );
    }
  });

  test('rejects aggregate and candidate count contradictions while retaining valid zero and positive controls', () => {
    assert.deepEqual(normalizeCompleteRawCtResponse({ certCount: 0, matches: [] }, 's').candidates, []);
    assert.doesNotThrow(() => normalizeCompleteRawCtResponse({
      certCount: 3,
      matches: [match({ certificateCount: 3 })],
    }, 's'));
    assert.throws(() => normalizeCompleteRawCtResponse({
      certCount: 0,
      matches: [match({ certificateCount: 1 })],
    }, 's'), /exceed the aggregate/iu);
    assert.throws(() => normalizeCompleteRawCtResponse({
      certCount: 2,
      matches: [match({ certificateCount: 3 })],
    }, 's'), /exceed the aggregate/iu);
  });

  test('structured matches ignore unrelated top-level fields', () => {
    const result = normalizeCtResponse(
      { domains: ['unrelated.example.com'], matches: [match({ domain: 'structured.com' })] },
      's',
    );
    assert.deepStrictEqual(result.candidates.map((c) => c.domain), ['structured.com']);
  });

  test('binds the response keyword and treats omitted completeness flags as partial', () => {
    assert.throws(() => normalizeRawCtResponse({
      keyword: 'other', certCount: 0, matches: [], truncated: false,
      certificateGroupsTruncated: false,
    }, 'requested'), /requested keyword/iu);
    assert.throws(() => normalizeRawCtResponse({
      certCount: 0, matches: [], truncated: false, certificateGroupsTruncated: false,
    }, 'requested'), /requested keyword/iu);

    const missingTopLevel = normalizeRawCtResponse({
      keyword: 'requested', certCount: 0, matches: [], certificateGroupsTruncated: false,
    }, 'requested');
    assert.equal(missingTopLevel.truncated, true);
    const missingGroupFlag = normalizeRawCtResponse({
      keyword: 'requested', certCount: 0, matches: [], truncated: false,
    }, 'requested');
    assert.equal(missingGroupFlag.certificateGroupsTruncated, true);
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
    const once = requiredValue(normalizeCtProvenance({
      hostnames: ['b.example.com', 'a.example.com', 'a.example.com'],
      firstObservedAt: '2026-01-01T00:00:00Z',
      lastObservedAt: '2026-02-01T00:00:00Z',
      certificateCount: 4,
      extra: 'discard-me',
    }));
    const twice = normalizeCtProvenance(once);
    assert.deepStrictEqual(twice, once);
    assert.deepStrictEqual(once.hostnames, ['a.example.com', 'b.example.com']);
    assert.deepStrictEqual(Object.keys(once).sort(), ['certificateCount', 'firstObservedAt', 'hostnames', 'lastObservedAt']);
  });

  test('contradictory first/last observation ordering is corrected', () => {
    const ct = requiredValue(normalizeCtProvenance({ firstObservedAt: '2026-06-01T00:00:00Z', lastObservedAt: '2026-01-01T00:00:00Z', certificateCount: 1 }));
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
