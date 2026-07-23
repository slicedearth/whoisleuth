const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const { domainToASCII } = require('url');

let idn;
before(async () => {
  idn = await import('../frontend/src/lib/analysis/idn-confusables.js');
});

describe('punycode decoding and dual domain representation', () => {
  test('decodes a known internationalized label without a runtime dependency', () => {
    assert.equal(idn.decodePunycodeLabel('mnchen-3ya'), 'münchen');
    assert.equal(idn.unicodeDomainFromAscii('xn--mnchen-3ya.de'), 'münchen.de');
  });

  test('matches the platform IDNA conversion for representative non-Latin labels', () => {
    for (const unicode of ['中国.cn', 'пример.рф', '日本語.jp', 'παράδειγμα.test']) {
      const ascii = domainToASCII(unicode);
      assert.ok(ascii);
      assert.equal(idn.unicodeDomainFromAscii(ascii), unicode.normalize('NFC'));
    }
  });

  test('preserves ordinary ASCII labels around an internationalized label', () => {
    assert.equal(idn.unicodeDomainFromAscii('login.xn--bcher-kva.example'), 'login.bücher.example');
  });

  test('normalizes Unicode and ACE input to the same analysis identity', () => {
    const fromUnicode = idn.analyzeDomainIdn('BÜCHER.example.');
    const fromAscii = idn.analyzeDomainIdn('xn--bcher-kva.example');
    assert.equal(fromUnicode.asciiDomain, fromAscii.asciiDomain);
    assert.equal(fromUnicode.unicodeDomain, fromAscii.unicodeDomain);
    assert.equal(fromUnicode.skeleton, fromAscii.skeleton);
  });

  test('rejects malformed, oversized, and unsafe inputs', () => {
    assert.equal(idn.decodePunycodeLabel(''), null);
    assert.equal(idn.decodePunycodeLabel('bad!value'), null);
    assert.equal(idn.unicodeDomainFromAscii('not a domain'), null);
    assert.equal(idn.analyzeDomainIdn('localhost'), null);
    assert.equal(idn.analyzeDomainIdn(`a${'b'.repeat(64)}.example`), null);
  });
});

describe('script analysis', () => {
  test('detects a Latin and Cyrillic mixture within one label', () => {
    const result = idn.analyzeDomainIdn(domainToASCII('раypal.com'));
    assert.equal(result.hasIdn, true);
    assert.equal(result.mixedScript, true);
    assert.deepEqual(result.labels[0].scripts, ['Cyrillic', 'Latin']);
    assert.ok(result.findings.some((finding) => finding.id === 'mixed_script_label'));
  });

  test('does not flag a legitimate same-script accented label as mixed', () => {
    const result = idn.analyzeDomainIdn(domainToASCII('café.example'));
    assert.equal(result.hasIdn, true);
    assert.equal(result.mixedScript, false);
    assert.deepEqual(result.labels[0].scripts, ['Latin']);
  });

  test('does not flag a single-script Cyrillic label as mixed', () => {
    const result = idn.analyzeDomainIdn(domainToASCII('пример.example'));
    assert.equal(result.mixedScript, false);
    assert.deepEqual(result.labels[0].scripts, ['Cyrillic']);
  });

  test('treats Han, Hiragana, and Katakana as a compatible Japanese label', () => {
    const result = idn.analyzeDomainIdn(domainToASCII('日本ごカナ.jp'));
    assert.equal(result.mixedScript, false);
    assert.deepEqual(result.labels[0].scripts, ['Han', 'Hiragana', 'Katakana']);
  });

  test('does not confuse scripts used by different labels with mixed-script labels', () => {
    const result = idn.analyzeDomainIdn(domainToASCII('日本語.example'));
    assert.deepEqual(result.scripts, ['Han', 'Latin']);
    assert.equal(result.mixedScript, false);
  });
});

describe('versioned visual skeleton comparison', () => {
  test('matches a mixed-script lookalike to an official ASCII domain', () => {
    const result = idn.analyzeDomainIdn(domainToASCII('раypal.com'), ['paypal.com']);
    assert.equal(result.version, 1);
    assert.equal(result.mappingVersion, 'tr39-17.0.0-bounded-ascii-v3');
    assert.equal(result.skeleton, 'paypal.com');
    assert.deepEqual(result.referenceMatches.map((match) => match.asciiDomain), ['paypal.com']);
    assert.ok(result.findings.some((finding) => finding.id === 'official_skeleton_match'));
  });

  test('supports same-script accent folding while retaining a cautious finding', () => {
    const result = idn.analyzeDomainIdn(domainToASCII('café.example'), ['cafe.example']);
    assert.equal(result.mixedScript, false);
    assert.deepEqual(result.referenceMatches.map((match) => match.asciiDomain), ['cafe.example']);
    assert.match(result.findings.at(-1).detail, /similarity evidence, not proof/i);
  });

  test('does not match an unrelated official domain', () => {
    const result = idn.analyzeDomainIdn(domainToASCII('bücher.example'), ['library.example']);
    assert.deepEqual(result.referenceMatches, []);
  });

  test('normalizes full-width presentation forms before skeleton comparison', () => {
    assert.equal(idn.unicodeSkeleton('ｐａｙｐａｌ.com'), 'paypal.com');
  });

  test('matches a newly curated Coptic lookalike with explicit script provenance', () => {
    const ascii = domainToASCII('ⲥope.example');
    const result = idn.analyzeDomainIdn(ascii, ['cope.example']);
    assert.equal(result.mappingVersion, 'tr39-17.0.0-bounded-ascii-v3');
    assert.equal(result.skeleton, 'cope.example');
    assert.deepEqual(result.labels[0].scripts, ['Coptic', 'Latin']);
    assert.deepEqual(result.referenceMatches.map((match) => match.asciiDomain), ['cope.example']);
  });

  test('maps selected Unicode 17 additions without broad compatibility folding', () => {
    assert.equal(idn.unicodeSkeleton('ᴄꭇᴏꭎᴠᴡʏ'), 'crouvwy');
    assert.equal(idn.unicodeSkeleton('քւց'), 'fig');
  });

  test('matches generated mixed-script and whole-label additions', () => {
    const mixed = idn.analyzeDomainIdn(domainToASCII('𐑈ecure.example'), ['secure.example']);
    assert.equal(mixed.skeleton, 'secure.example');
    assert.deepEqual(mixed.referenceMatches.map((match) => match.asciiDomain), ['secure.example']);

    const whole = idn.analyzeDomainIdn(domainToASCII('քւց.example'), ['fig.example']);
    assert.equal(whole.skeleton, 'fig.example');
    assert.deepEqual(whole.labels[0].scripts, ['Armenian']);
    assert.deepEqual(whole.referenceMatches.map((match) => match.asciiDomain), ['fig.example']);
  });

  test('bounds reference processing and reports truncation', () => {
    const references = Array.from({ length: 60 }, (_, index) => `unrelated-${index}.example`);
    const result = idn.analyzeDomainIdn(domainToASCII('café.example'), references);
    assert.equal(result.truncated, true);
    assert.deepEqual(result.referenceMatches, []);
  });

  test('does not mutate the reference array', () => {
    const references = ['paypal.com'];
    const before = structuredClone(references);
    idn.analyzeDomainIdn(domainToASCII('раypal.com'), references);
    assert.deepEqual(references, before);
  });
});

describe('shared candidate-generation mapping', () => {
  test('provides a bounded deterministic set for supported ASCII characters', () => {
    assert.deepEqual(idn.confusableCharactersForAscii('A'), ['а', 'α', 'ɑ']);
    assert.deepEqual(idn.confusableCharactersForAscii('c'), ['с', 'ᴄ', 'ⲥ', '𐐽']);
    assert.deepEqual(idn.confusableCharactersForAscii('i'), ['і', 'ι', 'ı', 'ɪ', 'ɩ', 'ⲓ', 'ꙇ', 'ւ']);
    assert.deepEqual(idn.confusableCharactersForAscii('g'), ['ɡ', 'ƍ', 'ᶃ', 'ց']);
    assert.deepEqual(idn.confusableCharactersForAscii('?'), []);
    for (const character of 'abcdefghijklmnopqrstuvwxyz') {
      const substitutions = idn.confusableCharactersForAscii(character);
      assert.ok(substitutions.length <= 8, character);
      assert.equal(new Set(substitutions).size, substitutions.length, character);
      for (const substitution of substitutions) {
        assert.ok(domainToASCII(`${substitution}.example`).startsWith('xn--'), `${character}: ${substitution}`);
        assert.equal(idn.unicodeSkeleton(substitution), character, `${character}: ${substitution}`);
      }
    }
    const mutableCopy = idn.confusableCharactersForAscii('c');
    mutableCopy.push('x');
    assert.deepEqual(idn.confusableCharactersForAscii('c'), ['с', 'ᴄ', 'ⲥ', '𐐽']);
  });

  test('builds deterministic whole-label candidates from one reviewed script', () => {
    assert.deepEqual(idn.wholeLabelConfusableVariantsForAscii('scope'), [
      { unicodeLabel: 'ѕсоре', script: 'Cyrillic' },
    ]);
    assert.deepEqual(idn.wholeLabelConfusableVariantsForAscii('fig'), [
      { unicodeLabel: 'քւց', script: 'Armenian' },
    ]);
  });

  test('requires at least two replaceable letters and caps whole-label output', () => {
    for (const input of ['', 'a', '-scope', 'bad_label', 'secure', null]) {
      assert.deepEqual(idn.wholeLabelConfusableVariantsForAscii(input), [], String(input));
    }
    const variants = idn.wholeLabelConfusableVariantsForAscii('scope');
    assert.ok(variants.length <= 6);
    assert.equal(Object.isFrozen(variants[0]), true);
  });

  test('builds deterministic two-character candidates within one reviewed script', () => {
    const result = idn.advancedConfusableVariantsForAscii('scope');
    assert.equal(result.eligibleVariantCount, 59);
    assert.equal(result.variants.length, 59);
    assert.equal(result.omittedByPolicy, 225);
    assert.equal(result.omittedByBudget, 0);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.variants), true);
    assert.ok(result.variants.some((variant) => variant.visualClass === 'reviewed'));
    assert.ok(result.variants.some((variant) => variant.visualClass === 'projected'));
    for (const variant of result.variants) {
      assert.equal([...variant.unicodeLabel].filter((character, index) => character !== 'scope'[index]).length, 2);
      assert.equal(idn.unicodeSkeleton(variant.unicodeLabel), 'scope');
      assert.match(variant.script, /^(Armenian|Coptic|Cyrillic|Deseret|Greek|Latin|Lisu)$/);
    }
    assert.deepEqual(
      idn.advancedConfusableVariantsForAscii('scope'),
      result,
    );
  });

  test('caps advanced output independently and reports policy and budget omissions', () => {
    const result = idn.advancedConfusableVariantsForAscii('oooooooooooo');
    assert.equal(result.eligibleVariantCount, 1056);
    assert.equal(result.variants.length, idn.MAX_ADVANCED_CONFUSABLE_VARIANTS);
    assert.equal(result.omittedByPolicy, 3168);
    assert.equal(result.omittedByBudget, 800);
    assert.deepEqual(idn.estimateAdvancedConfusableVariants('oooooooooooo'), {
      eligibleVariantCount: 1056,
      omittedByPolicy: 3168,
      omittedByBudget: 800,
    });
    for (const input of ['', 'a', '-scope', 'bad_label', null]) {
      assert.deepEqual(idn.advancedConfusableVariantsForAscii(input), {
        variants: [],
        eligibleVariantCount: 0,
        omittedByPolicy: 0,
        omittedByBudget: 0,
      }, String(input));
    }
  });
});
