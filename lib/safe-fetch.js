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

// Expands a valid IPv6 address string to its full 8-group, zero-padded hex
// form - e.g. "::1" -> all-zero groups ending in "0001". Needed because the
// same address can be written multiple ways (a "::" shorthand for a run of
// zero groups, an embedded IPv4 tail as either dotted-decimal or two hex
// groups), and a hostile authoritative DNS server - the exact threat this
// module exists to guard against - is free to choose whichever string form
// it wants. Checking string prefixes on the as-written form (the previous
// approach) only catches whichever form happened to be anticipated; e.g.
// "::ffff:127.0.0.1" and "::ffff:7f00:1" are the same address, but only the
// first was recognized as IPv4-mapped loopback.
function expandIpv6Groups(ip) {
  const hasDoubleColon = ip.includes('::');
  const [headStr, tailStr] = hasDoubleColon ? ip.split('::') : [ip, undefined];

  // A dotted-decimal segment (the tail of "::ffff:127.0.0.1") is two
  // 16-bit groups' worth of bits - convert it to hex groups first so the
  // rest of this function only ever deals with plain hex.
  const toHexGroups = (part) => {
    if (!part) return [];
    return part.split(':').flatMap((group) => {
      if (!group.includes('.')) return [group];
      const bytes = group.split('.').map(Number);
      return [
        (((bytes[0] << 8) | bytes[1]) >>> 0).toString(16),
        (((bytes[2] << 8) | bytes[3]) >>> 0).toString(16),
      ];
    });
  };

  const headGroups = toHexGroups(headStr);
  const tailGroups = hasDoubleColon ? toHexGroups(tailStr) : [];
  if (!hasDoubleColon) return headGroups.map((g) => g.padStart(4, '0').toLowerCase());
  const missing = 8 - headGroups.length - tailGroups.length;
  const middleGroups = new Array(Math.max(missing, 0)).fill('0');
  return [...headGroups, ...middleGroups, ...tailGroups].map((g) => g.padStart(4, '0').toLowerCase());
}

function groupsToIpv4(hiGroup, loGroup) {
  const hi = parseInt(hiGroup, 16);
  const lo = parseInt(loGroup, 16);
  if (Number.isNaN(hi) || Number.isNaN(lo)) return null;
  return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.');
}

function isPrivateIpv6(ip) {
  const groups = expandIpv6Groups(ip.toLowerCase());
  if (groups.length !== 8) return true; // couldn't parse cleanly - fail closed
  const [g0, g1, g2, g3, g4, g5, , g7] = groups;
  const g6 = groups[6];

  if (groups.every((g) => g === '0000')) return true; // :: (unspecified)
  if (groups.slice(0, 7).every((g) => g === '0000') && g7 === '0001') return true; // ::1 (loopback)

  // IPv4-mapped (::ffff:0:0/96) and the deprecated IPv4-compatible
  // (::0:0/96) forms both put the embedded address in the last two groups -
  // checked on the canonical expanded form above, so it doesn't matter
  // whether the address was originally written in dotted-decimal or hex.
  if ([g0, g1, g2, g3, g4].every((g) => g === '0000') && (g5 === 'ffff' || g5 === '0000')) {
    const embedded = groupsToIpv4(g6, g7);
    if (embedded && isPrivateIpv4(embedded)) return true;
  }
  // NAT64 well-known prefix (64:ff9b::/96) - same tail embedding, different
  // prefix; some IPv6-only networks synthesize these to reach IPv4 hosts.
  if (g0 === '0064' && g1 === 'ff9b' && [g2, g3, g4, g5].every((g) => g === '0000')) {
    const embedded = groupsToIpv4(g6, g7);
    if (embedded && isPrivateIpv4(embedded)) return true;
  }
  // 6to4 (2002::/16) - the embedded IPv4 lives in groups 1-2, not the tail.
  if (g0 === '2002') {
    const embedded = groupsToIpv4(g1, g2);
    if (embedded && isPrivateIpv4(embedded)) return true;
  }

  if (/^fe[89ab][0-9a-f]$/.test(g0)) return true; // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}$/.test(g0)) return true; // unique local fc00::/7
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
    // This response's body (if any) is never going to be read - we're
    // moving on to a completely different fetch for the redirect target,
    // not returning this one to the caller - so release it explicitly
    // instead of leaving an unconsumed stream for undici to notice later.
    await res.body?.cancel().catch(() => {});
    return safeFetch(nextUrl, options, redirectsLeft - 1);
  }

  // Each call above created a fresh Agent (and connection pool) pinned to
  // that hop's validated address(es) - not shared/reused across calls, so
  // there's no keep-alive benefit being lost by not closing it explicitly
  // here. It's deliberately NOT closed on the response that's about to be
  // returned to the caller: every caller in this project reads the body
  // *after* safeFetch returns (with the fetch timeout still armed through
  // that read - see availability.js/favicon.js/rdap.js/domain-posture.js),
  // and closing the dispatcher out from under an in-progress body read
  // would abort it. Undici's own idle-timeout closes the now-unused
  // connection once that read finishes.
  return res;
}

// Reads at most maxBytes of a response body, cancelling the underlying
// stream as soon as that cap is hit instead of buffering the whole thing -
// shared by every caller that fetches a response body it doesn't control
// the size of (a domain's own homepage, a public search API), so none of
// them can be made to hold an arbitrarily large body in memory. `truncated`
// tells the caller whether the real body was actually cut short - callers
// that need well-formed content (e.g. JSON) should treat that as a hard
// failure rather than parsing a partial blob; callers that only need to
// scan for a substring (e.g. plain-text/HTML matching) can safely ignore it.
async function readTextCapped(res, maxBytes) {
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) {
    const full = await res.text();
    return { text: full.slice(0, maxBytes), truncated: full.length > maxBytes };
  }

  const decoder = new TextDecoder();
  let text = '';
  let received = 0;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  // If the cap was hit, one more read() tells us whether there was actually
  // more data left (truncated) or the body just happened to end right there.
  let truncated = false;
  if (received >= maxBytes) {
    const { done } = await reader.read();
    if (!done) truncated = true;
  }
  reader.cancel().catch(() => {});
  return { text: text.slice(0, maxBytes), truncated };
}

// Binary-safe counterpart to readTextCapped, for a response body that isn't
// text (a favicon image) - collects raw bytes into a Buffer instead of
// decoding as UTF-8, which would corrupt non-text bytes.
async function readBytesCapped(res, maxBytes) {
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { bytes: buf.subarray(0, maxBytes), truncated: buf.length > maxBytes };
  }

  const chunks = [];
  let received = 0;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    chunks.push(Buffer.from(value));
  }
  // Same "one more read() to check for leftover data" trick as readTextCapped.
  let truncated = false;
  if (received >= maxBytes) {
    const { done } = await reader.read();
    if (!done) truncated = true;
  }
  reader.cancel().catch(() => {});
  return { bytes: Buffer.concat(chunks), truncated };
}

module.exports = { safeFetch, readTextCapped, readBytesCapped, isPrivateAddress, resolvePublicAddresses };
