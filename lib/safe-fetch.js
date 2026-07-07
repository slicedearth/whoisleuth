// Guards against SSRF via DNS rebinding: a caller can supply any domain name
// to /api/availability, which (in deep-check mode) fetches that domain's own
// homepage to look for parking/for-sale signals. Nothing stops that domain's
// DNS from pointing at a private/loopback/link-local address (including
// cloud metadata endpoints like 169.254.169.254) instead of a real public
// site, and an HTTP redirect could do the same after the initial check.
//
// Resolving the hostname and checking the result is NOT enough on its own -
// fetch() performs its own, separate DNS resolution when it actually opens
// the connection, and nothing guarantees a second lookup answers the same
// way as the first. A malicious authoritative DNS server can simply answer
// differently on successive queries (classic DNS rebinding), returning a
// public address for the validation lookup and a private one moments later
// for fetch()'s own lookup. So this resolves the hostname once, validates
// every address it maps to, and then *pins* the actual connection to one of
// those already-validated addresses via a custom `dns.lookup`-compatible
// resolver on a per-request undici Agent - there is no second, independent
// DNS query left for a rebinding attacker to answer differently. The
// hostname itself is still used for the TLS SNI/certificate check and the
// HTTP Host header; only the IP a socket actually connects to is pinned.

const dns = require('dns').promises;
const net = require('net');
const { Agent } = require('undici');

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

// Resolves the hostname and returns every address it maps to, having
// verified all of them are public. Throws (fails closed) if any address is
// private/reserved, or if there are no records at all.
async function resolvePublicAddresses(hostname) {
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
  return records;
}

// A per-request undici Agent whose connections are pinned to the given,
// already-validated address(es) - overriding the `lookup` function used at
// connect time instead of letting undici resolve the hostname itself.
// Matches the dns.lookup callback contract net.connect/tls.connect expect:
// `callback(err, address, family)`, or `callback(err, addressObjects)` when
// called with `{ all: true }` (Node's Happy Eyeballs dual-stack racing).
function pinnedDispatcher(records) {
  return new Agent({
    connect: {
      lookup(_hostname, options, callback) {
        if (options && options.all) {
          callback(null, records.map(({ address, family }) => ({ address, family })));
        } else {
          callback(null, records[0].address, records[0].family);
        }
      },
    },
  });
}

// Same call shape as fetch(), but resolves and validates the hostname (and
// every redirect hop) first, then pins the actual connection to one of the
// validated addresses. Always follows redirects manually so each hop gets
// the same check - `redirect: 'follow'` would perform later hops without
// ever re-validating or re-pinning them.
async function safeFetch(url, options = {}, redirectsLeft = MAX_REDIRECTS) {
  const parsed = new URL(url);
  const records = await resolvePublicAddresses(parsed.hostname);
  const dispatcher = pinnedDispatcher(records);

  // `dispatcher` is a real, supported undici extension to Node's global
  // fetch (used above to pin the connection) - TS's built-in fetch types
  // don't know about it since it's outside the standard fetch spec.
  /** @type {RequestInit & { dispatcher?: import('undici').Dispatcher }} */
  const fetchOptions = { ...options, redirect: 'manual', dispatcher };
  const res = await fetch(url, fetchOptions);

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const location = res.headers.get('location');
    if (!location || redirectsLeft <= 0) return res;
    const nextUrl = new URL(location, url).toString();
    return safeFetch(nextUrl, options, redirectsLeft - 1);
  }

  return res;
}

module.exports = { safeFetch, isPrivateAddress };
