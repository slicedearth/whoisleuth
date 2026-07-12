// Browser-side internationalized-domain analysis. This module performs no
// network requests and deliberately produces explainable similarity evidence,
// not a malicious/benign verdict. The small mapping is a versioned, curated
// subset of the character relationships described by Unicode Technical
// Standard #39 (Unicode Security Mechanisms); it focuses on characters that
// visually collapse to common ASCII domain-label characters.

export const IDN_ANALYSIS_VERSION = 1;
export const CONFUSABLE_MAPPING_VERSION = 'tr39-curated-ascii-v1';

const MAX_DOMAIN_LENGTH = 253;
const MAX_LABELS = 20;
const MAX_UNICODE_LABEL_CODEPOINTS = 128;
const MAX_REFERENCE_DOMAINS = 50;
const MAX_REFERENCE_MATCHES = 20;
const MAX_FINDINGS = 20;
const MAX_GENERATION_CONFUSABLES = 8;

// NFKD handles full-width and mathematical presentation forms before this
// table is consulted. Keep only defensible single-character visual mappings;
// broader language-aware similarity belongs in a later, separately versioned
// mapping rather than silently changing this contract.
const CONFUSABLE_GROUPS = Object.freeze({
  a: 'аαɑ',
  b: 'ЬƄ',
  c: 'сϲⅽ',
  d: 'ԁⅾ',
  e: 'еεҽ',
  f: 'ϝ',
  g: 'ɡ',
  h: 'һհ',
  i: 'іιı',
  j: 'јϳ',
  k: 'κк',
  l: 'ӏⅼ',
  m: 'мⅿ',
  n: 'ո',
  o: 'оοօ',
  p: 'рρ',
  q: 'ԛ',
  r: 'г',
  s: 'ѕꜱ',
  t: 'тτ',
  u: 'υս',
  v: 'ѵν',
  w: 'ԝա',
  x: 'хχ',
  y: 'уү',
  z: 'ᴢ',
});

const CONFUSABLE_TO_ASCII = new Map();
for (const [ascii, values] of Object.entries(CONFUSABLE_GROUPS)) {
  for (const value of values) CONFUSABLE_TO_ASCII.set(value, ascii);
}

/** @type {ReadonlyArray<readonly [string, RegExp]>} */
const SCRIPT_TESTS = Object.freeze([
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Devanagari', /\p{Script=Devanagari}/u],
  ['Bengali', /\p{Script=Bengali}/u],
  ['Gurmukhi', /\p{Script=Gurmukhi}/u],
  ['Gujarati', /\p{Script=Gujarati}/u],
  ['Tamil', /\p{Script=Tamil}/u],
  ['Telugu', /\p{Script=Telugu}/u],
  ['Kannada', /\p{Script=Kannada}/u],
  ['Malayalam', /\p{Script=Malayalam}/u],
  ['Thai', /\p{Script=Thai}/u],
  ['Georgian', /\p{Script=Georgian}/u],
  ['Han', /\p{Script=Han}/u],
  ['Hiragana', /\p{Script=Hiragana}/u],
  ['Katakana', /\p{Script=Katakana}/u],
  ['Hangul', /\p{Script=Hangul}/u],
]);

const MARK_RE = /\p{Mark}/u;
const LETTER_RE = /\p{Letter}/u;
const JAPANESE_SCRIPTS = new Set(['Han', 'Hiragana', 'Katakana']);

function decodeDigit(codePoint) {
  if (codePoint >= 0x61 && codePoint <= 0x7a) return codePoint - 0x61;
  if (codePoint >= 0x41 && codePoint <= 0x5a) return codePoint - 0x41;
  if (codePoint >= 0x30 && codePoint <= 0x39) return codePoint - 0x30 + 26;
  return -1;
}

function adaptBias(delta, pointCount, firstTime) {
  let value = firstTime ? Math.floor(delta / 700) : delta >> 1;
  value += Math.floor(value / pointCount);
  let k = 0;
  while (value > 455) {
    value = Math.floor(value / 35);
    k += 36;
  }
  return k + Math.floor((36 * value) / (value + 38));
}

// RFC 3492 decoder kept local so the browser build does not acquire a runtime
// dependency merely to present the Unicode form of an already-normalized ACE
// label. Every arithmetic step is checked and decoded output is capped.
export function decodePunycodeLabel(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > 59 || !/^[a-z0-9-]+$/i.test(input)) return null;
  /** @type {number[]} */
  const output = [];
  const delimiter = input.lastIndexOf('-');
  let cursor = 0;
  if (delimiter >= 0) {
    for (const char of input.slice(0, delimiter)) {
      const point = char.codePointAt(0);
      if (point === undefined || point >= 0x80) return null;
      output.push(point);
    }
    cursor = delimiter + 1;
  }

  let n = 128;
  let index = 0;
  let bias = 72;
  while (cursor < input.length) {
    const oldIndex = index;
    let weight = 1;
    for (let k = 36; ; k += 36) {
      if (cursor >= input.length) return null;
      const encodedPoint = input.codePointAt(cursor++);
      if (encodedPoint === undefined) return null;
      const digit = decodeDigit(encodedPoint);
      if (digit < 0 || digit > Math.floor((Number.MAX_SAFE_INTEGER - index) / weight)) return null;
      index += digit * weight;
      const threshold = k <= bias + 1 ? 1 : k >= bias + 26 ? 26 : k - bias;
      if (digit < threshold) break;
      const baseMinusThreshold = 36 - threshold;
      if (weight > Math.floor(Number.MAX_SAFE_INTEGER / baseMinusThreshold)) return null;
      weight *= baseMinusThreshold;
    }
    const pointCount = output.length + 1;
    bias = adaptBias(index - oldIndex, pointCount, oldIndex === 0);
    const increment = Math.floor(index / pointCount);
    if (increment > 0x10ffff - n) return null;
    n += increment;
    index %= pointCount;
    if (n >= 0xd800 && n <= 0xdfff) return null;
    output.splice(index, 0, n);
    index += 1;
    if (output.length > MAX_UNICODE_LABEL_CODEPOINTS) return null;
  }

  try {
    return String.fromCodePoint(...output).normalize('NFC');
  } catch {
    return null;
  }
}

function normalizeAsciiDomain(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\.+$/, '');
  if (!trimmed || trimmed.length > MAX_DOMAIN_LENGTH || /[\u0000-\u0020\u007f]/.test(trimmed)) return null;
  let hostname;
  try {
    hostname = new URL(`https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  const labels = hostname.split('.');
  if (labels.length < 2 || labels.length > MAX_LABELS) return null;
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  return hostname;
}

export function unicodeDomainFromAscii(raw) {
  const asciiDomain = normalizeAsciiDomain(raw);
  if (!asciiDomain) return null;
  const labels = [];
  for (const label of asciiDomain.split('.')) {
    if (!label.startsWith('xn--')) {
      labels.push(label);
      continue;
    }
    const decoded = decodePunycodeLabel(label.slice(4));
    if (!decoded) return null;
    labels.push(decoded);
  }
  return labels.join('.');
}

function scriptForCharacter(character) {
  if (!LETTER_RE.test(character)) return null;
  for (const [name, expression] of SCRIPT_TESTS) {
    if (expression.test(character)) return name;
  }
  return 'Other';
}

function isCompatibleScriptSet(scripts) {
  return scripts.length <= 1 || scripts.every((script) => JAPANESE_SCRIPTS.has(script));
}

export function unicodeSkeleton(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_DOMAIN_LENGTH * 4) return null;
  let output = '';
  for (const character of raw.normalize('NFKD').toLowerCase()) {
    if (MARK_RE.test(character)) continue;
    const mapped = CONFUSABLE_TO_ASCII.get(character);
    if (mapped) {
      output += mapped;
    } else if (character === '0') {
      output += 'o';
    } else if (character === '1' || character === '|') {
      output += 'l';
    } else {
      output += character;
    }
    if (output.length > MAX_DOMAIN_LENGTH * 2) return null;
  }
  return output;
}

export function confusableCharactersForAscii(character) {
  return [...(CONFUSABLE_GROUPS[String(character || '').toLowerCase()] || '')].slice(0, MAX_GENERATION_CONFUSABLES);
}

function analyzeLabels(unicodeDomain) {
  const labels = [];
  const allScripts = new Set();
  for (const label of unicodeDomain.split('.').slice(0, MAX_LABELS)) {
    const scripts = [...new Set([...label].map(scriptForCharacter).filter(Boolean))].sort();
    for (const script of scripts) allScripts.add(script);
    labels.push({ label, scripts, mixed: !isCompatibleScriptSet(scripts) });
  }
  return { labels, scripts: [...allScripts].sort() };
}

/**
 * @param {string} rawDomain
 * @param {string[]} [referenceDomains]
 */
export function analyzeDomainIdn(rawDomain, referenceDomains = []) {
  const asciiDomain = normalizeAsciiDomain(rawDomain);
  if (!asciiDomain) return null;
  const unicodeDomain = unicodeDomainFromAscii(asciiDomain);
  if (!unicodeDomain) return null;
  const hasIdn = asciiDomain.split('.').some((label) => label.startsWith('xn--'));
  const analyzed = analyzeLabels(unicodeDomain);
  const mixedScriptLabels = analyzed.labels.filter((label) => label.mixed);
  const skeleton = unicodeSkeleton(unicodeDomain);
  const referenceMatches = [];
  const seenReferences = new Set();
  for (const rawReference of (Array.isArray(referenceDomains) ? referenceDomains : []).slice(0, MAX_REFERENCE_DOMAINS)) {
    const referenceAscii = normalizeAsciiDomain(rawReference);
    if (!referenceAscii || referenceAscii === asciiDomain || seenReferences.has(referenceAscii)) continue;
    seenReferences.add(referenceAscii);
    const referenceUnicode = unicodeDomainFromAscii(referenceAscii);
    const referenceSkeleton = referenceUnicode ? unicodeSkeleton(referenceUnicode) : null;
    if (!skeleton || !referenceSkeleton || skeleton !== referenceSkeleton) continue;
    referenceMatches.push({
      asciiDomain: referenceAscii,
      unicodeDomain: referenceUnicode,
      skeleton: referenceSkeleton,
    });
    if (referenceMatches.length >= MAX_REFERENCE_MATCHES) break;
  }

  const findings = [];
  if (hasIdn) findings.push({
    id: 'internationalized_domain',
    tone: 'info',
    label: 'Internationalized domain',
    detail: 'The DNS-safe ASCII form contains an xn-- label. Review the Unicode and ASCII forms together.',
  });
  for (const label of mixedScriptLabels) {
    findings.push({
      id: 'mixed_script_label',
      tone: 'warning',
      label: 'Mixed writing scripts',
      detail: `“${label.label}” combines ${label.scripts.join(' and ')} characters. Mixed scripts can be legitimate but deserve visual review.`,
    });
    if (findings.length >= MAX_FINDINGS) break;
  }
  if (referenceMatches.length && findings.length < MAX_FINDINGS) findings.push({
    id: 'official_skeleton_match',
    tone: 'warning',
    label: 'Confusable with an official domain',
    detail: `The normalized visual skeleton matches ${referenceMatches.map((item) => item.asciiDomain).join(', ')}. This is similarity evidence, not proof of impersonation.`,
  });

  return {
    version: IDN_ANALYSIS_VERSION,
    mappingVersion: CONFUSABLE_MAPPING_VERSION,
    asciiDomain,
    unicodeDomain,
    hasIdn,
    scripts: analyzed.scripts,
    labels: analyzed.labels,
    mixedScript: mixedScriptLabels.length > 0,
    skeleton,
    referenceMatches,
    findings,
    truncated: Array.isArray(referenceDomains) && referenceDomains.length > MAX_REFERENCE_DOMAINS,
    limitations: [
      'Confusable analysis uses a bounded curated mapping and cannot identify every visual similarity.',
      'Script mixing and skeleton matches are contextual indicators, not maliciousness verdicts.',
    ],
  };
}
