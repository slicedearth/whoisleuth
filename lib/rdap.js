// RDAP: IANA bootstrap registry lookup (https://data.iana.org/rdap/) and
// response parsing. Shared by the Express server and the Netlify Functions.

const net = require('net');
const { domainToASCII } = require('url');
const { cached } = require('./lookup-cache');
const { safeFetch, safeFetchDetailed, readTextCapped } = require('./safe-fetch');

const BOOTSTRAP_TTL_MS = 60 * 60 * 1000; // 1 hour
const BOOTSTRAP_STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BOOTSTRAP_KINDS = new Set(['dns', 'ipv4', 'ipv6', 'asn']);
const bootstrapCache = new Map();
const bootstrapInflight = new Map();

// Every other upstream call in this project (crt.sh, a domain's own
// homepage, WHOIS sockets) already has a timeout - this one didn't, so a
// slow/unresponsive registry or the IANA bootstrap endpoint could hang a
// request indefinitely on server.js, or die ungracefully on a Netlify
// function's own execution limit instead of failing cleanly.
const UPSTREAM_TIMEOUT_MS = 7000;
const UPSTREAM_TOTAL_DEADLINE_MS = 12000;
const REGISTRAR_RDAP_TIMEOUT_MS = 7000;
const MAX_RDAP_ENDPOINTS = 3;
const MAX_RDAP_ENDPOINT_LENGTH = 2048;
const MAX_RDAP_ATTEMPT_DETAIL_LENGTH = 240;
// RDAP responses can legitimately run large (many nameservers/statuses/
// entities on one record) but still need a bound - unlike a domain's own
// homepage this isn't attacker-authored content, so this cap is generous.
const MAX_RDAP_BYTES = 2000000;
const MAX_RDAP_ENTITIES = 100;
const MAX_RDAP_ENTITY_DEPTH = 6;
const MAX_ENTITIES_PER_ROLE = 5;
const MAX_VCARD_ENTRIES = 100;
const MAX_ENTITY_ROLES = 12;
const MAX_CONTACT_VALUES = 8;
const MAX_ENTITY_LINKS = 10;
const MAX_RDAP_LINKS = 20;
const MAX_RDAP_REDACTIONS = 100;
const MAX_RDAP_VARIANT_GROUPS = 20;
const MAX_RDAP_VARIANT_NAMES = 50;
const RDAP_CONTACT_ROLES = new Set([
  'registrar', 'registrant', 'administrative', 'technical', 'billing', 'abuse', 'noc',
  'reseller', 'sponsor', 'proxy', 'notifications',
]);

// Uses safeFetch (not plain fetch) for the same reason every other outbound
// request in this project does: it validates every redirect hop lands on a
// public address instead of just following an upstream registry's
// redirects blindly, and pins the connection against DNS rebinding. The
// timeout stays armed through the capped body read (cleared in `finally`,
// not right after headers arrive) - a slow/malicious upstream could
// otherwise send headers immediately and then stall or trickle the body
// forever with no deadline protecting the read.
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await safeFetch(url, { ...options, signal: controller.signal });
    const { text, truncated } = await readTextCapped(res, MAX_RDAP_BYTES);
    if (truncated) throw new Error(`Response from ${url} exceeded ${MAX_RDAP_BYTES} bytes`);
    return { status: res.status, ok: res.ok, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRegistrarWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await safeFetchDetailed(url, { ...options, signal: controller.signal });
    const { text, truncated } = await readTextCapped(result.response, MAX_RDAP_BYTES);
    if (truncated) throw new Error(`Response from ${url} exceeded ${MAX_RDAP_BYTES} bytes`);
    return {
      status: result.response.status,
      ok: result.response.ok,
      text,
      finalUrl: result.finalUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// CIDR helpers (for matching an IP against RDAP bootstrap ranges)
// ---------------------------------------------------------------------------

function ipv4ToLong(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + (parseInt(octet, 10) & 0xff), 0) >>> 0;
}

function ipInCidrV4(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = bitsStr !== undefined ? parseInt(bitsStr, 10) : 32;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToLong(ip) & mask) === (ipv4ToLong(range) & mask);
}

function expandIpv6(ip) {
  let head = ip;
  let tail = '';
  if (ip.includes('::')) {
    [head, tail] = ip.split('::');
  } else {
    tail = '';
  }
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts = ip.includes('::')
    ? [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts]
    : headParts;
  while (parts.length < 8) parts.push('0');
  return parts.slice(0, 8);
}

function ipv6ToBigInt(ip) {
  const parts = expandIpv6(ip);
  return parts.reduce((acc, part) => (acc << 16n) + BigInt(parseInt(part || '0', 16)), 0n);
}

function ipInCidrV6(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = bitsStr !== undefined ? parseInt(bitsStr, 10) : 128;
  const full = (1n << 128n) - 1n;
  const mask = bits === 0 ? 0n : (full << BigInt(128 - bits)) & full;
  return (ipv6ToBigInt(ip) & mask) === (ipv6ToBigInt(range) & mask);
}

// ---------------------------------------------------------------------------
// Bootstrap lookup
// ---------------------------------------------------------------------------

function validBootstrap(data) {
  return Boolean(data && typeof data === 'object' && !Array.isArray(data)
    && Array.isArray(data.services) && data.services.length > 0
    && data.services.every((service) => Array.isArray(service) && service.length >= 2
      && Array.isArray(service[0]) && service[0].length > 0
      && service[0].every((entry) => typeof entry === 'string' && entry.length > 0)
      && Array.isArray(service[1]) && service[1].length > 0
      && service[1].some((url) => typeof url === 'string' && /^https?:\/\//i.test(url))));
}

async function fetchBootstrap(kind, options = {}) {
  if (!BOOTSTRAP_KINDS.has(kind)) throw new Error(`Unsupported RDAP bootstrap kind: ${kind}`);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const fetchUpstream = options.fetchUpstream || fetchRegistrarWithTimeout;
  const cached = bootstrapCache.get(kind);
  if (cached && now() - cached.fetchedAt < BOOTSTRAP_TTL_MS) return cached.data;
  if (bootstrapInflight.has(kind)) return bootstrapInflight.get(kind);

  const request = (async () => {
    try {
      const res = await fetchUpstream(`https://data.iana.org/rdap/${kind}.json`, {}, UPSTREAM_TIMEOUT_MS);
      if (!res.ok) throw new Error(`IANA bootstrap fetch failed for ${kind} (${res.status})`);
      let data;
      try { data = JSON.parse(res.text); } catch { throw new Error(`IANA bootstrap returned invalid JSON for ${kind}`); }
      if (!validBootstrap(data)) throw new Error(`IANA bootstrap returned an unexpected format for ${kind}`);
      bootstrapCache.set(kind, { data, fetchedAt: now() });
      return data;
    } catch (cause) {
      const fallback = bootstrapCache.get(kind);
      if (fallback && now() - fallback.fetchedAt <= BOOTSTRAP_STALE_TTL_MS) return fallback.data;
      throw cause;
    } finally {
      bootstrapInflight.delete(kind);
    }
  })();
  bootstrapInflight.set(kind, request);
  return request;
}

function clearRdapBootstrapCache() {
  bootstrapCache.clear();
  bootstrapInflight.clear();
}

function uniqueBases(urls) {
  const seen = new Set();
  return (Array.isArray(urls) ? urls : [])
    .filter((url) => typeof url === 'string'
      && url.length <= MAX_RDAP_ENDPOINT_LENGTH
      && !/[\u0000-\u001f\u007f]/.test(url)
      && /^https?:\/\//i.test(url))
    .sort((a, b) => Number(/^http:\/\//i.test(a)) - Number(/^http:\/\//i.test(b)))
    .filter((url) => {
      const key = url.replace(/\/$/, '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function findRdapBases(type, value) {
  if (type === 'domain') {
    const bootstrap = await fetchBootstrap('dns');
    const tld = value.split('.').pop().toLowerCase();
    for (const [tlds, urls] of bootstrap.services) {
      if (tlds.some((t) => t.toLowerCase() === tld)) return uniqueBases(urls);
    }
    return [];
  }

  if (type === 'ipv4' || type === 'ipv6') {
    const bootstrap = await fetchBootstrap(type === 'ipv4' ? 'ipv4' : 'ipv6');
    const matcher = type === 'ipv4' ? ipInCidrV4 : ipInCidrV6;
    let best = null;
    let bestPrefix = -1;
    for (const [cidrs, urls] of bootstrap.services) {
      for (const cidr of cidrs) {
        if (matcher(value, cidr)) {
          const prefix = parseInt(cidr.split('/')[1] ?? (type === 'ipv4' ? '32' : '128'), 10);
          if (prefix > bestPrefix) {
            bestPrefix = prefix;
            best = uniqueBases(urls);
          }
        }
      }
    }
    return best || [];
  }

  if (type === 'asn') {
    const bootstrap = await fetchBootstrap('asn');
    const num = parseInt(value.replace(/^AS/i, ''), 10);
    for (const [ranges, urls] of bootstrap.services) {
      for (const range of ranges) {
        const [start, end] = range.includes('-') ? range.split('-').map(Number) : [Number(range), Number(range)];
        if (num >= start && num <= end) return uniqueBases(urls);
      }
    }
    return [];
  }

  return [];
}

function rdapPathFor(type, value) {
  if (type === 'domain') return `domain/${value}`;
  if (type === 'ipv4' || type === 'ipv6') return `ip/${value}`;
  if (type === 'asn') return `autnum/${value.replace(/^AS/i, '')}`;
  throw new Error(`Unsupported RDAP type: ${type}`);
}

function canonicalDomain(value) {
  if (typeof value !== 'string') return null;
  const ascii = domainToASCII(value.trim().replace(/\.+$/, ''));
  return ascii ? ascii.toLowerCase() : null;
}

function ipv6ToComparableBigInt(ip) {
  let normalized = ip;
  if (ip.includes('.')) {
    const lastColon = ip.lastIndexOf(':');
    const embedded = ip.slice(lastColon + 1);
    if (net.isIP(embedded) !== 4) return null;
    const value = ipv4ToLong(embedded);
    normalized = `${ip.slice(0, lastColon)}:${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  try {
    return ipv6ToBigInt(normalized);
  } catch {
    return null;
  }
}

function validateRdapResponse(type, requestedValue, parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, detail: 'The response did not contain a usable RDAP object.' };
  }

  const expectedClass = type === 'domain' ? 'domain'
    : type === 'asn' ? 'autnum' : 'ip network';
  if (parsed.objectClassName && parsed.objectClassName !== expectedClass) {
    return {
      valid: false,
      detail: `Expected object class ${expectedClass}, received ${parsed.objectClassName}.`,
    };
  }

  if (type === 'domain') {
    const requested = canonicalDomain(requestedValue);
    const returned = canonicalDomain(parsed.domain);
    if (!requested || !returned || requested !== returned) {
      return { valid: false, detail: 'The response domain did not match the requested domain.' };
    }
    return { valid: true, detail: null };
  }

  if (type === 'asn') {
    const requested = Number(String(requestedValue).replace(/^AS/i, ''));
    if (!Number.isSafeInteger(requested)
      || !Number.isSafeInteger(parsed.startAutnum)
      || !Number.isSafeInteger(parsed.endAutnum)
      || parsed.startAutnum > parsed.endAutnum
      || requested < parsed.startAutnum
      || requested > parsed.endAutnum) {
      return { valid: false, detail: 'The response AS range did not cover the requested ASN.' };
    }
    return { valid: true, detail: null };
  }

  const version = type === 'ipv4' ? 4 : 6;
  if (net.isIP(requestedValue) !== version
    || net.isIP(parsed.startAddress) !== version
    || net.isIP(parsed.endAddress) !== version) {
    return { valid: false, detail: 'The response did not contain a compatible IP range.' };
  }
  const convert = version === 4 ? ipv4ToLong : ipv6ToComparableBigInt;
  const requested = convert(requestedValue);
  const start = convert(parsed.startAddress);
  const end = convert(parsed.endAddress);
  if (requested === null || start === null || end === null
    || start > end || requested < start || requested > end) {
    return { valid: false, detail: 'The response IP range did not cover the requested address.' };
  }
  return { valid: true, detail: null };
}

function safeAttemptDetail(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, MAX_RDAP_ATTEMPT_DETAIL_LENGTH) : null;
}

/**
 * @param {string} endpoint
 * @param {string} outcome
 * @param {{status?: number|null, detail?: string|null, selected?: boolean}} [options]
 */
function rdapAttempt(endpoint, outcome, options = {}) {
  const { status = null, detail = null, selected = false } = options;
  return {
    endpoint: String(endpoint).slice(0, MAX_RDAP_ENDPOINT_LENGTH),
    transportSecurity: /^https:\/\//i.test(endpoint) ? 'https' : 'http',
    status: Number.isInteger(status) ? status : null,
    outcome,
    detail: safeAttemptDetail(detail),
    selected,
  };
}

function rdapFailure(outcome, status) {
  if (outcome === 'invalid_json') return 'returned invalid JSON';
  if (outcome === 'invalid_response') return 'returned an invalid RDAP object';
  if (outcome === 'rate_limited') return `returned HTTP ${status}`;
  if (outcome === 'server_error' || outcome === 'client_error') return `returned HTTP ${status}`;
  return outcome.replaceAll('_', ' ');
}

function registrarRdapError(endpoint, outcome, options = {}) {
  const attempt = rdapAttempt(endpoint, outcome, options);
  const detail = attempt.detail || 'The registrar RDAP request failed.';
  return Object.assign(new Error(detail), {
    registrarRdap: {
      status: 'error',
      detail,
      endpoint: attempt.endpoint,
      transportSecurity: attempt.transportSecurity,
      upstreamStatus: attempt.status,
      fetchedAt: null,
      attempt,
    },
  });
}

function domainEndpointIdentity(raw, domain) {
  try {
    const url = new URL(raw);
    const canonical = canonicalDomain(domain);
    const path = url.pathname.replace(/\/+$/, '');
    const match = path.match(/\/domain\/([^/]+)$/i);
    if (!canonical || !match) return null;
    const pathDomain = canonicalDomain(decodeURIComponent(match[1]));
    if (pathDomain !== canonical) return null;
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}/domain/${canonical}`;
  } catch {
    return null;
  }
}

/**
 * Select one registrar-published domain-object URL from normalized RDAP links.
 * The href is registry-controlled input, so this boundary accepts only a
 * complete HTTPS domain-object URL; it never constructs a request path from an
 * upstream-provided service base.
 *
 * @param {string} domain
 * @param {Array<any>} links
 * @param {string|null} [registryEndpoint]
 */
function selectRegistrarRdapLink(domain, links, registryEndpoint = null) {
  const canonical = canonicalDomain(domain);
  if (!canonical || !Array.isArray(links)) return null;
  const registryIdentity = registryEndpoint
    ? domainEndpointIdentity(registryEndpoint, canonical)
    : null;

  for (const link of links) {
    if (!link || typeof link !== 'object' || Array.isArray(link)) continue;
    if (link.rel !== 'related' || typeof link.href !== 'string') continue;
    if (link.href.length > MAX_RDAP_ENDPOINT_LENGTH || /[\u0000-\u001f\u007f]/.test(link.href)) continue;

    let url;
    try {
      url = new URL(link.href);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    // WHATWG URL parsing normalizes an explicit default :443 to an empty port,
    // so this reliably rejects non-default ports without fragile raw parsing.
    if (url.port || url.search || url.hash) continue;
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(hostname)) continue;

    const type = typeof link.type === 'string'
      ? link.type.split(';', 1)[0].trim().toLowerCase()
      : '';
    if (type && type !== 'application/rdap+json') continue;

    const identity = domainEndpointIdentity(url.href, canonical);
    if (!identity || identity === registryIdentity) continue;
    return url.href;
  }
  return null;
}

/**
 * Fetch at most one registrar RDAP object linked by a successful registry
 * response. Definitive results use the shared three-minute lookup cache;
 * transient errors reject so the cache never retains them.
 *
 * @param {string} domain
 * @param {any} registryRecord
 * @param {{fetchUpstream?: Function}} [options]
 */
async function fetchRegistrarRdapRecord(domain, registryRecord, options = {}) {
  const canonical = canonicalDomain(domain);
  if (!canonical) throw new Error('A valid domain is required for registrar RDAP.');
  const fetchUpstream = options.fetchUpstream || fetchWithTimeout;

  return cached(`rdap-registrar:domain:${canonical}`, async () => {
    const endpoint = selectRegistrarRdapLink(
      canonical,
      registryRecord?.parsed?.links,
      registryRecord?.rdapServer || null
    );
    if (!endpoint) {
      return {
        status: 'unsupported',
        detail: 'The registry did not publish a registrar RDAP link for this domain.',
        endpoint: null,
        transportSecurity: null,
        upstreamStatus: null,
        fetchedAt: null,
        attempt: null,
      };
    }

    let upstream;
    try {
      upstream = await fetchUpstream(
        endpoint,
        { headers: { Accept: 'application/rdap+json' } },
        REGISTRAR_RDAP_TIMEOUT_MS
      );
    } catch (err) {
      const detail = String(err && err.message ? err.message : 'request failed');
      const outcome = err && err.name === 'AbortError' || /timed? out|time limit/i.test(detail)
        ? 'timeout'
        : /exceeded \d+ bytes/i.test(detail) ? 'invalid_response' : 'network_error';
      throw registrarRdapError(endpoint, outcome, { detail });
    }

    const selectedEndpoint = upstream.finalUrl || endpoint;
    if (selectRegistrarRdapLink(
      canonical,
      [{ rel: 'related', href: selectedEndpoint }],
      registryRecord?.rdapServer || null
    ) !== selectedEndpoint) {
      throw registrarRdapError(selectedEndpoint, 'invalid_response', {
        status: upstream.status,
        detail: 'The registrar endpoint redirected outside the eligible HTTPS domain-object URL boundary.',
      });
    }

    if (upstream.status !== 404 && !upstream.ok) {
      const outcome = upstream.status === 429 ? 'rate_limited'
        : upstream.status >= 500 ? 'server_error' : 'client_error';
      throw registrarRdapError(selectedEndpoint, outcome, {
        status: upstream.status,
        detail: `The registrar endpoint returned HTTP ${upstream.status}.`,
      });
    }

    let data;
    try {
      data = JSON.parse(upstream.text);
    } catch {
      throw registrarRdapError(selectedEndpoint, 'invalid_json', {
        status: upstream.status,
        detail: 'The registrar endpoint returned invalid JSON.',
      });
    }

    const fetchedAt = new Date().toISOString();
    if (upstream.status === 404) {
      const attempt = rdapAttempt(selectedEndpoint, 'not_found', {
        status: upstream.status,
        detail: 'The registrar endpoint reported no matching object.',
        selected: true,
      });
      return {
        status: 'not_found',
        detail: 'The registrar RDAP service reported no matching object.',
        endpoint: selectedEndpoint,
        transportSecurity: 'https',
        upstreamStatus: upstream.status,
        fetchedAt,
        data,
        parsed: null,
        attempt,
      };
    }

    const parsed = parseRdap('domain', data);
    const validation = validateRdapResponse('domain', canonical, parsed);
    if (!validation.valid) {
      throw registrarRdapError(selectedEndpoint, 'invalid_response', {
        status: upstream.status,
        detail: validation.detail,
      });
    }

    const attempt = rdapAttempt(selectedEndpoint, 'success', {
      status: upstream.status,
      detail: 'The registrar endpoint returned the requested RDAP object.',
      selected: true,
    });
    return {
      status: 'success',
      detail: null,
      endpoint: selectedEndpoint,
      transportSecurity: 'https',
      upstreamStatus: upstream.status,
      fetchedAt,
      data,
      parsed,
      attempt,
    };
  });
}

// Resolves the registry, fetches the record, and parses it - the full
// /api/rdap request shape shared by both server.js and
// netlify/functions/rdap.js, so the two deployment targets can't drift.
// Returns null when no RDAP registry covers this query (the caller decides
// how to report that as a 404). Cached briefly (lib/lookup-cache.js) since
// checkDomainAvailability() also calls this for the same domain a fast
// scan and a follow-up deep-check both look up in quick succession.
async function fetchRdapFromBases(type, value, bases, fetchUpstream = fetchWithTimeout) {
  const candidates = uniqueBases(bases).slice(0, MAX_RDAP_ENDPOINTS);
  if (candidates.length === 0) return null;

  const startedAt = Date.now();
  const attempts = [];
  for (const base of candidates) {
    const elapsed = Date.now() - startedAt;
    const remaining = UPSTREAM_TOTAL_DEADLINE_MS - elapsed;
    if (remaining <= 0) break;

    const url = base.replace(/\/$/, '') + '/' + rdapPathFor(type, value);
    try {
      const upstream = await fetchUpstream(
        url,
        { headers: { Accept: 'application/rdap+json' } },
        Math.min(UPSTREAM_TIMEOUT_MS, remaining)
      );

      let data;
      try {
        data = JSON.parse(upstream.text);
      } catch {
        attempts.push(rdapAttempt(url, 'invalid_json', {
          status: upstream.status, detail: 'The endpoint returned invalid JSON.',
        }));
        continue;
      }

      // A 404 from the authoritative RDAP service is a real negative domain
      // answer. Other non-success statuses (especially 429/5xx) describe the
      // upstream service, not the queried object, so try the next bootstrap
      // endpoint and never let availability interpret them as "not found".
      if (upstream.status !== 404 && !upstream.ok) {
        const outcome = upstream.status === 429 ? 'rate_limited'
          : upstream.status >= 500 ? 'server_error' : 'client_error';
        attempts.push(rdapAttempt(url, outcome, {
          status: upstream.status, detail: `The endpoint returned HTTP ${upstream.status}.`,
        }));
        continue;
      }

      if (upstream.status === 404) {
        attempts.push(rdapAttempt(url, 'not_found', {
          status: upstream.status, detail: 'The authoritative endpoint reported no matching object.', selected: true,
        }));
        return {
          rdapServer: url,
          transportSecurity: /^https:\/\//i.test(url) ? 'https' : 'http',
          upstreamStatus: upstream.status,
          fetchedAt: new Date().toISOString(),
          data,
          parsed: null,
          attempts,
        };
      }

      const parsed = parseRdap(type, data);
      const validation = validateRdapResponse(type, value, parsed);
      if (!validation.valid) {
        attempts.push(rdapAttempt(url, 'invalid_response', {
          status: upstream.status, detail: validation.detail,
        }));
        continue;
      }

      attempts.push(rdapAttempt(url, 'success', {
        status: upstream.status, detail: 'The endpoint returned the requested RDAP object.', selected: true,
      }));

      return {
        rdapServer: url,
        transportSecurity: /^https:\/\//i.test(url) ? 'https' : 'http',
        upstreamStatus: upstream.status,
        fetchedAt: new Date().toISOString(),
        data,
        parsed,
        attempts,
      };
    } catch (err) {
      const detail = String(err && err.message ? err.message : 'request failed');
      const outcome = err && err.name === 'AbortError' || /timed? out|time limit/i.test(detail)
        ? 'timeout' : 'network_error';
      attempts.push(rdapAttempt(url, outcome, { detail }));
    }
  }

  const detail = attempts.length
    ? attempts.map((attempt) => `${attempt.endpoint} ${rdapFailure(attempt.outcome, attempt.status)}`).join('; ')
    : 'the total upstream deadline expired';
  throw Object.assign(
    new Error(`RDAP lookup failed across ${candidates.length} endpoint(s): ${detail}`),
    { attempts }
  );
}

async function fetchRdapRecord(type, value) {
  return cached(`rdap:${type}:${value}`, async () => {
    const bases = await findRdapBases(type, value);
    return fetchRdapFromBases(type, value, bases);
  });
}

// ---------------------------------------------------------------------------
// RDAP response parsing (turns the raw JSON into a readable summary)
// ---------------------------------------------------------------------------

function boundedString(value, maxLength, { lower = false } = {}) {
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return lower ? normalized.toLowerCase() : normalized;
}

function boundedInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function truncatedText(value, maxLength) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength).trim() || null;
}

function flattenScalarValues(value, maxValues = 32) {
  const output = [];
  const stack = [{ value, depth: 0 }];
  let visited = 0;
  while (stack.length && output.length < maxValues && visited < 128) {
    const current = stack.pop();
    if (!current) continue;
    visited += 1;
    if (Array.isArray(current.value)) {
      if (current.depth >= MAX_RDAP_ENTITY_DEPTH) continue;
      for (let i = Math.min(current.value.length, maxValues) - 1; i >= 0; i -= 1) {
        stack.push({ value: current.value[i], depth: current.depth + 1 });
      }
    } else if (typeof current.value === 'string') {
      output.push(current.value);
    } else if (typeof current.value === 'number' && Number.isFinite(current.value)) {
      output.push(String(current.value));
    }
  }
  return output;
}

function vcardRawValues(vcardArray, field) {
  if (!Array.isArray(vcardArray) || !Array.isArray(vcardArray[1])) return [];
  return vcardArray[1]
    .slice(0, MAX_VCARD_ENTRIES)
    .filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].toLowerCase() === field)
    .map((entry) => entry[3]);
}

function normalizeContactValues(vcardArray, field, maxLength, { lower = false } = {}) {
  const values = [];
  const seen = new Set();
  for (const raw of vcardRawValues(vcardArray, field)) {
    for (const scalar of flattenScalarValues(raw, MAX_CONTACT_VALUES)) {
      const normalized = boundedString(scalar, maxLength, { lower });
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(normalized);
      if (values.length >= MAX_CONTACT_VALUES) return values;
    }
  }
  return values;
}

function normalizeAddresses(vcardArray) {
  const addresses = [];
  const seen = new Set();
  for (const raw of vcardRawValues(vcardArray, 'adr')) {
    const parts = flattenScalarValues(raw, 32)
      .map((part) => boundedString(part, 300))
      .filter(Boolean);
    const address = boundedString(parts.join(', '), 1000);
    if (!address || seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    addresses.push(address);
    if (addresses.length >= MAX_CONTACT_VALUES) break;
  }
  return addresses;
}

function contactValuesTruncated(vcardArray) {
  for (const field of ['fn', 'org', 'email', 'tel']) {
    let count = 0;
    for (const raw of vcardRawValues(vcardArray, field)) {
      count += flattenScalarValues(raw, MAX_CONTACT_VALUES + 1).length;
      if (count > MAX_CONTACT_VALUES) return true;
    }
  }
  return vcardRawValues(vcardArray, 'adr').length > MAX_CONTACT_VALUES;
}

function normalizeLinks(links, maxLinks = MAX_RDAP_LINKS) {
  if (!Array.isArray(links)) return [];
  const normalized = [];
  for (const link of links.slice(0, 100)) {
    if (!link || typeof link !== 'object' || Array.isArray(link)) continue;
    const href = boundedString(link.href, 2048);
    if (!href) continue;
    try {
      const parsed = new URL(href);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
    } catch {
      continue;
    }
    normalized.push({
      rel: boundedString(link.rel, 100, { lower: true }),
      href,
      type: boundedString(link.type, 160, { lower: true }),
      title: boundedString(link.title, 300),
    });
    if (normalized.length >= maxLinks) break;
  }
  return normalized;
}

function normalizePublicIds(publicIds) {
  if (!Array.isArray(publicIds)) return [];
  const normalized = [];
  for (const item of publicIds.slice(0, 100)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const type = boundedString(item.type, 160);
    const identifier = boundedString(item.identifier, 300);
    if (!type || !identifier) continue;
    normalized.push({ type, identifier });
    if (normalized.length >= 20) break;
  }
  return normalized;
}

function normalizeStringList(value, maxItems, maxLength, { lower = false } = {}) {
  if (!Array.isArray(value)) return [];
  const output = [];
  const seen = new Set();
  for (const item of value.slice(0, Math.max(maxItems * 4, maxItems))) {
    const normalized = boundedString(item, maxLength, { lower });
    if (!normalized || seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    output.push(normalized);
    if (output.length >= maxItems) break;
  }
  return output;
}

function redactionLabel(value) {
  if (typeof value === 'string') return boundedString(value, 300);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return boundedString(value.type, 160) || boundedString(value.description, 300);
}

function normalizeRedactions(redacted) {
  if (!Array.isArray(redacted)) return { redactions: [], redactionsTruncated: false };
  const redactions = [];
  const candidates = redacted.slice(0, MAX_RDAP_REDACTIONS * 2);
  let stoppedAt = candidates.length;
  for (let index = 0; index < candidates.length; index += 1) {
    const item = candidates[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const entry = {
      name: redactionLabel(item.name),
      reason: redactionLabel(item.reason),
      method: boundedString(item.method, 80, { lower: true }),
      pathLanguage: boundedString(item.pathLang, 80, { lower: true }),
      prePath: boundedString(item.prePath, 512),
      postPath: boundedString(item.postPath, 512),
      replacementPath: boundedString(item.replacementPath, 512),
    };
    if (!Object.values(entry).some(Boolean)) continue;
    redactions.push(entry);
    if (redactions.length >= MAX_RDAP_REDACTIONS) {
      stoppedAt = index + 1;
      break;
    }
  }
  return {
    redactions,
    redactionsTruncated: stoppedAt < redacted.length,
  };
}

function normalizeDomainVariants(value) {
  if (!Array.isArray(value)) return { variants: [], variantsTruncated: false };
  const variants = [];
  let truncated = value.length > MAX_RDAP_VARIANT_GROUPS;
  for (const group of value.slice(0, MAX_RDAP_VARIANT_GROUPS)) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    const sourceNames = Array.isArray(group.variantNames) ? group.variantNames : [];
    const variantNames = [];
    for (const name of sourceNames.slice(0, MAX_RDAP_VARIANT_NAMES * 2)) {
      if (!name || typeof name !== 'object' || Array.isArray(name)) continue;
      const ldhName = boundedString(name.ldhName, 253);
      const unicodeName = boundedString(name.unicodeName, 253);
      if (!ldhName && !unicodeName) continue;
      variantNames.push({ ldhName, unicodeName });
      if (variantNames.length >= MAX_RDAP_VARIANT_NAMES) break;
    }
    if (sourceNames.length > MAX_RDAP_VARIANT_NAMES) truncated = true;
    const relation = normalizeStringList(group.relation, 20, 100, { lower: true });
    const idnTable = boundedString(group.idnTable, 300);
    if (!variantNames.length && !relation.length && !idnTable) continue;
    variants.push({ relation, idnTable, variantNames });
  }
  return { variants, variantsTruncated: truncated };
}

function publicId(entity, typePattern) {
  const match = entity && Array.isArray(entity.publicIds)
    ? entity.publicIds.find((item) => typePattern.test(String(item.type || '')))
    : null;
  return match ? match.identifier : null;
}

function textWouldTruncate(value, maxLength) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return false;
  return value.replace(/\s+/g, ' ').trim().length > maxLength;
}

function summarizeTextBlocks(blocks) {
  if (!Array.isArray(blocks)) return { items: [], truncated: false };
  const output = [];
  let truncated = blocks.length > 50;
  for (const block of blocks.slice(0, 50)) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const descriptions = [];
    const sourceDescriptions = Array.isArray(block.description) ? block.description : [];
    if (sourceDescriptions.length > 20) truncated = true;
    for (const text of sourceDescriptions.slice(0, 20)) {
      if (textWouldTruncate(text, 800)) truncated = true;
      const description = truncatedText(text, 800);
      if (!description) continue;
      if (descriptions.length < 6) descriptions.push(description);
      else truncated = true;
    }
    if (!descriptions.length) continue;
    if (textWouldTruncate(block.title, 160)) truncated = true;
    const item = { title: truncatedText(block.title, 160) || 'Notice', descriptions };
    if (output.length < 12) output.push(item);
    else truncated = true;
  }
  return { items: output, truncated };
}

function boundedEventString(value, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.trim() || null;
}

function normalizeRdapEvents(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
    const action = boundedEventString(event.eventAction, 100)?.toLowerCase().replace(/\s+/g, ' ') || null;
    const date = boundedEventString(event.eventDate, 64);
    const actor = boundedEventString(event.eventActor, 160);
    return action || date ? { action, date, actor } : null;
  }).filter(Boolean);
}

function lifecycleDate(events, action, newest) {
  let selected = null;
  let selectedTime = newest ? -Infinity : Infinity;
  for (const event of events) {
    if (event.action !== action || !event.date) continue;
    const time = Date.parse(event.date);
    if (!Number.isFinite(time)) continue;
    if ((newest && time > selectedTime) || (!newest && time < selectedTime)) {
      selected = event.date;
      selectedTime = time;
    }
  }
  return selected;
}

function summarizeLifecycle(events) {
  return {
    createdDate: lifecycleDate(events, 'registration', false),
    reregistrationDate: lifecycleDate(events, 'reregistration', true),
    expiryDate: lifecycleDate(events, 'expiration', true),
    updatedDate: lifecycleDate(events, 'last changed', true),
    transferDate: lifecycleDate(events, 'transfer', true),
    deletionDate: lifecycleDate(events, 'deletion', true),
    reinstantiationDate: lifecycleDate(events, 'reinstantiation', true),
  };
}

function summarizeEntity(entity) {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return null;
  const roles = [];
  if (Array.isArray(entity.roles)) {
    for (const rawRole of entity.roles.slice(0, 100)) {
      const role = boundedString(rawRole, 80, { lower: true });
      if (!role || roles.includes(role)) continue;
      roles.push(role);
      if (roles.length >= MAX_ENTITY_ROLES) break;
    }
  }
  const names = normalizeContactValues(entity.vcardArray, 'fn', 300);
  const organizations = normalizeContactValues(entity.vcardArray, 'org', 300);
  const emails = normalizeContactValues(entity.vcardArray, 'email', 320, { lower: true });
  const phones = normalizeContactValues(entity.vcardArray, 'tel', 100);
  const addresses = normalizeAddresses(entity.vcardArray);
  const summary = {
    handle: boundedString(entity.handle, 200),
    roles,
    name: names[0] || null,
    names,
    org: organizations[0] || null,
    organizations,
    email: emails[0] || null,
    emails,
    phone: phones[0] || null,
    phones,
    address: addresses[0] || null,
    addresses,
    publicIds: normalizePublicIds(entity.publicIds),
    links: normalizeLinks(entity.links, MAX_ENTITY_LINKS),
    truncated: Boolean(
      (Array.isArray(entity.roles) && entity.roles.length > MAX_ENTITY_ROLES)
      || (Array.isArray(entity.vcardArray?.[1]) && entity.vcardArray[1].length > MAX_VCARD_ENTRIES)
      || contactValuesTruncated(entity.vcardArray)
      || (Array.isArray(entity.publicIds) && entity.publicIds.length > 20)
      || (Array.isArray(entity.links) && entity.links.length > MAX_ENTITY_LINKS)
    ),
  };
  const hasAny = Boolean(summary.handle || summary.name || summary.org || summary.email
    || summary.phone || summary.address || summary.publicIds.length || summary.links.length);
  return hasAny ? summary : null;
}

function summarizeEntities(entities) {
  const summaries = [];
  const source = Array.isArray(entities) ? entities : [];
  let truncated = source.length > MAX_RDAP_ENTITIES;
  const stack = source
    .slice(0, MAX_RDAP_ENTITIES)
    .reverse()
    .map((entity) => ({ entity, depth: 0 }));
  const seen = new WeakSet();
  let visited = 0;
  while (stack.length && visited < MAX_RDAP_ENTITIES) {
    const current = stack.pop();
    if (!current) continue;
    const { entity, depth } = current;
    if (!entity || typeof entity !== 'object' || Array.isArray(entity) || seen.has(entity)) continue;
    seen.add(entity);
    visited += 1;
    const summary = summarizeEntity(entity);
    if (summary) summaries.push(summary);
    if (depth >= MAX_RDAP_ENTITY_DEPTH || !Array.isArray(entity.entities)) continue;
    const remaining = Math.max(0, MAX_RDAP_ENTITIES - visited - stack.length);
    const nested = entity.entities.slice(0, remaining);
    if (nested.length < entity.entities.length) truncated = true;
    for (let i = nested.length - 1; i >= 0; i -= 1) stack.push({ entity: nested[i], depth: depth + 1 });
  }
  if (stack.length) truncated = true;
  return { summaries, truncated };
}

function groupEntitiesByRole(entities) {
  const grouped = {};
  const truncatedRoles = new Set();
  for (const entity of entities) {
    for (const role of entity.roles) {
      if (!RDAP_CONTACT_ROLES.has(role)) continue;
      if (!grouped[role]) grouped[role] = [];
      if (grouped[role].length < MAX_ENTITIES_PER_ROLE) grouped[role].push(entity);
      else truncatedRoles.add(role);
    }
  }
  return { entitiesByRole: grouped, truncatedEntityRoles: [...truncatedRoles].sort() };
}

function entityInventory(entities) {
  const collected = summarizeEntities(entities);
  const grouped = groupEntitiesByRole(collected.summaries);
  return {
    ...grouped,
    entitiesTruncated: collected.truncated || grouped.truncatedEntityRoles.length > 0
      || collected.summaries.some((entity) => entity.truncated),
  };
}

function parseRdap(type, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const events = normalizeRdapEvents(data.events);
  const redactionInfo = normalizeRedactions(data.redacted);
  const noticesInfo = summarizeTextBlocks(data.notices);
  const remarksInfo = summarizeTextBlocks(data.remarks);
  // Preserve the established status-array contract while making it available
  // to every RDAP object type. Unlike set-like fields, status order and
  // repetition remain as published for backwards compatibility.
  const statuses = Array.isArray(data.status)
    ? data.status.slice(0, 100).map((status) => boundedString(status, 160)).filter(Boolean)
    : [];
  const common = {
    objectClassName: boundedString(data.objectClassName, 80, { lower: true }),
    language: boundedString(data.lang, 35, { lower: true }),
    conformance: normalizeStringList(data.rdapConformance, 50, 160, { lower: true }),
    conformanceTruncated: Array.isArray(data.rdapConformance) && data.rdapConformance.length > 50,
    ...redactionInfo,
    port43: boundedString(data.port43, 300),
    parentHandle: boundedString(data.parentHandle, 300),
    links: normalizeLinks(data.links),
    linksTruncated: Array.isArray(data.links) && data.links.length > MAX_RDAP_LINKS,
    notices: noticesInfo.items,
    noticesTruncated: noticesInfo.truncated,
    remarks: remarksInfo.items,
    remarksTruncated: remarksInfo.truncated,
    statuses,
    statusesTruncated: Array.isArray(data.status) && data.status.length > 100,
    events,
    eventsTruncated: Array.isArray(data.events) && data.events.length > 100,
    lifecycle: summarizeLifecycle(events),
  };

  if (type === 'domain') {
    const { entitiesByRole, entitiesTruncated, truncatedEntityRoles } = entityInventory(data.entities);
    const registrarEntity = entitiesByRole.registrar && entitiesByRole.registrar[0];
    let nameserverAddressesTruncated = false;
    const nameserverDetails = Array.isArray(data.nameservers)
      ? data.nameservers.slice(0, 200).map((ns) => {
          if (!ns || typeof ns !== 'object' || Array.isArray(ns)) return null;
          const v4 = Array.isArray(ns.ipAddresses && ns.ipAddresses.v4) ? ns.ipAddresses.v4 : [];
          const v6 = Array.isArray(ns.ipAddresses && ns.ipAddresses.v6) ? ns.ipAddresses.v6 : [];
          if (v4.length + v6.length > 20) nameserverAddressesTruncated = true;
          const addresses = [
            ...v4.map((address) => boundedString(address, 80)).filter((address) => address && net.isIP(address) === 4),
            ...v6.map((address) => boundedString(address, 80)).filter((address) => address && net.isIP(address) === 6),
          ].slice(0, 20);
          return {
            name: boundedString(ns.ldhName || ns.unicodeName, 253),
            addresses,
          };
        }).filter((ns) => ns && ns.name)
      : [];
    const secureDns = data.secureDNS && typeof data.secureDNS === 'object' && !Array.isArray(data.secureDNS)
      ? data.secureDNS : null;
    const variantInfo = normalizeDomainVariants(data.variants);
    const dsData = secureDns && Array.isArray(secureDns.dsData)
      ? secureDns.dsData.slice(0, 50).map((ds) => {
          if (!ds || typeof ds !== 'object' || Array.isArray(ds)) return null;
          const digest = boundedString(ds.digest, 512);
          const normalized = {
            keyTag: boundedInteger(ds.keyTag, 0, 65535), algorithm: boundedInteger(ds.algorithm, 0, 255),
            digestType: boundedInteger(ds.digestType, 0, 255),
            digest: digest && digest.length % 2 === 0 && /^[0-9a-f]+$/i.test(digest) ? digest : null,
          };
          return Object.values(normalized).every((value) => value !== null) ? normalized : null;
        }).filter(Boolean)
      : [];
    return {
      ...common,
      domain: boundedString(data.ldhName || data.unicodeName, 253),
      unicodeDomain: data.unicodeName && data.unicodeName !== data.ldhName
        ? boundedString(data.unicodeName, 253) : null,
      handle: boundedString(data.handle, 300),
      nameservers: nameserverDetails.map((ns) => ns.name),
      nameserverDetails,
      nameserversTruncated: Array.isArray(data.nameservers) && data.nameservers.length > 200,
      nameserverAddressesTruncated,
      dnssec: secureDns && secureDns.delegationSigned === true
        ? 'Signed' : secureDns && secureDns.delegationSigned === false ? 'Unsigned' : 'Unknown',
      zoneSigned: secureDns && typeof secureDns.zoneSigned === 'boolean' ? secureDns.zoneSigned : null,
      delegationSigned: secureDns && typeof secureDns.delegationSigned === 'boolean'
        ? secureDns.delegationSigned : null,
      dsData,
      dsDataTruncated: Boolean(secureDns && Array.isArray(secureDns.dsData) && secureDns.dsData.length > 50),
      ...variantInfo,
      registrarIanaId: publicId(registrarEntity, /iana registrar id/i),
      entitiesByRole,
      entitiesTruncated,
      truncatedEntityRoles,
      registrar: registrarEntity || null,
      registrant: entitiesByRole.registrant?.[0] || null,
      administrative: entitiesByRole.administrative?.[0] || null,
      technical: entitiesByRole.technical?.[0] || null,
      billing: entitiesByRole.billing?.[0] || null,
      abuse: entitiesByRole.abuse?.[0] || null,
    };
  }

  if (type === 'ipv4' || type === 'ipv6') {
    const { entitiesByRole, entitiesTruncated, truncatedEntityRoles } = entityInventory(data.entities);
    const cidrs = Array.isArray(data.cidr0_cidrs)
      ? data.cidr0_cidrs.slice(0, 200)
          .map((c) => {
            if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
            const expectedFamily = type === 'ipv4' ? 4 : 6;
            const prefix = boundedString(expectedFamily === 4 ? c.v4prefix : c.v6prefix, 80);
            if (!prefix || net.isIP(prefix) !== expectedFamily) return null;
            const length = boundedInteger(c.length, 0, expectedFamily === 4 ? 32 : 128);
            return prefix && length !== null ? `${prefix}/${length}` : null;
          })
          .filter(Boolean)
      : [];
    return {
      ...common,
      handle: boundedString(data.handle, 300),
      name: boundedString(data.name, 300),
      startAddress: boundedString(data.startAddress, 80),
      endAddress: boundedString(data.endAddress, 80),
      cidrs,
      cidrsTruncated: Array.isArray(data.cidr0_cidrs) && data.cidr0_cidrs.length > 200,
      country: boundedString(data.country, 2),
      networkType: boundedString(data.type, 160),
      entitiesByRole,
      entitiesTruncated,
      truncatedEntityRoles,
      org: entitiesByRole.registrant?.[0] || entitiesByRole.administrative?.[0] || null,
      abuse: entitiesByRole.abuse?.[0] || null,
    };
  }

  if (type === 'asn') {
    const { entitiesByRole, entitiesTruncated, truncatedEntityRoles } = entityInventory(data.entities);
    return {
      ...common,
      handle: boundedString(data.handle, 300),
      name: boundedString(data.name, 300),
      startAutnum: boundedInteger(data.startAutnum, 0, 4294967295),
      endAutnum: boundedInteger(data.endAutnum, 0, 4294967295),
      country: boundedString(data.country, 2),
      autnumType: boundedString(data.type, 160),
      entitiesByRole,
      entitiesTruncated,
      truncatedEntityRoles,
      org: entitiesByRole.registrant?.[0] || null,
      abuse: entitiesByRole.abuse?.[0] || null,
    };
  }

  return null;
}

module.exports = {
  BOOTSTRAP_TTL_MS,
  BOOTSTRAP_STALE_TTL_MS,
  fetchBootstrap,
  clearRdapBootstrapCache,
  fetchRdapRecord,
  fetchRdapFromBases,
  fetchRegistrarRdapRecord,
  selectRegistrarRdapLink,
  uniqueBases,
  parseRdap,
  normalizeRdapEvents,
  summarizeLifecycle,
};
