// RDAP: IANA bootstrap registry lookup (https://data.iana.org/rdap/) and
// response parsing. Shared by the Express server and the Netlify Functions.

const { cached } = require('./lookup-cache');
const { safeFetch, readTextCapped } = require('./safe-fetch');

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
  const fetchUpstream = options.fetchUpstream || fetchWithTimeout;
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
        fetchedAt: new Date().toISOString(),
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

function scalarVcardValue(value) {
  if (Array.isArray(value)) return value.flat(Infinity).filter(Boolean).join(', ') || null;
  return value == null ? null : String(value);
}

function summarizeAddress(vcardArray) {
  const value = vcardField(vcardArray, 'adr');
  if (!value) return null;
  return scalarVcardValue(value);
}

function publicId(entity, typePattern) {
  if (!entity || !Array.isArray(entity.publicIds)) return null;
  const match = entity.publicIds.find((item) => typePattern.test(String(item.type || '')));
  return match && match.identifier != null ? String(match.identifier) : null;
}

function summarizeTextBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks.slice(0, 12).map((block) => ({
    title: String(block.title || 'Notice').slice(0, 160),
    descriptions: (Array.isArray(block.description) ? block.description : [])
      .slice(0, 6)
      .map((text) => String(text).replace(/\s+/g, ' ').trim().slice(0, 800))
      .filter(Boolean),
  })).filter((block) => block.descriptions.length > 0);
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
  if (!entity) return null;
  const name = scalarVcardValue(vcardField(entity.vcardArray, 'fn'));
  const org = scalarVcardValue(vcardField(entity.vcardArray, 'org'));
  const email = scalarVcardValue(vcardField(entity.vcardArray, 'email'));
  const phone = scalarVcardValue(vcardField(entity.vcardArray, 'tel'));
  const address = summarizeAddress(entity.vcardArray);
  const summary = { handle: entity.handle || null, name, org, email, phone, address };
  const hasAny = Object.values(summary).some((v) => v);
  return hasAny ? summary : null;
}

function parseRdap(type, data) {
  if (!data || typeof data !== 'object') return null;
  const events = normalizeRdapEvents(data.events);
  const common = {
    port43: data.port43 || null,
    parentHandle: data.parentHandle || null,
    notices: summarizeTextBlocks(data.notices),
    remarks: summarizeTextBlocks(data.remarks),
  };

  if (type === 'domain') {
    const registrarEntity = findEntity(data.entities, 'registrar');
    const nameserverDetails = Array.isArray(data.nameservers)
      ? data.nameservers.slice(0, 200).map((ns) => ({
          name: ns.ldhName || ns.unicodeName || null,
          addresses: [
            ...(Array.isArray(ns.ipAddresses && ns.ipAddresses.v4) ? ns.ipAddresses.v4 : []),
            ...(Array.isArray(ns.ipAddresses && ns.ipAddresses.v6) ? ns.ipAddresses.v6 : []),
          ].slice(0, 20).map((address) => String(address).slice(0, 80)),
        })).filter((ns) => ns.name)
      : [];
    const dsData = data.secureDNS && Array.isArray(data.secureDNS.dsData)
      ? data.secureDNS.dsData.slice(0, 50).map((ds) => ({
          keyTag: ds.keyTag ?? null,
          algorithm: ds.algorithm ?? null,
          digestType: ds.digestType ?? null,
          digest: ds.digest ? String(ds.digest).slice(0, 512) : null,
        }))
      : [];
    return {
      ...common,
      domain: data.ldhName || data.unicodeName || null,
      unicodeDomain: data.unicodeName && data.unicodeName !== data.ldhName ? data.unicodeName : null,
      handle: data.handle || null,
      statuses: Array.isArray(data.status) ? data.status : [],
      events,
      lifecycle: summarizeLifecycle(events),
      nameservers: nameserverDetails.map((ns) => ns.name),
      nameserverDetails,
      dnssec: data.secureDNS ? (data.secureDNS.delegationSigned ? 'Signed' : 'Unsigned') : 'Unknown',
      zoneSigned: data.secureDNS ? data.secureDNS.zoneSigned ?? null : null,
      delegationSigned: data.secureDNS ? data.secureDNS.delegationSigned ?? null : null,
      dsData,
      registrarIanaId: publicId(registrarEntity, /iana registrar id/i),
      registrar: summarizeEntity(registrarEntity),
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
      ...common,
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
      ...common,
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
  BOOTSTRAP_TTL_MS,
  BOOTSTRAP_STALE_TTL_MS,
  fetchBootstrap,
  clearRdapBootstrapCache,
  fetchRdapRecord,
  fetchRdapFromBases,
  uniqueBases,
  parseRdap,
  normalizeRdapEvents,
  summarizeLifecycle,
};
