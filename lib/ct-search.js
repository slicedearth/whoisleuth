// Certificate Transparency search - finds hostnames that have ever had a
// publicly-issued TLS certificate containing a given keyword, via crt.sh's
// public JSON API. This catches lookalike domains the typosquat generator's
// fixed permutation algorithms would never guess (arbitrary misspellings,
// unrelated TLDs, subdomain tricks) - almost every phishing site gets a
// free certificate within minutes of going live, so CT logs are often the
// earliest public signal a new lookalike exists at all. Shared by the
// Express server and the Netlify Functions.

const { readTextCapped } = require('./safe-fetch');

const CRT_SH_TIMEOUT_MS = 20000;
const MAX_RESULTS = 500;
// crt.sh's response size scales with how many certificates ever matched the
// keyword, not with MAX_RESULTS - a broad single-word keyword can have
// millions of matching certificates, and unlike the domain-homepage fetch in
// lib/availability.js (fine to scan a truncated prefix for a text match),
// this response has to be complete, valid JSON to parse at all. Capped so a
// broad keyword fails with a clear "narrow your search" error instead of
// buffering an arbitrarily large body in memory first.
const CRT_SH_MAX_BYTES = 5 * 1024 * 1024;

// crt.sh is a free, volunteer-run service backed by a Postgres database
// that gets hammered constantly - broad search terms in particular can make
// it time out or briefly 502/503 under load, even though the same query
// often succeeds a few seconds later. Worth a couple of retries before
// giving up, rather than failing a whole search on a single transient blip.
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;
// Separate, smaller budget for timeouts specifically - each retry here
// already costs a full CRT_SH_TIMEOUT_MS wait (unlike the cheap ~1.5-3s
// delay before a status-code retry above), so this caps the worst case at
// two attempts (~40s) instead of stacking on top of MAX_RETRIES.
const MAX_TIMEOUT_RETRIES = 1;

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function normalizeHostname(raw) {
  let h = raw.trim().toLowerCase();
  if (h.startsWith('*.')) h = h.slice(2);
  return HOSTNAME_RE.test(h) ? h : null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCrtSh(keyword, attempt = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CRT_SH_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(`https://crt.sh/?q=${encodeURIComponent(keyword)}&output=json`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; DomainStatusChecker/1.0)' },
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name !== 'AbortError') throw err;
      if (attempt < MAX_TIMEOUT_RETRIES) return fetchCrtSh(keyword, attempt + 1);
      throw new Error(
        `crt.sh took too long to respond (>${CRT_SH_TIMEOUT_MS / 1000}s per attempt, ${attempt + 1} attempts) - ` +
          "it can be slow for broad search terms or under heavy load; try a narrower keyword or try again shortly."
      );
    }

    if (!res.ok) {
      // Not reading this body - release it explicitly instead of leaving an
      // unconsumed stream (and the connection it's tied to) open until
      // undici's own idle-timeout eventually notices.
      await res.body?.cancel().catch(() => {});
      if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * (attempt + 1));
        return fetchCrtSh(keyword, attempt + 1);
      }
      throw new Error(
        RETRYABLE_STATUSES.has(res.status)
          ? `crt.sh is temporarily overloaded (${res.status} after ${attempt + 1} attempts) - it's a free public service that intermittently struggles under load; try again in a moment.`
          : `crt.sh returned ${res.status}`
      );
    }

    const { text, truncated } = await readTextCapped(res, CRT_SH_MAX_BYTES);
    if (truncated) {
      throw new Error(
        `crt.sh returned more than ${CRT_SH_MAX_BYTES / (1024 * 1024)}MB of results for "${keyword}" - try a narrower/more specific keyword.`
      );
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

async function searchCertificateTransparency(keyword) {
  const trimmed = (keyword || '').trim();
  if (!trimmed) return { domains: [], certCount: 0, truncated: false };

  const data = await fetchCrtSh(trimmed);

  const domains = new Set();
  for (const entry of data) {
    const blob = `${entry.name_value || ''}\n${entry.common_name || ''}`;
    for (const line of blob.split('\n')) {
      const host = normalizeHostname(line);
      if (host) domains.add(host);
    }
  }

  const sorted = [...domains].sort();
  return {
    certCount: data.length,
    domains: sorted.slice(0, MAX_RESULTS),
    truncated: sorted.length > MAX_RESULTS,
  };
}

module.exports = { searchCertificateTransparency };
