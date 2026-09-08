// Bounded favicon acquisition. Recognised image bytes produce an exact SHA-256;
// supported decoded pixels can also produce a heuristic dHash. Neither match
// establishes ownership, shared infrastructure or maliciousness. HTML error
// bodies are not image evidence and must not end candidate fallback.

import * as crypto from 'node:crypto';

import { safeFetch, readBytesCapped } from './safe-fetch.mts';
import { whoisleuthRequestHeaders } from './outbound-identity.mts';
import { faviconPerceptualHash } from './perceptual-hash.mts';
import { analyzeStaticHtml, type StaticHtmlAnalysis } from './static-html-analysis.mts';
import { isHtmlElement, parseBoundedHtml } from './bounded-html-document.mts';
import {
  FAVICON_FETCH_TIMEOUT_MS,
  MAX_FAVICON_BYTES,
  MAX_FAVICON_CANDIDATES,
} from './outbound-request-bounds.mts';
// Bounds worst-case work when a (possibly hostile) page declares many icon
// links - we try candidates in priority order and stop at the first that
// yields hashable bytes, so this only bites on pages where every earlier
// candidate fails.

type FaviconHash = { hash: string; phash: string | null };
type FaviconHtmlEvidence = Pick<StaticHtmlAnalysis, 'iconLinks' | 'effectiveBaseUrl'>;
type FaviconOptions = {
  html?: string;
  baseUrl?: string;
  htmlAnalysis?: FaviconHtmlEvidence;
  fetcher?: typeof safeFetch;
  timeoutMs?: number;
};

// Extracts favicon URLs declared in the page's own <link rel="...icon..."> tags
// (resolved to absolute URLs against the page origin), in preference order:
// standard "icon"/"shortcut icon" first, then "apple-touch-icon". data:
// URIs are passed through verbatim - decodeFaviconCandidate handles them
// without a network fetch.
function extractIconUrls(html: string, baseUrl: string, suppliedAnalysis?: FaviconHtmlEvidence): string[] {
  const analysis = suppliedAnalysis ?? analyzeStaticHtml(html, { baseUrl });
  const urls: string[] = [];
  for (const { href } of analysis.iconLinks) {
    if (/^data:/i.test(href)) {
      urls.push(href);
      continue;
    }
    try {
      const resolved = new URL(href, analysis.effectiveBaseUrl ?? baseUrl);
      if (['http:', 'https:'].includes(resolved.protocol) && !resolved.username && !resolved.password) urls.push(resolved.toString());
    } catch {
      /* malformed href - skip it */
    }
  }
  return urls;
}

// Decodes an inline `data:` favicon (base64 or percent-encoded) into a byte
// buffer, bounded to MAX_FAVICON_BYTES. Returns null on anything malformed.
function decodeDataUri(uri: string): Buffer | null {
  // Percent encoding is at most three input characters per output byte.
  // Refuse oversized encoded input before slicing or decoding it.
  if (uri.length > MAX_FAVICON_BYTES * 3 + 128) return null;
  const comma = uri.indexOf(',');
  if (comma === -1 || comma > 128) return null;
  const meta = uri.slice(5, comma);
  const data = uri.slice(comma + 1);
  try {
    const base64 = /;base64$/i.test(meta);
    if (base64 && (data.length > Math.ceil(MAX_FAVICON_BYTES / 3) * 4
      || !/^[A-Za-z0-9+/]*={0,2}$/u.test(data))) return null;
    const bytes = base64
      ? Buffer.from(data, 'base64')
      : Buffer.from(decodeURIComponent(data), 'utf8');
    return bytes.length > 0 && bytes.length <= MAX_FAVICON_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

// Admission recognises container framing, not every codec feature or rendered
// meaning. Exact-only formats remain usable; fuzzy decoding has its own pixel
// and inflate limits. All loops here operate within MAX_FAVICON_BYTES.
function isFaviconImage(bytes: Buffer): boolean {
  if (bytes.length < 6 || bytes.length > MAX_FAVICON_BYTES) return false;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let dataSeen = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = bytes.readUInt32BE(offset);
      const end = offset + 12 + size;
      if (end > bytes.length) return false;
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (offset === 8 && (type !== 'IHDR' || size !== 13
        || bytes.readUInt32BE(offset + 8) === 0 || bytes.readUInt32BE(offset + 12) === 0)) return false;
      if (type === 'IDAT' && size > 0) dataSeen = true;
      if (type === 'IEND') return size === 0 && dataSeen && end === bytes.length;
      offset = end;
    }
    return false;
  }
  if (bytes.readUInt32LE(0) === 0x00010000) {
    const count = bytes.readUInt16LE(4);
    const directoryEnd = 6 + count * 16;
    if (!count || directoryEnd > bytes.length) return false;
    for (let index = 0; index < count; index += 1) {
      const entry = 6 + index * 16;
      const size = bytes.readUInt32LE(entry + 8);
      const offset = bytes.readUInt32LE(entry + 12);
      if (size < 12 || offset < directoryEnd || offset + size > bytes.length) continue;
      const payload = bytes.subarray(offset, offset + size);
      if (payload.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || [12, 40, 52, 56, 108, 124].includes(payload.readUInt32LE(0))) return true;
    }
    return false;
  }
  if (/^GIF8[79]a$/u.test(bytes.toString('ascii', 0, 6))) {
    return bytes.length >= 14 && bytes.readUInt16LE(6) > 0 && bytes.readUInt16LE(8) > 0 && bytes.at(-1) === 0x3b;
  }
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  }
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return bytes.readUInt32LE(4) + 8 === bytes.length && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16));
  }
  // Standalone SVG needs an SVG root, not an SVG embedded in an HTML error
  // page. Native tree construction discards neither an HTML wrapper nor sibling
  // content here. No script, entity, resource or stylesheet is executed.
  const source = bytes.toString('utf8');
  if (!source.includes('<svg')) return false;
  const parsed = parseBoundedHtml(source);
  if (parsed.inputLimitReached || parsed.constructionLimitReached) return false;
  const html = parsed.document.childNodes.find(isHtmlElement);
  if (html?.sourceCodeLocation?.startTag || parsed.document.childNodes.some((node) =>
    node.nodeName === '#documentType' && 'name' in node && node.name !== 'svg')) return false;
  const head = html?.childNodes.find((node) => isHtmlElement(node) && node.tagName === 'head');
  if (head && isHtmlElement(head) && (head.sourceCodeLocation?.startTag
    || head.childNodes.some((node) => node.nodeName !== '#comment'
      && !(node.nodeName === '#text' && 'value' in node && !node.value.trim())))) return false;
  const body = html?.childNodes.find((node) => isHtmlElement(node) && node.tagName === 'body');
  if (!body || !isHtmlElement(body) || body.sourceCodeLocation?.startTag) return false;
  const content = body.childNodes.filter((node) => node.nodeName !== '#comment'
    && !(node.nodeName === '#text' && 'value' in node && !node.value.trim()));
  const root = content[0];
  if (content.length !== 1 || !root || !('tagName' in root) || root.tagName !== 'svg'
    || root.namespaceURI !== 'http://www.w3.org/2000/svg'
    || !root.attrs.some((attribute) => attribute.name === 'xmlns' && attribute.value === 'http://www.w3.org/2000/svg')) return false;
  const location = root.sourceCodeLocation;
  if (!location?.startTag) return false;
  return Boolean(location.endTag || /\/\s*>$/u.test(source.slice(location.startTag.startOffset, location.startTag.endOffset)));
}

// Returns the favicon bytes for one candidate URL (a real fetch, or an inline
// data: decode), or null if it can't be retrieved/used.
async function fetchFaviconBytes(
  url: string,
  headers: Record<string, string>,
  fetcher: typeof safeFetch,
  timeoutMs: number,
): Promise<Buffer | null> {
  if (/^data:/i.test(url)) return decodeDataUri(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { signal: controller.signal, headers });
    if (!res.ok) {
      // Not reading this body - release it explicitly instead of leaving an
      // unconsumed stream (and the connection it's tied to) open until
      // undici's own idle-timeout eventually notices.
      await res.body?.cancel().catch(() => {});
      return null;
    }
    // The timeout stays armed through this read (cleared in `finally` below,
    // not right after headers arrive) - a malicious site could otherwise send
    // headers immediately and then trickle or stall the body forever, hanging
    // this worker with no deadline once disarmed.
    const { bytes, truncated } = await readBytesCapped(res, MAX_FAVICON_BYTES);
    // A truncated or empty file can't be hashed meaningfully.
    return truncated || bytes.length === 0 ? null : bytes;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Fetches the domain's favicon and returns both an exact SHA-256 and a
// perceptual dHash of the same bytes (see the module header). `html`, when
// provided (the deep-check path already has the homepage in hand), is scanned
// for declared <link rel="icon"> URLs, which are tried before the bare
// /favicon.ico fallback.
function buildFaviconCandidates(domain: string, html = '', options: Pick<FaviconOptions, 'baseUrl' | 'htmlAnalysis'> = {}): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (url: string) => { if (url && !seen.has(url)) { seen.add(url); candidates.push(url); } };

  if (html || options.htmlAnalysis) for (const url of extractIconUrls(html, options.baseUrl ?? `https://${domain}/`, options.htmlAnalysis)) add(url);
  add(`https://${domain}/favicon.ico`);
  add(`https://${domain}/favicon.svg`);
  add(`http://${domain}/favicon.ico`);
  add(`http://${domain}/favicon.svg`);
  return candidates.slice(0, MAX_FAVICON_CANDIDATES);
}

async function fetchFaviconHash(
  domain: string,
  { html = '', baseUrl, htmlAnalysis, fetcher = safeFetch, timeoutMs = FAVICON_FETCH_TIMEOUT_MS }: FaviconOptions = {},
): Promise<FaviconHash | null> {
  const headers = whoisleuthRequestHeaders();
  const candidates = buildFaviconCandidates(domain, html, {
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(htmlAnalysis ? { htmlAnalysis } : {}),
  });
  const requestTimeoutMs = Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= FAVICON_FETCH_TIMEOUT_MS
    ? timeoutMs
    : FAVICON_FETCH_TIMEOUT_MS;

  for (const url of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const bytes = await fetchFaviconBytes(url, headers, fetcher, requestTimeoutMs);
    if (bytes && isFaviconImage(bytes)) {
      return {
        hash: crypto.createHash('sha256').update(bytes).digest('hex'),
        phash: faviconPerceptualHash(bytes),
      };
    }
  }
  return null;
}

export { fetchFaviconHash, extractIconUrls, buildFaviconCandidates };
