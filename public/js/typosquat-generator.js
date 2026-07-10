// Pure typosquat candidate generation. The UI consumes richer candidate
// objects so a later scan can explain why each domain was generated; callers
// that only need the historical string list can use the compatibility wrapper.

const QWERTY_ADJACENT = {
  q: 'wa', w: 'qeas', e: 'wrds', r: 'etdf', t: 'ryfg', y: 'tugh', u: 'yihj', i: 'uojk', o: 'iplk', p: 'ol',
  a: 'qwsz', s: 'awedxz', d: 'serfcx', f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb', j: 'huikmn', k: 'jiolm', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
};

const HOMOGLYPH_SWAPS = [
  ['rn', 'm'], ['m', 'rn'], ['o', '0'], ['0', 'o'], ['l', '1'], ['1', 'l'], ['i', '1'], ['vv', 'w'], ['w', 'vv'],
];

const UNICODE_HOMOGLYPHS = {
  a: ['а'], c: ['с'], e: ['е'], i: ['і'], o: ['о'], p: ['р'], s: ['ѕ'], x: ['х'], y: ['у'],
};

const VOWELS = 'aeiou';
const PHISHING_DICTIONARY = ['login', 'secure', 'verify', 'account', 'support', 'security', 'update', 'confirm', 'portal', 'admin'];
const TLD_TYPOS = {
  com: ['cm', 'co', 'om', 'con', 'comm', 'cim', 'vom'],
  net: ['ner', 'nte', 'ne'],
  org: ['ogr', 'rg', 'orgg'],
};

export const MUTATION_LABELS = {
  character_omission: 'Character omission',
  character_duplication: 'Character duplication',
  character_transposition: 'Adjacent transposition',
  keyboard_substitution: 'Keyboard substitution',
  keyboard_insertion: 'Keyboard insertion',
  vowel_swap: 'Vowel swap',
  bitsquatting: 'Bitsquatting',
  ascii_homoglyph: 'ASCII homoglyph',
  unicode_homoglyph: 'Unicode homoglyph',
  dictionary: 'Phishing dictionary',
  tld_typo: 'TLD typo',
};

function splitDomainParts(input) {
  const trimmed = input.trim().toLowerCase();
  const match = trimmed.match(/^([a-z0-9-]+)\.([a-z]+)$/);
  return match ? { name: match[1], tld: match[2] } : { name: trimmed.replace(/[^a-z0-9-]/g, ''), tld: null };
}

function toAsciiLabel(label) {
  try {
    return new URL(`https://${label}.example`).hostname.replace(/\.example$/, '');
  } catch {
    return null;
  }
}

/** @param {Map<string, Set<string>>} variants */
function addVariant(variants, variant, mutationType) {
  if (!variant) return;
  if (!variants.has(variant)) variants.set(variant, new Set());
  variants.get(variant)?.add(mutationType);
}

/**
 * @typedef {Object} TyposquatCandidate
 * @property {string} domain
 * @property {string} source
 * @property {string} tld
 * @property {string[]} mutationTypes
 */

/** @returns {TyposquatCandidate[]} */
export function generateTyposquatCandidates(rawInput, fallbackTlds) {
  const { name, tld } = splitDomainParts(rawInput);
  if (!name) return [];
  const tlds = tld ? [tld] : fallbackTlds;
  if (tlds.length === 0) return [];

  /** @type {Map<string, Set<string>>} */
  const nameVariants = new Map();

  for (let i = 0; i < name.length; i += 1) {
    addVariant(nameVariants, name.slice(0, i) + name.slice(i + 1), 'character_omission');
    addVariant(nameVariants, name.slice(0, i + 1) + name[i] + name.slice(i + 1), 'character_duplication');
  }
  for (let i = 0; i < name.length - 1; i += 1) {
    addVariant(nameVariants, name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2), 'character_transposition');
  }
  for (let i = 0; i < name.length; i += 1) {
    const adjacent = QWERTY_ADJACENT[name[i]];
    if (!adjacent) continue;
    for (const key of adjacent) {
      addVariant(nameVariants, name.slice(0, i) + key + name.slice(i + 1), 'keyboard_substitution');
      addVariant(nameVariants, name.slice(0, i) + key + name.slice(i), 'keyboard_insertion');
      addVariant(nameVariants, name.slice(0, i + 1) + key + name.slice(i + 1), 'keyboard_insertion');
    }
  }
  for (let i = 0; i < name.length; i += 1) {
    if (!VOWELS.includes(name[i])) continue;
    for (const vowel of VOWELS) {
      if (vowel !== name[i]) addVariant(nameVariants, name.slice(0, i) + vowel + name.slice(i + 1), 'vowel_swap');
    }
  }
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    for (let bit = 0; bit < 8; bit += 1) {
      const flipped = String.fromCharCode(code ^ (1 << bit));
      if (/^[a-z0-9-]$/.test(flipped)) {
        addVariant(nameVariants, name.slice(0, i) + flipped + name.slice(i + 1), 'bitsquatting');
      }
    }
  }
  for (const [from, to] of HOMOGLYPH_SWAPS) {
    if (name.includes(from)) addVariant(nameVariants, name.split(from).join(to), 'ascii_homoglyph');
  }
  for (let i = 0; i < name.length; i += 1) {
    const substitutions = UNICODE_HOMOGLYPHS[name[i]];
    if (!substitutions) continue;
    for (const substitution of substitutions) {
      const ascii = toAsciiLabel(name.slice(0, i) + substitution + name.slice(i + 1));
      if (ascii) addVariant(nameVariants, ascii, 'unicode_homoglyph');
    }
  }
  for (const word of PHISHING_DICTIONARY) {
    addVariant(nameVariants, `${word}${name}`, 'dictionary');
    addVariant(nameVariants, `${word}-${name}`, 'dictionary');
    addVariant(nameVariants, `${name}${word}`, 'dictionary');
    addVariant(nameVariants, `${name}-${word}`, 'dictionary');
  }

  nameVariants.delete(name);
  nameVariants.delete('');

  /** @type {Map<string, TyposquatCandidate>} */
  const byDomain = new Map();
  const source = tld ? `${name}.${tld}` : name;
  for (const [variant, mutationTypes] of nameVariants) {
    for (const candidateTld of tlds) {
      const domain = `${variant}.${candidateTld}`;
      byDomain.set(domain, { domain, source, tld: candidateTld, mutationTypes: [...mutationTypes] });
    }
  }
  if (tld && TLD_TYPOS[tld]) {
    for (const typoTld of TLD_TYPOS[tld]) {
      const domain = `${name}.${typoTld}`;
      byDomain.set(domain, { domain, source, tld: typoTld, mutationTypes: ['tld_typo'] });
    }
  }
  return [...byDomain.values()];
}

export function generateTyposquatVariants(rawInput, fallbackTlds) {
  return generateTyposquatCandidates(rawInput, fallbackTlds).map((candidate) => candidate.domain);
}
