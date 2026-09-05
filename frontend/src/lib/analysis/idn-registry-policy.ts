import { analyzeDomainIdn } from './idn-confusables.ts';

export const IDN_POLICY_SCHEMA = 'whoisleuth.registry-idn-policy';
export const IDN_POLICY_VERSION = 1;
export const MAX_IDN_POLICY_BYTES = 2 * 1024 * 1024;
export const MAX_IDN_POLICY_ELEMENTS = 50_000;
export const MAX_IDN_POLICY_RANGES = 20_000;
export const MAX_IDN_POLICY_CODEPOINTS = 200_000;

type CodePointRange = Readonly<{ start: number; end: number }>;

export type RegistryIdnPolicy = Readonly<{
  schema: typeof IDN_POLICY_SCHEMA;
  version: typeof IDN_POLICY_VERSION;
  suffix: string;
  sourceName: string;
  sourceDigestSha256: string;
  ranges: readonly CodePointRange[];
  codePointCount: number;
  sequenceCount: number;
  limitations: readonly string[];
}>;

export type RegistryIdnCandidateReview = Readonly<{
  domain: string;
  unicodeDomain: string;
  state: 'allowed_by_table' | 'not_listed' | 'ascii_only' | 'out_of_scope' | 'unavailable';
  label: string | null;
  unlistedCodePoints: readonly string[];
  explanation: string;
}>;

const SUFFIX_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const CODE_POINT_RE = /^[0-9a-f]{1,6}$/i;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizeSuffix(value: unknown): string {
  const suffix = String(value ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!suffix || suffix.length > 253 || !SUFFIX_RE.test(suffix)) {
    throw new TypeError('Enter the DNS-safe ASCII suffix covered by this registry table.');
  }
  return suffix;
}

function sourceName(value: unknown): string {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return normalized || 'local-registry-table.xml';
}

function digest(value: unknown): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError('The registry table digest is missing or invalid.');
  }
  return normalized;
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attributes);
  return match?.[2]?.trim() || null;
}

function codePoint(value: string | null): number | null {
  if (!value || !CODE_POINT_RE.test(value)) return null;
  const parsed = Number.parseInt(value, 16);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 0x10ffff ? parsed : null;
}

function xmlTagEnd(value: string, start: number): number {
  let quote = '';
  for (let index = start; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return index;
  }
  return -1;
}

function localXmlName(value: string): string {
  return value.split(':').at(-1)?.toLowerCase() ?? '';
}

function scanLgrRepertoire(xml: string): Readonly<{
  ranges: CodePointRange[];
  sequenceCount: number;
  elementCount: number;
}> {
  const ranges: CodePointRange[] = [];
  const stack: string[] = [];
  let sequenceCount = 0;
  let elementCount = 0;
  let rootSeen = false;
  let rootClosed = false;
  let cursor = 0;

  while (cursor < xml.length) {
    const open = xml.indexOf('<', cursor);
    const textOutsideRoot = open < 0 ? xml.slice(cursor) : xml.slice(cursor, open);
    if ((!rootSeen || rootClosed) && textOutsideRoot.trim()) {
      throw new TypeError('The registry table XML contains text outside its LGR root element.');
    }
    if (open < 0) break;

    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4);
      if (end < 0) throw new TypeError('The registry table XML contains an unterminated comment.');
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', open)) {
      if (!stack.length) throw new TypeError('The registry table XML contains CDATA outside its LGR root element.');
      const end = xml.indexOf(']]>', open + 9);
      if (end < 0) throw new TypeError('The registry table XML contains an unterminated CDATA section.');
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<?', open)) {
      const end = xml.indexOf('?>', open + 2);
      if (end < 0) throw new TypeError('The registry table XML contains an unterminated processing instruction.');
      cursor = end + 2;
      continue;
    }
    if (xml.startsWith('<!', open)) {
      throw new TypeError('The registry table XML contains an unsupported declaration.');
    }

    const end = xmlTagEnd(xml, open + 1);
    if (end < 0) throw new TypeError('The registry table XML contains an unterminated element.');
    const rawTag = xml.slice(open + 1, end).trim();
    if (rawTag.startsWith('/')) {
      const closing = /^\/\s*([A-Za-z_][\w.:-]*)\s*$/u.exec(rawTag)?.[1] ?? '';
      const expected = stack.pop() ?? '';
      if (!closing || closing !== expected) {
        throw new TypeError('The registry table XML contains mismatched elements.');
      }
      if (!stack.length) rootClosed = true;
      cursor = end + 1;
      continue;
    }

    if (rootClosed) throw new TypeError('The registry table XML contains more than one root element.');
    const selfClosing = /\/\s*$/u.test(rawTag);
    const start = /^([A-Za-z_][\w.:-]*)([\s\S]*)$/u.exec(rawTag);
    const qualifiedName = start?.[1] ?? '';
    if (!qualifiedName) throw new TypeError('The registry table XML contains a malformed element.');
    const elementName = localXmlName(qualifiedName);
    let attributes = start?.[2] ?? '';
    if (selfClosing) attributes = attributes.replace(/\/\s*$/u, '');
    if (!stack.length) {
      if (rootSeen || elementName !== 'lgr') {
        throw new TypeError('The selected XML does not have an LGR root element.');
      }
      rootSeen = true;
    }

    const insideRepertoireData = stack.length === 2 && localXmlName(stack[0] ?? '') === 'lgr' && localXmlName(stack[1] ?? '') === 'data';
    if (insideRepertoireData && (elementName === 'char' || elementName === 'range')) {
      elementCount += 1;
      if (elementCount > MAX_IDN_POLICY_ELEMENTS) {
        throw new TypeError(`Registry table XML exceeds ${MAX_IDN_POLICY_ELEMENTS} character and range elements.`);
      }
      if (elementName === 'char') {
        const raw = attribute(attributes, 'cp');
        if (raw) {
          const sequence = raw.split(/\s+/u).filter(Boolean);
          if (sequence.length !== 1) sequenceCount += 1;
          else {
            const parsed = codePoint(sequence[0] ?? null);
            if (parsed !== null) ranges.push({ start: parsed, end: parsed });
          }
        }
      } else {
        const first = codePoint(attribute(attributes, 'first-cp'));
        const last = codePoint(attribute(attributes, 'last-cp'));
        if (first !== null && last !== null && first <= last) ranges.push({ start: first, end: last });
      }
      if (ranges.length > MAX_IDN_POLICY_RANGES) {
        throw new TypeError(`Registry table XML exceeds ${MAX_IDN_POLICY_RANGES} retained ranges.`);
      }
    }

    if (!selfClosing) stack.push(qualifiedName);
    else if (!stack.length) rootClosed = true;
    cursor = end + 1;
  }

  if (!rootSeen) throw new TypeError('The selected XML does not have an LGR root element.');
  if (stack.length || !rootClosed) throw new TypeError('The registry table XML contains unclosed elements.');
  return { ranges, sequenceCount, elementCount };
}

function mergeRanges(values: readonly CodePointRange[]): CodePointRange[] {
  const sorted = [...values].sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function rangeCount(ranges: readonly CodePointRange[]): number {
  return ranges.reduce((total, range) => total + range.end - range.start + 1, 0);
}

export async function digestRegistryIdnPolicySource(sourceText: string): Promise<string> {
  if (typeof sourceText !== 'string' || !sourceText || byteLength(sourceText) > MAX_IDN_POLICY_BYTES) {
    throw new TypeError(`Registry table XML must be between 1 byte and ${MAX_IDN_POLICY_BYTES} bytes.`);
  }
  const value = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceText));
  return `sha256:${[...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, '0')).join('')}`;
}

export function parseRegistryIdnPolicy(input: {
  suffix: unknown;
  sourceName: unknown;
  sourceDigestSha256: unknown;
  xml: unknown;
}): RegistryIdnPolicy {
  if (typeof input.xml !== 'string' || !input.xml || byteLength(input.xml) > MAX_IDN_POLICY_BYTES) {
    throw new TypeError(`Registry table XML must be between 1 byte and ${MAX_IDN_POLICY_BYTES} bytes.`);
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(input.xml)) {
    throw new TypeError('Registry table XML containing document types or entities is not accepted.');
  }
  const { ranges, sequenceCount, elementCount } = scanLgrRepertoire(input.xml);
  if (!elementCount || !ranges.length) {
    throw new TypeError('The registry table did not contain any supported single-code-point entries.');
  }
  const merged = mergeRanges(ranges);
  const codePointCount = rangeCount(merged);
  if (codePointCount > MAX_IDN_POLICY_CODEPOINTS) {
    throw new TypeError(`Registry table XML describes more than ${MAX_IDN_POLICY_CODEPOINTS} code points.`);
  }
  return Object.freeze({
    schema: IDN_POLICY_SCHEMA,
    version: IDN_POLICY_VERSION,
    suffix: normalizeSuffix(input.suffix),
    sourceName: sourceName(input.sourceName),
    sourceDigestSha256: digest(input.sourceDigestSha256),
    ranges: Object.freeze(merged.map((range) => Object.freeze(range))),
    codePointCount,
    sequenceCount,
    limitations: Object.freeze([
      'This review checks only whether individual code points appear in the imported LGR repertoire.',
      'Context rules, variant dispositions, whole-label rules, registry eligibility, price, and live availability are not evaluated.',
      ...(sequenceCount ? [`${sequenceCount} multi-code-point sequence entr${sequenceCount === 1 ? 'y was' : 'ies were'} excluded from the individual-code-point repertoire.`] : []),
    ]),
  });
}

function includesCodePoint(policy: RegistryIdnPolicy, value: number): boolean {
  let low = 0;
  let high = policy.ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = policy.ranges[middle];
    if (!range) return false;
    if (value < range.start) high = middle - 1;
    else if (value > range.end) low = middle + 1;
    else return true;
  }
  return false;
}

function codePointLabel(value: number): string {
  return `U+${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function reviewRegistryIdnCandidates(
  policy: RegistryIdnPolicy,
  candidates: readonly { domain: unknown; unicodeDomain?: unknown }[],
): RegistryIdnCandidateReview[] {
  const output: RegistryIdnCandidateReview[] = [];
  for (const candidate of candidates.slice(0, 2_000)) {
    const domain = String(candidate.domain ?? '').trim().toLowerCase().slice(0, 253);
    if (!domain) continue;
    const suffixLabels = policy.suffix.split('.');
    const asciiLabels = domain.split('.');
    const suffixMatches = asciiLabels.length > suffixLabels.length
      && asciiLabels.slice(-suffixLabels.length).join('.') === policy.suffix;
    const analyzed = analyzeDomainIdn(domain);
    const unicodeDomain = typeof candidate.unicodeDomain === 'string' && candidate.unicodeDomain
      ? candidate.unicodeDomain.slice(0, 253)
      : analyzed?.unicodeDomain ?? domain;
    if (!suffixMatches) {
      output.push({ domain, unicodeDomain, state: 'out_of_scope', label: null, unlistedCodePoints: [], explanation: `The candidate is outside .${policy.suffix}, the scope assigned to this local table.` });
      continue;
    }
    const unicodeLabels = unicodeDomain.split('.');
    const label = unicodeLabels[unicodeLabels.length - suffixLabels.length - 1] ?? null;
    if (!label) {
      output.push({ domain, unicodeDomain, state: 'unavailable', label: null, unlistedCodePoints: [], explanation: 'The registrable label could not be isolated for local table review.' });
      continue;
    }
    const nonAscii = [...label].map((character) => character.codePointAt(0)).filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0x7f);
    if (!nonAscii.length) {
      output.push({ domain, unicodeDomain, state: 'ascii_only', label, unlistedCodePoints: [], explanation: 'The reviewed label contains only ASCII characters, so the imported IDN repertoire does not apply.' });
      continue;
    }
    const missing = [...new Set(nonAscii.filter((value) => !includesCodePoint(policy, value)).map(codePointLabel))].sort();
    output.push(missing.length
      ? { domain, unicodeDomain, state: 'not_listed', label, unlistedCodePoints: missing, explanation: 'At least one non-ASCII code point was not listed in the imported repertoire.' }
      : { domain, unicodeDomain, state: 'allowed_by_table', label, unlistedCodePoints: [], explanation: 'Every non-ASCII code point appeared in the imported repertoire. Context and registry rules still require review.' });
  }
  return output;
}
