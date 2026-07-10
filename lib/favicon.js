// Favicon-hash fetch - a lookalike/typosquat domain that serves the exact
// same favicon bytes as a brand's real site is a strong sign of a cloned
// phishing kit (attackers copy the favicon along with the rest of the
// page); a domain that merely resolves and serves *some* page proves much
// less. This is an exact byte hash, not a perceptual/fuzzy one - a resized
// or re-saved favicon won't match even if visually identical, but unlike a
// perceptual hash it needs no image-decoding dependency and has zero false
// positives on an exact clone, which is the common case for copy-pasted
// phishing kits.

const crypto = require('crypto');
const { safeFetch, readBytesCapped } = require('./safe-fetch');

const MAX_FAVICON_BYTES = 200000; // generous for a favicon, small enough to bound memory

async function fetchFaviconHash(domain) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; DomainStatusChecker/1.0)' };
  for (const scheme of ['https', 'http']) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await safeFetch(`${scheme}://${domain}/favicon.ico`, { signal: controller.signal, headers });
      if (!res.ok) continue;
      // The timeout stays armed through this read (cleared in `finally`
      // below, not right after headers arrive) - a malicious site could
      // otherwise send headers immediately and then trickle or stall the
      // body forever, hanging this worker with no deadline once disarmed.
      const { bytes, truncated } = await readBytesCapped(res, MAX_FAVICON_BYTES);
      // A truncated or empty file can't be hashed meaningfully - skip it
      // rather than compare a partial read against a full one.
      if (truncated || bytes.length === 0) continue;
      return crypto.createHash('sha256').update(bytes).digest('hex');
    } catch {
      /* best-effort - fall through and try the next scheme, or give up */
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

module.exports = { fetchFaviconHash };
