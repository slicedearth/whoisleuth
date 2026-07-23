// Pure typosquat candidate generation. The UI consumes richer candidate
// objects so a later scan can explain why each domain was generated; callers
// that only need the historical string list can use the compatibility wrapper.

import {
  confusableCharactersForAscii,
  wholeLabelConfusableVariantsForAscii,
} from './idn-confusables.mts';

type KeyboardRow = { keys: string; offset: number };
type KeyboardPosition = { rowIndex: number; index: number; x: number };
type KeyboardLayout = { id: string; label: string; adjacent: Readonly<Record<string, string>> };
type GenerationPreset = { id: string; label: string; description: string; mutationTypes: readonly string[] };
type GenerationOptions = {
  preset?: unknown;
  keyboardLayout?: unknown;
  dictionaryTerms?: unknown;
  mutationTypes?: unknown;
};
type DomainParts = { name: string; tld: string | null; wordTokens: string[] };
type GenerationState = {
  sourceName: string;
  variants: Map<string, Set<string>>;
  familyCounts: Map<string, number>;
  limitReasons: Set<string>;
  rejectedVariantCount: number;
  enabledFamilies: Set<string>;
};
export type TyposquatCandidate = { domain: string; source: string; tld: string; mutationTypes: string[] };
export type TyposquatGenerationResult = {
  version: 1;
  candidates: TyposquatCandidate[];
  inputValid: boolean;
  truncated: boolean;
  limitReasons: string[];
  rejectedVariantCount: number;
  limits: { tlds: number; nameVariants: number; candidates: number };
};

function buildKeyboardAdjacency(rows: KeyboardRow[]): Readonly<Record<string, string>> {
  const positions = new Map<string, KeyboardPosition>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    for (let index = 0; index < row.keys.length; index += 1) {
      positions.set(row.keys[index], { rowIndex, index, x: index + row.offset });
    }
  }
  const adjacency: Record<string, string> = {};
  for (const [key, position] of positions) {
    const neighbours: string[] = [];
    const sameRow = rows[position.rowIndex].keys;
    if (position.index > 0) neighbours.push(sameRow[position.index - 1]);
    if (position.index + 1 < sameRow.length) neighbours.push(sameRow[position.index + 1]);
    for (const adjacentRowIndex of [position.rowIndex - 1, position.rowIndex + 1]) {
      const adjacentRow = rows[adjacentRowIndex];
      if (!adjacentRow) continue;
      for (let index = 0; index < adjacentRow.keys.length; index += 1) {
        if (Math.abs((index + adjacentRow.offset) - position.x) <= 0.51) neighbours.push(adjacentRow.keys[index]);
      }
    }
    adjacency[key] = [...new Set(neighbours)].join('');
  }
  return Object.freeze(adjacency);
}

const QWERTY_ADJACENT = buildKeyboardAdjacency([
  { keys: '1234567890', offset: 0 },
  { keys: 'qwertyuiop', offset: 0.5 },
  { keys: 'asdfghjkl', offset: 1 },
  { keys: 'zxcvbnm', offset: 1.5 },
]);
const AZERTY_ADJACENT = buildKeyboardAdjacency([
  { keys: '1234567890', offset: 0 },
  { keys: 'azertyuiop', offset: 0.5 },
  { keys: 'qsdfghjklm', offset: 1 },
  { keys: 'wxcvbn', offset: 1.5 },
]);
const QWERTZ_ADJACENT = buildKeyboardAdjacency([
  { keys: '1234567890', offset: 0 },
  { keys: 'qwertzuiop', offset: 0.5 },
  { keys: 'asdfghjkl', offset: 1 },
  { keys: 'yxcvbnm', offset: 1.5 },
]);

function combineKeyboardAdjacency(layouts: ReadonlyArray<Readonly<Record<string, string>>>): Readonly<Record<string, string>> {
  const combined: Record<string, string> = {};
  for (const layout of layouts) {
    for (const [key, neighbours] of Object.entries(layout)) {
      combined[key] = [...new Set(`${combined[key] || ''}${neighbours}`)].join('');
    }
  }
  return Object.freeze(combined);
}

const ALL_KEYBOARD_ADJACENT = combineKeyboardAdjacency([QWERTY_ADJACENT, AZERTY_ADJACENT, QWERTZ_ADJACENT]);

export const DEFAULT_KEYBOARD_LAYOUT = 'qwerty';
export const KEYBOARD_LAYOUTS: Readonly<Record<string, KeyboardLayout>> = Object.freeze({
  qwerty: Object.freeze({ id: 'qwerty', label: 'QWERTY', adjacent: Object.freeze(QWERTY_ADJACENT) }),
  azerty: Object.freeze({ id: 'azerty', label: 'AZERTY', adjacent: AZERTY_ADJACENT }),
  qwertz: Object.freeze({ id: 'qwertz', label: 'QWERTZ', adjacent: QWERTZ_ADJACENT }),
  all: Object.freeze({ id: 'all', label: 'All supported layouts', adjacent: ALL_KEYBOARD_ADJACENT }),
});

const HOMOGLYPH_SWAPS: ReadonlyArray<readonly [string, string]> = [
  ['rn', 'm'], ['m', 'rn'], ['o', '0'], ['0', 'o'], ['l', '1'], ['1', 'l'], ['i', '1'], ['vv', 'w'], ['w', 'vv'],
];

const VOWELS = 'aeiou';
const IMPERSONATION_TERMS = Object.freeze([
  'login',
  'signin',
  'auth',
  'sso',
  'secure',
  'verify',
  'account',
  'password',
  'recovery',
  'support',
  'helpdesk',
  'security',
  'update',
  'confirm',
  'portal',
  'admin',
  'service',
  'billing',
  'payment',
  'wallet',
  'identity',
  'password-reset',
  'account-recovery',
  'customer-support',
  'security-check',
]);
const TLD_TYPOS: Readonly<Record<string, readonly string[]>> = {
  com: ['cm', 'co', 'om', 'con', 'comm', 'cim', 'vom'],
  net: ['ner', 'nte', 'ne'],
  org: ['ogr', 'rg', 'orgg'],
};

export const MAX_GENERATION_TLDS = 20;
export const MAX_NAME_VARIANTS = 1_500;
export const MAX_GENERATED_CANDIDATES = 2_000;
export const MAX_GENERATION_INPUT_LENGTH = 253;
export const MAX_CUSTOM_DICTIONARY_TERMS = 100;
export const MAX_CUSTOM_DICTIONARY_TERM_LENGTH = 32;
export const MAX_CUSTOM_DICTIONARY_TEXT_LENGTH = 4_096;

const MAX_LABEL_LENGTH = 63;
const MAX_TLD_INPUTS_INSPECTED = MAX_GENERATION_TLDS * 4;
const MAX_CUSTOM_DICTIONARY_INPUTS_INSPECTED = MAX_CUSTOM_DICTIONARY_TERMS * 4;
const CONTROL_CHARACTER_RE = /[\x00-\x1f\x7f]/;
const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD_RE = /^[a-z]{2,63}$/;
const CUSTOM_DICTIONARY_TERM_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const FAMILY_NEW_VARIANT_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  character_addition: 128,
  character_omission: 128,
  character_duplication: 128,
  character_transposition: 128,
  pluralization: 16,
  tld_embedding: 16,
  www_prefix: 8,
  hyphenation: 64,
  separator_omission: 16,
  word_reordering: 32,
  keyboard_substitution: 512,
  keyboard_insertion: 768,
  vowel_swap: 256,
  bitsquatting: 512,
  ascii_homoglyph: 128,
  unicode_homoglyph: 768,
  unicode_whole_label: 8,
  dictionary: 512,
  dictionary_token_replacement: 200,
});

const COMMON_EDIT_MUTATIONS = Object.freeze([
  'character_addition',
  'character_omission',
  'character_duplication',
  'character_transposition',
  'pluralization',
  'tld_embedding',
  'www_prefix',
  'hyphenation',
  'separator_omission',
  'word_reordering',
  'keyboard_substitution',
  'vowel_swap',
  'bitsquatting',
  'tld_typo',
  'tld_substitution',
]);
const IMPERSONATION_MUTATIONS = Object.freeze([
  'ascii_homoglyph',
  'unicode_homoglyph',
  'unicode_whole_label',
  'dictionary',
  'dictionary_token_replacement',
  'hyphenation',
  'word_reordering',
  'tld_typo',
  'tld_substitution',
]);
const ALL_MUTATIONS = Object.freeze([
  ...Object.keys(FAMILY_NEW_VARIANT_LIMITS),
  'tld_typo',
  'tld_substitution',
]);
export const MUTATION_FAMILY_IDS = ALL_MUTATIONS;

export const DEFAULT_GENERATION_PRESET = 'all';
export const GENERATION_PRESETS: Readonly<Record<string, GenerationPreset>> = Object.freeze({
  common: Object.freeze({
    id: 'common',
    label: 'Common edits',
    description: 'Character, separator, word-order, keyboard, bitsquat, and TLD changes.',
    mutationTypes: COMMON_EDIT_MUTATIONS,
  }),
  impersonation: Object.freeze({
    id: 'impersonation',
    label: 'Impersonation',
    description: 'Lookalike characters, account-themed terms, word forms, and TLD changes.',
    mutationTypes: IMPERSONATION_MUTATIONS,
  }),
  all: Object.freeze({
    id: 'all',
    label: 'All families',
    description: 'Every bounded mutation family, including keyboard insertions.',
    mutationTypes: ALL_MUTATIONS,
  }),
  custom: Object.freeze({
    id: 'custom',
    label: 'Custom families',
    description: 'Use only the mutation families you select.',
    mutationTypes: Object.freeze([]),
  }),
});

export const MUTATION_LABELS = {
  character_addition: 'Character addition',
  character_omission: 'Character omission',
  character_duplication: 'Character duplication',
  character_transposition: 'Adjacent transposition',
  pluralization: 'Plural form',
  tld_embedding: 'TLD embedded in label',
  www_prefix: 'WWW-style prefix',
  hyphenation: 'Hyphen insertion',
  separator_omission: 'Separator omission',
  word_reordering: 'Word reordering',
  keyboard_substitution: 'Keyboard substitution',
  keyboard_insertion: 'Keyboard insertion',
  vowel_swap: 'Vowel swap',
  bitsquatting: 'Bitsquatting',
  ascii_homoglyph: 'ASCII lookalike',
  unicode_homoglyph: 'Unicode confusable',
  unicode_whole_label: 'Whole-label Unicode confusable',
  dictionary: 'Impersonation term',
  dictionary_token_replacement: 'Dictionary token replacement',
  tld_typo: 'TLD typo',
  tld_substitution: 'Selected TLD substitution',
};

function isValidDomainLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_LABEL_LENGTH && DOMAIN_LABEL_RE.test(value);
}

function splitDomainParts(input: unknown): DomainParts | null {
  if (typeof input !== 'string' || input.length > MAX_GENERATION_INPUT_LENGTH || CONTROL_CHARACTER_RE.test(input)) return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  if (trimmed.includes('.')) {
    const match = trimmed.match(/^([a-z0-9-]+)\.([a-z]+)$/);
    if (!match || !isValidDomainLabel(match[1]) || !TLD_RE.test(match[2])) return null;
    const tokens = match[1].split('-');
    return { name: match[1], tld: match[2], wordTokens: tokens.length >= 2 && tokens.length <= 4 && tokens.every(Boolean) ? tokens : [] };
  }

  // Preserve the established brand-label convenience while refusing to turn
  // ambiguous dotted inputs into a different domain by deleting punctuation.
  const name = trimmed.replace(/[^a-z0-9-]/g, '');
  if (!isValidDomainLabel(name)) return null;
  const tokenized = /^[a-z0-9]+(?:[\s_-]+[a-z0-9]+){1,3}$/.test(trimmed)
    ? trimmed.split(/[\s_-]+/)
    : [];
  return { name, tld: null, wordTokens: tokenized.length >= 2 && tokenized.length <= 4 ? tokenized : [] };
}

function distinctWordOrders(tokens: unknown): string[][] {
  if (!Array.isArray(tokens) || tokens.length < 2 || tokens.length > 4) return [];
  if (!tokens.every((token) => typeof token === 'string')) return [];
  const strings = tokens as string[];
  const orders: string[][] = [];
  const used = Array(strings.length).fill(false);
  const current: string[] = [];
  function visit() {
    if (current.length === strings.length) {
      orders.push([...current]);
      return;
    }
    const seenAtDepth = new Set<string>();
    for (let index = 0; index < strings.length; index += 1) {
      if (used[index] || seenAtDepth.has(strings[index])) continue;
      seenAtDepth.add(strings[index]);
      used[index] = true;
      current.push(strings[index]);
      visit();
      current.pop();
      used[index] = false;
    }
  }
  visit();
  return orders;
}

function normalizeTlds(values: unknown): { values: string[]; truncated: boolean } {
  if (!Array.isArray(values)) return { values: [], truncated: false };
  const normalized: string[] = [];
  const seen = new Set<string>();
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

export function normalizeCustomDictionaryTerms(raw: unknown): { values: string[]; truncated: boolean; rejectedCount: number } {
  let inputs: unknown[];
  let truncated = false;
  if (typeof raw === 'string') {
    const bounded = raw.slice(0, MAX_CUSTOM_DICTIONARY_TEXT_LENGTH);
    truncated = raw.length > MAX_CUSTOM_DICTIONARY_TEXT_LENGTH;
    inputs = bounded.split(/[;,\s]+/).filter(Boolean);
  } else if (Array.isArray(raw)) {
    inputs = raw.slice(0, MAX_CUSTOM_DICTIONARY_INPUTS_INSPECTED);
    truncated = raw.length > MAX_CUSTOM_DICTIONARY_INPUTS_INSPECTED;
  } else {
    inputs = [];
  }

  if (inputs.length > MAX_CUSTOM_DICTIONARY_INPUTS_INSPECTED) {
    inputs = inputs.slice(0, MAX_CUSTOM_DICTIONARY_INPUTS_INSPECTED);
    truncated = true;
  }

  const values: string[] = [];
  const seen = new Set<string>();
  let rejectedCount = 0;
  for (const rawValue of inputs) {
    if (typeof rawValue !== 'string'
      || rawValue.length > MAX_CUSTOM_DICTIONARY_TERM_LENGTH
      || CONTROL_CHARACTER_RE.test(rawValue)) {
      rejectedCount += 1;
      continue;
    }
    const value = rawValue.trim().toLowerCase();
    if (!CUSTOM_DICTIONARY_TERM_RE.test(value)) {
      rejectedCount += 1;
      continue;
    }
    if (seen.has(value)) continue;
    if (values.length >= MAX_CUSTOM_DICTIONARY_TERMS) {
      truncated = true;
      continue;
    }
    seen.add(value);
    values.push(value);
  }
  return { values, truncated, rejectedCount };
}

function resolveGenerationPreset(options: GenerationOptions): GenerationPreset {
  const requested = typeof options?.preset === 'string' ? options.preset : DEFAULT_GENERATION_PRESET;
  return GENERATION_PRESETS[requested] || GENERATION_PRESETS[DEFAULT_GENERATION_PRESET];
}

export function normalizeMutationFamilyIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const supported = new Set(MUTATION_FAMILY_IDS);
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of raw.slice(0, MUTATION_FAMILY_IDS.length * 2)) {
    if (typeof value !== 'string' || !supported.has(value) || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function resolveEnabledFamilies(preset: GenerationPreset, options: GenerationOptions): Set<string> {
  return new Set(preset.id === 'custom'
    ? normalizeMutationFamilyIds(options.mutationTypes)
    : preset.mutationTypes);
}

function pluralForms(name: string, wordTokens: string[]): string[] {
  const forms = new Set<string>();
  const addPlural = (value: string) => {
    if (!value || value.endsWith('s')) return;
    forms.add(`${value}${/(?:s|x|z|ch|sh)$/.test(value) ? 'es' : 's'}`);
  };
  addPlural(name);
  if (wordTokens.length >= 2) {
    const last = wordTokens.at(-1) || '';
    if (last && !last.endsWith('s')) {
      const pluralLast = `${last}${/(?:s|x|z|ch|sh)$/.test(last) ? 'es' : 's'}`;
      forms.add([...wordTokens.slice(0, -1), pluralLast].join(''));
      forms.add([...wordTokens.slice(0, -1), pluralLast].join('-'));
    }
  }
  return [...forms];
}

function resolveKeyboardLayout(options: GenerationOptions): KeyboardLayout {
  const requested = typeof options?.keyboardLayout === 'string' ? options.keyboardLayout : DEFAULT_KEYBOARD_LAYOUT;
  return KEYBOARD_LAYOUTS[requested] || KEYBOARD_LAYOUTS[DEFAULT_KEYBOARD_LAYOUT];
}

function selectCandidateTlds(sourceTld: string | null, fallbackTlds: unknown, enabledFamilies: Set<string>) {
  if (sourceTld && !enabledFamilies.has('tld_substitution')) {
    return { values: [sourceTld], truncated: false };
  }
  const normalizedFallbackTlds = normalizeTlds(fallbackTlds);
  const combinedTlds = sourceTld
    ? [sourceTld, ...normalizedFallbackTlds.values.filter((value) => value !== sourceTld)]
    : normalizedFallbackTlds.values;
  return {
    values: combinedTlds.slice(0, MAX_GENERATION_TLDS),
    truncated: normalizedFallbackTlds.truncated || combinedTlds.length > MAX_GENERATION_TLDS,
  };
}

function toAsciiLabel(label: string): string | null {
  try {
    return new URL(`https://${label}.example`).hostname.replace(/\.example$/, '');
  } catch {
    return null;
  }
}

function generationState(sourceName: string, enabledFamilies: Set<string>): GenerationState {
  return {
    sourceName,
    variants: new Map(),
    familyCounts: new Map(),
    limitReasons: new Set(),
    rejectedVariantCount: 0,
    enabledFamilies,
  };
}

function addVariant(state: GenerationState, variant: string, mutationType: string): void {
  if (!state.enabledFamilies.has(mutationType)) return;
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

function interleaveVariantsByFamily(variants: Map<string, Set<string>>): Array<[string, Set<string>]> {
  const grouped = new Map<string, Array<[string, Set<string>]>>();
  for (const entry of variants) {
    const primaryFamily = entry[1].values().next().value;
    if (typeof primaryFamily !== 'string') continue;
    const group = grouped.get(primaryFamily) || [];
    group.push(entry);
    grouped.set(primaryFamily, group);
  }

  const ordered: Array<[string, Set<string>]> = [];
  const groups = [...grouped.values()];
  const longestGroup = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < longestGroup; index += 1) {
    for (const group of groups) {
      const entry = group[index];
      if (entry) ordered.push(entry);
    }
  }
  return ordered;
}

/**
 * Returns a cheap upper-bound estimate without allocating candidate objects.
 * The estimate intentionally precedes validity filtering and deduplication, so
 * the generated result can be smaller but never larger than this bounded value.
 */
export function estimateTyposquatCandidateCount(rawInput: unknown, fallbackTlds: unknown, options: GenerationOptions = {}) {
  const parts = splitDomainParts(rawInput);
  const preset = resolveGenerationPreset(options);
  const keyboardLayout = resolveKeyboardLayout(options);
  const customDictionary = normalizeCustomDictionaryTerms(options.dictionaryTerms);
  if (!parts) {
    return { inputValid: false, preset: preset.id, tldCount: 0, estimatedMaximum: 0, mayReachLimit: false };
  }

  const enabledFamilies = resolveEnabledFamilies(preset, options);
  const selectedTlds = selectCandidateTlds(parts.tld, fallbackTlds, enabledFamilies);
  if (selectedTlds.values.length === 0) {
    return {
      inputValid: true,
      preset: preset.id,
      tldCount: 0,
      estimatedMaximum: 0,
      mayReachLimit: selectedTlds.truncated,
    };
  }

  const name = parts.name;
  const hyphenCount = [...name].filter((character) => character === '-').length;
  let hyphenationCount = 0;
  for (let index = 1; index < name.length; index += 1) {
    if (name[index - 1] !== '-' && name[index] !== '-') hyphenationCount += 1;
  }
  let wordOrderMaximum = 0;
  if (parts.wordTokens.length >= 2) {
    let orderCount = 1;
    for (let value = 2; value <= parts.wordTokens.length; value += 1) orderCount *= value;
    wordOrderMaximum = Math.max(0, orderCount - 1) * 2;
  }
  let adjacentCount = 0;
  let vowelCount = 0;
  let asciiHomoglyphCount = 0;
  let unicodeHomoglyphCount = 0;
  for (const character of name) {
    adjacentCount += keyboardLayout.adjacent[character]?.length || 0;
    if (VOWELS.includes(character)) vowelCount += 1;
    unicodeHomoglyphCount += confusableCharactersForAscii(character)?.length || 0;
  }
  for (const [from] of HOMOGLYPH_SWAPS) {
    if (name.includes(from)) asciiHomoglyphCount += 1;
  }

  const rawFamilyCounts = {
    character_addition: 36 * (1 + hyphenCount),
    character_omission: name.length,
    character_duplication: name.length,
    character_transposition: Math.max(0, name.length - 1),
    pluralization: pluralForms(name, parts.wordTokens).length,
    tld_embedding: parts.tld ? 2 : 0,
    www_prefix: 3,
    hyphenation: hyphenationCount,
    separator_omission: hyphenCount > 0 ? hyphenCount + 1 : 0,
    word_reordering: wordOrderMaximum,
    keyboard_substitution: adjacentCount,
    keyboard_insertion: adjacentCount * 2,
    vowel_swap: vowelCount * (VOWELS.length - 1),
    bitsquatting: name.length * 8,
    ascii_homoglyph: asciiHomoglyphCount,
    unicode_homoglyph: unicodeHomoglyphCount,
    unicode_whole_label: wholeLabelConfusableVariantsForAscii(name).length,
    dictionary: [...new Set([...IMPERSONATION_TERMS, ...customDictionary.values])].length * 4,
    dictionary_token_replacement: name.includes('-') && parts.wordTokens.length >= 2
      ? customDictionary.values.length * 2
      : 0,
  };
  let rawVariantMaximum = 0;
  let familyLimitPossible = false;
  for (const [mutationType, rawCount] of Object.entries(rawFamilyCounts)) {
    if (!enabledFamilies.has(mutationType)) continue;
    const familyLimit = FAMILY_NEW_VARIANT_LIMITS[mutationType];
    rawVariantMaximum += Math.min(rawCount, familyLimit);
    if (rawCount > familyLimit) familyLimitPossible = true;
  }
  const variantMaximum = Math.min(rawVariantMaximum, MAX_NAME_VARIANTS);
  const tldTypoMaximum = parts.tld && enabledFamilies.has('tld_typo') ? (TLD_TYPOS[parts.tld]?.length || 0) : 0;
  const tldSubstitutionMaximum = parts.tld && enabledFamilies.has('tld_substitution')
    ? Math.max(0, selectedTlds.values.length - 1)
    : 0;
  const rawCandidateMaximum = (variantMaximum * selectedTlds.values.length) + tldTypoMaximum + tldSubstitutionMaximum;
  return {
    inputValid: true,
    preset: preset.id,
    tldCount: selectedTlds.values.length,
    estimatedMaximum: Math.min(rawCandidateMaximum, MAX_GENERATED_CANDIDATES),
    mayReachLimit: selectedTlds.truncated
      || ((enabledFamilies.has('dictionary') || enabledFamilies.has('dictionary_token_replacement'))
        && customDictionary.truncated)
      || familyLimitPossible
      || rawVariantMaximum > MAX_NAME_VARIANTS
      || rawCandidateMaximum > MAX_GENERATED_CANDIDATES,
  };
}

/**
 * Generates a bounded, deterministic candidate set with diagnostic metadata.
 * Compatibility callers can continue to use generateTyposquatCandidates().
 * @returns {TyposquatGenerationResult}
 */
export function generateTyposquatCandidateSet(rawInput: unknown, fallbackTlds: unknown, options: GenerationOptions = {}): TyposquatGenerationResult {
  const preset = resolveGenerationPreset(options);
  const keyboardLayout = resolveKeyboardLayout(options);
  const customDictionary = normalizeCustomDictionaryTerms(options.dictionaryTerms);
  const enabledFamilies = resolveEnabledFamilies(preset, options);
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
  const normalizedTlds = selectCandidateTlds(tld, fallbackTlds, enabledFamilies);
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

  const state = generationState(name, enabledFamilies);
  if ((enabledFamilies.has('dictionary') || enabledFamilies.has('dictionary_token_replacement'))
    && customDictionary.truncated) {
    state.limitReasons.add('dictionary-terms');
  }

  if (enabledFamilies.has('character_addition')) {
    const insertionPoints = [name.length];
    for (let index = 1; index < name.length; index += 1) {
      if (name[index] === '-') insertionPoints.push(index);
    }
    for (const index of insertionPoints) {
      for (const character of '0123456789abcdefghijklmnopqrstuvwxyz') {
        addVariant(state, `${name.slice(0, index)}${character}${name.slice(index)}`, 'character_addition');
      }
    }
  }

  if (enabledFamilies.has('character_omission') || enabledFamilies.has('character_duplication')) {
    for (let i = 0; i < name.length; i += 1) {
      if (enabledFamilies.has('character_omission')) {
        addVariant(state, name.slice(0, i) + name.slice(i + 1), 'character_omission');
      }
      if (enabledFamilies.has('character_duplication')) {
        addVariant(state, name.slice(0, i + 1) + name[i] + name.slice(i + 1), 'character_duplication');
      }
    }
  }
  if (enabledFamilies.has('character_transposition')) {
    for (let i = 0; i < name.length - 1; i += 1) {
      addVariant(state, name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2), 'character_transposition');
    }
  }
  if (enabledFamilies.has('pluralization')) {
    for (const variant of pluralForms(name, parts.wordTokens)) addVariant(state, variant, 'pluralization');
  }
  if (enabledFamilies.has('tld_embedding') && tld) {
    addVariant(state, `${name}${tld}`, 'tld_embedding');
    addVariant(state, `${name}-${tld}`, 'tld_embedding');
  }
  if (enabledFamilies.has('www_prefix')) {
    addVariant(state, `ww${name}`, 'www_prefix');
    addVariant(state, `www${name}`, 'www_prefix');
    addVariant(state, `www-${name}`, 'www_prefix');
  }
  if (enabledFamilies.has('hyphenation')) {
    for (let index = 1; index < name.length; index += 1) {
      if (name[index - 1] === '-' || name[index] === '-') continue;
      addVariant(state, `${name.slice(0, index)}-${name.slice(index)}`, 'hyphenation');
    }
  }
  if (enabledFamilies.has('separator_omission') && name.includes('-')) {
    for (let index = 0; index < name.length; index += 1) {
      if (name[index] === '-') addVariant(state, name.slice(0, index) + name.slice(index + 1), 'separator_omission');
    }
    addVariant(state, name.replaceAll('-', ''), 'separator_omission');
  }
  if (enabledFamilies.has('word_reordering') && parts.wordTokens.length >= 2) {
    const originalOrder = parts.wordTokens.join('\u0000');
    for (const order of distinctWordOrders(parts.wordTokens)) {
      if (order.join('\u0000') === originalOrder) continue;
      addVariant(state, order.join(''), 'word_reordering');
      addVariant(state, order.join('-'), 'word_reordering');
    }
  }
  if (enabledFamilies.has('keyboard_substitution') || enabledFamilies.has('keyboard_insertion')) {
    for (let i = 0; i < name.length; i += 1) {
      const adjacent = keyboardLayout.adjacent[name[i]];
      if (!adjacent) continue;
      for (const key of adjacent) {
        if (enabledFamilies.has('keyboard_substitution')) {
          addVariant(state, name.slice(0, i) + key + name.slice(i + 1), 'keyboard_substitution');
        }
        if (enabledFamilies.has('keyboard_insertion')) {
          addVariant(state, name.slice(0, i) + key + name.slice(i), 'keyboard_insertion');
          addVariant(state, name.slice(0, i + 1) + key + name.slice(i + 1), 'keyboard_insertion');
        }
      }
    }
  }
  if (enabledFamilies.has('vowel_swap')) {
    for (let i = 0; i < name.length; i += 1) {
      if (!VOWELS.includes(name[i])) continue;
      for (const vowel of VOWELS) {
        if (vowel !== name[i]) addVariant(state, name.slice(0, i) + vowel + name.slice(i + 1), 'vowel_swap');
      }
    }
  }
  if (enabledFamilies.has('bitsquatting')) {
    for (let i = 0; i < name.length; i += 1) {
      const code = name.charCodeAt(i);
      for (let bit = 0; bit < 8; bit += 1) {
        const flipped = String.fromCharCode(code ^ (1 << bit));
        if (/^[a-z0-9-]$/.test(flipped)) {
          addVariant(state, name.slice(0, i) + flipped + name.slice(i + 1), 'bitsquatting');
        }
      }
    }
  }
  if (enabledFamilies.has('ascii_homoglyph')) {
    for (const [from, to] of HOMOGLYPH_SWAPS) {
      if (name.includes(from)) addVariant(state, name.split(from).join(to), 'ascii_homoglyph');
    }
  }
  if (enabledFamilies.has('unicode_whole_label')) {
    for (const variant of wholeLabelConfusableVariantsForAscii(name)) {
      const ascii = toAsciiLabel(variant.unicodeLabel);
      if (!ascii) continue;
      // Preserve the established Risk-model input while separately explaining
      // that every replaceable letter uses one reviewed non-Latin script.
      addVariant(state, ascii, 'unicode_homoglyph');
      addVariant(state, ascii, 'unicode_whole_label');
    }
  }
  if (enabledFamilies.has('unicode_homoglyph')) {
    for (let i = 0; i < name.length; i += 1) {
      const substitutions = confusableCharactersForAscii(name[i]);
      if (!substitutions) continue;
      for (const substitution of substitutions) {
        const ascii = toAsciiLabel(name.slice(0, i) + substitution + name.slice(i + 1));
        if (ascii) addVariant(state, ascii, 'unicode_homoglyph');
      }
    }
  }
  if (enabledFamilies.has('dictionary')) {
    // Analyst-supplied terms are deliberate inputs, so they precede the
    // built-in vocabulary when the per-family or global cap applies.
    for (const word of [...new Set([...customDictionary.values, ...IMPERSONATION_TERMS])]) {
      addVariant(state, `${word}${name}`, 'dictionary');
      addVariant(state, `${word}-${name}`, 'dictionary');
      addVariant(state, `${name}${word}`, 'dictionary');
      addVariant(state, `${name}-${word}`, 'dictionary');
    }
  }
  if (enabledFamilies.has('dictionary_token_replacement')
    && name.includes('-')
    && parts.wordTokens.length >= 2) {
    const firstTail = parts.wordTokens.slice(1).join('-');
    const lastHead = parts.wordTokens.slice(0, -1).join('-');
    for (const word of customDictionary.values) {
      addVariant(state, `${word}-${firstTail}`, 'dictionary_token_replacement');
      addVariant(state, `${lastHead}-${word}`, 'dictionary_token_replacement');
    }
  }

  const byDomain = new Map<string, TyposquatCandidate>();
  const source = tld ? `${name}.${tld}` : name;

  function addCandidate(domain: string, candidateTld: string, mutationTypes: Iterable<string>) {
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
  if (tld && enabledFamilies.has('tld_typo') && TLD_TYPOS[tld]) {
    for (const typoTld of TLD_TYPOS[tld]) addCandidate(`${name}.${typoTld}`, typoTld, ['tld_typo']);
  }
  if (tld && enabledFamilies.has('tld_substitution')) {
    for (const candidateTld of tlds) {
      if (candidateTld !== tld) addCandidate(`${name}.${candidateTld}`, candidateTld, ['tld_substitution']);
    }
  }
  // Interleave families before applying the global candidate cap. Without
  // this deterministic round-robin, early high-volume edit families can
  // completely hide later analyst-directed or Unicode families.
  candidateLoop: for (const [variant, mutationTypes] of interleaveVariantsByFamily(state.variants)) {
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

export function generateTyposquatCandidates(rawInput: unknown, fallbackTlds: unknown, options: GenerationOptions = {}): TyposquatCandidate[] {
  return generateTyposquatCandidateSet(rawInput, fallbackTlds, options).candidates;
}

export function generateTyposquatVariants(rawInput: unknown, fallbackTlds: unknown, options: GenerationOptions = {}): string[] {
  return generateTyposquatCandidates(rawInput, fallbackTlds, options).map((candidate) => candidate.domain);
}
