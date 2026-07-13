const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let generator;
before(async () => {
  generator = await import('../frontend/src/lib/analysis/typosquat-generator.js');
});

describe('provenance-aware typosquat generation', () => {
  test('retains every mutation family that produces the same domain', () => {
    const candidates = generator.generateTyposquatCandidates('a.com', []);
    const qVariant = candidates.find((candidate) => candidate.domain === 'q.com');
    assert.ok(qVariant);
    assert.deepEqual(qVariant.mutationTypes.sort(), ['bitsquatting', 'keyboard_substitution']);
  });

  test('records source domain and candidate TLD', () => {
    const candidate = generator.generateTyposquatCandidates('acme.com', []).find((item) => item.domain === 'acm.com');
    assert.deepEqual(candidate, {
      domain: 'acm.com',
      source: 'acme.com',
      tld: 'com',
      mutationTypes: ['character_omission'],
    });
  });

  test('tracks same-name TLD typos separately', () => {
    const candidate = generator.generateTyposquatCandidates('acme.com', []).find((item) => item.domain === 'acme.cm');
    assert.deepEqual(candidate.mutationTypes, ['tld_typo']);
    assert.equal(candidate.tld, 'cm');
  });

  test('expands a domain seed across selected alternate TLDs', () => {
    const candidates = generator.generateTyposquatCandidates('acme.com', ['com', 'net', 'org']);
    assert.deepEqual(candidates.find((candidate) => candidate.domain === 'acme.net'), {
      domain: 'acme.net',
      source: 'acme.com',
      tld: 'net',
      mutationTypes: ['tld_substitution'],
    });
    assert.equal(candidates.some((candidate) => candidate.domain === 'acme.com'), false);
  });

  test('retains both label and TLD mutation provenance when both change', () => {
    const candidate = generator.generateTyposquatCandidates('acme.com', ['net'])
      .find((item) => item.domain === 'acm.net');
    assert.deepEqual(candidate.mutationTypes, ['character_omission', 'tld_substitution']);
  });

  test('merges selected substitutions with same-name TLD typo provenance', () => {
    const candidate = generator.generateTyposquatCandidates('acme.com', ['co'])
      .find((item) => item.domain === 'acme.co');
    assert.deepEqual(candidate.mutationTypes, ['tld_typo', 'tld_substitution']);
  });

  test('counts the source TLD inside the bounded selected TLD set', () => {
    const fallbackTlds = Array.from({ length: generator.MAX_GENERATION_TLDS }, (_, index) =>
      `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
    );
    const result = generator.generateTyposquatCandidateSet('acme.com', fallbackTlds);
    const substitutionTlds = new Set(result.candidates
      .filter((candidate) => candidate.mutationTypes.includes('tld_substitution'))
      .map((candidate) => candidate.tld));
    assert.equal(substitutionTlds.size, generator.MAX_GENERATION_TLDS - 1);
    assert.equal(substitutionTlds.has(fallbackTlds.at(-1)), false);
    assert.equal(result.truncated, true);
    assert.ok(result.limitReasons.includes('tlds'));
  });

  test('keeps the historical string-only wrapper compatible', () => {
    const rich = generator.generateTyposquatCandidates('acme', ['com', 'net']).map((candidate) => candidate.domain);
    assert.deepEqual(generator.generateTyposquatVariants('acme', ['com', 'net']), rich);
  });

  test('rejects invalid edge-hyphen labels produced by mutation families', () => {
    const result = generator.generateTyposquatCandidateSet('m.com', []);
    assert.equal(result.candidates.some((candidate) => candidate.domain === '-.com'), false);
    assert.ok(result.rejectedVariantCount > 0);
  });

  test('every generated domain contains bounded valid labels', () => {
    const result = generator.generateTyposquatCandidateSet('security-example', ['com', 'net']);
    assert.ok(result.candidates.length > 0);
    for (const candidate of result.candidates) {
      assert.ok(candidate.domain.length <= 253);
      for (const label of candidate.domain.split('.')) {
        assert.match(label, /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
      }
    }
  });

  test('caps unique candidates and reports the limiting boundary', () => {
    const tlds = Array.from({ length: 20 }, (_, index) =>
      `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
    );
    const result = generator.generateTyposquatCandidateSet('acme', tlds);
    assert.equal(result.candidates.length, generator.MAX_GENERATED_CANDIDATES);
    assert.equal(result.truncated, true);
    assert.ok(result.limitReasons.includes('candidates'));
  });

  test('caps the TLD set before building the candidate cross-product', () => {
    const tlds = Array.from({ length: generator.MAX_GENERATION_TLDS + 5 }, (_, index) =>
      `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
    );
    const result = generator.generateTyposquatCandidateSet('x', tlds);
    assert.equal(new Set(result.candidates.map((candidate) => candidate.tld)).size, generator.MAX_GENERATION_TLDS);
    assert.equal(result.truncated, true);
    assert.ok(result.limitReasons.includes('tlds'));
  });

  test('returns a stable diagnostic contract for invalid inputs', () => {
    for (const input of ['', 'a'.repeat(64), 'example.co.uk', 'bad\nlabel', null, {}, []]) {
      const result = generator.generateTyposquatCandidateSet(input, ['com']);
      assert.equal(result.version, 1);
      assert.equal(result.inputValid, false);
      assert.deepEqual(result.candidates, []);
      assert.equal(result.truncated, false);
    }
  });

  test('normalizes and deduplicates bounded fallback TLDs', () => {
    const result = generator.generateTyposquatCandidateSet('acme', ['COM', '.com', ' net ', 'invalid!', 7, null]);
    assert.deepEqual([...new Set(result.candidates.map((candidate) => candidate.tld))], ['com', 'net']);
  });

  test('does not mutate caller inputs', () => {
    const tlds = ['COM', '.net', 'org'];
    const before = structuredClone(tlds);
    generator.generateTyposquatCandidateSet('acme', tlds);
    assert.deepEqual(tlds, before);
  });

  test('produces deterministic candidates and diagnostics', () => {
    const first = generator.generateTyposquatCandidateSet('example.com', []);
    const second = generator.generateTyposquatCandidateSet('example.com', []);
    assert.deepEqual(second, first);
  });

  test('reports the public generation limits in its result metadata', () => {
    const result = generator.generateTyposquatCandidateSet('acme', ['com']);
    assert.deepEqual(result.limits, {
      tlds: generator.MAX_GENERATION_TLDS,
      nameVariants: generator.MAX_NAME_VARIANTS,
      candidates: generator.MAX_GENERATED_CANDIDATES,
    });
  });
});
