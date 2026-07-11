// RDAP: IANA bootstrap registry lookup (https://data.iana.org/rdap/) and
// response parsing. Shared by the Express server and the Netlify Functions.

const { cached } = require('./lookup-cache');
const { safeFetch, readTextCapped } = require('./safe-fetch');

const BOOTSTRAP_TTL_MS = 60 * 60 * 1000; // 1 hour
const bootstrapCache = new Map();

// Every other upstream call in this project (crt.sh, a domain's own
// homepage, WHOIS sockets) already has a timeout - this one didn't, so a
// slow/unresponsive registry or the IANA bootstrap endpoint could hang a
// request indefinitely on server.js, or die ungracefully on a Netlify
// function's own execution limit instead of failing cleanly.
const UPSTREAM_TIMEOUT_MS = 7000;
const UPSTREAM_TOTAL_DEADLINE_MS = 12000;
const MAX_RDAP_ENDPOINTS = 3;
// RDAP responses can legitimately run large (many nameservers/statuses/
// entities on one record) but still need a bound - unlike a domain's own
// homepage this isn't attacker-authored content, so this cap is generous.
const MAX_RDAP_BYTES = 2000000;

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

async function fetchBootstrap(kind) {
  const cached = bootstrapCache.get(kind);
  if (cached && Date.now() - cached.fetchedAt < BOOTSTRAP_TTL_MS) return cached.data;

  const res = await fetchWithTimeout(`https://data.iana.org/rdap/${kind}.json`, {}, UPSTREAM_TIMEOUT_MS);
  if (!res.ok) throw new Error(`IANA bootstrap fetch failed for ${kind} (${res.status})`);
  const data = JSON.parse(res.text);
  bootstrapCache.set(kind, { data, fetchedAt: Date.now() });
  return data;
}

function uniqueBases(urls) {
  const seen = new Set();
  return (Array.isArray(urls) ? urls : [])
    .filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url))
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
  const failures = [];
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
        failures.push(`${url} returned invalid JSON`);
        continue;
      }

      // A 404 from the authoritative RDAP service is a real negative domain
      // answer. Other non-success statuses (especially 429/5xx) describe the
      // upstream service, not the queried object, so try the next bootstrap
      // endpoint and never let availability interpret them as "not found".
      if (upstream.status !== 404 && !upstream.ok) {
        failures.push(`${url} returned HTTP ${upstream.status}`);
        continue;
      }

      return {
        rdapServer: url,
        upstreamStatus: upstream.status,
        data,
        parsed: upstream.ok ? parseRdap(type, data) : null,
      };
    } catch (err) {
      failures.push(`${url}: ${String(err && err.message ? err.message : 'request failed')}`);
    }
  }

  const detail = failures.length ? failures.join('; ') : 'the total upstream deadline expired';
  throw new Error(`RDAP lookup failed across ${candidates.length} endpoint(s): ${detail}`);
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

function findEntity(entities, role) {
  if (!Array.isArray(entities)) return null;
  for (const ent of entities) {
    if (Array.isArray(ent.roles) && ent.roles.includes(role)) return ent;
    const nested = findEntity(ent.entities, role);
    if (nested) return nested;
  }
  return null;
}

function vcardField(vcardArray, field) {
  if (!Array.isArray(vcardArray) || !Array.isArray(vcardArray[1])) return null;
  const entry = vcardArray[1].find((e) => e[0] === field);
  return entry ? entry[3] : null;
}

function summarizeEntity(entity) {
  if (!entity) return null;
  const name = vcardField(entity.vcardArray, 'fn');
  const org = vcardField(entity.vcardArray, 'org');
  const email = vcardField(entity.vcardArray, 'email');
  const phone = vcardField(entity.vcardArray, 'tel');
  const summary = { handle: entity.handle || null, name: name || null, org: org || null, email: email || null, phone: phone || null };
  const hasAny = Object.values(summary).some((v) => v);
  return hasAny ? summary : null;
}

function parseRdap(type, data) {
  if (!data || typeof data !== 'object') return null;
  const events = Array.isArray(data.events)
    ? data.events.map((e) => ({ action: e.eventAction, date: e.eventDate }))
    : [];

  if (type === 'domain') {
    return {
      domain: data.ldhName || data.unicodeName || null,
      handle: data.handle || null,
      statuses: Array.isArray(data.status) ? data.status : [],
      events,
      nameservers: Array.isArray(data.nameservers) ? data.nameservers.map((ns) => ns.ldhName).filter(Boolean) : [],
      dnssec: data.secureDNS ? (data.secureDNS.delegationSigned ? 'Signed' : 'Unsigned') : 'Unknown',
      registrar: summarizeEntity(findEntity(data.entities, 'registrar')),
      registrant: summarizeEntity(findEntity(data.entities, 'registrant')),
      technical: summarizeEntity(findEntity(data.entities, 'technical')),
      billing: summarizeEntity(findEntity(data.entities, 'billing')),
      abuse: summarizeEntity(findEntity(data.entities, 'abuse')),
    };
  }

  if (type === 'ipv4' || type === 'ipv6') {
    const cidrs = Array.isArray(data.cidr0_cidrs)
      ? data.cidr0_cidrs
          .map((c) => (c.v4prefix ? `${c.v4prefix}/${c.length}` : c.v6prefix ? `${c.v6prefix}/${c.length}` : null))
          .filter(Boolean)
      : [];
    return {
      handle: data.handle || null,
      name: data.name || null,
      startAddress: data.startAddress || null,
      endAddress: data.endAddress || null,
      cidrs,
      country: data.country || null,
      networkType: data.type || null,
      events,
      org: summarizeEntity(findEntity(data.entities, 'registrant')) || summarizeEntity(findEntity(data.entities, 'administrative')),
      abuse: summarizeEntity(findEntity(data.entities, 'abuse')),
    };
  }

  if (type === 'asn') {
    return {
      handle: data.handle || null,
      name: data.name || null,
      startAutnum: data.startAutnum ?? null,
      endAutnum: data.endAutnum ?? null,
      country: data.country || null,
      autnumType: data.type || null,
      events,
      org: summarizeEntity(findEntity(data.entities, 'registrant')),
      abuse: summarizeEntity(findEntity(data.entities, 'abuse')),
    };
  }

  return null;
}

module.exports = {
  fetchRdapRecord,
  fetchRdapFromBases,
  uniqueBases,
};
