// WHOIS: raw TCP port-43 lookups, following registry referrals starting from
// the IANA root WHOIS server, plus response parsing. Shared by the Express
// server and the Netlify Functions.

const net = require('net');
const { cached } = require('./lookup-cache');

const IANA_WHOIS = 'whois.iana.org';

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

// Cached briefly (lib/lookup-cache.js) - the same query looked up again
// shortly after (a deep-check following a fast scan, re-reviewing a
// candidate list) doesn't need a fresh TCP:43 chain every time.
async function buildWhoisChain(queryStr) {
  return cached(`whois:${queryStr.toLowerCase()}`, async () => {
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
  });
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

module.exports = {
  whoisQuery,
  extractReferral,
  buildWhoisChain,
  parseWhoisChain,
};
