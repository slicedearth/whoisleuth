// Domain name generator - brainstorms candidates from a seed keyword
// (prefix/suffix/plural variants x a TLD list) and drops them straight into
// the query box for a fast scan. A fixed, small modifier set rather than a
// configurable one - keeps this simple while covering the common patterns.
//
// Typosquat / brand-protection variant generator, modeled on dnstwist's
// permutation algorithms: character omission, duplication, adjacent-key
// substitution/insertion (QWERTY), adjacent transposition, vowel-swapping,
// bitsquatting (simulated single-bit memory/transmission errors), a
// phishing-relevant dictionary fuzzer, ASCII and real Unicode homoglyphs,
// and TLD-typo variants. Distinct generation strategy from the
// brainstorming generator above: this one is confusability-driven (finding
// cybersquatting/phishing targets), not idea-driven.

import { fillQueryInputWithCandidates } from './dom.js';

function parseTldList(raw) {
  return [...new Set(
    raw
      .split(',')
      .map((t) => t.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean)
  )];
}

// ---------------------------------------------------------------------------
// Keyword generator
// ---------------------------------------------------------------------------

const GENERATOR_PREFIXES = ['get', 'my', 'the', 'try', 'use'];
const GENERATOR_SUFFIXES = ['hq', 'app', 'hub', 'online', 'site', 'now'];

function generateDomainCandidates(rawKeyword, tlds) {
  const words = rawKeyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0 || tlds.length === 0) return [];

  const concatenated = words.join('');
  const bases = new Set([concatenated]);
  if (words.length > 1) bases.add(words.join('-'));
  for (const p of GENERATOR_PREFIXES) bases.add(p + concatenated);
  for (const s of GENERATOR_SUFFIXES) bases.add(concatenated + s);
  if (concatenated.length > 3 && !concatenated.endsWith('s')) bases.add(concatenated + 's');

  const seen = new Set();
  const candidates = [];
  for (const base of bases) {
    for (const tld of tlds) {
      const domain = `${base}.${tld}`;
      if (seen.has(domain)) continue;
      seen.add(domain);
      candidates.push(domain);
    }
  }
  return candidates;
}

const generatorRunBtn = /** @type {HTMLButtonElement} */ (document.getElementById('generator-run-btn'));
const generatorKeywordInput = /** @type {HTMLInputElement} */ (document.getElementById('generator-keyword'));
const generatorTldsInput = /** @type {HTMLInputElement} */ (document.getElementById('generator-tlds'));
const generatorStatusEl = /** @type {HTMLElement} */ (document.getElementById('generator-status'));

generatorRunBtn.addEventListener('click', () => {
  const keyword = generatorKeywordInput.value;
  const tlds = parseTldList(generatorTldsInput.value);
  const statusEl = generatorStatusEl;
  const candidates = generateDomainCandidates(keyword, tlds);

  if (candidates.length === 0) {
    statusEl.innerHTML = '<span class="error-text">Enter a keyword and at least one TLD.</span>';
    return;
  }

  fillQueryInputWithCandidates(candidates);
  statusEl.textContent = `Generated ${candidates.length} candidates - scrolled to the query box above so you can review them, then click Lookup to scan.`;
});

// ---------------------------------------------------------------------------
// Typosquat generator
// ---------------------------------------------------------------------------

const QWERTY_ADJACENT = {
  q: 'wa', w: 'qeas', e: 'wrds', r: 'etdf', t: 'ryfg', y: 'tugh', u: 'yihj', i: 'uojk', o: 'iplk', p: 'ol',
  a: 'qwsz', s: 'awedxz', d: 'serfcx', f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb', j: 'huikmn', k: 'jiolm', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
};

const HOMOGLYPH_SWAPS = [
  ['rn', 'm'], ['m', 'rn'], ['o', '0'], ['0', 'o'], ['l', '1'], ['1', 'l'], ['i', '1'], ['vv', 'w'], ['w', 'vv'],
];

// Unicode characters that render near-identically to their Latin
// counterpart in most fonts (the classic IDN homograph attack set) -
// encoded to punycode below so the result is a real, queryable domain name,
// not just a display trick.
const UNICODE_HOMOGLYPHS = {
  a: ['а'], // Cyrillic а U+0430
  c: ['с'], // Cyrillic с U+0441
  e: ['е'], // Cyrillic е U+0435
  i: ['і'], // Cyrillic і U+0456
  o: ['о'], // Cyrillic о U+043E
  p: ['р'], // Cyrillic р U+0440
  s: ['ѕ'], // Cyrillic ѕ U+0455
  x: ['х'], // Cyrillic х U+0445
  y: ['у'], // Cyrillic у U+0443
};

const VOWELS = 'aeiou';

// Common in real phishing/typosquat registrations - a brand name combined
// with a word that implies "this is the legitimate place to log in."
const PHISHING_DICTIONARY = ['login', 'secure', 'verify', 'account', 'support', 'security', 'update', 'confirm', 'portal', 'admin'];

const TLD_TYPOS = {
  com: ['cm', 'co', 'om', 'con', 'comm', 'cim', 'vom'],
  net: ['ner', 'nte', 'ne'],
  org: ['ogr', 'rg', 'orgg'],
};

function splitDomainParts(input) {
  const trimmed = input.trim().toLowerCase();
  const m = trimmed.match(/^([a-z0-9-]+)\.([a-z]+)$/);
  return m ? { name: m[1], tld: m[2] } : { name: trimmed.replace(/[^a-z0-9-]/g, ''), tld: null };
}

// Converts a label that may contain Unicode homoglyphs into its punycode
// (ASCII-compatible) form via the browser's own URL/IDNA implementation,
// rather than hand-rolling RFC 3492 punycode encoding. ".example" is just a
// syntactically-valid placeholder TLD for parsing - nothing is resolved.
function toAsciiLabel(label) {
  try {
    return new URL(`https://${label}.example`).hostname.replace(/\.example$/, '');
  } catch {
    return null;
  }
}

function generateTyposquatVariants(rawInput, fallbackTlds) {
  const { name, tld } = splitDomainParts(rawInput);
  if (!name) return [];
  const tlds = tld ? [tld] : fallbackTlds;
  if (tlds.length === 0) return [];

  const nameVariants = new Set();

  // Character omission
  for (let i = 0; i < name.length; i += 1) nameVariants.add(name.slice(0, i) + name.slice(i + 1));
  // Character duplication
  for (let i = 0; i < name.length; i += 1) nameVariants.add(name.slice(0, i + 1) + name[i] + name.slice(i + 1));
  // Adjacent transposition
  for (let i = 0; i < name.length - 1; i += 1) {
    nameVariants.add(name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2));
  }
  // Adjacent-key substitution and insertion (QWERTY)
  for (let i = 0; i < name.length; i += 1) {
    const adj = QWERTY_ADJACENT[name[i]];
    if (!adj) continue;
    for (const key of adj) {
      nameVariants.add(name.slice(0, i) + key + name.slice(i + 1)); // substitution
      nameVariants.add(name.slice(0, i) + key + name.slice(i)); // insertion before
      nameVariants.add(name.slice(0, i + 1) + key + name.slice(i + 1)); // insertion after
    }
  }
  // Vowel swapping
  for (let i = 0; i < name.length; i += 1) {
    if (!VOWELS.includes(name[i])) continue;
    for (const v of VOWELS) {
      if (v !== name[i]) nameVariants.add(name.slice(0, i) + v + name.slice(i + 1));
    }
  }
  // Bitsquatting - simulates a single-bit memory/transmission error landing
  // on a still-valid domain character
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    for (let bit = 0; bit < 8; bit += 1) {
      const flipped = String.fromCharCode(code ^ (1 << bit));
      if (/^[a-z0-9-]$/.test(flipped)) nameVariants.add(name.slice(0, i) + flipped + name.slice(i + 1));
    }
  }
  // ASCII homoglyph swaps
  for (const [from, to] of HOMOGLYPH_SWAPS) {
    if (name.includes(from)) nameVariants.add(name.split(from).join(to));
  }
  // Real Unicode homoglyphs (punycode-encoded so they're queryable)
  for (let i = 0; i < name.length; i += 1) {
    const subs = UNICODE_HOMOGLYPHS[name[i]];
    if (!subs) continue;
    for (const sub of subs) {
      const ascii = toAsciiLabel(name.slice(0, i) + sub + name.slice(i + 1));
      if (ascii) nameVariants.add(ascii);
    }
  }
  // Dictionary fuzzing (phishing-relevant words, prefix/suffix, +/- hyphen)
  for (const word of PHISHING_DICTIONARY) {
    nameVariants.add(`${word}${name}`);
    nameVariants.add(`${word}-${name}`);
    nameVariants.add(`${name}${word}`);
    nameVariants.add(`${name}-${word}`);
  }

  nameVariants.delete(name);
  nameVariants.delete('');

  const seen = new Set();
  const candidates = [];
  for (const variant of nameVariants) {
    for (const t of tlds) {
      const domain = `${variant}.${t}`;
      if (seen.has(domain)) continue;
      seen.add(domain);
      candidates.push(domain);
    }
  }
  // Same-name, typo'd TLD (e.g. "example.cm" for "example.com")
  if (tld && TLD_TYPOS[tld]) {
    for (const typoTld of TLD_TYPOS[tld]) {
      const domain = `${name}.${typoTld}`;
      if (!seen.has(domain)) {
        seen.add(domain);
        candidates.push(domain);
      }
    }
  }
  return candidates;
}

const typoRunBtn = /** @type {HTMLButtonElement} */ (document.getElementById('typo-run-btn'));
const typoKeywordInput = /** @type {HTMLInputElement} */ (document.getElementById('typo-keyword'));
const typoTldsInput = /** @type {HTMLInputElement} */ (document.getElementById('typo-tlds'));
const typoStatusEl = /** @type {HTMLElement} */ (document.getElementById('typo-status'));

typoRunBtn.addEventListener('click', () => {
  const keyword = typoKeywordInput.value;
  const tlds = parseTldList(typoTldsInput.value);
  const statusEl = typoStatusEl;
  const candidates = generateTyposquatVariants(keyword, tlds);

  if (candidates.length === 0) {
    statusEl.innerHTML = '<span class="error-text">Enter a brand/domain name.</span>';
    return;
  }

  fillQueryInputWithCandidates(candidates);
  statusEl.textContent = `Generated ${candidates.length} typosquat variants - scrolled to the query box above so you can review them, then click Lookup to scan.`;
});
