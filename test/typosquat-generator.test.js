const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let generator;
before(async () => {
  generator = await import('../public/js/typosquat-generator.js');
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

  test('keeps the historical string-only wrapper compatible', () => {
    const rich = generator.generateTyposquatCandidates('acme', ['com', 'net']).map((candidate) => candidate.domain);
    assert.deepEqual(generator.generateTyposquatVariants('acme', ['com', 'net']), rich);
  });
});
