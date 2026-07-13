// Pure typosquat candidate generation. The UI consumes richer candidate
// objects so a later scan can explain why each domain was generated; callers
// that only need the historical string list can use the compatibility wrapper.

import { confusableCharactersForAscii } from './idn-confusables.js';

const QWERTY_ADJACENT = {
  q: 'wa', w: 'qeas', e: 'wrds', r: 'etdf', t: 'ryfg', y: 'tugh', u: 'yihj', i: 'uojk', o: 'iplk', p: 'ol',
  a: 'qwsz', s: 'awedxz', d: 'serfcx', f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb', j: 'huikmn', k: 'jiolm', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
};

const HOMOGLYPH_SWAPS = [
  ['rn', 'm'], ['m', 'rn'], ['o', '0'], ['0', 'o'], ['l', '1'], ['1', 'l'], ['i', '1'], ['vv', 'w'], ['w', 'vv'],
];

const VOWELS = 'aeiou';
const PHISHING_DICTIONARY = ['login', 'secure', 'verify', 'account', 'support', 'security', 'update', 'confirm', 'portal', 'admin'];
const TLD_TYPOS = {
  com: ['cm', 'co', 'om', 'con', 'comm', 'cim', 'vom'],
  net: ['ner', 'nte', 'ne'],
  org: ['ogr', 'rg', 'orgg'],
};

export const MAX_GENERATION_TLDS = 20;
export const MAX_NAME_VARIANTS = 1_500;
export const MAX_GENERATED_CANDIDATES = 2_000;
export const MAX_GENERATION_INPUT_LENGTH = 253;

const MAX_LABEL_LENGTH = 63;
const MAX_TLD_INPUTS_INSPECTED = MAX_GENERATION_TLDS * 4;
const CONTROL_CHARACTER_RE = /[\x00-\x1f\x7f]/;
const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD_RE = /^[a-z]{2,63}$/;
const FAMILY_NEW_VARIANT_LIMITS = Object.freeze({
  character_omission: 128,
  character_duplication: 128,
  character_transposition: 128,
  keyboard_substitution: 512,
  keyboard_insertion: 768,
  vowel_swap: 256,
  bitsquatting: 512,
  ascii_homoglyph: 128,
  unicode_homoglyph: 768,
  dictionary: 64,
});

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
  tld_substitution: 'Selected TLD substitution',
};

function isValidDomainLabel(value) {
  return typeof value === 'string' && value.length <= MAX_LABEL_LENGTH && DOMAIN_LABEL_RE.test(value);
}

function splitDomainParts(input) {
  if (typeof input !== 'string' || input.length > MAX_GENERATION_INPUT_LENGTH || CONTROL_CHARACTER_RE.test(input)) return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  if (trimmed.includes('.')) {
    const match = trimmed.match(/^([a-z0-9-]+)\.([a-z]+)$/);
    if (!match || !isValidDomainLabel(match[1]) || !TLD_RE.test(match[2])) return null;
    return { name: match[1], tld: match[2] };
  }

  // Preserve the established brand-label convenience while refusing to turn
  // ambiguous dotted inputs into a different domain by deleting punctuation.
  const name = trimmed.replace(/[^a-z0-9-]/g, '');
  return isValidDomainLabel(name) ? { name, tld: null } : null;
}

function normalizeTlds(values) {
  if (!Array.isArray(values)) return { values: [], truncated: false };
  const normalized = [];
  const seen = new Set();
  let truncated = values.length > MAX_TLD_INPUTS_INSPECTED;

  for (const raw of values.slice(0, MAX_TLD_INPUTS_INSPECTED)) {
    if (typeof raw !== 'string' || raw.length > MAX_LABEL_LENGTH + 1 || CONTROL_CHARACTER_RE.test(raw)) continue;
    const value = raw.trim().toLowerCase().replace(/^\./, '');
    if (!TLD_RE.test(value) || seen.has(value)) continue;
    if (normalized.length >= MAX_GENERATION_TLDS) {
      truncated = true;
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return { values: normalized, truncated };
}

function toAsciiLabel(label) {
  try {
    return new URL(`https://${label}.example`).hostname.replace(/\.example$/, '');
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} GenerationState
 * @property {string} sourceName
 * @property {Map<string, Set<string>>} variants
 * @property {Map<string, number>} familyCounts
 * @property {Set<string>} limitReasons
 * @property {number} rejectedVariantCount
 */

/** @returns {GenerationState} */
function generationState(sourceName) {
  return {
    sourceName,
    variants: new Map(),
    familyCounts: new Map(),
    limitReasons: new Set(),
    rejectedVariantCount: 0,
  };
}

/** @param {GenerationState} state */
function addVariant(state, variant, mutationType) {
  if (!isValidDomainLabel(variant) || variant === state.sourceName) {
    if (variant && variant !== state.sourceName) state.rejectedVariantCount += 1;
    return;
  }

  const existing = state.variants.get(variant);
  if (existing) {
    // Limits constrain unique output growth, never provenance for a candidate
    // that another mutation family already generated.
    existing.add(mutationType);
    return;
  }

  const familyLimit = FAMILY_NEW_VARIANT_LIMITS[mutationType];
  const familyCount = state.familyCounts.get(mutationType) || 0;
  if (typeof familyLimit === 'number' && familyCount >= familyLimit) {
    state.limitReasons.add(`family:${mutationType}`);
    return;
  }
  if (state.variants.size >= MAX_NAME_VARIANTS) {
    state.limitReasons.add('name-variants');
    return;
  }

  state.variants.set(variant, new Set([mutationType]));
  state.familyCounts.set(mutationType, familyCount + 1);
}

/**
 * @typedef {Object} TyposquatCandidate
 * @property {string} domain
 * @property {string} source
 * @property {string} tld
 * @property {string[]} mutationTypes
 */

/**
 * @typedef {Object} TyposquatGenerationResult
 * @property {1} version
 * @property {TyposquatCandidate[]} candidates
 * @property {boolean} inputValid
 * @property {boolean} truncated
 * @property {string[]} limitReasons
 * @property {number} rejectedVariantCount
 * @property {{tlds: number, nameVariants: number, candidates: number}} limits
 */

/**
 * Generates a bounded, deterministic candidate set with diagnostic metadata.
 * Compatibility callers can continue to use generateTyposquatCandidates().
 * @returns {TyposquatGenerationResult}
 */
export function generateTyposquatCandidateSet(rawInput, fallbackTlds) {
  const parts = splitDomainParts(rawInput);
  if (!parts) {
    return {
      version: 1,
      candidates: [],
      inputValid: false,
      truncated: false,
      limitReasons: [],
      rejectedVariantCount: 0,
      limits: { tlds: MAX_GENERATION_TLDS, nameVariants: MAX_NAME_VARIANTS, candidates: MAX_GENERATED_CANDIDATES },
    };
  }
  const { name, tld } = parts;
  const normalizedFallbackTlds = normalizeTlds(fallbackTlds);
  const combinedTlds = tld
    ? [tld, ...normalizedFallbackTlds.values.filter((value) => value !== tld)]
    : normalizedFallbackTlds.values;
  const normalizedTlds = {
    values: combinedTlds.slice(0, MAX_GENERATION_TLDS),
    truncated: normalizedFallbackTlds.truncated || combinedTlds.length > MAX_GENERATION_TLDS,
  };
  const tlds = normalizedTlds.values;
  if (tlds.length === 0) {
    return {
      version: 1,
      candidates: [],
      inputValid: true,
      truncated: normalizedTlds.truncated,
      limitReasons: normalizedTlds.truncated ? ['tlds'] : [],
      rejectedVariantCount: 0,
      limits: { tlds: MAX_GENERATION_TLDS, nameVariants: MAX_NAME_VARIANTS, candidates: MAX_GENERATED_CANDIDATES },
    };
  }

  const state = generationState(name);

  for (let i = 0; i < name.length; i += 1) {
    addVariant(state, name.slice(0, i) + name.slice(i + 1), 'character_omission');
    addVariant(state, name.slice(0, i + 1) + name[i] + name.slice(i + 1), 'character_duplication');
  }
  for (let i = 0; i < name.length - 1; i += 1) {
    addVariant(state, name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2), 'character_transposition');
  }
  for (let i = 0; i < name.length; i += 1) {
    const adjacent = QWERTY_ADJACENT[name[i]];
    if (!adjacent) continue;
    for (const key of adjacent) {
      addVariant(state, name.slice(0, i) + key + name.slice(i + 1), 'keyboard_substitution');
      addVariant(state, name.slice(0, i) + key + name.slice(i), 'keyboard_insertion');
      addVariant(state, name.slice(0, i + 1) + key + name.slice(i + 1), 'keyboard_insertion');
    }
  }
  for (let i = 0; i < name.length; i += 1) {
    if (!VOWELS.includes(name[i])) continue;
    for (const vowel of VOWELS) {
      if (vowel !== name[i]) addVariant(state, name.slice(0, i) + vowel + name.slice(i + 1), 'vowel_swap');
    }
  }
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    for (let bit = 0; bit < 8; bit += 1) {
      const flipped = String.fromCharCode(code ^ (1 << bit));
      if (/^[a-z0-9-]$/.test(flipped)) {
        addVariant(state, name.slice(0, i) + flipped + name.slice(i + 1), 'bitsquatting');
      }
    }
  }
  for (const [from, to] of HOMOGLYPH_SWAPS) {
    if (name.includes(from)) addVariant(state, name.split(from).join(to), 'ascii_homoglyph');
  }
  for (let i = 0; i < name.length; i += 1) {
    const substitutions = confusableCharactersForAscii(name[i]);
    if (!substitutions) continue;
    for (const substitution of substitutions) {
      const ascii = toAsciiLabel(name.slice(0, i) + substitution + name.slice(i + 1));
      if (ascii) addVariant(state, ascii, 'unicode_homoglyph');
    }
  }
  for (const word of PHISHING_DICTIONARY) {
    addVariant(state, `${word}${name}`, 'dictionary');
    addVariant(state, `${word}-${name}`, 'dictionary');
    addVariant(state, `${name}${word}`, 'dictionary');
    addVariant(state, `${name}-${word}`, 'dictionary');
  }

  /** @type {Map<string, TyposquatCandidate>} */
  const byDomain = new Map();
  const source = tld ? `${name}.${tld}` : name;

  function addCandidate(domain, candidateTld, mutationTypes) {
    const existing = byDomain.get(domain);
    if (existing) {
      for (const mutationType of mutationTypes) {
        if (!existing.mutationTypes.includes(mutationType)) existing.mutationTypes.push(mutationType);
      }
      return;
    }
    if (byDomain.size >= MAX_GENERATED_CANDIDATES) {
      state.limitReasons.add('candidates');
      return;
    }
    byDomain.set(domain, { domain, source, tld: candidateTld, mutationTypes: [...mutationTypes] });
  }

  // Reserve room for same-name TLD variants before the cross-product reaches
  // the global cap; these candidates are otherwise easy to starve with 20 TLDs.
  if (tld && TLD_TYPOS[tld]) {
    for (const typoTld of TLD_TYPOS[tld]) addCandidate(`${name}.${typoTld}`, typoTld, ['tld_typo']);
  }
  if (tld) {
    for (const candidateTld of tlds) {
      if (candidateTld !== tld) addCandidate(`${name}.${candidateTld}`, candidateTld, ['tld_substitution']);
    }
  }
  candidateLoop: for (const [variant, mutationTypes] of state.variants) {
    for (const candidateTld of tlds) {
      if (byDomain.size >= MAX_GENERATED_CANDIDATES) {
        state.limitReasons.add('candidates');
        break candidateLoop;
      }
      const domain = `${variant}.${candidateTld}`;
      const candidateMutationTypes = tld && candidateTld !== tld
        ? [...mutationTypes, 'tld_substitution']
        : mutationTypes;
      addCandidate(domain, candidateTld, candidateMutationTypes);
    }
  }

  if (normalizedTlds.truncated) state.limitReasons.add('tlds');
  return {
    version: 1,
    candidates: [...byDomain.values()],
    inputValid: true,
    truncated: state.limitReasons.size > 0,
    limitReasons: [...state.limitReasons],
    rejectedVariantCount: state.rejectedVariantCount,
    limits: { tlds: MAX_GENERATION_TLDS, nameVariants: MAX_NAME_VARIANTS, candidates: MAX_GENERATED_CANDIDATES },
  };
}

/** @returns {TyposquatCandidate[]} */
export function generateTyposquatCandidates(rawInput, fallbackTlds) {
  return generateTyposquatCandidateSet(rawInput, fallbackTlds).candidates;
}

export function generateTyposquatVariants(rawInput, fallbackTlds) {
  return generateTyposquatCandidates(rawInput, fallbackTlds).map((candidate) => candidate.domain);
}
