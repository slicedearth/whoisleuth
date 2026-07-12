// WHOIS: raw TCP port-43 lookups, following registry referrals starting from
// the IANA root WHOIS server, plus response parsing. Shared by the Express
// server and the Netlify Functions.

const net = require('net');
const { cached } = require('./lookup-cache');
const { readTextCapped, resolvePublicAddresses } = require('./safe-fetch');

const IANA_WHOIS = 'whois.iana.org';
const MAX_WHOIS_BYTES = 200000; // far more than even a large multi-section response needs
const WHOIS_HOP_DEADLINE_MS = 12000; // DNS + connect + body ceiling for one server
const WHOIS_CHAIN_DEADLINE_MS = 25000; // hard ceiling across the full referral chain
const MAX_GT_REGISTRY_HTML_BYTES = 500000;

// `server` here isn't always the trusted IANA root - after the first hop,
// it's a referral hostname lib/whois.js's own extractReferral() pulled out
// of the *previous* server's response text (a "refer:"/"whois:" field), so
// a malicious or compromised registry could point this at an internal
// address. Same DNS-rebinding-guarded-connection-pinning approach
// safe-fetch.js uses for HTTP: net.createConnection() would otherwise do
// its own internal DNS lookup with no way to inspect/validate the result,
// so this resolves and validates the address first, then connects to that
// pinned IP directly rather than trusting a second, independent lookup at
// connect time to answer the same way.
async function whoisQuery(server, query, {
  port = 43,
  timeoutMs = 10000,
  totalDeadlineMs = WHOIS_HOP_DEADLINE_MS,
} = {}) {
  const startedAt = Date.now();
  let resolutionTimer;
  const records = await Promise.race([
    resolvePublicAddresses(server),
    new Promise((_, reject) => {
      resolutionTimer = setTimeout(
        () => reject(new Error(`WHOIS request to ${server} timed out during DNS resolution`)),
        totalDeadlineMs
      );
    }),
  ]).finally(() => clearTimeout(resolutionTimer));
  const [{ address }] = records;
  const remainingMs = Math.max(1, totalDeadlineMs - (Date.now() - startedAt));

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: address, port }, () => {
      socket.write(query + '\r\n');
    });
    let data = '';
    let totalBytes = 0;
    let settled = false;

    const deadline = setTimeout(() => {
      settled = true;
      socket.destroy();
      reject(new Error(`WHOIS request to ${server} exceeded the total time limit`));
    }, remainingMs);

    function settle(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn(value);
    }

    socket.setTimeout(Math.min(timeoutMs, remainingMs)); // inactivity timeout - resets on each chunk received
    socket.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_WHOIS_BYTES) {
        socket.destroy();
        settle(reject, new Error(`WHOIS response from ${server} exceeded ${MAX_WHOIS_BYTES} bytes`));
        return;
      }
      data += chunk.toString('utf8');
    });
    socket.on('end', () => settle(resolve, data));
    socket.on('close', () => settle(resolve, data));
    socket.on('timeout', () => {
      socket.destroy();
      settle(reject, new Error(`WHOIS request to ${server} timed out`));
    });
    socket.on('error', (err) => settle(reject, err));
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
    if (!res.ok) {
      // Not reading this body - release it explicitly instead of leaving an
      // unconsumed stream (and the connection it's tied to) open until
      // undici's own idle-timeout eventually notices.
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const body = await readTextCapped(res, MAX_GT_REGISTRY_HTML_BYTES);
    if (body.truncated) return null;
    const html = body.text;

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
async function buildWhoisChainUncached(queryStr, options = {}) {
  const queryWhois = options.whoisQuery || whoisQuery;
  const now = options.now || Date.now;
  const chainDeadlineMs = options.chainDeadlineMs || WHOIS_CHAIN_DEADLINE_MS;
  const chain = [];
  const visited = new Set();
  let currentServer = IANA_WHOIS;
  const startedAt = now();

  for (let hop = 0; hop < 6; hop += 1) {
    if (visited.has(currentServer.toLowerCase())) break;
    visited.add(currentServer.toLowerCase());

      const remainingMs = chainDeadlineMs - (now() - startedAt);
      if (remainingMs <= 0) {
      chain.push({
        server: currentServer,
        queriedAt: new Date().toISOString(),
        error: 'WHOIS referral chain exceeded the total time limit',
      });
      break;
    }

    let text;
    const queriedAt = new Date().toISOString();
    try {
      text = await queryWhois(currentServer, queryStr, {
        timeoutMs: Math.min(10000, remainingMs),
        totalDeadlineMs: Math.min(WHOIS_HOP_DEADLINE_MS, remainingMs),
      });
    } catch (err) {
      chain.push({ server: currentServer, queriedAt, error: err.message });
      break;
    }
    chain.push({ server: currentServer, queriedAt, response: text });

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
          queriedAt: new Date().toISOString(),
          response: formatGtResultAsText(queryStr, gtResult),
        });
      }
    } catch {
      /* best-effort fallback - a failure here just leaves the IANA hop as-is */
    }
  }

  return chain;
}

async function buildWhoisChain(queryStr) {
  return cached(`whois:${queryStr.toLowerCase()}`, () => buildWhoisChainUncached(queryStr));
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

// Some legacy thick-WHOIS registries (e.g. .edu via EDUCAUSE) list a
// registrant/admin/technical contact as an unlabeled, indented block under a
// plain header line instead of "Field: value" pairs - e.g.
//   Administrative Contact:
//   \tJane Doe
//   \tExample University
//   \tRoom 100, 1 Example Way
//   \tExampleville, EX 00000
//   \tUSA
//   \t+1.5555550100
//   \tjane@example.edu
// The block ends at the next blank line. Line content (not position) finds
// the email/phone since the address can span a variable number of lines;
// the first remaining line is treated as the name. Whatever's left
// (typically an org line plus the address itself) is folded into `address`
// rather than split further - there's no reliable way to tell an org line
// from an address line by shape alone, and folding still surfaces all of it
// to the user rather than silently dropping it.
function parseIndentedContactBlock(text, headerRe) {
  const headerMatch = text.match(headerRe);
  if (!headerMatch) return null;
  const rest = text.slice(headerMatch.index + headerMatch[0].length);
  const blankLineMatch = rest.match(/\n[ \t]*\n/);
  const blockText = blankLineMatch ? rest.slice(0, blankLineMatch.index) : rest;
  const lines = blockText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const remaining = [...lines];
  const emailIdx = remaining.findIndex((l) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l));
  const email = emailIdx !== -1 ? remaining.splice(emailIdx, 1)[0] : null;
  const phoneIdx = remaining.findIndex((l) => /^[+\d][\d.\-() ]{6,}$/.test(l));
  const phone = phoneIdx !== -1 ? remaining.splice(phoneIdx, 1)[0] : null;

  const name = remaining.shift() || null;
  const address = remaining.length ? remaining.join(', ') : null;

  return { name, address, phone, email };
}

// ---------------------------------------------------------------------------
// Chain authority analysis - decides whether a domain is genuinely
// unregistered, which is not "did any hop's text contain 'no match'". A WHOIS
// referral chain runs IANA root -> registry -> registrar; the registry hop is
// authoritative for *existence*, and a registrar hop that fails, rate-limits,
// or (misbehaving) returns "no match" must NOT override positive registration
// evidence the registry already gave. Treating a global "any hop said no
// match" boolean as availability produces false "available" verdicts whenever
// a downstream registrar WHOIS hiccups.
// ---------------------------------------------------------------------------

const NOT_FOUND_RE = /no match for|no match\b|not found|no data found|no entries found|domain not found|no object found|not registered|status\s*:\s*(?:available|free)\b|registered\s*:\s*(?:no|false)\b|is available for registration/i;

// Rate-limit / soft-failure language. Detected separately from "not found" so
// a throttled registrar can't read as "available".
const RATE_LIMIT_RE = /rate.?limit|too many requests|quota exceeded|query limit|limit exceeded|number of .* exceeded|exceeded .* (?:queries|requests)|try again later|please try again|please wait|throttl|temporarily unavailable/i;

// Positive registration evidence: a field that only appears for a domain that
// actually exists, carrying a non-empty value. The IANA root hop is excluded
// by the caller (it describes the TLD delegation, not the queried domain).
const POSITIVE_REGISTRATION_RE = /^[ \t*]*(?:Domain(?: Name)?|Registrar|Registrar WHOIS Server|Creation Date|Created(?: On)?|Registry Expiry Date|Registered|Name Server|nserver|Sponsoring Registrar)[ \t.]*:[ \t]*\S/im;
const POSITIVE_BRACKET_RE = /\[(?:Domain Name|Registrant|Name Server)\][ \t]*\S/i;

function classifyHopEvidence(hop, index) {
  if (hop.error) return 'error';
  const text = hop.response || '';
  if (!text.trim()) return 'inconclusive';
  // Explicit failures and availability declarations take precedence over an
  // echoed "Domain Name:" line. Several registries echo the query before
  // saying "Status: available" or "Registered: no"; treating that echo as
  // positive evidence turns an unregistered domain into a registered one.
  if (RATE_LIMIT_RE.test(text)) return 'rate_limited';
  if (NOT_FOUND_RE.test(text)) return 'negative';
  // Hop 0 is IANA's TLD delegation record, never evidence about the queried
  // domain itself.
  if (index > 0 && (POSITIVE_REGISTRATION_RE.test(text) || POSITIVE_BRACKET_RE.test(text))) return 'positive';
  return 'inconclusive';
}

// Pure, fixture-testable: given the referral chain, decide existence and
// report which hop settled it and whether a later hop failed or contradicted
// it. The first definitive non-root response is the registry-level authority;
// later registrar output is diagnostic but cannot reverse that decision.
function analyzeWhoisChainAuthority(chain) {
  const evidence = (Array.isArray(chain) ? chain : []).map((hop, index) => ({
    server: hop.server,
    index,
    kind: classifyHopEvidence(hop, index),
  }));

  const failed = evidence.filter((e) => e.kind === 'error' || e.kind === 'rate_limited');
  // The authoritative hop is the first non-root hop that gave a definitive
  // (positive or negative) answer - i.e. the registry, before any flaky
  // registrar referral.
  const authoritative = evidence.find((e) => e.index > 0 && (e.kind === 'positive' || e.kind === 'negative'));
  const conflict = authoritative
    ? evidence.find((e) => e.index > authoritative.index
      && (e.kind === 'positive' || e.kind === 'negative')
      && e.kind !== authoritative.kind)
    : null;
  const registrationStatus = !authoritative
    ? 'inconclusive'
    : authoritative.kind === 'positive' ? 'registered' : 'not_found';
  return {
    registrationStatus,
    notFound: registrationStatus === 'not_found',
    notFoundSource: registrationStatus === 'not_found' && authoritative ? authoritative.server : null,
    authoritativeHop: authoritative ? authoritative.server : null,
    failedHop: failed.length ? failed[0].server : null,
    conflictingHop: conflict ? conflict.server : null,
    chainStatus: authoritative && failed.length === 0 && !conflict ? 'complete' : 'partial',
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
    registryDomainId: [/^[ \t*]*Registry Domain ID[ \t.]*:[ \t]*(.+)$/im],
    registrar: [/^[ \t*]*Registrar[ \t.]*:[ \t]*(.+)$/im, /^[ \t*]*Sponsoring Registrar[ \t.]*:[ \t]*(.+)$/im],
    registrarUrl: [/^[ \t*]*Registrar URL[ \t.]*:[ \t]*(.+)$/im],
    registrarWhoisServer: [/^[ \t*]*Registrar WHOIS Server[ \t.]*:[ \t]*(.+)$/im],
    registrarIanaId: [/^[ \t*]*Registrar IANA ID[ \t.]*:[ \t]*(.+)$/im],
    reseller: [/^[ \t*]*Reseller[ \t.]*:[ \t]*(.+)$/im],
    createdDate: [
      /^[ \t*]*Creation Date[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Created(?: On)?[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Regist(?:ration|ered)(?: Time| Date)?[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Domain record activated[ \t.]*:[ \t]*(.+)$/im,
    ],
    expiryDate: [
      /^[ \t*]*Registr(?:y|ar) Expiry Date[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Registrar Registration Expiration Date[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Expir(?:y|ation|e)s?(?: Date| On)?[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Valid Until[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Domain expires[ \t.]*:[ \t]*(.+)$/im,
    ],
    updatedDate: [
      /^[ \t*]*Updated Date[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Last Update(?:d)?(?: Date| On)?[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Last Modified[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Changed[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Domain record last updated[ \t.]*:[ \t]*(.+)$/im,
    ],
    abuseEmail: [/^[ \t*]*Registrar Abuse Contact Email[ \t.]*:[ \t]*(.+)$/im],
    abusePhone: [/^[ \t*]*Registrar Abuse Contact Phone[ \t.]*:[ \t]*(.+)$/im],
    dnssec: [/^[ \t*]*DNSSEC[ \t.]*:[ \t]*(.+)$/im, /^[ \t*]*Signed[ \t.]*:[ \t]*(.+)$/im],
    // auDA (.au) publishes the registrant's eligibility basis (e.g. an ABN/
    // ACN for a company) alongside - and often instead of - a named contact,
    // since .au domain eligibility is tied to a registrable Australian
    // presence rather than an individual.
    eligibilityType: [/^[ \t*]*Eligibility Type[ \t.]*:[ \t]*(.+)$/im],
    eligibilityId: [/^[ \t*]*Eligibility ID[ \t.]*:[ \t]*(.+)$/im],
    // Standard ICANN thick-WHOIS registrant/admin fields - present verbatim
    // on registries that don't redact contact data, and also what the .gt
    // web-lookup fallback below is formatted to produce. Several registries
    // (e.g. .au via auDA) insert an extra "Contact" word - "Registrant
    // Contact Email:", "Tech Contact Name:" - handled below with an optional
    // "(?:Contact )?" group rather than a whole separate pattern, except for
    // registrantName, where priority matters: on .au, the plain "Registrant:"
    // line carries the actual legal entity ("Example Corporation Pty Ltd") while
    // "Registrant Contact Name:" is often just a generic role ("Domain
    // Administrator") - kept as a lower-priority third alternate so the more
    // useful value wins when both are present.
    registrantName: [
      /^[ \t*]*Registrant Name[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Registrant[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Registrant Contact Name[ \t.]*:[ \t]*(.+)$/im,
    ],
    registrantOrg: [/^[ \t*]*Registrant (?:Contact )?Organi[sz]ation[ \t.]*:[ \t]*(.+)$/im],
    registrantEmail: [/^[ \t*]*Registrant (?:Contact )?Email[ \t.]*:[ \t]*(.+)$/im],
    registrantPhone: [/^[ \t*]*Registrant (?:Contact )?Phone[ \t.]*:[ \t]*(.+)$/im],
    registrantAddress: [/^[ \t*]*Registrant (?:Contact )?Address[ \t.]*:[ \t]*(.+)$/im],
    adminName: [/^[ \t*]*Admin(?:istrative)? (?:Contact )?Name[ \t.]*:[ \t]*(.+)$/im],
    adminOrg: [/^[ \t*]*Admin(?:istrative)? (?:Contact )?Organi[sz]ation[ \t.]*:[ \t]*(.+)$/im],
    adminEmail: [/^[ \t*]*Admin(?:istrative)? (?:Contact )?Email[ \t.]*:[ \t]*(.+)$/im],
    adminPhone: [/^[ \t*]*Admin(?:istrative)? (?:Contact )?Phone[ \t.]*:[ \t]*(.+)$/im],
    techName: [/^[ \t*]*Tech(?:nical)? (?:Contact )?Name[ \t.]*:[ \t]*(.+)$/im],
    techOrg: [/^[ \t*]*Tech(?:nical)? (?:Contact )?Organi[sz]ation[ \t.]*:[ \t]*(.+)$/im],
    techEmail: [/^[ \t*]*Tech(?:nical)? (?:Contact )?Email[ \t.]*:[ \t]*(.+)$/im],
    techPhone: [/^[ \t*]*Tech(?:nical)? (?:Contact )?Phone[ \t.]*:[ \t]*(.+)$/im],
    billingName: [/^[ \t*]*Billing (?:Contact )?Name[ \t.]*:[ \t]*(.+)$/im],
    billingOrg: [/^[ \t*]*Billing (?:Contact )?Organi[sz]ation[ \t.]*:[ \t]*(.+)$/im],
    billingEmail: [/^[ \t*]*Billing (?:Contact )?Email[ \t.]*:[ \t]*(.+)$/im],
    billingPhone: [/^[ \t*]*Billing (?:Contact )?Phone[ \t.]*:[ \t]*(.+)$/im],
  };

  const nameservers = new Set();
  const statuses = new Set();

  chain.forEach((hop, hopIndex) => {
    const text = hop.response;
    if (!text) return;

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
          const value = m[1].trim();
          // Some WHOIS formats use "Registered: yes/no" as a boolean state,
          // while others use "Registered: <date>" for creation time. Never
          // store the boolean form as a date ("no" previously became a truthy
          // createdDate and could make availability look registered).
          if (key === 'createdDate' && /^(?:yes|no|true|false|available|free)$/i.test(value)) continue;
          fields[key] = value;
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

    // EDUCAUSE (.edu) and similar legacy registries list registrant/admin/
    // technical contacts as indented blocks rather than "Field: value"
    // pairs - see parseIndentedContactBlock. The plain "Registrant:" header
    // has no separate person name on .edu (registrants are institutions),
    // so its block's first line maps to the org, not a name.
    if (!isRootHop && !fields.registrantOrg && !fields.registrantName) {
      const block = parseIndentedContactBlock(text, /^[ \t]*Registrant:[ \t]*$/m);
      if (block) {
        if (block.name) fields.registrantOrg = block.name;
        if (block.address) fields.registrantAddress = block.address;
        if (block.phone) fields.registrantPhone = block.phone;
        if (block.email) fields.registrantEmail = block.email;
      }
    }
    if (!isRootHop && !fields.adminName) {
      const block = parseIndentedContactBlock(text, /^[ \t]*Administrative Contact:[ \t]*$/m);
      if (block) {
        if (block.name) fields.adminName = block.name;
        if (block.email) fields.adminEmail = block.email;
      }
    }
    if (!isRootHop && !fields.techName) {
      const block = parseIndentedContactBlock(text, /^[ \t]*Technical Contact:[ \t]*$/m);
      if (block) {
        if (block.name) fields.techName = block.name;
        if (block.email) fields.techEmail = block.email;
      }
    }
    if (!isRootHop && !fields.billingName) {
      const block = parseIndentedContactBlock(text, /^[ \t]*Billing Contact:[ \t]*$/m);
      if (block) {
        if (block.name) fields.billingName = block.name;
        if (block.email) fields.billingEmail = block.email;
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

  // Existence is decided authority-aware, not by a global "any hop said no
  // match" flag: positive registry evidence is never overridden by a later
  // registrar hop that failed, rate-limited, or returned "no match".
  const authority = analyzeWhoisChainAuthority(chain);
  fields.notFound = authority.notFound;
  fields.notFoundSource = authority.notFoundSource;
  fields.authoritativeHop = authority.authoritativeHop;
  fields.failedHop = authority.failedHop;
  fields.conflictingHop = authority.conflictingHop;
  fields.registrationStatus = authority.registrationStatus;
  fields.chainStatus = authority.chainStatus;
  return fields;
}

module.exports = {
  buildWhoisChain,
  parseWhoisChain,
  analyzeWhoisChainAuthority,
  whoisQuery,
  buildWhoisChainUncached,
};
