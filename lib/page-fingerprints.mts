// Privacy-bounded fingerprints derived from the homepage HTML already captured
// for deep Lookup. The module never retains normalized markup or visible text:
// those intermediate representations exist only long enough to derive a digest.

import { createHash } from 'node:crypto';

type ExactBodyHash = {
  algorithm: 'sha256';
  value: string;
  scope: 'complete-body' | 'captured-prefix';
  bytes: number;
  source: string;
};

type FingerprintResourceInput = { externalOrigins?: unknown[]; truncated?: boolean };
type FingerprintIdentifier = { type: string; value: string };
type PageFingerprintOptions = {
  baseUrl?: string;
  exactBodyHash?: unknown;
  sourceTruncated?: boolean;
  resources?: FingerprintResourceInput | null;
  trackingIdentifiers?: unknown[];
  identifiersTruncated?: boolean;
};

type FormShape = { method: string; action: string; controls: Record<string, number> };

const PAGE_FINGERPRINT_VERSION = 1;
const MAX_FINGERPRINT_SOURCE_BYTES = 300000;
const MAX_FINGERPRINT_TAG_LENGTH = 4096;
const MAX_FINGERPRINT_TOKENS = 4096;
const MAX_FINGERPRINT_ATTRIBUTES = 64;
const MAX_VISIBLE_TEXT_TOKENS = 8192;
const MAX_FORM_FINGERPRINTS = 50;
const MAX_FORM_CONTROLS = 500;
const MAX_RESOURCE_HOSTS = 30;
const MAX_IDENTIFIER_VALUES = 30;
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;
const HAS_CONTROL_RE = /[\u0000-\u001f\u007f]/;
const COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g;
const RAW_BODY_RE = /<(script|style|noscript|textarea|template)\b([^>]*)>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const MARKUP_TOKEN_RE = /<\/?[A-Za-z][A-Za-z0-9:-]*\b[^>]*>|[^<]+/g;
const TAG_NAME_RE = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)/;
const ATTRIBUTE_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const WORD_RE = /[\p{L}\p{N}]+/gu;
const URL_ATTRIBUTE_NAMES = new Set(['action', 'cite', 'data', 'formaction', 'href', 'poster', 'src']);
const OMITTED_ATTRIBUTE_NAMES = new Set(['integrity', 'nonce', 'srcdoc', 'style', 'value']);
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function boundedSource(html: unknown) {
  const original = Buffer.from(typeof html === 'string' ? html : String(html || ''), 'utf8');
  const truncated = original.length > MAX_FINGERPRINT_SOURCE_BYTES;
  const bytes = truncated ? original.subarray(0, MAX_FINGERPRINT_SOURCE_BYTES) : original;
  return { bytes, text: bytes.toString('utf8'), truncated };
}

function staticMarkup(html: string): string {
  return html
    .replace(COMMENT_RE, ' ')
    .replace(RAW_BODY_RE, '<$1$2></$1>');
}

function normalizedExactBodyHash(value: unknown): ExactBodyHash | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/i.test(String(record.value || ''))) return null;
  if (!['complete-body', 'captured-prefix'].includes(String(record.scope))) return null;
  if (!Number.isSafeInteger(record.bytes) || Number(record.bytes) < 0 || Number(record.bytes) > MAX_FINGERPRINT_SOURCE_BYTES) return null;
  return {
    algorithm: 'sha256',
    value: String(record.value).toLowerCase(),
    scope: record.scope as ExactBodyHash['scope'],
    bytes: Number(record.bytes),
    source: 'captured-response-bytes',
  };
}

function parseAttributes(tag: string): { values: Map<string, string>; truncated: boolean } {
  const start = tag.search(/\s/);
  if (start === -1) return { values: new Map<string, string>(), truncated: false };
  const values = new Map<string, string>();
  let truncated = false;
  let match;
  ATTRIBUTE_RE.lastIndex = 0;
  while ((match = ATTRIBUTE_RE.exec(tag.slice(start)))) {
    const name = match[1].toLowerCase();
    if (values.has(name)) continue;
    if (values.size >= MAX_FINGERPRINT_ATTRIBUTES) {
      truncated = true;
      break;
    }
    values.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return { values, truncated };
}

function decodeStableEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
  return text.replace(/&(?:#(\d{1,7})|#x([a-f0-9]{1,6})|([a-z]{2,8}));/gi, (whole, decimal, hex, name) => {
    if (name) return named[name.toLowerCase()] ?? whole.toLowerCase();
    const point = Number.parseInt(decimal || hex, decimal ? 10 : 16);
    if (!Number.isInteger(point) || point <= 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return ' ';
    return String.fromCodePoint(point);
  });
}

function looksRandom(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const compact = value.replace(/[-_]/g, '');
  if (/^[a-f0-9]{16,}$/i.test(compact)) return true;
  if (/^[a-z0-9+/]{20,}={0,2}$/i.test(compact) && /[a-z]/i.test(compact) && /\d/.test(compact)) return true;
  return false;
}

function reduceDynamicValues(value: string): string {
  return value
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}(?:[t\s]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?)?\b/gi, '<time>')
    .replace(/\b\d{10,13}\b/g, '<time>')
    .replace(/\b[a-f0-9]{16,}\b/gi, '<id>')
    .replace(/\b(?=[a-z0-9_-]{20,}\b)(?=[a-z0-9_-]*[a-z])(?=[a-z0-9_-]*\d)[a-z0-9_-]+\b/gi, '<id>');
}

function normalizeText(value: unknown, maxLength = 512): string {
  const normalized = reduceDynamicValues(decodeStableEntities(String(value || '')))
    .normalize('NFKC')
    .replace(CONTROL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return normalized.slice(0, maxLength);
}

function normalizeUrlAttribute(value: unknown, baseUrl: string): string | null {
  if (typeof value !== 'string' || !value || value.length > MAX_FINGERPRINT_TAG_LENGTH || HAS_CONTROL_RE.test(value)) return null;
  try {
    const url = new URL(value.trim(), baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) return null;
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, MAX_FINGERPRINT_TAG_LENGTH);
  } catch {
    return null;
  }
}

function normalizeAttribute(name: string, value: string, baseUrl: string): string | null {
  if (OMITTED_ATTRIBUTE_NAMES.has(name) || name.startsWith('data-') || name.startsWith('on')
    || /(?:csrf|nonce|session|token)/i.test(name)) return null;
  if (name === 'srcset') return null;
  if (URL_ATTRIBUTE_NAMES.has(name)) {
    const normalized = normalizeUrlAttribute(value, baseUrl);
    return normalized ? `${name}=${normalized}` : name;
  }
  if (name === 'class') {
    const classes = normalizeText(value, 1024).split(' ').filter((item) => item && !looksRandom(item)).sort();
    return classes.length ? `${name}=${classes.join('.')}` : name;
  }
  const normalized = normalizeText(value, 256);
  if ((name === 'id' || name === 'name') && looksRandom(normalized)) return name;
  return normalized ? `${name}=${normalized}` : name;
}

function normalizedMarkupAndStructure(html: string, baseUrl: string) {
  const markup = staticMarkup(html);
  const normalizedTokens: string[] = [];
  const structureTokens: string[] = [];
  const visibleSegments: string[] = [];
  let normalizedTruncated = false;
  let structureTruncated = false;
  let attributesTruncated = false;
  let oversizedTag = false;
  let match;
  MARKUP_TOKEN_RE.lastIndex = 0;
  while ((match = MARKUP_TOKEN_RE.exec(markup))) {
    const token = match[0];
    if (token.startsWith('<')) {
      if (token.length > MAX_FINGERPRINT_TAG_LENGTH) {
        oversizedTag = true;
        continue;
      }
      const nameMatch = token.match(TAG_NAME_RE);
      if (!nameMatch) continue;
      const closing = Boolean(nameMatch[1]);
      const name = nameMatch[2].toLowerCase();
      const selfClosing = !closing && (VOID_TAGS.has(name) || /\/\s*>$/.test(token));
      const structure = closing ? `/${name}` : selfClosing ? `${name}/` : name;
      if (structureTokens.length < MAX_FINGERPRINT_TOKENS) structureTokens.push(structure);
      else structureTruncated = true;

      if (normalizedTokens.length >= MAX_FINGERPRINT_TOKENS) {
        normalizedTruncated = true;
        continue;
      }
      if (closing) {
        normalizedTokens.push(`</${name}>`);
        continue;
      }
      const parsed = parseAttributes(token);
      if (parsed.truncated) attributesTruncated = true;
      const attributes = [...parsed.values.entries()]
        .map(([attributeName, value]) => {
          const metaKey = name === 'meta' ? String(parsed.values.get('name') || parsed.values.get('property') || '') : '';
          if (attributeName === 'content' && /(?:csrf|nonce|session|token)/i.test(metaKey)) return null;
          return normalizeAttribute(attributeName, value, baseUrl);
        })
        .filter(Boolean)
        .sort();
      normalizedTokens.push(`<${name}${attributes.length ? ` ${attributes.join(' ')}` : ''}${selfClosing ? '/' : ''}>`);
      continue;
    }

    const text = normalizeText(token, MAX_FINGERPRINT_SOURCE_BYTES);
    if (!text) continue;
    visibleSegments.push(text);
    if (normalizedTokens.length < MAX_FINGERPRINT_TOKENS) normalizedTokens.push(`#text:${text.slice(0, 512)}`);
    else normalizedTruncated = true;
  }
  return {
    normalizedTokens,
    structureTokens,
    visibleText: visibleSegments.join(' '),
    normalizedTruncated: normalizedTruncated || attributesTruncated || oversizedTag,
    structureTruncated: structureTruncated || oversizedTag,
    attributesTruncated,
    oversizedTag,
  };
}

function simHash64(tokens: string[]): { value: string; featureCount: number } | null {
  if (!tokens.length) return null;
  const features = new Map();
  const width = tokens.length >= 3 ? 3 : 1;
  for (let index = 0; index <= tokens.length - width; index += 1) {
    const feature = tokens.slice(index, index + width).join('\u001f');
    features.set(feature, Math.min(3, (features.get(feature) || 0) + 1));
  }
  const vector = new Int32Array(64);
  for (const [feature, weight] of features) {
    const hash = createHash('sha256').update(feature).digest().readBigUInt64BE(0);
    for (let bit = 0; bit < 64; bit += 1) vector[bit] += ((hash >> BigInt(bit)) & 1n) === 1n ? weight : -weight;
  }
  let result = 0n;
  for (let bit = 0; bit < 64; bit += 1) if (vector[bit] > 0) result |= 1n << BigInt(bit);
  return { value: result.toString(16).padStart(16, '0'), featureCount: features.size };
}

function visibleTextFingerprint(text: string) {
  const allTokens = text.match(WORD_RE) || [];
  const truncated = allTokens.length > MAX_VISIBLE_TEXT_TOKENS;
  const tokens = allTokens.slice(0, MAX_VISIBLE_TEXT_TOKENS).map((token) => normalizeText(token, 128)).filter(Boolean);
  const result = simHash64(tokens);
  return result ? {
    algorithm: 'simhash64-v1',
    value: result.value,
    tokenCount: tokens.length,
    featureCount: result.featureCount,
    truncated,
  } : null;
}

function formActionClass(value: unknown, baseUrl: string): string {
  if (typeof value !== 'string' || !value.trim()) return 'self';
  const normalized = normalizeUrlAttribute(value, baseUrl);
  if (!normalized) return 'invalid';
  const base = new URL(baseUrl);
  const action = new URL(normalized);
  if (action.origin === base.origin) return 'same-origin';
  if (base.protocol === 'https:' && action.protocol === 'http:') return 'external-insecure';
  return 'external';
}

function formStructureFingerprint(markup: string, baseUrl: string) {
  const forms: FormShape[] = [];
  let current: FormShape | null = null;
  let formLimitReached = false;
  let controlLimitReached = false;
  let controls = 0;
  let match;
  MARKUP_TOKEN_RE.lastIndex = 0;
  while ((match = MARKUP_TOKEN_RE.exec(markup))) {
    const token = match[0];
    if (!token.startsWith('<') || token.length > MAX_FINGERPRINT_TAG_LENGTH) continue;
    const nameMatch = token.match(TAG_NAME_RE);
    if (!nameMatch) continue;
    const closing = Boolean(nameMatch[1]);
    const name = nameMatch[2].toLowerCase();
    if (name === 'form') {
      if (closing) {
        if (current) forms.push(current);
        current = null;
        continue;
      }
      if (current) forms.push(current);
      if (forms.length >= MAX_FORM_FINGERPRINTS) {
        formLimitReached = true;
        current = null;
        continue;
      }
      const attributes = parseAttributes(token).values;
      const rawMethod = normalizeText(attributes.get('method') || 'get', 20);
      current = {
        method: /^[a-z]{1,20}$/.test(rawMethod) ? rawMethod : 'other',
        action: formActionClass(attributes.get('action'), baseUrl),
        controls: {},
      };
      continue;
    }
    if (!current || closing || !['button', 'input', 'select', 'textarea'].includes(name)) continue;
    if (controls >= MAX_FORM_CONTROLS) {
      controlLimitReached = true;
      continue;
    }
    controls += 1;
    const attributes = parseAttributes(token).values;
    const rawType = name === 'input' || name === 'button'
      ? normalizeText(attributes.get('type') || (name === 'input' ? 'text' : 'submit'), 30)
      : name;
    const type = /^[a-z0-9-]{1,30}$/.test(rawType) ? `${name}:${rawType}` : `${name}:other`;
    current.controls[type] = (current.controls[type] || 0) + 1;
  }
  if (current) forms.push(current);
  if (forms.length > MAX_FORM_FINGERPRINTS) {
    forms.length = MAX_FORM_FINGERPRINTS;
    formLimitReached = true;
  }
  for (const form of forms) form.controls = Object.fromEntries(Object.entries(form.controls).sort(([left], [right]) => left.localeCompare(right)));
  return forms.length ? {
    algorithm: 'sha256',
    value: sha256(JSON.stringify(forms)),
    formCount: forms.length,
    controlCount: controls,
    truncated: formLimitReached || controlLimitReached,
  } : null;
}

function normalizedResourceHosts(resources: FingerprintResourceInput | null | undefined) {
  const input = Array.isArray(resources?.externalOrigins) ? resources.externalOrigins : [];
  const hosts = new Set();
  let truncated = resources?.truncated === true || input.length > MAX_RESOURCE_HOSTS;
  for (const value of input) {
    if (hosts.size >= MAX_RESOURCE_HOSTS) {
      truncated = true;
      break;
    }
    if (typeof value !== 'string') continue;
    try {
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.hostname) hosts.add(url.hostname.toLowerCase());
    } catch {
      // Invalid retained input cannot contribute to a new fingerprint.
    }
  }
  const values = [...hosts].sort();
  return {
    algorithm: 'set-sha256',
    value: values.length ? sha256(JSON.stringify(values)) : null,
    values,
    truncated,
  };
}

function normalizedIdentifiers(identifiers: unknown, explicitlyTruncated = false) {
  const values: FingerprintIdentifier[] = [];
  const seen = new Set();
  let truncated = explicitlyTruncated || (Array.isArray(identifiers) && identifiers.length > MAX_IDENTIFIER_VALUES);
  for (const item of Array.isArray(identifiers) ? identifiers : []) {
    if (values.length >= MAX_IDENTIFIER_VALUES) {
      truncated = true;
      break;
    }
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const type = String(record.type || '');
    const value = String(record.value || '');
    if (!/^[a-z-]{1,40}$/.test(type) || !/^[A-Z0-9-]{1,64}$/.test(value)) continue;
    const key = `${type}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    values.push({ type, value });
  }
  values.sort((left, right) => left.type.localeCompare(right.type) || left.value.localeCompare(right.value));
  return {
    algorithm: 'set-sha256',
    value: values.length ? sha256(JSON.stringify(values)) : null,
    values,
    truncated,
  };
}

function createPageFingerprints(html: unknown, options: PageFingerprintOptions = {}) {
  const source = boundedSource(html);
  const baseUrl = (() => {
    try {
      const url = new URL(typeof options.baseUrl === 'string' ? options.baseUrl : 'https://invalid.example/');
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : 'https://invalid.example/';
    } catch {
      return 'https://invalid.example/';
    }
  })();
  let exact = normalizedExactBodyHash(options.exactBodyHash) || {
    algorithm: 'sha256',
    value: sha256(source.bytes),
    scope: options.sourceTruncated === true || source.truncated ? 'captured-prefix' : 'complete-body',
    bytes: source.bytes.length,
    source: 'decoded-markup',
  };
  if (options.sourceTruncated === true && exact.scope === 'complete-body') exact = { ...exact, scope: 'captured-prefix' };
  const normalized = normalizedMarkupAndStructure(source.text, baseUrl);
  const text = visibleTextFingerprint(normalized.visibleText);
  const forms = formStructureFingerprint(staticMarkup(source.text), baseUrl);
  const resourceHosts = normalizedResourceHosts(options.resources);
  const identifiers = normalizedIdentifiers(options.trackingIdentifiers, options.identifiersTruncated === true);
  const truncated = options.sourceTruncated === true || source.truncated || normalized.normalizedTruncated
    || normalized.structureTruncated || text?.truncated === true || forms?.truncated === true
    || resourceHosts.truncated || identifiers.truncated;
  const limitations = [
    'Fingerprints summarize capped static HTML and are comparison aids, not cryptographic proof of page authorship or intent.',
    'Visible-text SimHash is a fuzzy similarity fingerprint and must not be treated as a cryptographic digest.',
  ];
  if (source.truncated) limitations.push(`Fingerprint input was capped at ${MAX_FINGERPRINT_SOURCE_BYTES} UTF-8 bytes.`);
  if (normalized.normalizedTruncated || normalized.structureTruncated) limitations.push(`Fingerprint tokenization reached the ${MAX_FINGERPRINT_TOKENS}-token or ${MAX_FINGERPRINT_TAG_LENGTH}-character tag boundary.`);
  if (normalized.attributesTruncated) limitations.push(`Some tags exceeded the ${MAX_FINGERPRINT_ATTRIBUTES}-attribute fingerprint boundary.`);
  if (text?.truncated) limitations.push(`Visible-text fingerprinting retained only the first ${MAX_VISIBLE_TEXT_TOKENS} normalized tokens.`);
  if (forms?.truncated) limitations.push(`Form fingerprinting retained at most ${MAX_FORM_FINGERPRINTS} forms and ${MAX_FORM_CONTROLS} controls.`);
  return {
    fingerprintVersion: PAGE_FINGERPRINT_VERSION,
    exact,
    normalizedHtml: {
      algorithm: 'sha256',
      value: sha256(normalized.normalizedTokens.join('\n')),
      tokenCount: normalized.normalizedTokens.length,
      truncated: normalized.normalizedTruncated,
    },
    visibleText: text,
    domStructure: {
      algorithm: 'sha256',
      value: sha256(normalized.structureTokens.join('\n')),
      nodeCount: normalized.structureTokens.length,
      parser: 'static-tag-sequence-v1',
      truncated: normalized.structureTruncated,
    },
    formStructure: forms,
    resourceHosts,
    identifiers,
    complete: !truncated,
    truncated,
    limitations,
  };
}

export {
  PAGE_FINGERPRINT_VERSION,
  MAX_FINGERPRINT_SOURCE_BYTES,
  MAX_FINGERPRINT_TOKENS,
  MAX_VISIBLE_TEXT_TOKENS,
  MAX_FORM_FINGERPRINTS,
  MAX_FORM_CONTROLS,
  createPageFingerprints,
};
