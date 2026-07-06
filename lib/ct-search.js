// Certificate Transparency search - finds hostnames that have ever had a
// publicly-issued TLS certificate containing a given keyword, via crt.sh's
// public JSON API. This catches lookalike domains the typosquat generator's
// fixed permutation algorithms would never guess (arbitrary misspellings,
// unrelated TLDs, subdomain tricks) - almost every phishing site gets a
// free certificate within minutes of going live, so CT logs are often the
// earliest public signal a new lookalike exists at all. Shared by the
// Express server and the Netlify Functions.

const CRT_SH_TIMEOUT_MS = 20000;
const MAX_RESULTS = 500;

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function normalizeHostname(raw) {
  let h = raw.trim().toLowerCase();
  if (h.startsWith('*.')) h = h.slice(2);
  return HOSTNAME_RE.test(h) ? h : null;
}

async function searchCertificateTransparency(keyword) {
  const trimmed = (keyword || '').trim();
  if (!trimmed) return { domains: [], certCount: 0, truncated: false };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CRT_SH_TIMEOUT_MS);
  let data;
  try {
    const res = await fetch(`https://crt.sh/?q=${encodeURIComponent(trimmed)}&output=json`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; DomainStatusChecker/1.0)' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`crt.sh returned ${res.status}`);
    data = JSON.parse(await res.text());
  } finally {
    clearTimeout(timeout);
  }

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
