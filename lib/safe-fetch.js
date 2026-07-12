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
const MAX_SAFE_FETCH_URL_LENGTH = 4096;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // malformed - fail closed
  const [a, b, c] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // RFC6598 shared address space (carrier-grade NAT) - routes inside provider networks, not the open internet
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata services
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0 && c === 0) return true; // RFC6890 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // RFC5737 TEST-NET-1 (documentation-only, never routed)
  if (a === 192 && b === 88 && c === 99) return true; // RFC7526 deprecated 6to4 relay anycast
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && b >= 18 && b <= 19) return true; // RFC2544 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // RFC5737 TEST-NET-2 (documentation-only, never routed)
  if (a === 203 && b === 0 && c === 113) return true; // RFC5737 TEST-NET-3 (documentation-only, never routed)
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
  if (g0.startsWith('ff')) return true; // multicast ff00::/8

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
  // RFC 8215 local-use NAT64 prefix (64:ff9b:1::/48). Unlike the well-known
  // /96 above, operators may choose how IPv4 bits are embedded within this
  // larger prefix. The whole range is non-global by definition, so reject it
  // rather than attempting to decode one layout and leaving others open.
  if (g0 === '0064' && g1 === 'ff9b' && g2 === '0001') return true;
  // 6to4 (2002::/16) - the embedded IPv4 lives in groups 1-2, not the tail.
  if (g0 === '2002') {
    const embedded = groupsToIpv4(g1, g2);
    if (embedded && isPrivateIpv4(embedded)) return true;
  }

  // Teredo (2001:0000::/32) carries both a server IPv4 address and an
  // obfuscated client IPv4 address. Decode both so a transition address
  // cannot smuggle a private/loopback target past the IPv4 guard.
  if (g0 === '2001' && g1 === '0000') {
    const server = groupsToIpv4(g2, g3);
    const client = groupsToIpv4(
      ((~parseInt(g6, 16)) & 0xffff).toString(16),
      ((~parseInt(g7, 16)) & 0xffff).toString(16)
    );
    if ((server && isPrivateIpv4(server)) || (client && isPrivateIpv4(client))) return true;
  }

  if (/^fe[89ab][0-9a-f]$/.test(g0)) return true; // link-local fe80::/10
  if (/^fe[cdef][0-9a-f]$/.test(g0)) return true; // deprecated site-local fec0::/10
  if (/^f[cd][0-9a-f]{2}$/.test(g0)) return true; // unique local fc00::/7
  if (g0 === '0100' && [g1, g2, g3].every((g) => g === '0000')) return true; // discard-only 100::/64
  if (g0 === '2001' && g1 === '0db8') return true; // documentation 2001:db8::/32
  if (g0 === '2001' && g1 === '0002' && g2 === '0000') return true; // benchmarking 2001:2::/48
  if (g0 === '2001' && /^00[1-2][0-9a-f]$/.test(g1)) return true; // ORCHID/ORCHIDv2
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

function normalizedFetchUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SAFE_FETCH_URL_LENGTH) {
    throw new Error('Refusing to fetch an empty or oversized URL');
  }
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Refusing to fetch a non-HTTP URL');
  if (!parsed.hostname) throw new Error('Refusing to fetch a URL without a hostname');
  if (parsed.username || parsed.password) throw new Error('Refusing to fetch a URL containing credentials');
  const normalized = parsed.toString();
  if (normalized.length > MAX_SAFE_FETCH_URL_LENGTH) throw new Error('Refusing to fetch an oversized URL');
  return normalized;
}

function boundedDuration(value) {
  return Math.max(0, Math.min(120_000, Math.round(Number(value) || 0)));
}

async function closeDispatcher(dispatcher) {
  if (!dispatcher || typeof dispatcher.close !== 'function') return;
  try {
    await dispatcher.close();
  } catch {
    // Cleanup must never replace the request result or its more useful error.
  }
}

// Detailed form of the shared safe request engine. It follows redirects
// manually under the same DNS validation and connection-pinning policy as
// safeFetch(), while retaining a bounded hop trace for consumers that need
// provenance. The optional dependencies object exists for deterministic local
// tests; production callers use the defaults.
async function safeFetchDetailed(url, options = {}, dependencies = {}) {
  const resolveAddresses = dependencies.resolvePublicAddresses || resolvePublicAddresses;
  const makeDispatcher = dependencies.pinnedDispatcher || pinnedDispatcher;
  const request = dependencies.fetch || fetch;
  const now = dependencies.now || Date.now;
  const requestedMaxRedirects = Number(dependencies.maxRedirects);
  const maxRedirects = Number.isInteger(requestedMaxRedirects)
    ? Math.max(0, Math.min(MAX_REDIRECTS, requestedMaxRedirects))
    : MAX_REDIRECTS;
  const requestedUrl = normalizedFetchUrl(url);
  const startedAt = now();
  const hops = [];
  let currentUrl = requestedUrl;
  let redirectCount = 0;

  while (true) {
    const parsed = new URL(currentUrl);
    const records = await resolveAddresses(parsed.hostname);
    const dispatcher = makeDispatcher(records);
    const hopStartedAt = now();

    // `dispatcher` is a real, supported undici extension to Node's global
    // fetch (used above to pin the connection) - TS's built-in fetch types
    // don't know about it since it's outside the standard fetch spec.
    /** @type {RequestInit & { dispatcher?: import('undici').Dispatcher }} */
    const fetchOptions = { ...options, redirect: 'manual', dispatcher };
    let response;
    try {
      response = await request(currentUrl, fetchOptions);
    } catch (error) {
      await closeDispatcher(dispatcher);
      throw error;
    }
    const location = REDIRECT_STATUSES.has(response.status) ? response.headers.get('location') : null;
    let nextUrl = null;
    if (location) {
      try {
        nextUrl = normalizedFetchUrl(new URL(location, currentUrl).toString());
      } catch (error) {
        await response.body?.cancel().catch(() => {});
        await closeDispatcher(dispatcher);
        throw error;
      }
    }
    hops.push({
      url: currentUrl,
      status: response.status,
      location: nextUrl,
      durationMs: boundedDuration(now() - hopStartedAt),
    });

    if (nextUrl && redirectCount < maxRedirects) {
      await response.body?.cancel().catch(() => {});
      await closeDispatcher(dispatcher);
      redirectCount += 1;
      currentUrl = nextUrl;
      continue;
    }

    // This Agent is unique to this request, so it must never retain an idle
    // keep-alive socket. Undici's graceful close waits for the active response
    // to finish: initiate it now without awaiting, letting the caller consume
    // or cancel the body while the dispatcher retires deterministically.
    void closeDispatcher(dispatcher);

    return {
      response,
      requestedUrl,
      finalUrl: currentUrl,
      redirected: redirectCount > 0,
      redirectCount,
      redirectLimitReached: Boolean(nextUrl && redirectCount >= maxRedirects),
      hops,
      durationMs: boundedDuration(now() - startedAt),
    };
  }
}

// Compatibility form: existing callers still receive a Response, but it is
// produced by the detailed engine above rather than a separate request path.
async function safeFetch(url, options = {}, redirectsLeft = MAX_REDIRECTS) {
  const result = await safeFetchDetailed(url, options, { maxRedirects: redirectsLeft });
  return result.response;
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
    const full = Buffer.from(await res.arrayBuffer());
    const captured = full.subarray(0, maxBytes);
    return { text: new TextDecoder().decode(captured), truncated: full.length > maxBytes, bytesRead: captured.length };
  }

  const decoder = new TextDecoder();
  let text = '';
  let received = 0;
  let truncated = false;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - received;
    const captured = value.subarray(0, remaining);
    received += captured.byteLength;
    text += decoder.decode(captured, { stream: true });
    if (captured.byteLength < value.byteLength) {
      truncated = true;
      break;
    }
  }
  // If the cap was hit, one more read() tells us whether there was actually
  // more data left (truncated) or the body just happened to end right there.
  if (!truncated && received >= maxBytes) {
    const { done } = await reader.read();
    if (!done) truncated = true;
  }
  reader.cancel().catch(() => {});
  text += decoder.decode();
  return { text, truncated, bytesRead: received };
}

// Binary-safe counterpart to readTextCapped, for a response body that isn't
// text (a favicon image) - collects raw bytes into a Buffer instead of
// decoding as UTF-8, which would corrupt non-text bytes.
async function readBytesCapped(res, maxBytes) {
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    const bytes = buf.subarray(0, maxBytes);
    return { bytes, truncated: buf.length > maxBytes, bytesRead: bytes.length };
  }

  const chunks = [];
  let received = 0;
  let truncated = false;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - received;
    const captured = value.subarray(0, remaining);
    received += captured.byteLength;
    chunks.push(Buffer.from(captured));
    if (captured.byteLength < value.byteLength) {
      truncated = true;
      break;
    }
  }
  // Same "one more read() to check for leftover data" trick as readTextCapped.
  if (!truncated && received >= maxBytes) {
    const { done } = await reader.read();
    if (!done) truncated = true;
  }
  reader.cancel().catch(() => {});
  return { bytes: Buffer.concat(chunks), truncated, bytesRead: received };
}

module.exports = {
  MAX_REDIRECTS,
  MAX_SAFE_FETCH_URL_LENGTH,
  safeFetch,
  safeFetchDetailed,
  readTextCapped,
  readBytesCapped,
  isPrivateAddress,
  resolvePublicAddresses,
};
