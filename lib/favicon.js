// Favicon-hash fetch - a lookalike/typosquat domain that serves the same
// favicon as a brand's real site is a strong sign of a cloned phishing kit
// (attackers copy the favicon along with the rest of the page); a domain
// that merely resolves and serves *some* page proves much less.
//
// Two hashes are produced from the same bytes:
//   - hash:  exact SHA-256 of the raw bytes. Zero false positives, but only
//            catches a byte-for-byte copy.
//   - phash: perceptual (fuzzy) dHash (lib/perceptual-hash.js). Catches a
//            resized/recompressed/re-saved copy that's visually identical but
//            no longer byte-identical - the common case when the favicon
//            passed through a different tool than the original. Null when the
//            image format can't be decoded (GIF/JPEG/SVG), so it strictly
//            adds coverage without weakening the exact tier.

const crypto = require('crypto');
const { safeFetch, readBytesCapped } = require('./safe-fetch');
const { faviconPerceptualHash } = require('./perceptual-hash');

const MAX_FAVICON_BYTES = 200000; // generous for a favicon, small enough to bound memory
const FAVICON_FETCH_TIMEOUT_MS = 5000;
// Bounds worst-case work when a (possibly hostile) page declares many icon
// links - we try candidates in priority order and stop at the first that
// yields hashable bytes, so this only bites on pages where every earlier
// candidate fails.
const MAX_FAVICON_CANDIDATES = 4;

// Extracts favicon URLs declared in the page's own <link rel="...icon..."> tags
// (resolved to absolute URLs against the page origin), in preference order:
// standard "icon"/"shortcut icon" first, then "apple-touch-icon". Many modern
// sites (e.g. npm) serve no /favicon.ico at all and only declare a PNG on a
// CDN this way, so checking only /favicon.ico misses them entirely. data:
// URIs are passed through verbatim - decodeFaviconCandidate handles them
// without a network fetch.
function extractIconUrls(html, baseUrl) {
  const links = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = (tag.match(/\brel\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (!rel || !/icon/i.test(rel)) continue;
    const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    links.push({ href: href.trim(), priority: /apple-touch/i.test(rel) ? 1 : 0 });
  }
  links.sort((a, b) => a.priority - b.priority);

  const urls = [];
  for (const { href } of links) {
    if (/^data:/i.test(href)) {
      urls.push(href);
      continue;
    }
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') urls.push(resolved.toString());
    } catch {
      /* malformed href - skip it */
    }
  }
  return urls;
}

// Decodes an inline `data:` favicon (base64 or percent-encoded) into a byte
// buffer, bounded to MAX_FAVICON_BYTES. Returns null on anything malformed.
function decodeDataUri(uri) {
  const comma = uri.indexOf(',');
  if (comma === -1) return null;
  const meta = uri.slice(5, comma);
  const data = uri.slice(comma + 1);
  try {
    const bytes = /;base64/i.test(meta)
      ? Buffer.from(data, 'base64')
      : Buffer.from(decodeURIComponent(data), 'latin1');
    return bytes.length > 0 && bytes.length <= MAX_FAVICON_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

// Returns the favicon bytes for one candidate URL (a real fetch, or an inline
// data: decode), or null if it can't be retrieved/used.
async function fetchFaviconBytes(url, headers) {
  if (/^data:/i.test(url)) return decodeDataUri(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FAVICON_FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, { signal: controller.signal, headers });
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
async function fetchFaviconHash(domain, { html = '' } = {}) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; DomainStatusChecker/1.0)' };
  const candidates = [];
  const seen = new Set();
  const add = (url) => { if (url && !seen.has(url)) { seen.add(url); candidates.push(url); } };

  if (html) for (const url of extractIconUrls(html, `https://${domain}/`)) add(url);
  add(`https://${domain}/favicon.ico`);
  add(`http://${domain}/favicon.ico`);

  for (const url of candidates.slice(0, MAX_FAVICON_CANDIDATES)) {
    // eslint-disable-next-line no-await-in-loop
    const bytes = await fetchFaviconBytes(url, headers);
    if (bytes) {
      return {
        hash: crypto.createHash('sha256').update(bytes).digest('hex'),
        phash: faviconPerceptualHash(bytes),
      };
    }
  }
  return null;
}

module.exports = { fetchFaviconHash, extractIconUrls };
