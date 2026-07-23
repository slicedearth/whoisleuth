const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { domainToASCII } = require('node:url');

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

  test('generates newly curated IDNA-safe confusables with unchanged provenance', () => {
    const expected = domainToASCII('sⲥope.com');
    const result = generator.generateTyposquatCandidateSet('scope.com', [], { preset: 'impersonation' });
    assert.ok(expected.startsWith('xn--'));
    assert.deepEqual(result.candidates.find((candidate) => candidate.domain === expected), {
      domain: expected,
      source: 'scope.com',
      tld: 'com',
      mutationTypes: ['unicode_homoglyph'],
    });
  });

  test('generates bounded Unicode-projected additions with unchanged provenance', () => {
    const expected = domainToASCII('ցateway.com');
    const result = generator.generateTyposquatCandidateSet('gateway.com', [], { preset: 'impersonation' });
    assert.ok(expected.startsWith('xn--'));
    assert.deepEqual(result.candidates.find((candidate) => candidate.domain === expected), {
      domain: expected,
      source: 'gateway.com',
      tld: 'com',
      mutationTypes: ['unicode_homoglyph'],
    });
  });

  test('generates bounded whole-label Unicode candidates with additive provenance', () => {
    const expected = domainToASCII('ѕсоре.invalid');
    const result = generator.generateTyposquatCandidateSet('scope.invalid', [], { preset: 'impersonation' });
    assert.deepEqual(result.candidates.find((candidate) => candidate.domain === expected), {
      domain: expected,
      source: 'scope.invalid',
      tld: 'invalid',
      mutationTypes: ['unicode_homoglyph', 'unicode_whole_label'],
    });
    assert.ok(generator.estimateTyposquatCandidateCount('scope.invalid', [], { preset: 'impersonation' }).estimatedMaximum >= result.candidates.length);
  });

  test('generates the advanced two-character family only when explicitly selected', () => {
    const options = {
      preset: 'custom',
      mutationTypes: ['unicode_homoglyph_depth_2'],
    };
    const result = generator.generateTyposquatCandidateSet('scope.invalid', [], options);
    assert.equal(result.candidates.length, 59);
    assert.ok(result.candidates.every((candidate) =>
      candidate.mutationTypes.length === 1
      && candidate.mutationTypes[0] === 'unicode_homoglyph_depth_2'));
    assert.deepEqual(result.advancedConfusable, {
      generated: 59,
      omittedByPolicy: 225,
      omittedByBudget: 0,
    });
    assert.equal(result.truncated, false);
    assert.ok(generator.estimateTyposquatCandidateCount('scope.invalid', [], options).estimatedMaximum >= result.candidates.length);
  });

  test('caps advanced two-character variants and exposes the exact omissions', () => {
    const result = generator.generateTyposquatCandidateSet('oooooooooooo.invalid', [], {
      preset: 'custom',
      mutationTypes: ['unicode_homoglyph_depth_2'],
    });
    assert.equal(result.candidates.length, generator.MAX_ADVANCED_CONFUSABLE_VARIANTS);
    assert.deepEqual(result.advancedConfusable, {
      generated: generator.MAX_ADVANCED_CONFUSABLE_VARIANTS,
      omittedByPolicy: 3168,
      omittedByBudget: 800,
    });
    assert.equal(result.truncated, true);
    assert.ok(result.limitReasons.includes('family:unicode_homoglyph_depth_2'));
  });

  test('caps unique candidates and reports the limiting boundary', () => {
    const tlds = Array.from({ length: 20 }, (_, index) =>
      `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
    );
    const result = generator.generateTyposquatCandidateSet('acme', tlds);
    assert.equal(result.candidates.length, generator.MAX_GENERATED_CANDIDATES);
    assert.equal(result.truncated, true);
    assert.ok(result.limitReasons.includes('candidates'));
    assert.ok(result.candidates.some((candidate) =>
      candidate.domain === 'login-acme.aa' && candidate.mutationTypes.includes('dictionary')));
    assert.ok(result.candidates.some((candidate) => candidate.mutationTypes.includes('unicode_homoglyph')));
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

  test('inserts hyphens only at valid internal label boundaries', () => {
    const result = generator.generateTyposquatCandidateSet('acme.com', [], { preset: 'common' });
    for (const domain of ['a-cme.com', 'ac-me.com', 'acm-e.com']) {
      assert.deepEqual(result.candidates.find((candidate) => candidate.domain === domain)?.mutationTypes, ['hyphenation']);
    }
    assert.equal(result.candidates.some((candidate) => candidate.domain.startsWith('-.')), false);
    assert.equal(result.candidates.some((candidate) => candidate.domain.includes('--')), false);
  });

  test('adds bounded suffix and word-boundary characters with explicit provenance', () => {
    const result = generator.generateTyposquatCandidateSet('acme-pay.com', [], { preset: 'common' });
    for (const domain of ['acme-pay0.com', 'acmea-pay.com']) {
      assert.ok(result.candidates.some((candidate) =>
        candidate.domain === domain && candidate.mutationTypes.includes('character_addition')));
    }
    assert.equal(result.limitReasons.includes('family:character_addition'), false);
  });

  test('generates conservative plural, TLD-embedded, and WWW-style forms', () => {
    const result = generator.generateTyposquatCandidateSet('acme-shop.net', ['net', 'org'], { preset: 'common' });
    for (const [domain, mutationType] of [
      ['acme-shops.net', 'pluralization'],
      ['acmeshops.net', 'pluralization'],
      ['acme-shopnet.net', 'tld_embedding'],
      ['acme-shop-net.net', 'tld_embedding'],
      ['www-acme-shop.net', 'www_prefix'],
    ]) {
      assert.ok(result.candidates.some((candidate) =>
        candidate.domain === domain && candidate.mutationTypes.includes(mutationType)), domain);
    }
    assert.equal(result.candidates.some((candidate) => candidate.domain.endsWith('.com')), false);
  });

  test('prioritizes analyst dictionary terms fairly when the global cap applies', () => {
    const tlds = Array.from({ length: 20 }, (_, index) =>
      `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
    );
    const result = generator.generateTyposquatCandidateSet('acme', tlds, {
      preset: 'all',
      dictionaryTerms: ['invoice'],
    });
    assert.ok(result.candidates.some((candidate) =>
      candidate.domain === 'invoice-acme.aa' && candidate.mutationTypes.includes('dictionary')));
    assert.ok(result.candidates.some((candidate) => candidate.mutationTypes.includes('character_addition')));
    assert.ok(result.candidates.some((candidate) => candidate.mutationTypes.includes('ascii_homoglyph')));
  });

  test('removes one or all existing separators with explicit provenance', () => {
    const result = generator.generateTyposquatCandidateSet('acme-pay-login.com', [], { preset: 'common' });
    assert.ok(result.candidates.some((candidate) =>
      candidate.domain === 'acmepaylogin.com' && candidate.mutationTypes.includes('separator_omission')));
    assert.ok(result.candidates.some((candidate) =>
      candidate.domain === 'acmepay-login.com' && candidate.mutationTypes.includes('separator_omission')));
    assert.ok(result.candidates.some((candidate) =>
      candidate.domain === 'acme-paylogin.com' && candidate.mutationTypes.includes('separator_omission')));
  });

  test('preserves bounded word boundaries and generates deterministic reordered forms', () => {
    const result = generator.generateTyposquatCandidateSet('Acme Pay', ['com'], { preset: 'common' });
    assert.deepEqual(result.candidates.find((candidate) => candidate.domain === 'acme-pay.com'), {
      domain: 'acme-pay.com',
      source: 'acmepay',
      tld: 'com',
      mutationTypes: ['hyphenation'],
    });
    for (const domain of ['payacme.com', 'pay-acme.com']) {
      assert.deepEqual(result.candidates.find((candidate) => candidate.domain === domain)?.mutationTypes, ['word_reordering']);
    }
  });

  test('reorders hyphenated domain tokens without mislabelling the original order', () => {
    const result = generator.generateTyposquatCandidateSet('acme-pay.com', [], { preset: 'common' });
    assert.ok(result.candidates.some((candidate) =>
      candidate.domain === 'pay-acme.com' && candidate.mutationTypes.includes('word_reordering')));
    const joinedOriginal = result.candidates.find((candidate) => candidate.domain === 'acmepay.com');
    assert.ok(joinedOriginal);
    assert.ok(joinedOriginal.mutationTypes.includes('separator_omission'));
    assert.equal(joinedOriginal.mutationTypes.includes('word_reordering'), false);
  });

  test('caps four-token word permutations and reports the family boundary', () => {
    const result = generator.generateTyposquatCandidateSet('one two three four', ['com'], { preset: 'common' });
    assert.equal(result.truncated, true);
    assert.ok(result.limitReasons.includes('family:word_reordering'));
    assert.ok(result.candidates.some((candidate) => candidate.domain === 'one-two-four-three.com'));
  });

  test('multi-word estimates remain an upper bound for generated separator forms', () => {
    for (const input of ['Acme Pay', 'acme-pay.com', 'one two three four']) {
      const estimate = generator.estimateTyposquatCandidateCount(input, ['com'], { preset: 'common' });
      const result = generator.generateTyposquatCandidateSet(input, ['com'], { preset: 'common' });
      assert.ok(estimate.estimatedMaximum >= result.candidates.length, input);
    }
  });

  test('generates a bounded curated set of joined and hyphenated impersonation terms', () => {
    const result = generator.generateTyposquatCandidateSet('acme.com', [], { preset: 'impersonation' });
    const dictionaryCandidates = result.candidates.filter((candidate) => candidate.mutationTypes.includes('dictionary'));
    assert.equal(dictionaryCandidates.length, 100);
    for (const domain of [
      'signin-acme.com',
      'acmehelpdesk.com',
      'password-reset-acme.com',
      'acme-account-recovery.com',
    ]) {
      assert.ok(dictionaryCandidates.some((candidate) => candidate.domain === domain), domain);
    }
    assert.equal(result.limitReasons.includes('family:dictionary'), false);
  });

  test('keeps expanded dictionary generation deterministic and inside its estimate', () => {
    const options = { preset: 'impersonation' };
    const first = generator.generateTyposquatCandidateSet('acme.com', ['com', 'net'], options);
    const second = generator.generateTyposquatCandidateSet('acme.com', ['com', 'net'], options);
    const estimate = generator.estimateTyposquatCandidateCount('acme.com', ['com', 'net'], options);
    assert.deepEqual(second, first);
    assert.ok(estimate.estimatedMaximum >= first.candidates.length);
    assert.equal(estimate.mayReachLimit, false);
  });

  test('accepts bounded analyst dictionary terms without mutating the caller', () => {
    const dictionaryTerms = ['invoice', 'Support', 'invoice', 'bad value!', 7];
    const before = structuredClone(dictionaryTerms);
    const options = { preset: 'impersonation', dictionaryTerms };
    const result = generator.generateTyposquatCandidateSet('acme.com', [], options);
    assert.ok(result.candidates.some((candidate) =>
      candidate.domain === 'invoice-acme.com' && candidate.mutationTypes.includes('dictionary')));
    assert.ok(result.candidates.some((candidate) =>
      candidate.domain === 'acmesupport.com' && candidate.mutationTypes.includes('dictionary')));
    assert.equal(result.candidates.some((candidate) => candidate.domain.includes('bad value')), false);
    assert.deepEqual(dictionaryTerms, before);
    assert.ok(generator.estimateTyposquatCandidateCount('acme.com', [], options).estimatedMaximum >= result.candidates.length);
  });

  test('replaces only the first or last explicit token with analyst dictionary terms', () => {
    const dictionaryTerms = ['account', 'support'];
    const options = {
      preset: 'custom',
      mutationTypes: ['dictionary_token_replacement'],
      dictionaryTerms,
    };
    const result = generator.generateTyposquatCandidateSet('alpha-portal.invalid', [], options);
    assert.deepEqual(result.candidates, [
      {
        domain: 'account-portal.invalid',
        source: 'alpha-portal.invalid',
        tld: 'invalid',
        mutationTypes: ['dictionary_token_replacement'],
      },
      {
        domain: 'alpha-account.invalid',
        source: 'alpha-portal.invalid',
        tld: 'invalid',
        mutationTypes: ['dictionary_token_replacement'],
      },
      {
        domain: 'support-portal.invalid',
        source: 'alpha-portal.invalid',
        tld: 'invalid',
        mutationTypes: ['dictionary_token_replacement'],
      },
      {
        domain: 'alpha-support.invalid',
        source: 'alpha-portal.invalid',
        tld: 'invalid',
        mutationTypes: ['dictionary_token_replacement'],
      },
    ]);
    assert.equal(result.candidates.some((candidate) => candidate.domain === 'account-alpha-portal.invalid'), false);
    assert.equal(result.candidates.some((candidate) => candidate.domain.includes('login')), false);
    assert.equal(generator.estimateTyposquatCandidateCount('alpha-portal.invalid', [], options).estimatedMaximum, 4);
  });

  test('token replacement stays neutral when the seed has no explicit token boundary', () => {
    const options = {
      preset: 'custom',
      mutationTypes: ['dictionary_token_replacement'],
      dictionaryTerms: ['account'],
    };
    assert.deepEqual(generator.generateTyposquatCandidateSet('alphaportal.invalid', [], options).candidates, []);
    assert.equal(generator.estimateTyposquatCandidateCount('alphaportal.invalid', [], options).estimatedMaximum, 0);
  });

  test('bounds and reports excessive analyst dictionary input', () => {
    const terms = Array.from({ length: generator.MAX_CUSTOM_DICTIONARY_TERMS + 5 }, (_, index) => `term${index}`);
    const normalized = generator.normalizeCustomDictionaryTerms(terms);
    assert.equal(normalized.values.length, generator.MAX_CUSTOM_DICTIONARY_TERMS);
    assert.equal(normalized.truncated, true);
    assert.equal(normalized.rejectedCount, 0);
    const result = generator.generateTyposquatCandidateSet('acme.com', [], {
      preset: 'impersonation',
      dictionaryTerms: terms,
    });
    assert.equal(result.truncated, true);
    assert.ok(result.limitReasons.includes('dictionary-terms'));
  });

  test('normalizes bounded dictionary text and rejects unsafe terms', () => {
    assert.deepEqual(generator.normalizeCustomDictionaryTerms(' Invoice, support\nhelp-desk;bad! invoice '), {
      values: ['invoice', 'support', 'help-desk'],
      truncated: false,
      rejectedCount: 1,
    });
    const oversized = generator.normalizeCustomDictionaryTerms('x'.repeat(generator.MAX_CUSTOM_DICTIONARY_TEXT_LENGTH + 1));
    assert.equal(oversized.truncated, true);
    assert.equal(oversized.values.length, 0);
    assert.equal(oversized.rejectedCount, 1);
  });

  test('keeps every standard mutation family as the explicit and implicit default', () => {
    const implicit = generator.generateTyposquatCandidateSet('acme.com', ['com', 'net']);
    const explicit = generator.generateTyposquatCandidateSet('acme.com', ['com', 'net'], {
      preset: 'all',
      keyboardLayout: 'qwerty',
    });
    assert.equal(generator.DEFAULT_GENERATION_PRESET, 'all');
    assert.equal(generator.DEFAULT_KEYBOARD_LAYOUT, 'qwerty');
    assert.deepEqual(explicit, implicit);
    assert.ok(generator.MUTATION_FAMILY_IDS.includes('unicode_homoglyph_depth_2'));
    assert.equal(generator.DEFAULT_CUSTOM_MUTATION_FAMILY_IDS.includes('unicode_homoglyph_depth_2'), false);
    assert.equal(generator.GENERATION_PRESETS.all.mutationTypes.includes('unicode_homoglyph_depth_2'), false);
    assert.equal(implicit.candidates.some((candidate) =>
      candidate.mutationTypes.includes('unicode_homoglyph_depth_2')), false);
  });

  test('custom preset uses only normalized analyst-selected families', () => {
    const options = {
      preset: 'custom',
      mutationTypes: ['pluralization', 'tld_embedding', 'pluralization', 'unknown', 7],
    };
    const result = generator.generateTyposquatCandidateSet('acme.com', ['com', 'net'], options);
    assert.deepEqual(generator.normalizeMutationFamilyIds(options.mutationTypes), ['pluralization', 'tld_embedding']);
    assert.deepEqual(
      [...new Set(result.candidates.flatMap((candidate) => candidate.mutationTypes))].sort(),
      ['pluralization', 'tld_embedding'],
    );
    assert.ok(result.candidates.some((candidate) => candidate.domain === 'acmes.com'));
    assert.ok(result.candidates.some((candidate) => candidate.domain === 'acmecom.com'));
    assert.equal(result.candidates.some((candidate) => candidate.domain === 'acme.net'), false);
    assert.equal(generator.estimateTyposquatCandidateCount('acme.com', ['com', 'net'], options).preset, 'custom');
  });

  test('empty custom family selection returns no candidates without inventing a fallback', () => {
    const result = generator.generateTyposquatCandidateSet('acme.com', ['com'], {
      preset: 'custom',
      mutationTypes: [],
    });
    assert.equal(result.inputValid, true);
    assert.deepEqual(result.candidates, []);
  });

  test('common-edits preset excludes impersonation and keyboard-insertion families', () => {
    const result = generator.generateTyposquatCandidateSet('acme.com', ['com', 'net'], { preset: 'common' });
    const mutationTypes = new Set(result.candidates.flatMap((candidate) => candidate.mutationTypes));
    assert.ok(mutationTypes.has('character_omission'));
    assert.ok(mutationTypes.has('bitsquatting'));
    assert.ok(mutationTypes.has('tld_substitution'));
    assert.equal(mutationTypes.has('dictionary'), false);
    assert.equal(mutationTypes.has('ascii_homoglyph'), false);
    assert.equal(mutationTypes.has('unicode_homoglyph'), false);
    assert.equal(mutationTypes.has('unicode_whole_label'), false);
    assert.equal(mutationTypes.has('unicode_homoglyph_depth_2'), false);
    assert.equal(mutationTypes.has('keyboard_insertion'), false);
    assert.equal(result.candidates.some((candidate) => candidate.domain === 'loginacme.com'), false);
  });

  test('impersonation preset excludes ordinary character-edit families', () => {
    const result = generator.generateTyposquatCandidateSet('acme.com', ['com', 'net'], { preset: 'impersonation' });
    const mutationTypes = new Set(result.candidates.flatMap((candidate) => candidate.mutationTypes));
    assert.ok(mutationTypes.has('dictionary'));
    assert.ok(mutationTypes.has('unicode_homoglyph'));
    assert.ok(mutationTypes.has('unicode_whole_label'));
    assert.equal(mutationTypes.has('unicode_homoglyph_depth_2'), false);
    assert.ok(mutationTypes.has('tld_substitution'));
    assert.equal(mutationTypes.has('character_omission'), false);
    assert.equal(mutationTypes.has('keyboard_substitution'), false);
    assert.equal(mutationTypes.has('bitsquatting'), false);
    assert.ok(result.candidates.some((candidate) => candidate.domain === 'loginacme.com'));
    assert.equal(result.candidates.some((candidate) => candidate.domain === 'acm.com'), false);
  });

  test('unknown presets fall back to the established all-family result', () => {
    const expected = generator.generateTyposquatCandidateSet('acme.com', ['com', 'net']);
    const result = generator.generateTyposquatCandidateSet('acme.com', ['com', 'net'], { preset: 'not-a-preset' });
    assert.deepEqual(result, expected);
  });

  test('publishes immutable preset definitions', () => {
    assert.equal(Object.isFrozen(generator.GENERATION_PRESETS), true);
    for (const preset of Object.values(generator.GENERATION_PRESETS)) {
      assert.equal(Object.isFrozen(preset), true);
      assert.equal(Object.isFrozen(preset.mutationTypes), true);
    }
  });

  test('publishes immutable keyboard-layout definitions', () => {
    assert.deepEqual(Object.keys(generator.KEYBOARD_LAYOUTS), ['qwerty', 'azerty', 'qwertz', 'all']);
    assert.equal(Object.isFrozen(generator.KEYBOARD_LAYOUTS), true);
    for (const layout of Object.values(generator.KEYBOARD_LAYOUTS)) {
      assert.equal(Object.isFrozen(layout), true);
      assert.equal(Object.isFrozen(layout.adjacent), true);
    }
  });

  test('keyboard layouts include bounded number-row substitutions and insertions', () => {
    for (const [keyboardLayout, seed] of [
      ['qwerty', 'q'],
      ['azerty', 'a'],
      ['qwertz', 'q'],
    ]) {
      const substitutions = generator.generateTyposquatCandidateSet(`${seed}.invalid`, [], {
        preset: 'custom',
        mutationTypes: ['keyboard_substitution'],
        keyboardLayout,
      });
      assert.deepEqual(
        substitutions.candidates.filter((candidate) => /^[12]\.invalid$/.test(candidate.domain)),
        [
          {
            domain: '1.invalid',
            source: `${seed}.invalid`,
            tld: 'invalid',
            mutationTypes: ['keyboard_substitution'],
          },
          {
            domain: '2.invalid',
            source: `${seed}.invalid`,
            tld: 'invalid',
            mutationTypes: ['keyboard_substitution'],
          },
        ],
      );
    }

    const insertions = generator.generateTyposquatCandidateSet('wlab.invalid', [], {
      preset: 'custom',
      mutationTypes: ['keyboard_insertion'],
      keyboardLayout: 'qwerty',
    });
    for (const domain of ['2wlab.invalid', 'w2lab.invalid', '3wlab.invalid', 'w3lab.invalid']) {
      assert.deepEqual(insertions.candidates.find((candidate) => candidate.domain === domain)?.mutationTypes, [
        'keyboard_insertion',
      ]);
    }
  });

  test('AZERTY adds its physical-key neighbours without changing mutation semantics', () => {
    const qwerty = generator.generateTyposquatCandidateSet('z.com', [], { preset: 'common', keyboardLayout: 'qwerty' });
    const azerty = generator.generateTyposquatCandidateSet('z.com', [], { preset: 'common', keyboardLayout: 'azerty' });
    assert.equal(qwerty.candidates.some((candidate) => candidate.domain === 'e.com'), false);
    assert.deepEqual(azerty.candidates.find((candidate) => candidate.domain === 'e.com'), {
      domain: 'e.com',
      source: 'z.com',
      tld: 'com',
      mutationTypes: ['keyboard_substitution'],
    });
  });

  test('QWERTZ adds its physical-key neighbours and unknown layouts fall back to QWERTY', () => {
    const qwerty = generator.generateTyposquatCandidateSet('z.com', [], { preset: 'common', keyboardLayout: 'qwerty' });
    const qwertz = generator.generateTyposquatCandidateSet('z.com', [], { preset: 'common', keyboardLayout: 'qwertz' });
    const unknown = generator.generateTyposquatCandidateSet('z.com', [], { preset: 'common', keyboardLayout: 'unknown' });
    assert.equal(qwerty.candidates.some((candidate) => candidate.domain === 't.com'), false);
    assert.ok(qwertz.candidates.some((candidate) => candidate.domain === 't.com'));
    assert.deepEqual(unknown, qwerty);
  });

  test('all-layout mode deterministically unions supported keyboard neighbours', () => {
    const all = generator.generateTyposquatCandidateSet('z.com', [], { preset: 'common', keyboardLayout: 'all' });
    assert.ok(all.candidates.some((candidate) => candidate.domain === 'e.com'));
    assert.ok(all.candidates.some((candidate) => candidate.domain === 't.com'));
    assert.deepEqual(
      generator.generateTyposquatCandidateSet('z.com', [], { preset: 'common', keyboardLayout: 'all' }),
      all,
    );
  });

  test('estimate is a deterministic upper bound for every preset', () => {
    for (const preset of Object.keys(generator.GENERATION_PRESETS)) {
      for (const keyboardLayout of Object.keys(generator.KEYBOARD_LAYOUTS)) {
        const tlds = ['com', 'net', 'org'];
        const before = structuredClone(tlds);
        const options = {
          preset,
          keyboardLayout,
          ...(preset === 'custom' ? { mutationTypes: generator.MUTATION_FAMILY_IDS } : {}),
        };
        const estimate = generator.estimateTyposquatCandidateCount('acme.com', tlds, options);
        const result = generator.generateTyposquatCandidateSet('acme.com', tlds, options);
        assert.equal(estimate.inputValid, true);
        assert.equal(estimate.preset, preset);
        assert.equal(estimate.tldCount, 3);
        assert.ok(estimate.estimatedMaximum >= result.candidates.length);
        assert.ok(estimate.estimatedMaximum <= generator.MAX_GENERATED_CANDIDATES);
        assert.deepEqual(generator.estimateTyposquatCandidateCount('acme.com', tlds, options), estimate);
        assert.deepEqual(tlds, before);
      }
    }
  });

  test('estimate reports invalid and missing-TLD inputs without generating candidates', () => {
    assert.deepEqual(generator.estimateTyposquatCandidateCount('example.co.uk', ['com']), {
      inputValid: false,
      preset: 'all',
      tldCount: 0,
      estimatedMaximum: 0,
      mayReachLimit: false,
    });
    assert.deepEqual(generator.estimateTyposquatCandidateCount('acme', []), {
      inputValid: true,
      preset: 'all',
      tldCount: 0,
      estimatedMaximum: 0,
      mayReachLimit: false,
    });
  });

  test('estimate discloses when the global candidate cap may apply', () => {
    const tlds = Array.from({ length: generator.MAX_GENERATION_TLDS }, (_, index) =>
      `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
    );
    const estimate = generator.estimateTyposquatCandidateCount('acme', tlds);
    assert.equal(estimate.estimatedMaximum, generator.MAX_GENERATED_CANDIDATES);
    assert.equal(estimate.mayReachLimit, true);
  });
});
