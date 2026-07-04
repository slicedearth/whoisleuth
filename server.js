const express = require('express');
const net = require('net');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const IANA_WHOIS = 'whois.iana.org';
const BOOTSTRAP_TTL_MS = 60 * 60 * 1000; // 1 hour
const bootstrapCache = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------------------
// Query classification
// ---------------------------------------------------------------------------

function classifyQuery(raw) {
  let q = raw.trim();
  q = q.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0];
  q = q.replace(/^www\./i, '');

  const ipv4Re = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const asnRe = /^AS(\d+)$/i;

  if (ipv4Re.test(q)) return { type: 'ipv4', value: q };
  if (q.includes(':') && /^[0-9a-fA-F:]+$/.test(q)) return { type: 'ipv6', value: q };

  const asnMatch = q.match(asnRe);
  if (asnMatch) return { type: 'asn', value: `AS${asnMatch[1]}` };
  if (/^\d+$/.test(q)) return { type: 'asn', value: `AS${q}` };

  return { type: 'domain', value: q.toLowerCase() };
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
// RDAP: IANA bootstrap registry lookup (https://data.iana.org/rdap/)
// ---------------------------------------------------------------------------

async function fetchBootstrap(kind) {
  const cached = bootstrapCache.get(kind);
  if (cached && Date.now() - cached.fetchedAt < BOOTSTRAP_TTL_MS) return cached.data;

  const res = await fetch(`https://data.iana.org/rdap/${kind}.json`);
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

app.get('/api/rdap', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

    const { type, value } = classifyQuery(q);
    const base = await findRdapBase(type, value);
    if (!base) {
      return res.status(404).json({ error: `No RDAP registry found for "${q}" via IANA bootstrap` });
    }

    const url = base.replace(/\/$/, '') + '/' + rdapPathFor(type, value);
    const upstream = await fetch(url, { headers: { Accept: 'application/rdap+json' } });
    const text = await upstream.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    res.status(200).json({
      query: q,
      type,
      rdapServer: url,
      upstreamStatus: upstream.status,
      data,
      parsed: upstream.ok ? parseRdap(type, data) : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// WHOIS: raw TCP port-43 lookups, following registry referrals starting from
// the IANA root WHOIS server (whois.iana.org)
// ---------------------------------------------------------------------------

function whoisQuery(server, query, { port = 43, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: server, port }, () => {
      socket.write(query + '\r\n');
    });
    let data = '';
    socket.setTimeout(timeoutMs);
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
    });
    socket.on('end', () => resolve(data));
    socket.on('close', () => resolve(data));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`WHOIS request to ${server} timed out`));
    });
    socket.on('error', (err) => reject(err));
  });
}

function extractReferral(whoisText) {
  // [ \t]* (not \s*) after the colon - some registries (e.g. .gt) list
  // "refer:" and "whois:" fields with no value, and \s* would cross the
  // blank line and wrongly capture the next field's label as a hostname.
  const patterns = [
    /^[ \t]*refer:[ \t]*([a-zA-Z0-9.\-]+)/mi,
    /^[ \t]*ReferralServer:[ \t]*whois:\/\/([a-zA-Z0-9.\-]+)/mi,
    /^[ \t]*whois:[ \t]*([a-zA-Z0-9.\-]+)/mi,
  ];
  for (const re of patterns) {
    const m = whoisText.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// .gt has no WHOIS:43 server registered with IANA (its "refer:"/"whois:"
// fields are blank) - the registry instead exposes registrant/expiry/
// nameserver data through a plain server-rendered page on their own site,
// no CAPTCHA or JS required. This is scraped best-effort and formatted as
// standard WHOIS text so it flows through the same parseWhoisChain/
// checkDomainAvailability logic as every other registry, rather than a
// bespoke parallel path. Any parsing failure here is swallowed - it just
// means .gt lookups fall back to showing only the IANA hop, same as before.
// ---------------------------------------------------------------------------

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function sectionBetween(html, startRe, endRes) {
  const startMatch = html.match(startRe);
  if (!startMatch) return '';
  const rest = html.slice(startMatch.index + startMatch[0].length);
  let endIdx = rest.length;
  for (const endRe of endRes) {
    const m = rest.match(endRe);
    if (!m) continue;
    // If the match starts with the ">" that closes the previous tag (e.g.
    // "</a>" right before a header's text), include that ">" so we don't
    // leave a dangling "</a" with no closing bracket for stripTags to clean up.
    const idx = m[0].startsWith('>') ? m.index + 1 : m.index;
    if (idx < endIdx) endIdx = idx;
  }
  return rest.slice(0, endIdx);
}

// Font Awesome icons act as the only "labels" for several fields in this
// markup (no text label, just an icon) - replace each with a text marker
// before stripping tags, then split on those markers.
function extractIconFields(html, iconMap) {
  let marked = html;
  for (const [icon, key] of Object.entries(iconMap)) {
    marked = marked.replace(new RegExp(`<i[^>]*\\b${icon}\\b[^>]*></i>`, 'gi'), `\n@@${key}@@\n`);
  }
  const text = stripTags(marked);
  const parts = text.split(/@@(\w+)@@/);
  const fields = {};
  for (let i = 1; i < parts.length; i += 2) {
    const value = (parts[i + 1] || '').trim();
    if (value && !fields[parts[i]]) fields[parts[i]] = value;
  }
  return fields;
}

async function fetchGtRegistryWhois(domain) {
  const url = `https://www.gt/sitio/whois.php?dn=${encodeURIComponent(domain)}.&lang=en`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DomainStatusChecker/1.0)' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const html = await res.text();

    if (/is not registered/i.test(html)) return { registered: false };

    const statusMatch = html.match(/<i class="fas fa-bell fa-fw"><\/i>\s*([A-Za-z]+)/i);
    const expiryMatch = html.match(/Expiration:\s*([0-9]{4}-[A-Za-z]{3}-[0-9]{2}[^<]*)/i);

    const orgSection = sectionBetween(html, /Entitled Organization/i, [/Servers\s*<\/h4>/i]);
    const org = extractIconFields(orgSection, {
      'fa-building': 'org',
      'fa-address-card': 'address',
      'fa-phone': 'phone',
    });

    const adminSection = sectionBetween(html, />\s*ADMINISTRATIVE\s*</i, [/>\s*TECHNICAL\s*</i, />\s*BILLING\s*</i]);
    const admin = extractIconFields(adminSection, {
      'fa-user': 'name',
      'fa-envelope': 'email',
      'fa-address-card': 'address', // marked but unused - prevents it bleeding into "email"
      'fa-building': 'org',
    });

    const serversSection = sectionBetween(html, /Servers\s*<\/h4>/i, [/<div class="span6">/i]);
    const nameservers = [...serversSection.matchAll(/<strong>\s*([a-zA-Z0-9.\-]+)\.?\s*<\/strong>/gi)].map((m) =>
      m[1].trim()
    );

    return {
      registered: true,
      status: statusMatch ? statusMatch[1].trim() : null,
      expiryDate: expiryMatch ? expiryMatch[1].trim() : null,
      registrantOrg: org.org || null,
      registrantAddress: org.address || null,
      registrantPhone: org.phone || null,
      adminName: admin.name || null,
      adminOrg: admin.org || null,
      adminEmail: admin.email || null,
      nameservers,
    };
  } catch {
    return null; // best-effort - never breaks the main lookup
  } finally {
    clearTimeout(timeout);
  }
}

function formatGtResultAsText(domain, result) {
  if (!result.registered) {
    return `No match for domain ${domain.toUpperCase()}.`;
  }
  const lines = [`Domain Name: ${domain.toUpperCase()}`];
  if (result.status) lines.push(`Domain Status: ${result.status}`);
  if (result.expiryDate) lines.push(`Registry Expiry Date: ${result.expiryDate}`);
  if (result.registrantOrg) lines.push(`Registrant Organization: ${result.registrantOrg}`);
  if (result.registrantAddress) lines.push(`Registrant Address: ${result.registrantAddress}`);
  if (result.registrantPhone) lines.push(`Registrant Phone: ${result.registrantPhone}`);
  if (result.adminName) lines.push(`Admin Name: ${result.adminName}`);
  if (result.adminOrg) lines.push(`Admin Organization: ${result.adminOrg}`);
  if (result.adminEmail) lines.push(`Admin Email: ${result.adminEmail}`);
  for (const ns of result.nameservers) lines.push(`Name Server: ${ns}`);
  return lines.join('\n');
}

async function buildWhoisChain(queryStr) {
  const chain = [];
  const visited = new Set();
  let currentServer = IANA_WHOIS;

  for (let hop = 0; hop < 6; hop += 1) {
    if (visited.has(currentServer.toLowerCase())) break;
    visited.add(currentServer.toLowerCase());

    let text;
    try {
      text = await whoisQuery(currentServer, queryStr);
    } catch (err) {
      chain.push({ server: currentServer, error: err.message });
      break;
    }
    chain.push({ server: currentServer, response: text });

    const referral = extractReferral(text);
    if (!referral || referral.toLowerCase() === currentServer.toLowerCase()) break;
    currentServer = referral;
  }

  if (queryStr.toLowerCase().endsWith('.gt') && chain.length === 1 && !chain[0].error) {
    try {
      const gtResult = await fetchGtRegistryWhois(queryStr);
      if (gtResult) {
        chain.push({
          server: 'www.gt (registry website - .gt has no WHOIS:43 server)',
          response: formatGtResultAsText(queryStr, gtResult),
        });
      }
    } catch {
      /* best-effort fallback - a failure here just leaves the IANA hop as-is */
    }
  }

  return chain;
}

// ---------------------------------------------------------------------------
// WHOIS response parsing (merges the referral chain into readable fields)
// ---------------------------------------------------------------------------

// Some registries (FRED-based systems like .cz and .cr) list "registrant:
// HANDLE" as a pointer to a separate "contact: HANDLE" block elsewhere in
// the same response, rather than the name directly - e.g.
//   registrant:   CN_1173
//   ...
//   contact:      CN_1173
//   org:          NETIM
//   name:         Bruno VINCENT
// This resolves that indirection when a matching contact block exists.
function resolveFredContact(text, handle) {
  if (!handle) return null;
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerMatch = text.match(new RegExp(`^[ \\t]*contact:[ \\t]*${escaped}[ \\t]*$`, 'im'));
  if (!headerMatch) return null;

  const rest = text.slice(headerMatch.index + headerMatch[0].length);
  // the block ends at a blank line, or the next top-level "domain:"/"nsset:"/
  // "contact:" section, whichever comes first
  const endMatch = rest.match(/\n[ \t]*\n|^[ \t]*(?:domain|nsset|contact):/im);
  const block = endMatch ? rest.slice(0, endMatch.index) : rest;

  const get = (re) => {
    const m = block.match(re);
    return m ? m[1].trim() : null;
  };
  const addresses = [...block.matchAll(/^[ \t]*address:[ \t]*(.+)$/gim)].map((m) => m[1].trim());

  return {
    name: get(/^[ \t]*name:[ \t]*(.+)$/im),
    org: get(/^[ \t]*org:[ \t]*(.+)$/im),
    email: get(/^[ \t]*e-?mail:[ \t]*(.+)$/im),
    phone: get(/^[ \t]*phone:[ \t]*(.+)$/im),
    address: addresses.length ? addresses.join(', ') : null,
  };
}

function parseWhoisChain(chain) {
  const fields = {};
  // [ \t]* (not \s*) after each colon - same reasoning as extractReferral:
  // several registries list a field with no value (e.g. "Registrant
  // Organization: " followed directly by "Registrant Street: REDACTED"),
  // and \s* would cross that blank line and capture the next field's own
  // label as the value.
  //
  // Each field lists the standard ICANN thick-WHOIS label first, then
  // common alternates seen on registries that predate/ignore that format
  // (e.g. .it uses "Domain:"/"Created:"/"Expire Date:"). First match wins.
  // This is a broad-coverage net, not a claim of full per-registry support -
  // registries with entirely different conventions (e.g. .jp's bracketed
  // dual-language format) still need their own dedicated handling.
  // ^[ \t*]* (not ^\s*) - some registries prefix lines with "**" (e.g. .tr's
  // "** Domain Name:"). [ \t.]* before the colon - some use dot-leaders
  // (.tr's "Created on..........:") or extra spaces before the colon
  // (.kr's "Domain Name                 :") instead of a colon right after
  // the label.
  const patterns = {
    domainName: [/^[ \t*]*Domain Name[ \t.]*:[ \t]*(.+)$/im, /^[ \t*]*Domain[ \t.]*:[ \t]*(.+)$/im],
    registrar: [/^[ \t*]*Registrar[ \t.]*:[ \t]*(.+)$/im, /^[ \t*]*Sponsoring Registrar[ \t.]*:[ \t]*(.+)$/im],
    registrarUrl: [/^[ \t*]*Registrar URL[ \t.]*:[ \t]*(.+)$/im],
    createdDate: [
      /^[ \t*]*Creation Date[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Created(?: On)?[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Regist(?:ration|ered)(?: Time| Date)?[ \t.]*:[ \t]*(.+)$/im,
    ],
    expiryDate: [
      /^[ \t*]*Registr(?:y|ar) Expiry Date[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Expir(?:y|ation|e)s?(?: Date)?[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Valid Until[ \t.]*:[ \t]*(.+)$/im,
    ],
    updatedDate: [
      /^[ \t*]*Updated Date[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Last Update(?:d)?(?: On)?[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Last Modified[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Changed[ \t.]*:[ \t]*(.+)$/im,
    ],
    abuseEmail: [/^[ \t*]*Registrar Abuse Contact Email[ \t.]*:[ \t]*(.+)$/im],
    abusePhone: [/^[ \t*]*Registrar Abuse Contact Phone[ \t.]*:[ \t]*(.+)$/im],
    dnssec: [/^[ \t*]*DNSSEC[ \t.]*:[ \t]*(.+)$/im, /^[ \t*]*Signed[ \t.]*:[ \t]*(.+)$/im],
    // Standard ICANN thick-WHOIS registrant/admin fields - present verbatim
    // on registries that don't redact contact data, and also what the .gt
    // web-lookup fallback below is formatted to produce.
    registrantName: [/^[ \t*]*Registrant Name[ \t.]*:[ \t]*(.+)$/im, /^[ \t*]*Registrant[ \t.]*:[ \t]*(.+)$/im],
    registrantOrg: [/^[ \t*]*Registrant Organization[ \t.]*:[ \t]*(.+)$/im],
    registrantEmail: [/^[ \t*]*Registrant Email[ \t.]*:[ \t]*(.+)$/im],
    registrantPhone: [/^[ \t*]*Registrant Phone[ \t.]*:[ \t]*(.+)$/im],
    registrantAddress: [/^[ \t*]*Registrant Address[ \t.]*:[ \t]*(.+)$/im],
    adminName: [/^[ \t*]*Admin Name[ \t.]*:[ \t]*(.+)$/im],
    adminOrg: [/^[ \t*]*Admin Organization[ \t.]*:[ \t]*(.+)$/im],
    adminEmail: [/^[ \t*]*Admin Email[ \t.]*:[ \t]*(.+)$/im],
  };

  const nameservers = new Set();
  const statuses = new Set();
  let notFound = false;

  chain.forEach((hop, hopIndex) => {
    const text = hop.response;
    if (!text) return;

    if (/no match for|not found|no data found|no entries found|domain not found|status:\s*available/i.test(text)) {
      notFound = true;
    }

    // hopIndex 0 is always whois.iana.org, whose "domain:"/"created:"/
    // "changed:" fields describe the TLD's own root delegation record, not
    // the queried domain - e.g. "created: 1992-08-14" for .gt is Guatemala's
    // delegation date, not any individual .gt domain's registration date.
    // The broadened alternate labels (everything past index 0 in each
    // pattern array) are common enough on real registries' per-domain
    // responses that they'd false-match that IANA hop too, so they're only
    // tried against later, registry-level hops.
    const isRootHop = hopIndex === 0;

    for (const [key, res] of Object.entries(patterns)) {
      if (fields[key]) continue; // earlier hop already set it - don't let a later, less-authoritative hop overwrite
      const candidates = isRootHop ? res.slice(0, 1) : res;
      for (const re of candidates) {
        const m = text.match(re);
        if (m) {
          fields[key] = m[1].trim();
          break;
        }
      }
    }

    // If registrantName looks like it's actually a handle (a matching
    // "contact: <handle>" block exists in this same hop), resolve it for
    // the real name/org/email/phone/address. Harmless no-op otherwise -
    // registries where "Registrant:" is already the real name (e.g. .kr)
    // simply won't have a matching contact block to find.
    if (!isRootHop && fields.registrantName) {
      const resolved = resolveFredContact(text, fields.registrantName);
      if (resolved) {
        if (resolved.name) fields.registrantName = resolved.name;
        if (resolved.org && !fields.registrantOrg) fields.registrantOrg = resolved.org;
        if (resolved.email && !fields.registrantEmail) fields.registrantEmail = resolved.email;
        if (resolved.phone && !fields.registrantPhone) fields.registrantPhone = resolved.phone;
        if (resolved.address && !fields.registrantAddress) fields.registrantAddress = resolved.address;
      }
    }

    // .jp (JPRS) uses a bracketed dual-language format instead of
    // "Label: value" - e.g. "[Domain Name]   GOO.JP", with Japanese-only
    // labels alongside English ones for the same field. The bracket syntax
    // is distinctive enough to not need root-hop gating.
    if (!fields.domainName) {
      const m = text.match(/\[Domain Name\][ \t]*(.+)/i);
      if (m) fields.domainName = m[1].trim();
    }
    if (!fields.registrantName) {
      const m = text.match(/\[Registrant\][ \t]*(.+)/i);
      if (m) fields.registrantName = m[1].trim();
    }
    if (!fields.createdDate) {
      const m = text.match(/\[登録年月日\][ \t]*(.+)/);
      if (m) fields.createdDate = m[1].trim();
    }
    if (!fields.expiryDate) {
      const m = text.match(/\[有効期限\][ \t]*(.+)/);
      if (m) fields.expiryDate = m[1].trim();
    }
    for (const m of text.matchAll(/\[状態\][ \t]*(.+)/g)) statuses.add(m[1].trim());
    for (const m of text.matchAll(/\[Name Server\][ \t]*([a-zA-Z0-9.\-]+)/gi)) nameservers.add(m[1].trim());

    // "Name Server:" never collides with the IANA root hop (which uses
    // lowercase "nserver:" for the TLD's own root nameservers) so it's safe
    // on every hop; "nserver:"/"Host Name:"/"DNS:" are real per-domain
    // labels on some registries (e.g. .ru, .kr, .mx) but only once we're
    // past the root hop, for the same reason as the field patterns above.
    const nsLinePatterns = [/^[ \t*]*Name Server[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim];
    if (!isRootHop) {
      nsLinePatterns.push(
        /^[ \t*]*nserver[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim,
        /^[ \t*]*Host Name[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim,
        /^[ \t*]*DNS[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim
      );
    }
    for (const re of nsLinePatterns) {
      for (const m of text.matchAll(re)) nameservers.add(m[1].trim());
    }

    // Same root-hop exclusion as above: bare "status:" is also how IANA
    // reports the TLD's own delegation status (e.g. "status: ACTIVE" for
    // .gt itself), not the queried domain's status. Deliberately not adding
    // "state:" as an alternate here (some registries, e.g. .ru/.se, use it
    // for domain status) - it's also the standard label for a postal
    // address's state/province in Name/City/State/Country contact blocks
    // (seen on .mx), and there's no reliable way to tell those apart from
    // the label alone - a missing status is safer than a wrong one.
    const statusRe = isRootHop
      ? /^[ \t*]*Domain Status[ \t.]*:[ \t]*([a-zA-Z]+)/gim
      : /^[ \t*]*(?:Domain Status|Status)[ \t.]*:[ \t]*([a-zA-Z]+)/gim;
    for (const m of text.matchAll(statusRe)) statuses.add(m[1].trim());

    // Some registries (e.g. .it, .tr) list nameservers as a bare header
    // ("Nameservers", "Domain Servers") followed by unlabeled lines -
    // sometimes just a hostname, sometimes "hostname  ip.addr" - rather
    // than a per-line "Name Server:" label. Only meaningful on non-root hops.
    if (!isRootHop && nameservers.size === 0) {
      const headerMatch = text.match(/^[ \t*]*(?:Name ?[Ss]ervers|Domain Servers)[ \t.]*:?[ \t]*$/m);
      if (headerMatch) {
        let found = 0;
        for (const line of text.slice(headerMatch.index + headerMatch[0].length).split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) {
            if (found > 0) break; // blank line after >=1 hostname ends the section
            continue; // the header line's own line break - not a real gap yet
          }
          const hostMatch = trimmed.match(/^([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})(?:\s|$)/);
          if (hostMatch) {
            nameservers.add(hostMatch[1]);
            found += 1;
          } else {
            break;
          }
        }
      }
    }
  });

  fields.nameservers = [...nameservers];
  fields.statuses = [...statuses];
  fields.notFound = notFound;
  return fields;
}

app.get('/api/whois', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

    const { type, value } = classifyQuery(q);
    const chain = await buildWhoisChain(value);

    res.json({ query: q, type, chain, parsed: parseWhoisChain(chain) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Domain availability check
//
// Determines registered vs. available vs. expiring via RDAP/WHOIS, and flags
// likely for-sale listings by checking for known parking/marketplace
// nameservers and "for sale" listing language on the domain's own homepage.
// This does not attempt to price the domain - registries don't publish sale
// prices, and that's proprietary marketplace data.
// ---------------------------------------------------------------------------

const PARKING_NS_PATTERNS = [
  /sedoparking\.com$/i,
  /sedo\.com$/i,
  /above\.com$/i,
  /bodis\.com$/i,
  /parkingcrew\.net$/i,
  /dan\.com$/i,
  /hugedomains\.com$/i,
  /uniregistry/i,
  /squadhelp/i,
  /afternic/i,
  /voodoo\.com$/i,
];

const FOR_SALE_TEXT_RE = /(this domain (?:may be|is) for sale|buy this domain|domain for sale|make an offer|inquire about (?:this|the) domain|purchase this domain|this domain is available for purchase)/i;

async function fetchHomepageText(domain) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; DomainStatusChecker/1.0)' };
  for (const scheme of ['https', 'http']) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`${scheme}://${domain}`, { redirect: 'follow', signal: controller.signal, headers });
      clearTimeout(timeout);
      if (res.ok) return (await res.text()).slice(0, 300000);
    } catch {
      clearTimeout(timeout);
    }
  }
  return null;
}

async function checkDomainAvailability(domain) {
  let nameservers = [];
  let statuses = [];
  let rdapServer = null;
  let rdapFound = false;
  let registrar = null;
  let registrant = null;
  let createdDate = null;
  let expiryDate = null;

  try {
    const base = await findRdapBase('domain', domain);
    if (base) {
      const url = base.replace(/\/$/, '') + '/' + rdapPathFor('domain', domain);
      rdapServer = url;
      const upstream = await fetch(url, { headers: { Accept: 'application/rdap+json' } });
      if (upstream.status === 404) {
        return {
          state: 'available',
          confidence: 'high',
          detail: 'The registry\'s RDAP service has no record for this domain.',
          source: 'rdap',
          rdapServer: url,
        };
      }
      if (upstream.ok) {
        const data = await upstream.json();
        statuses = Array.isArray(data.status) ? data.status.map((s) => s.toLowerCase()) : [];
        nameservers = Array.isArray(data.nameservers) ? data.nameservers.map((ns) => ns.ldhName || '').filter(Boolean) : [];
        registrar = summarizeEntity(findEntity(data.entities, 'registrar'));
        registrant = summarizeEntity(findEntity(data.entities, 'registrant'));
        const events = Array.isArray(data.events) ? data.events : [];
        createdDate = (events.find((e) => e.eventAction === 'registration') || {}).eventDate || null;
        expiryDate = (events.find((e) => e.eventAction === 'expiration') || {}).eventDate || null;
        rdapFound = true;
      }
    }
  } catch {
    /* fall through to WHOIS-based detection */
  }

  let whoisChain = null;
  if (!rdapFound) {
    try {
      whoisChain = await buildWhoisChain(domain);
      const parsed = parseWhoisChain(whoisChain);
      if (parsed.notFound) {
        return {
          state: 'available',
          confidence: 'medium',
          detail: 'WHOIS reports no matching record for this domain.',
          source: 'whois',
        };
      }
      if (parsed.nameservers.length) nameservers = parsed.nameservers;
      if (parsed.statuses.length) statuses = parsed.statuses.map((s) => s.toLowerCase());
      if (parsed.registrar) {
        registrar = { handle: null, name: parsed.registrar, org: null, email: parsed.abuseEmail || null, phone: parsed.abusePhone || null };
      } else if (parsed.adminOrg || parsed.adminName || parsed.adminEmail) {
        // No standard "Registrar:" field (e.g. the .gt web-lookup fallback) -
        // its admin contact is functionally the registrar/reseller of record.
        registrar = { handle: null, name: parsed.adminOrg || parsed.adminName || null, org: parsed.adminOrg || null, email: parsed.adminEmail || null, phone: null };
      }
      if (parsed.registrantName || parsed.registrantOrg || parsed.registrantEmail || parsed.registrantPhone) {
        registrant = {
          handle: null,
          name: parsed.registrantName || null,
          org: parsed.registrantOrg || null,
          email: parsed.registrantEmail || null,
          phone: parsed.registrantPhone || null,
        };
      }
      createdDate = parsed.createdDate || null;
      expiryDate = parsed.expiryDate || null;
    } catch {
      /* if both RDAP and WHOIS fail, we simply can't determine availability */
    }
  }

  if (!rdapFound && !whoisChain) {
    return {
      state: 'unknown',
      confidence: 'low',
      detail: 'Could not reach RDAP or WHOIS for this domain to determine its status.',
    };
  }

  const baseInfo = { nameservers, statuses, registrar, registrant, createdDate, expiryDate, rdapServer };

  if (statuses.some((s) => s.includes('pendingdelete') || s.includes('redemptionperiod'))) {
    return {
      state: 'expiring',
      confidence: 'medium',
      detail: 'Domain is in redemption/pending-delete status and may become available soon.',
      ...baseInfo,
    };
  }

  // Registered - look for for-sale signals.
  const nsSignal = nameservers.find((ns) => PARKING_NS_PATTERNS.some((re) => re.test(ns)));
  let forSaleSignal = nsSignal ? `parking nameserver (${nsSignal})` : null;

  try {
    const page = await fetchHomepageText(domain);
    if (page) {
      const saleMatch = page.match(FOR_SALE_TEXT_RE);
      if (saleMatch) forSaleSignal = forSaleSignal || `homepage text ("${saleMatch[0]}")`;
    }
  } catch {
    /* homepage may be unreachable - not fatal */
  }

  if (!forSaleSignal) {
    return {
      state: 'registered',
      confidence: 'high',
      detail: 'Domain is registered and shows no for-sale signals.',
      ...baseInfo,
    };
  }

  return {
    state: 'for_sale',
    confidence: 'medium',
    detail: `Detected a for-sale listing (${forSaleSignal}).`,
    ...baseInfo,
  };
}

app.get('/api/availability', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

    const { type, value } = classifyQuery(q);
    if (type !== 'domain') {
      return res.json({ applicable: false, type });
    }

    const result = await checkDomainAvailability(value);
    res.json({ applicable: true, domain: value, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Bulk domain lookup: streams newline-delimited JSON so the frontend can
// show progress as each domain resolves, then export the results as CSV.
// ---------------------------------------------------------------------------

const MAX_BULK_DOMAINS = 200;
const BULK_CONCURRENCY = 6;

async function runPool(items, concurrency, worker) {
  let idx = 0;
  const size = Math.min(concurrency, items.length) || 1;
  const runners = new Array(size).fill(0).map(async () => {
    while (idx < items.length) {
      const current = idx++;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}

app.post('/api/bulk', async (req, res) => {
  const rawDomains = Array.isArray(req.body?.domains) ? req.body.domains : null;
  if (!rawDomains || rawDomains.length === 0) {
    return res.status(400).json({ error: 'Request body must include a non-empty "domains" array' });
  }

  const seen = new Set();
  const domains = [];
  for (const entry of rawDomains) {
    const trimmed = (entry || '').toString().trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    domains.push(trimmed);
    if (domains.length >= MAX_BULK_DOMAINS) break;
  }

  if (domains.length === 0) {
    return res.status(400).json({ error: 'No valid domains found in request' });
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  });
  res.write(JSON.stringify({ type: 'start', total: domains.length }) + '\n');

  await runPool(domains, BULK_CONCURRENCY, async (rawEntry, index) => {
    const { type, value } = classifyQuery(rawEntry);
    let record;

    if (type !== 'domain') {
      record = {
        domain: rawEntry,
        availability: 'error',
        availabilityDetail: 'Not a domain name (bulk lookup only supports domains, not IPs/ASNs)',
      };
    } else {
      try {
        const result = await checkDomainAvailability(value);
        record = {
          domain: value,
          availability: result.state,
          availabilityDetail: result.detail,
          registrarName: result.registrar ? result.registrar.name || result.registrar.org : null,
          registrarEmail: result.registrar ? result.registrar.email : null,
          registrantName: result.registrant ? result.registrant.name : null,
          registrantOrg: result.registrant ? result.registrant.org : null,
          registrantEmail: result.registrant ? result.registrant.email : null,
          createdDate: result.createdDate || null,
          expiryDate: result.expiryDate || null,
          nameservers: Array.isArray(result.nameservers) ? result.nameservers.join('; ') : '',
        };
      } catch (err) {
        record = { domain: value, availability: 'error', availabilityDetail: err.message };
      }
    }

    res.write(JSON.stringify({ type: 'result', index, ...record }) + '\n');
  });

  res.write(JSON.stringify({ type: 'done' }) + '\n');
  res.end();
});

app.listen(PORT, () => {
  console.log(`WHOIS/RDAP tool listening on http://localhost:${PORT}`);
});
