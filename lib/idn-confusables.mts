// Shared internationalized-domain analysis. This module performs no
// network requests and deliberately produces explainable similarity evidence,
// not a malicious/benign verdict. The small generated mapping is a versioned,
// bounded projection of Unicode Technical Standard #39 data plus the existing
// reviewed compatibility set. It focuses on characters that visually collapse
// to common ASCII domain-label characters.

import {
  GENERATED_CONFUSABLE_GROUPS,
  GENERATED_CONFUSABLE_MAPPING_VERSION,
  GENERATED_GENERATION_CONFUSABLE_GROUPS,
} from './generated/unicode-confusables-17.mts';
import { MAX_GENERATION_CONFUSABLES_PER_ASCII } from './idn-confusable-policy.mts';

export const IDN_ANALYSIS_VERSION = 1;
export const CONFUSABLE_MAPPING_VERSION = GENERATED_CONFUSABLE_MAPPING_VERSION;

const MAX_DOMAIN_LENGTH = 253;
const MAX_LABELS = 20;
const MAX_UNICODE_LABEL_CODEPOINTS = 128;
const MAX_REFERENCE_DOMAINS = 50;
const MAX_REFERENCE_MATCHES = 20;
const MAX_FINDINGS = 20;

type ScriptLabel = { label: string; scripts: string[]; mixed: boolean };
type ReferenceMatch = { asciiDomain: string; unicodeDomain: string; skeleton: string };
type IdnFinding = { id: string; tone: string; label: string; detail: string };
export type WholeLabelConfusableVariant = Readonly<{ unicodeLabel: string; script: string }>;

const CONFUSABLE_TO_ASCII = new Map<string, string>();
for (const [ascii, values] of Object.entries(GENERATED_CONFUSABLE_GROUPS)) {
  for (const value of values) CONFUSABLE_TO_ASCII.set(value, ascii);
}

const SCRIPT_TESTS: ReadonlyArray<readonly [string, RegExp]> = Object.freeze([
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Coptic', /\p{Script=Coptic}/u],
  ['Deseret', /\p{Script=Deseret}/u],
  ['Lisu', /\p{Script=Lisu}/u],
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
const JAPANESE_SCRIPTS = new Set<string>(['Han', 'Hiragana', 'Katakana']);
const WHOLE_LABEL_TARGET_SCRIPTS = Object.freeze([
  'Cyrillic',
  'Greek',
  'Armenian',
  'Coptic',
  'Deseret',
  'Lisu',
]);
const MAX_WHOLE_LABEL_VARIANTS = WHOLE_LABEL_TARGET_SCRIPTS.length;
const ASCII_GENERATION_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function decodeDigit(codePoint: number): number {
  if (codePoint >= 0x61 && codePoint <= 0x7a) return codePoint - 0x61;
  if (codePoint >= 0x41 && codePoint <= 0x5a) return codePoint - 0x41;
  if (codePoint >= 0x30 && codePoint <= 0x39) return codePoint - 0x30 + 26;
  return -1;
}

function adaptBias(delta: number, pointCount: number, firstTime: boolean): number {
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
export function decodePunycodeLabel(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 59 || !/^[a-z0-9-]+$/i.test(input)) return null;
  const output: number[] = [];
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

function normalizeAsciiDomain(raw: unknown): string | null {
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

export function unicodeDomainFromAscii(raw: unknown): string | null {
  const asciiDomain = normalizeAsciiDomain(raw);
  if (!asciiDomain) return null;
  const labels: string[] = [];
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

function scriptForCharacter(character: string): string | null {
  if (!LETTER_RE.test(character)) return null;
  for (const [name, expression] of SCRIPT_TESTS) {
    if (expression.test(character)) return name;
  }
  return 'Other';
}

function isCompatibleScriptSet(scripts: string[]): boolean {
  return scripts.length <= 1 || scripts.every((script) => JAPANESE_SCRIPTS.has(script));
}

export function unicodeSkeleton(raw: unknown): string | null {
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

export function confusableCharactersForAscii(character: unknown): string[] {
  const source = String(character || '').toLowerCase();
  return [...(GENERATED_GENERATION_CONFUSABLE_GROUPS[source] || '')]
    .slice(0, MAX_GENERATION_CONFUSABLES_PER_ASCII);
}

// Builds at most one deterministic candidate per reviewed non-Latin script.
// This is a deliberately narrower generation aid than the formal UTS #39
// whole-script algorithm: it uses JavaScript Script properties rather than
// resolved Script_Extensions and therefore does not expose a standards verdict.
export function wholeLabelConfusableVariantsForAscii(raw: unknown): WholeLabelConfusableVariant[] {
  if (typeof raw !== 'string') return [];
  const label = raw.trim().toLowerCase();
  const letters = [...label].filter((character) => /^[a-z]$/u.test(character));
  if (
    label.length === 0
    || label.length > 63
    || !ASCII_GENERATION_LABEL_RE.test(label)
    || letters.length < 2
  ) return [];

  const variants: WholeLabelConfusableVariant[] = [];
  for (const targetScript of WHOLE_LABEL_TARGET_SCRIPTS) {
    let unicodeLabel = '';
    let complete = true;
    for (const character of label) {
      if (!/^[a-z]$/u.test(character)) {
        unicodeLabel += character;
        continue;
      }
      const replacement = confusableCharactersForAscii(character)
        .find((candidate) => scriptForCharacter(candidate) === targetScript);
      if (!replacement) {
        complete = false;
        break;
      }
      unicodeLabel += replacement;
    }
    if (complete && unicodeLabel !== label) {
      variants.push(Object.freeze({ unicodeLabel, script: targetScript }));
      if (variants.length >= MAX_WHOLE_LABEL_VARIANTS) break;
    }
  }
  return variants;
}

function analyzeLabels(unicodeDomain: string): { labels: ScriptLabel[]; scripts: string[] } {
  const labels: ScriptLabel[] = [];
  const allScripts = new Set<string>();
  for (const label of unicodeDomain.split('.').slice(0, MAX_LABELS)) {
    const scripts = [...new Set([...label].map(scriptForCharacter).filter((script): script is string => Boolean(script)))].sort();
    for (const script of scripts) allScripts.add(script);
    labels.push({ label, scripts, mixed: !isCompatibleScriptSet(scripts) });
  }
  return { labels, scripts: [...allScripts].sort() };
}

export function analyzeDomainIdn(rawDomain: unknown, referenceDomains: unknown = []) {
  const asciiDomain = normalizeAsciiDomain(rawDomain);
  if (!asciiDomain) return null;
  const unicodeDomain = unicodeDomainFromAscii(asciiDomain);
  if (!unicodeDomain) return null;
  const hasIdn = asciiDomain.split('.').some((label) => label.startsWith('xn--'));
  const analyzed = analyzeLabels(unicodeDomain);
  const mixedScriptLabels = analyzed.labels.filter((label) => label.mixed);
  const skeleton = unicodeSkeleton(unicodeDomain);
  const referenceMatches: ReferenceMatch[] = [];
  const seenReferences = new Set<string>();
  for (const rawReference of (Array.isArray(referenceDomains) ? referenceDomains : []).slice(0, MAX_REFERENCE_DOMAINS)) {
    const referenceAscii = normalizeAsciiDomain(rawReference);
    if (!referenceAscii || referenceAscii === asciiDomain || seenReferences.has(referenceAscii)) continue;
    seenReferences.add(referenceAscii);
    const referenceUnicode = unicodeDomainFromAscii(referenceAscii);
    const referenceSkeleton = referenceUnicode ? unicodeSkeleton(referenceUnicode) : null;
    if (!skeleton || !referenceUnicode || !referenceSkeleton || skeleton !== referenceSkeleton) continue;
    referenceMatches.push({
      asciiDomain: referenceAscii,
      unicodeDomain: referenceUnicode,
      skeleton: referenceSkeleton,
    });
    if (referenceMatches.length >= MAX_REFERENCE_MATCHES) break;
  }

  const findings: IdnFinding[] = [];
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
      'Confusable analysis uses a bounded generated mapping and cannot identify every visual similarity.',
      'Script mixing and skeleton matches are contextual indicators, not maliciousness verdicts.',
    ],
  };
}
