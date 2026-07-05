// Guards against SSRF via DNS rebinding: a caller can supply any domain name
// to /api/availability, which (in deep-check mode) fetches that domain's own
// homepage to look for parking/for-sale signals. Nothing stops that domain's
// DNS from pointing at a private/loopback/link-local address (including
// cloud metadata endpoints like 169.254.169.254) instead of a real public
// site, and an HTTP redirect could do the same after the initial check. This
// resolves the hostname (and every redirect target) before connecting and
// refuses anything that isn't a public address.

const dns = require('dns').promises;
const net = require('net');

const MAX_REDIRECTS = 5;

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // malformed - fail closed
  const [a, b] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata services
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateIpv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true; // unspecified / loopback
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 - check the embedded IPv4 address
    const embedded = lower.split(':').pop();
    if (net.isIP(embedded) === 4) return isPrivateIpv4(embedded);
  }
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local fc00::/7
  return false;
}

function isPrivateAddress(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true; // not a recognizable IP literal - fail closed
}

async function assertPublicHostname(hostname) {
  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`DNS resolution failed for ${hostname}: ${err.message}`);
  }
  if (records.length === 0) throw new Error(`No DNS records for ${hostname}`);
  for (const { address } of records) {
    if (isPrivateAddress(address)) {
      throw new Error(`Refusing to fetch ${hostname}: resolves to a private/reserved address (${address})`);
    }
  }
}

// Same call shape as fetch(), but validates the hostname (and every redirect
// hop) resolves only to public addresses first. Always follows redirects
// manually so each hop gets the same check - `redirect: 'follow'` would
// perform later hops without ever re-validating them.
async function safeFetch(url, options = {}, redirectsLeft = MAX_REDIRECTS) {
  const parsed = new URL(url);
  await assertPublicHostname(parsed.hostname);

  const res = await fetch(url, { ...options, redirect: 'manual' });

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const location = res.headers.get('location');
    if (!location || redirectsLeft <= 0) return res;
    const nextUrl = new URL(location, url).toString();
    return safeFetch(nextUrl, options, redirectsLeft - 1);
  }

  return res;
}

module.exports = { safeFetch, isPrivateAddress };
