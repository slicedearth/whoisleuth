// RDAP: IANA bootstrap registry lookup (https://data.iana.org/rdap/) and
// response parsing. Shared by the Express server and the Netlify Functions.

const { cached } = require('./lookup-cache');

const BOOTSTRAP_TTL_MS = 60 * 60 * 1000; // 1 hour
const bootstrapCache = new Map();

// Every other upstream call in this project (crt.sh, a domain's own
// homepage, WHOIS sockets) already has a timeout - this one didn't, so a
// slow/unresponsive registry or the IANA bootstrap endpoint could hang a
// request indefinitely on server.js, or die ungracefully on a Netlify
// function's own execution limit instead of failing cleanly.
const UPSTREAM_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
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
  const data = await res.json();
  bootstrapCache.set(kind, { data, fetchedAt: Date.now() });
  return data;
}

async function findRdapBase(type, value) {
  if (type === 'domain') {
    const bootstrap = await fetchBootstrap('dns');
    const tld = value.split('.').pop().toLowerCase();
    for (const [tlds, urls] of bootstrap.services) {
      if (tlds.some((t) => t.toLowerCase() === tld)) return urls[0];
    }
    return null;
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
            best = urls[0];
          }
        }
      }
    }
    return best;
  }

  if (type === 'asn') {
    const bootstrap = await fetchBootstrap('asn');
    const num = parseInt(value.replace(/^AS/i, ''), 10);
    for (const [ranges, urls] of bootstrap.services) {
      for (const range of ranges) {
        const [start, end] = range.includes('-') ? range.split('-').map(Number) : [Number(range), Number(range)];
        if (num >= start && num <= end) return urls[0];
      }
    }
    return null;
  }

  return null;
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
async function fetchRdapRecord(type, value) {
  return cached(`rdap:${type}:${value}`, async () => {
    const base = await findRdapBase(type, value);
    if (!base) return null;

    const url = base.replace(/\/$/, '') + '/' + rdapPathFor(type, value);
    const upstream = await fetchWithTimeout(url, { headers: { Accept: 'application/rdap+json' } }, UPSTREAM_TIMEOUT_MS);
    const text = await upstream.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return {
      rdapServer: url,
      upstreamStatus: upstream.status,
      data,
      parsed: upstream.ok ? parseRdap(type, data) : null,
    };
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
  fetchBootstrap,
  findRdapBase,
  rdapPathFor,
  fetchRdapRecord,
  findEntity,
  vcardField,
  summarizeEntity,
  parseRdap,
};
