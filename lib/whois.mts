// WHOIS: raw TCP port-43 lookups, following registry referrals starting from
// the IANA root WHOIS server, plus response parsing. Shared by the Express
// server and the Netlify Functions.

import net from 'node:net';

import { cached } from './lookup-cache.mts';
import { safeFetch, readTextCapped, resolvePublicAddresses } from './safe-fetch.mts';
import { registryDateIso } from './registry-dates.mts';
import { registryCapabilityFor, type WhoisQueryProfile } from './registry-capabilities.mts';

type UnknownRecord = Record<string, any>;
type PublicAddressRecord = { address: string; family: number };
type WhoisHop = {
  server: string;
  address?: string | null;
  queriedAt: string;
  queryProfile?: string;
  responseEncoding?: string;
  response?: string;
  error?: string;
};
type WhoisChain = WhoisHop[];
type QueryAddress = (
  address: string,
  server: string,
  query: string,
  options: { port?: number; timeoutMs?: number; totalDeadlineMs?: number },
) => Promise<string>;
type WhoisQuery = (
  server: string,
  query: string,
  options: {
    port?: number;
    timeoutMs?: number;
    totalDeadlineMs?: number;
    onAddressSelected?: (address: string) => void;
  },
) => Promise<string>;
type GtRegistryResult = { registered: false } | {
  registered: true;
  status: string | null;
  expiryDate: string | null;
  registrantOrg: string | null;
  registrantAddress: string | null;
  registrantPhone: string | null;
  adminName: string | null;
  adminOrg: string | null;
  adminEmail: string | null;
  nameservers: string[];
};
type ParsedWhoisRecord = UnknownRecord;

const IANA_WHOIS = 'whois.iana.org';
const MAX_WHOIS_BYTES = 200000; // far more than even a large multi-section response needs
const WHOIS_HOP_DEADLINE_MS = 12000; // DNS + connect + body ceiling for one server
const WHOIS_CHAIN_DEADLINE_MS = 25000; // hard ceiling across the full referral chain
const MAX_WHOIS_ADDRESSES = 3;
const MAX_GT_REGISTRY_HTML_BYTES = 500000;
const MAX_WHOIS_FIELD_LENGTH = 1000;
const MAX_WHOIS_NAMESERVERS = 200;
const MAX_WHOIS_STATUSES = 100;

const WHOIS_QUERY_FORMATTERS: Record<WhoisQueryProfile, (domain: string) => string> = {
  'plain-domain': (domain) => domain,
  'denic-domain-ace': (domain) => `-T dn,ace ${domain}`,
  'jprs-domain-english': (domain) => `${domain}/e`,
};

function whoisTransportForHop(domain: string, hop: number): {
  query: string;
  queryProfile: WhoisQueryProfile;
  responseEncoding: 'utf-8';
} {
  const capability = registryCapabilityFor(domain);
  const queryProfile = hop === 1
    && capability?.whoisQueryScope === 'first-referral'
    ? capability.whoisQueryProfile
    : 'plain-domain';
  return {
    query: WHOIS_QUERY_FORMATTERS[queryProfile](domain),
    queryProfile,
    responseEncoding: capability?.whoisEncodingProfile || 'utf-8',
  };
}

function errorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const message = (value as UnknownRecord).message;
  return message ? String(message) : fallback;
}

// `server` here isn't always the trusted IANA root - after the first hop,
// it's a referral hostname lib/whois.mts's own extractReferral() pulled out
// of the *previous* server's response text (a "refer:"/"whois:" field), so
// a malicious or compromised registry could point this at an internal
// address. Same DNS-rebinding-guarded-connection-pinning approach
// safe-fetch.js uses for HTTP: net.createConnection() would otherwise do
// its own internal DNS lookup with no way to inspect/validate the result,
// so this resolves and validates the address first, then connects to that
// pinned IP directly rather than trusting a second, independent lookup at
// connect time to answer the same way.
function queryWhoisAddress(address: string, server: string, query: string, {
  port = 43,
  timeoutMs = 10000,
  totalDeadlineMs = WHOIS_HOP_DEADLINE_MS,
  createConnection = net.createConnection,
}: {
  port?: number;
  timeoutMs?: number;
  totalDeadlineMs?: number;
  createConnection?: typeof net.createConnection;
} = {}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: address, port }, () => {
      socket.write(query + '\r\n');
    });
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const deadline = setTimeout(() => {
      settled = true;
      socket.destroy();
      reject(new Error(`WHOIS request to ${server} exceeded the total time limit`));
    }, totalDeadlineMs);

    function settle<T>(fn: (value: T) => void, value: T) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn(value);
    }

    socket.setTimeout(Math.min(timeoutMs, totalDeadlineMs)); // inactivity timeout - resets on each chunk received
    socket.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_WHOIS_BYTES) {
        socket.destroy();
        settle(reject, new Error(`WHOIS response from ${server} exceeded ${MAX_WHOIS_BYTES} bytes`));
        return;
      }
      chunks.push(buffer);
    });
    // Decode once after the complete bounded byte sequence is assembled. A
    // TCP chunk boundary can fall inside one UTF-8 code point; decoding each
    // chunk independently would replace both halves with U+FFFD.
    const responseText = () => Buffer.concat(chunks, totalBytes).toString('utf8');
    socket.on('end', () => settle(resolve, responseText()));
    socket.on('close', () => settle(resolve, responseText()));
    socket.on('timeout', () => {
      socket.destroy();
      settle(reject, new Error(`WHOIS request to ${server} timed out`));
    });
    socket.on('error', (err) => settle(reject, err));
  });
}

async function whoisQuery(server: string, query: string, {
  port = 43,
  timeoutMs = 10000,
  totalDeadlineMs = WHOIS_HOP_DEADLINE_MS,
  resolveAddresses = resolvePublicAddresses,
  queryAddress = queryWhoisAddress,
  now = Date.now,
  onAddressSelected = (_address) => {},
}: {
  port?: number;
  timeoutMs?: number;
  totalDeadlineMs?: number;
  resolveAddresses?: (hostname: string) => Promise<PublicAddressRecord[]>;
  queryAddress?: QueryAddress;
  now?: () => number;
  onAddressSelected?: (address: string) => void;
} = {}): Promise<string> {
  const startedAt = now();
  let resolutionTimer: NodeJS.Timeout | undefined;
  const records = await Promise.race([
    resolveAddresses(server),
    new Promise<never>((_, reject) => {
      resolutionTimer = setTimeout(
        () => reject(new Error(`WHOIS request to ${server} timed out during DNS resolution`)),
        totalDeadlineMs
      );
    }),
  ]).finally(() => clearTimeout(resolutionTimer));

  const candidates = records.slice(0, MAX_WHOIS_ADDRESSES);
  const failures: string[] = [];
  let attempts = 0;
  for (const { address } of candidates) {
    const remainingMs = totalDeadlineMs - (now() - startedAt);
    if (remainingMs <= 0) break;
    attempts += 1;
    try {
      const response = await queryAddress(address, server, query, {
        port,
        timeoutMs: Math.min(timeoutMs, remainingMs),
        totalDeadlineMs: remainingMs,
      });
      try { onAddressSelected(address); } catch { /* diagnostics must not break a successful lookup */ }
      return response;
    } catch (err) {
      failures.push(errorMessage(err, 'connection failed').slice(0, 200));
    }
  }

  const detail = failures.length
    ? `: ${failures.join('; ')}`
    : ' because the total time limit expired';
  throw new Error(`WHOIS request to ${server} failed after ${attempts} of ${candidates.length} validated address(es)${detail}`);
}

function extractReferral(whoisText: string): string | null {
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

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function sectionBetween(html: string, startRe: RegExp, endRes: RegExp[]): string {
  const startMatch = html.match(startRe);
  if (!startMatch) return '';
  const rest = html.slice((startMatch.index ?? 0) + startMatch[0].length);
  let endIdx = rest.length;
  for (const endRe of endRes) {
    const m = rest.match(endRe);
    if (!m) continue;
    // If the match starts with the ">" that closes the previous tag (e.g.
    // "</a>" right before a header's text), include that ">" so we don't
    // leave a dangling "</a" with no closing bracket for stripTags to clean up.
    const matchIndex = m.index ?? 0;
    const idx = m[0].startsWith('>') ? matchIndex + 1 : matchIndex;
    if (idx < endIdx) endIdx = idx;
  }
  return rest.slice(0, endIdx);
}

// Font Awesome icons act as the only "labels" for several fields in this
// markup (no text label, just an icon) - replace each with a text marker
// before stripping tags, then split on those markers.
function extractIconFields(html: string, iconMap: Record<string, string>): Record<string, string> {
  let marked = html;
  for (const [icon, key] of Object.entries(iconMap)) {
    marked = marked.replace(new RegExp(`<i[^>]*\\b${icon}\\b[^>]*></i>`, 'gi'), `\n@@${key}@@\n`);
  }
  const text = stripTags(marked);
  const parts = text.split(/@@(\w+)@@/);
  const fields: Record<string, string> = {};
  for (let i = 1; i < parts.length; i += 2) {
    const value = (parts[i + 1] || '').trim();
    if (value && !fields[parts[i]]) fields[parts[i]] = value;
  }
  return fields;
}

async function fetchGtRegistryWhois(
  domain: string,
  { fetcher = safeFetch }: { fetcher?: (url: string, options: RequestInit) => Promise<Response> } = {},
): Promise<GtRegistryResult | null> {
  const url = `https://www.gt/sitio/whois.php?dn=${encodeURIComponent(domain)}.&lang=en`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetcher(url, {
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

function formatGtResultAsText(domain: string, result: GtRegistryResult): string {
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

// Cached briefly (lib/lookup-cache.mts) - the same query looked up again
// shortly after (a deep-check following a fast scan, re-reviewing a
// candidate list) doesn't need a fresh TCP:43 chain every time.
async function buildWhoisChainUncached(
  queryStr: string,
  options: {
    whoisQuery?: WhoisQuery;
    fetchGtRegistryWhois?: (domain: string) => Promise<GtRegistryResult | null>;
    now?: () => number;
    chainDeadlineMs?: number;
  } = {},
): Promise<WhoisChain> {
  const queryWhois = options.whoisQuery || whoisQuery;
  const fetchGtWhois = options.fetchGtRegistryWhois || fetchGtRegistryWhois;
  const now = options.now || Date.now;
  const chainDeadlineMs = options.chainDeadlineMs || WHOIS_CHAIN_DEADLINE_MS;
  const chain: WhoisChain = [];
  const visited = new Set<string>();
  let currentServer = IANA_WHOIS;
  const startedAt = now();

  for (let hop = 0; hop < 6; hop += 1) {
    if (visited.has(currentServer.toLowerCase())) break;
    visited.add(currentServer.toLowerCase());
    const transport = whoisTransportForHop(queryStr, hop);

    const remainingMs = chainDeadlineMs - (now() - startedAt);
    if (remainingMs <= 0) {
      chain.push({
        server: currentServer,
        queriedAt: new Date().toISOString(),
        queryProfile: transport.queryProfile,
        responseEncoding: transport.responseEncoding,
        error: 'WHOIS referral chain exceeded the total time limit',
      });
      break;
    }

    let text: string;
    let address: string | null = null;
    const queriedAt = new Date().toISOString();
    try {
      text = await queryWhois(currentServer, transport.query, {
        timeoutMs: Math.min(10000, remainingMs),
        totalDeadlineMs: Math.min(WHOIS_HOP_DEADLINE_MS, remainingMs),
        onAddressSelected: (selected) => { address = selected; },
      });
    } catch (err) {
      chain.push({
        server: currentServer,
        queriedAt,
        queryProfile: transport.queryProfile,
        responseEncoding: transport.responseEncoding,
        error: errorMessage(err, 'WHOIS request failed'),
      });
      break;
    }
    chain.push({
      server: currentServer,
      address,
      queriedAt,
      queryProfile: transport.queryProfile,
      responseEncoding: transport.responseEncoding,
      response: text,
    });

    const referral = extractReferral(text);
    if (!referral || referral.toLowerCase() === currentServer.toLowerCase()) break;
    currentServer = referral;
  }

  if (queryStr.toLowerCase().endsWith('.gt') && chain.length === 1 && !('error' in chain[0])) {
    try {
      const gtResult = await fetchGtWhois(queryStr);
      if (gtResult) {
        chain.push({
          server: 'www.gt (registry website - .gt has no WHOIS:43 server)',
          queriedAt: new Date().toISOString(),
          queryProfile: 'gt-registry-web',
          responseEncoding: 'utf-8',
          response: formatGtResultAsText(queryStr, gtResult),
        });
      }
    } catch {
      /* best-effort fallback - a failure here just leaves the IANA hop as-is */
    }
  }

  return chain;
}

async function buildWhoisChain(queryStr: string): Promise<WhoisChain> {
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
function resolveFredContact(text: string, handle: string | null | undefined) {
  if (!handle) return null;
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerMatch = text.match(new RegExp(`^[ \\t]*contact:[ \\t]*${escaped}[ \\t]*$`, 'im'));
  if (!headerMatch) return null;

  const rest = text.slice((headerMatch.index ?? 0) + headerMatch[0].length);
  // the block ends at a blank line, or the next top-level "domain:"/"nsset:"/
  // "contact:" section, whichever comes first
  const endMatch = rest.match(/\n[ \t]*\n|^[ \t]*(?:domain|nsset|contact):/im);
  const block = endMatch ? rest.slice(0, endMatch.index) : rest;

  const get = (re: RegExp): string | null => {
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

// ISNIC places the registrant handle in the domain block and publishes the
// corresponding organisation in a later `role`/`nic-hdl` block. Resolve only
// that exact adjacent marker pair, cap the inspected block, and keep the
// handle separately typed so it is not presented as a person's name.
function resolveIsnicRole(text: string, handle: string | null | undefined) {
  if (!handle) return null;
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerMatch = text.match(new RegExp(
    `^[ \\t]*role:[ \\t]*(.+)\\r?\\n[ \\t]*nic-hdl:[ \\t]*${escaped}[ \\t]*$`,
    'im',
  ));
  if (!headerMatch) return null;

  const lines = text.slice((headerMatch.index ?? 0) + headerMatch[0].length)
    .split('\n', 22);
  const block: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (block.length) break;
      continue;
    }
    if (/^[ \t]*(?:role|person|domain):/i.test(line)) break;
    if (block.length >= 20) break;
    block.push(line);
  }
  const blockText = block.join('\n');
  const get = (pattern: RegExp, maxLength: number) => {
    const match = blockText.match(pattern);
    return match ? boundedWhoisValue(match[1], maxLength) : { value: null, truncated: false };
  };
  const rawAddresses = [...blockText.matchAll(/^[ \t]*address:[ \t]*(.+)$/gim)];
  const addresses = rawAddresses.slice(0, 4)
    .map((match) => boundedWhoisValue(match[1], 300))
    .filter((entry) => entry.value);
  const address = boundedWhoisValue(addresses.map((entry) => entry.value).join(', '), 1000);
  return {
    org: boundedWhoisValue(headerMatch[1], 300),
    email: get(/^[ \t]*e-?mail:[ \t]*(.+)$/im, 320),
    phone: get(/^[ \t]*phone:[ \t]*(.+)$/im, 100),
    address,
    truncated: block.length >= 20 || rawAddresses.length > addresses.length
      || addresses.some((entry) => entry.truncated),
  };
}

// IRNIC publishes contact handles in the domain object and the corresponding
// bounded contact record in a later `nic-hdl` block. Interpret only a block
// carrying the exact requested handle and IRNIC source marker; terse `org`,
// `person`, and `e-mail` labels are otherwise too ambiguous to use globally.
function resolveIrnicContact(text: string, handle: string | null | undefined) {
  if (!handle) return null;
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerMatch = text.match(new RegExp(`^[ \\t]*nic-hdl:[ \\t]*${escaped}[ \\t]*$`, 'im'));
  if (!headerMatch) return null;
  const lines = text.slice((headerMatch.index ?? 0) + headerMatch[0].length)
    .split('\n', 22);
  const block: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (block.length) break;
      continue;
    }
    if (/^[ \t]*(?:domain|nic-hdl):/i.test(line)) break;
    if (block.length >= 20) break;
    block.push(line);
  }
  const blockText = block.join('\n');
  if (!/^[ \t]*source[ \t]*:[ \t]*IRNIC(?:\s|$)/im.test(blockText)) return null;
  const get = (pattern: RegExp, maxLength: number) => {
    const match = blockText.match(pattern);
    return match ? boundedWhoisValue(match[1], maxLength) : { value: null, truncated: false };
  };
  const rawAddresses = [...blockText.matchAll(/^[ \t]*address[ \t]*:[ \t]*(.+)$/gim)];
  const addresses = rawAddresses.slice(0, 4)
    .map((match) => boundedWhoisValue(match[1], 300))
    .filter((entry) => entry.value);
  const address = boundedWhoisValue(addresses.map((entry) => entry.value).join(', '), 1000);
  return {
    name: get(/^[ \t]*person[ \t]*:[ \t]*(.+)$/im, 300),
    org: get(/^[ \t]*org[ \t]*:[ \t]*(.+)$/im, 300),
    email: get(/^[ \t]*e-?mail[ \t]*:[ \t]*(.+)$/im, 320),
    phone: get(/^[ \t]*phone[ \t]*:[ \t]*(.+)$/im, 100),
    address,
    truncated: block.length >= 20 || rawAddresses.length > addresses.length
      || addresses.some((entry) => entry.truncated),
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
function parseIndentedContactBlock(text: string, headerRe: RegExp) {
  const headerMatch = text.match(headerRe);
  if (!headerMatch) return null;
  const rest = text.slice((headerMatch.index ?? 0) + headerMatch[0].length);
  const blankLineMatch = rest.match(/\n[ \t]*\n/);
  const blockText = blankLineMatch ? rest.slice(0, blankLineMatch.index) : rest;
  // Legacy contact blocks are small. Bound the lines retained by this
  // heuristic so a malformed response cannot make one block absorb an
  // arbitrarily large remainder of the already byte-capped response.
  const allLines = blockText.split('\n').map((l) => l.trim()).filter(Boolean);
  const lines = allLines.slice(0, 20);
  if (lines.length === 0) return null;

  const remaining = [...lines];
  const emailIdx = remaining.findIndex((l) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l));
  const email = emailIdx !== -1 ? remaining.splice(emailIdx, 1)[0] : null;
  const phoneIdx = remaining.findIndex((l) => /^[+\d][\d.\-() ]{6,}$/.test(l));
  const phone = phoneIdx !== -1 ? remaining.splice(phoneIdx, 1)[0] : null;

  const name = remaining.shift() || null;
  const address = remaining.length ? remaining.join(', ') : null;

  return { name, address, phone, email, truncated: allLines.length > lines.length };
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

const NOT_FOUND_RE = /no match for|no match\b|not found|no entries found|domain not found|no object found|not registered|status\s*:\s*(?:available|free)\b|registered\s*:\s*(?:no|false)\b|is available for registration/i;

// Some ccTLD registries publish terse, line-oriented availability responses
// that would be unsafe to recognize as arbitrary prose. Keep each documented
// form anchored to the complete line so surrounding descriptive text cannot
// become registry evidence.
const LINE_NOT_FOUND_PATTERNS = Object.freeze([
  /^[ \t]*%[ \t]*nothing found[ \t]*$/im,
  /^[ \t]*[a-z0-9](?:[a-z0-9.-]{0,252})[ \t]+is free[ \t]*$/im,
  /^[ \t]*el dominio no se encuentra registrado en nic argentina[ \t]*$/im,
  /^[ \t]*the domain has not been registered\.?[ \t]*$/im,
  /^[ \t]*the queried object does not exist:[ \t]*no matching objects found[ \t]*$/im,
  /^[ \t]*no record found for[ \t]+'[a-z0-9.-]{1,253}'\.?[ \t]*$/im,
  /^[ \t]*no data found[ \t]*$/im,
  /^[ \t]*>>[ \t]*no data found for domain[ \t]*:[ \t]*[a-z0-9.-]{1,253}[ \t]*$/im,
]);

// InternetNZ's documented .nz WHOIS protocol uses a numeric query_status
// field rather than the generic prose above. Only 220 means that the queried
// domain is available. Active and pending-release objects still exist in the
// registry, while reserved/conflicted/prohibited states remain inconclusive
// because they are neither ordinary registrations nor generally available.
const NZ_NOT_FOUND_RE = /^[ \t]*query_status[ \t]*:[ \t]*220(?:\s|$)/im;
const NZ_POSITIVE_RE = /^[ \t]*query_status[ \t]*:[ \t]*(?:200|210)(?:\s|$)/im;
const NZ_TEMPORARY_FAILURE_RE = /^[ \t]*query_status[ \t]*:[ \t]*4\d{2}(?:\s|$)/im;

// Rate-limit / soft-failure language. Explicit response lines take precedence
// over "not found" so a throttled registrar cannot read as available. Keep the
// match line-oriented: registry policy prose may describe throttling without
// reporting that the current query was throttled.
const RATE_LIMIT_LINE_RE = /^[ \t]*(?:[%#*;>-]+[ \t]*)?(?:(?:error|status)[ \t:.-]+)?(?:whois[ \t]+limit[ \t]+exceeded|query[ \t]+(?:rate[ \t-]*)?limit[ \t]+exceeded|(?:request|query)[ \t]+limit[ \t]+(?:exceeded|reached)|rate[ \t-]*limit(?:[ \t]+exceeded)?|too[ \t]+many[ \t]+(?:requests|queries)|quota[ \t]+exceeded|number[ \t]+of[^\r\n]{0,120}[ \t]+exceeded|(?:requests?|queries?)[ \t]+(?:are[ \t]+)?throttled|throttled|(?:service[ \t]+)?temporarily[ \t]+unavailable|(?:please[ \t]+)?try[ \t]+again[ \t]+later|please[ \t]+wait)\b[^\r\n]{0,240}$/im;

// Positive registration evidence: a field that only appears for a domain that
// actually exists, carrying a non-empty value. The IANA root hop is excluded
// by the caller (it describes the TLD delegation, not the queried domain).
const POSITIVE_REGISTRATION_RE = /^[ \t*]*(?:Domain(?:[ \t]+Name)?|domainname|Registrar|Registrar WHOIS Server|Creation Date|Created(?: On)?|Registry Expiry Date|Registered(?: On)?|Name Server|nserver|Sponsoring Registrar)[ \t.]*:[ \t]*\S/im;
const POSITIVE_BRACKET_RE = /\[(?:Domain Name|Registrant|Name Server)\][ \t]*\S/i;

function hasSectionedRegistrationEvidence(text: string): boolean {
  if (!/^[ \t]*Relevant dates[ \t]*:[ \t]*$/im.test(text)
    || !/^[ \t]*Registration status[ \t]*:[ \t]*$/im.test(text)) return false;
  const domain = parseIndentedWhoisValue(
    text,
    /^[ \t]*Domain(?: name)?[ \t]*:[ \t]*$/im,
    whoisFieldLimit('domainName'),
  );
  const status = parseIndentedWhoisValue(
    text,
    /^[ \t]*Registration status[ \t]*:[ \t]*$/im,
    160,
  );
  return Boolean(domain?.value && status?.value);
}

function classifyHopEvidence(hop: WhoisHop, index: number): string {
  if (hop.error) return 'error';
  const text = hop.response || '';
  if (!text.trim()) return 'inconclusive';
  // Explicit failures and availability declarations take precedence over an
  // echoed "Domain Name:" line. Several registries echo the query before
  // saying "Status: available" or "Registered: no"; treating that echo as
  // positive evidence turns an unregistered domain into a registered one.
  if (RATE_LIMIT_LINE_RE.test(text)) return 'rate_limited';
  if (NZ_TEMPORARY_FAILURE_RE.test(text)) return 'rate_limited';
  if (NZ_NOT_FOUND_RE.test(text)) return 'negative';
  if (NOT_FOUND_RE.test(text) || LINE_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(text))) return 'negative';
  // Hop 0 is IANA's TLD delegation record, never evidence about the queried
  // domain itself.
  if (index > 0 && (POSITIVE_REGISTRATION_RE.test(text)
    || POSITIVE_BRACKET_RE.test(text) || NZ_POSITIVE_RE.test(text)
    || hasSectionedRegistrationEvidence(text))) return 'positive';
  return 'inconclusive';
}

// Pure, fixture-testable: given the referral chain, decide existence and
// report which hop settled it and whether a later hop failed or contradicted
// it. The first definitive non-root response is the registry-level authority;
// later registrar output is diagnostic but cannot reverse that decision.
function analyzeWhoisChainAuthority(chain: unknown) {
  const source = Array.isArray(chain) ? chain as WhoisChain : [];
  const evidence = source.map((hop, index) => ({
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

function boundedWhoisValue(value: unknown, maxLength = MAX_WHOIS_FIELD_LENGTH) {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000a-\u001f\u007f]/.test(value)) return { value: null, truncated: false };
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return { value: null, truncated: false };
  return {
    value: normalized.slice(0, maxLength).trim() || null,
    truncated: normalized.length > maxLength,
  };
}

// Some sectioned registry responses put a field value on the next indented
// line rather than beside the header, for example "Domain name:" followed by
// the queried domain. Skip only leading blank lines, require indentation, and
// retain one bounded scalar so a malformed response cannot make the section
// absorb a following header or an arbitrary remainder of the response.
function parseIndentedWhoisValue(text: string, headerRe: RegExp, maxLength: number) {
  const headerMatch = text.match(headerRe);
  if (!headerMatch) return null;
  const lines = text.slice((headerMatch.index ?? 0) + headerMatch[0].length).split('\n').slice(0, 8);
  for (const line of lines) {
    if (!line.trim()) continue;
    if (!/^[ \t]/.test(line)) return null;
    return boundedWhoisValue(line, maxLength);
  }
  return null;
}

// A few registry formats place a small labelled record below a section
// header, for example "Registrar:" followed by an indented "Name:" line.
// Inspect only the next eight indented lines and require the exact requested
// subfield so a URL or neighbouring section cannot be promoted accidentally.
function parseIndentedWhoisSubfield(
  text: string,
  headerRe: RegExp,
  subfieldRe: RegExp,
  maxLength: number,
) {
  const headerMatch = text.match(headerRe);
  if (!headerMatch) return null;
  const lines = text.slice((headerMatch.index ?? 0) + headerMatch[0].length).split('\n').slice(0, 8);
  for (const line of lines) {
    if (!line.trim()) continue;
    if (!/^[ \t]/.test(line)) return null;
    const match = line.match(subfieldRe);
    if (match) return boundedWhoisValue(match[1], maxLength);
  }
  return null;
}

// Return one small, named section from a registry response. Section-scoped
// aliases such as `name:` are too ambiguous to interpret globally, so callers
// must first prove a registry-specific marker set and then parse only this
// bounded slice.
function parseBoundedWhoisSection(text: string, headerRe: RegExp, maxLines = 20) {
  const headerMatch = text.match(headerRe);
  if (!headerMatch) return '';
  const lines = text.slice((headerMatch.index ?? 0) + headerMatch[0].length)
    .split('\n', maxLines + 2);
  const section: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (section.length) break;
      continue;
    }
    if (/^[ \t]*\[[^\]]+\][ \t]*$/.test(line)) break;
    if (section.length >= maxLines) break;
    section.push(line);
  }
  return section.join('\n');
}

function assignBoundedWhoisMatch(
  text: string,
  fields: ParsedWhoisRecord,
  key: string,
  pattern: RegExp,
  truncatedFields: Set<string>,
) {
  if (fields[key]) return;
  const match = text.match(pattern);
  if (!match) return;
  const bounded = boundedWhoisValue(match[1], whoisFieldLimit(key));
  if (!bounded.value) return;
  fields[key] = bounded.value;
  if (bounded.truncated) truncatedFields.add(key);
}

function whoisFieldLimit(key: string): number {
  if (/Email$/i.test(key)) return 320;
  if (/Phone$/i.test(key)) return 100;
  if (/Date$/i.test(key)) return 100;
  if (/Url$/i.test(key)) return 2048;
  if (/domainName/i.test(key)) return 253;
  if (/Address/i.test(key)) return 1000;
  // A registry may publish several repeated street lines. Keep their bounded
  // composition rather than truncating it back to one line in the final pass.
  if (/Street/i.test(key)) return 1000;
  return 300;
}

function addBoundedWhoisSetValue(set: Set<string>, rawValue: unknown, {
  maxEntries, maxLength, field, truncatedFields,
}: { maxEntries: number; maxLength: number; field: string; truncatedFields: Set<string> }) {
  const bounded = boundedWhoisValue(rawValue, maxLength);
  if (!bounded.value || set.has(bounded.value)) return 'ignored';
  if (set.size >= maxEntries) {
    truncatedFields.add(field);
    return 'capped';
  }
  set.add(bounded.value);
  return 'added';
}

function collectBareWhoisNameservers(
  text: string,
  headerRe: RegExp,
  nameservers: Set<string>,
  truncatedFields: Set<string>,
) {
  const headerMatch = text.match(headerRe);
  if (!headerMatch) return;
  const lines = text.slice((headerMatch.index ?? 0) + headerMatch[0].length)
    .split('\n', MAX_WHOIS_NAMESERVERS + 3);
  let found = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (found) break;
      continue;
    }
    const hostMatch = trimmed.match(/^([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\.?(?:\s|$)/);
    if (!hostMatch) break;
    const result = addBoundedWhoisSetValue(nameservers, hostMatch[1].replace(/\.$/, ''), {
      maxEntries: MAX_WHOIS_NAMESERVERS,
      maxLength: 253,
      field: 'nameservers',
      truncatedFields,
    });
    if (result === 'capped') break;
    if (result === 'added') found += 1;
  }
}

function normalizedWhoisContact(
  fields: ParsedWhoisRecord,
  prefix: string,
  role: string,
  truncatedFields: Set<string>,
) {
  let address = fields[`${prefix}Address`] || [
    fields[`${prefix}Street`], fields[`${prefix}City`], fields[`${prefix}State`],
    fields[`${prefix}PostalCode`], fields[`${prefix}Country`],
  ].filter(Boolean).join(', ') || null;
  if (address && !fields[`${prefix}Address`]) {
    const bounded = boundedWhoisValue(address, 1000);
    address = bounded.value;
    if (address) fields[`${prefix}Address`] = address;
    if (bounded.truncated) truncatedFields.add(`${prefix}Address`);
  }
  const handle = fields[`${prefix}Id`] || null;
  const name = fields[`${prefix}Name`] || null;
  const org = fields[`${prefix}Org`] || null;
  const email = fields[`${prefix}Email`] || null;
  const phone = fields[`${prefix}Phone`] || null;
  if (![handle, name, org, email, phone, address].some(Boolean)) return null;
  return {
    handle,
    roles: [role],
    name,
    names: name ? [name] : [],
    org,
    organizations: org ? [org] : [],
    email,
    emails: email ? [email] : [],
    phone,
    phones: phone ? [phone] : [],
    address,
    addresses: address ? [address] : [],
    publicIds: handle ? [{ type: 'Registry contact ID', identifier: handle }] : [],
    links: [],
  };
}

function parseWhoisChain(chain: unknown): ParsedWhoisRecord {
  const source = Array.isArray(chain) ? chain as WhoisChain : [];
  const fields: ParsedWhoisRecord = {};
  const truncatedFields = new Set<string>();
  const expandedStreetFields = new Set<string>();
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
    domainName: [
      /^[ \t*]*Domain Name[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Domain[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*domain_name[ \t]*:[ \t]*(.+)$/im,
    ],
    registryDomainId: [/^[ \t*]*Registry Domain ID[ \t.]*:[ \t]*(.+)$/im],
    registrar: [
      /^[ \t*]*Registrar[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Sponsoring Registrar[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Registrar Name[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*registrar_name[ \t]*:[ \t]*(.+)$/im,
    ],
    registrarUrl: [/^[ \t*]*Registrar URL[ \t.]*:[ \t]*(.+)$/im],
    registrarWhoisServer: [/^[ \t*]*Registrar WHOIS Server[ \t.]*:[ \t]*(.+)$/im],
    registrarIanaId: [/^[ \t*]*Registrar IANA ID[ \t.]*:[ \t]*(.+)$/im],
    reseller: [/^[ \t*]*Reseller[ \t.]*:[ \t]*(.+)$/im],
    createdDate: [
      /^[ \t*]*Creation Date[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Created(?: On)?[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Regist(?:ration|ered)(?: Time| Date| On)?[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Domain record activated[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*domain_dateregistered[ \t]*:[ \t]*(.+)$/im,
      /^[ \t]*domain_datecreated[ \t]*:[ \t]*(.+)$/im,
    ],
    expiryDate: [
      /^[ \t*]*Registr(?:y|ar) Expiry Date[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Registrar Registration Expiration Date[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Expir(?:y|ation|e)s?(?: Date| On)?[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Valid Until[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Domain expires[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Renewal Date[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*paid-till[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*domain_datebilleduntil[ \t]*:[ \t]*(.+)$/im,
    ],
    updatedDate: [
      /^[ \t*]*Updated Date[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Update Date[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Last Update(?:d)?(?: Date| On)?[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Last Modified[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Modified(?: Date)?[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Modification Date[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*last-update[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Changed[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Domain record last updated[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*domain_datelastmodified[ \t]*:[ \t]*(.+)$/im,
    ],
    abuseEmail: [/^[ \t*]*Registrar Abuse Contact Email[ \t.]*:[ \t]*(.+)$/im],
    abusePhone: [/^[ \t*]*Registrar Abuse Contact Phone[ \t.]*:[ \t]*(.+)$/im],
    dnssec: [
      /^[ \t*]*DNSSEC[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Signed[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*domain_signed[ \t]*:[ \t]*(.+)$/im,
    ],
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
      /^[ \t*]*Owner Name[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*registrant_contact_name[ \t]*:[ \t]*(.+)$/im,
    ],
    registrantId: [/^[ \t*]*(?:Registry )?Registrant ID[ \t.]*:[ \t]*(.+)$/im],
    registrantOrg: [/^[ \t*]*Registrant (?:Contact )?Organi[sz]ation[ \t.]*:[ \t]*(.+)$/im],
    registrantEmail: [
      /^[ \t*]*Registrant (?:Contact )?Email[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*registrant_contact_email[ \t]*:[ \t]*(.+)$/im,
    ],
    registrantPhone: [
      /^[ \t*]*Registrant (?:Contact )?Phone[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*registrant_contact_phone[ \t]*:[ \t]*(.+)$/im,
    ],
    registrantAddress: [
      /^[ \t*]*Registrant (?:Contact )?Address[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Owner Address[ \t.]*:[ \t]*(.+)$/im,
    ],
    registrantStreet: [/^[ \t*]*Registrant (?:Contact )?Street[ \t.]*:[ \t]*(.+)$/im],
    registrantCity: [
      /^[ \t*]*Registrant (?:Contact )?City[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*registrant_contact_city[ \t]*:[ \t]*(.+)$/im,
    ],
    registrantState: [
      /^[ \t*]*Registrant (?:Contact )?State(?:\/Province)?[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*registrant_contact_province[ \t]*:[ \t]*(.+)$/im,
    ],
    registrantPostalCode: [
      /^[ \t*]*Registrant (?:Contact )?Postal Code[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*registrant_contact_postalcode[ \t]*:[ \t]*(.+)$/im,
    ],
    registrantCountry: [
      /^[ \t*]*Registrant (?:Contact )?Country[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t*]*Owner Country[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*registrant_contact_country[ \t]*:[ \t]*(.+)$/im,
    ],
    adminId: [/^[ \t*]*(?:Registry )?Admin(?:istrative)? (?:Contact )?ID[ \t.]*:[ \t]*(.+)$/im],
    adminName: [
      /^[ \t*]*Admin(?:istrative)? (?:Contact )?Name[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*admin_contact_name[ \t]*:[ \t]*(.+)$/im,
    ],
    adminOrg: [/^[ \t*]*Admin(?:istrative)? (?:Contact )?Organi[sz]ation[ \t.]*:[ \t]*(.+)$/im],
    adminEmail: [
      /^[ \t*]*Admin(?:istrative)? (?:Contact )?Email[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*admin_contact_email[ \t]*:[ \t]*(.+)$/im,
    ],
    adminPhone: [
      /^[ \t*]*Admin(?:istrative)? (?:Contact )?Phone[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*admin_contact_phone[ \t]*:[ \t]*(.+)$/im,
    ],
    adminAddress: [/^[ \t*]*Admin(?:istrative)? (?:Contact )?Address[ \t.]*:[ \t]*(.+)$/im],
    adminStreet: [/^[ \t*]*Admin(?:istrative)? (?:Contact )?Street[ \t.]*:[ \t]*(.+)$/im],
    adminCity: [
      /^[ \t*]*Admin(?:istrative)? (?:Contact )?City[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*admin_contact_city[ \t]*:[ \t]*(.+)$/im,
    ],
    adminState: [
      /^[ \t*]*Admin(?:istrative)? (?:Contact )?State(?:\/Province)?[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*admin_contact_province[ \t]*:[ \t]*(.+)$/im,
    ],
    adminPostalCode: [
      /^[ \t*]*Admin(?:istrative)? (?:Contact )?Postal Code[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*admin_contact_postalcode[ \t]*:[ \t]*(.+)$/im,
    ],
    adminCountry: [
      /^[ \t*]*Admin(?:istrative)? (?:Contact )?Country[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*admin_contact_country[ \t]*:[ \t]*(.+)$/im,
    ],
    techId: [/^[ \t*]*(?:Registry )?Tech(?:nical)? (?:Contact )?ID[ \t.]*:[ \t]*(.+)$/im],
    techName: [
      /^[ \t*]*Tech(?:nical)? (?:Contact )?Name[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*technical_contact_name[ \t]*:[ \t]*(.+)$/im,
    ],
    techOrg: [/^[ \t*]*Tech(?:nical)? (?:Contact )?Organi[sz]ation[ \t.]*:[ \t]*(.+)$/im],
    techEmail: [
      /^[ \t*]*Tech(?:nical)? (?:Contact )?Email[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*technical_contact_email[ \t]*:[ \t]*(.+)$/im,
    ],
    techPhone: [
      /^[ \t*]*Tech(?:nical)? (?:Contact )?Phone[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*technical_contact_phone[ \t]*:[ \t]*(.+)$/im,
    ],
    techAddress: [/^[ \t*]*Tech(?:nical)? (?:Contact )?Address[ \t.]*:[ \t]*(.+)$/im],
    techStreet: [/^[ \t*]*Tech(?:nical)? (?:Contact )?Street[ \t.]*:[ \t]*(.+)$/im],
    techCity: [
      /^[ \t*]*Tech(?:nical)? (?:Contact )?City[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*technical_contact_city[ \t]*:[ \t]*(.+)$/im,
    ],
    techState: [
      /^[ \t*]*Tech(?:nical)? (?:Contact )?State(?:\/Province)?[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*technical_contact_province[ \t]*:[ \t]*(.+)$/im,
    ],
    techPostalCode: [
      /^[ \t*]*Tech(?:nical)? (?:Contact )?Postal Code[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*technical_contact_postalcode[ \t]*:[ \t]*(.+)$/im,
    ],
    techCountry: [
      /^[ \t*]*Tech(?:nical)? (?:Contact )?Country[ \t.]*:[ \t]*(.+)$/im,
      /^[ \t]*technical_contact_country[ \t]*:[ \t]*(.+)$/im,
    ],
    billingId: [/^[ \t*]*(?:Registry )?Billing (?:Contact )?ID[ \t.]*:[ \t]*(.+)$/im],
    billingName: [/^[ \t*]*Billing (?:Contact )?Name[ \t.]*:[ \t]*(.+)$/im],
    billingOrg: [/^[ \t*]*Billing (?:Contact )?Organi[sz]ation[ \t.]*:[ \t]*(.+)$/im],
    billingEmail: [/^[ \t*]*Billing (?:Contact )?Email[ \t.]*:[ \t]*(.+)$/im],
    billingPhone: [/^[ \t*]*Billing (?:Contact )?Phone[ \t.]*:[ \t]*(.+)$/im],
    billingAddress: [/^[ \t*]*Billing (?:Contact )?Address[ \t.]*:[ \t]*(.+)$/im],
    billingStreet: [/^[ \t*]*Billing (?:Contact )?Street[ \t.]*:[ \t]*(.+)$/im],
    billingCity: [/^[ \t*]*Billing (?:Contact )?City[ \t.]*:[ \t]*(.+)$/im],
    billingState: [/^[ \t*]*Billing (?:Contact )?State(?:\/Province)?[ \t.]*:[ \t]*(.+)$/im],
    billingPostalCode: [/^[ \t*]*Billing (?:Contact )?Postal Code[ \t.]*:[ \t]*(.+)$/im],
    billingCountry: [/^[ \t*]*Billing (?:Contact )?Country[ \t.]*:[ \t]*(.+)$/im],
  };

  const nameservers = new Set<string>();
  const statuses = new Set<string>();

  source.forEach((hop, hopIndex) => {
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
    const isDnsBelgium = !isRootHop
      && /^%[^\r\n]*\.be Whois Server/im.test(text)
      && /^[ \t]*Registered[ \t]*:/im.test(text);
    const isEurid = !isRootHop
      && /^[ \t]*Script[ \t]*:/im.test(text)
      && /(?:^|\s)(?:www\.)?eurid\.eu(?:\s|\/|$)/im.test(text);
    const isNorid = !isRootHop
      && /^[ \t]*Domain Information[ \t]*$/im.test(text)
      && /^[ \t]*NORID Handle[ \t.]*:/im.test(text)
      && /^[ \t]*Registrar Handle[ \t.]*:/im.test(text)
      && /^[ \t]*Additional information[ \t]*:/im.test(text);
    const isCnnic = !isRootHop
      && /^[ \t]*ROID[ \t]*:/im.test(text)
      && /^[ \t]*Sponsoring Registrar[ \t]*:/im.test(text)
      && /^[ \t]*Registration Time[ \t]*:/im.test(text)
      && /^[ \t]*Expiration Time[ \t]*:/im.test(text);
    const isPunktum = !isRootHop
      && /^[ \t]*Registration period[ \t]*:/im.test(text)
      && /^[ \t]*VID[ \t]*:/im.test(text)
      && /^[ \t]*Nameservers[ \t]*$/im.test(text);
    const isPandi = !isRootHop
      && /^[ \t]*Domain ID[ \t]*:/im.test(text)
      && /^[ \t]*Sponsoring Registrar Organization[ \t]*:/im.test(text);
    const isIsocIl = !isRootHop
      && /^[ \t]*query[ \t]*:/im.test(text)
      && /^[ \t]*reg-name[ \t]*:/im.test(text)
      && /^[ \t]*validity[ \t]*:/im.test(text);
    const isTwnic = !isRootHop
      && /^[ \t]*Record created on[ \t]*:/im.test(text)
      && /^[ \t]*Record expires on[ \t]*:/im.test(text)
      && /^[ \t]*Registration Service Provider[ \t]*:/im.test(text);
    const isRegisterBg = !isRootHop
      && /^[ \t]*registration status[ \t]*:/im.test(text)
      && /^[ \t]*NAME SERVER INFORMATION[ \t]*:[ \t]*$/im.test(text);
    const isEif = !isRootHop
      && /Estonia \.ee Top Level Domain WHOIS server/i.test(text)
      && /^[ \t]*Domain[ \t]*:[ \t]*$/im.test(text)
      && /^[ \t]*Name servers[ \t]*:[ \t]*$/im.test(text);
    const isIszt = !isRootHop
      && /^% Whois server[^\r\n]*hu ccTLD/im.test(text)
      && /^[ \t]*record created[ \t]*:/im.test(text);
    const isIsnic = !isRootHop
      && /^% This is the ISNIC Whois server\./im.test(text)
      && /^[ \t]*source[ \t]*:[ \t]*ISNIC(?:\s|$)/im.test(text);
    const isNicLv = !isRootHop
      && /^[ \t]*\[Domain\][ \t]*$/im.test(text)
      && /^[ \t]*\[Holder\][ \t]*$/im.test(text)
      && /^[ \t]*\[Whois\][ \t]*$/im.test(text);
    const isSidn = !isRootHop
      && /^[ \t]*Domain nameservers[ \t]*:[ \t]*$/im.test(text)
      && /^[ \t]*Abuse Contact[ \t]*:[ \t]*$/im.test(text)
      && /^[ \t]*Record maintained by[ \t]*:/im.test(text);
    const isRnids = !isRootHop
      && /^[ \t]*Registration date[ \t]*:/im.test(text)
      && /^[ \t]*Modification date[ \t]*:/im.test(text)
      && /^[ \t]*DNSSEC signed[ \t]*:/im.test(text);
    const isCctldBy = !isRootHop
      && /^[ \t]*Domain name[ \t]*:/im.test(text)
      && /^[ \t]*Registration or other identification number[ \t]*:/im.test(text);
    const isHkirc = !isRootHop
      && /^[ \t]*Domain Name Information[ \t]*:[ \t]*$/im.test(text)
      && /^[ \t]*Name Servers Information[ \t]*:[ \t]*$/im.test(text)
      && /^[ \t]*Domain Name Commencement Date[ \t]*:/im.test(text);
    const isIrnic = !isRootHop
      && /^[ \t]*source[ \t]*:[ \t]*IRNIC(?:\s|$)/im.test(text)
      && /^[ \t]*holder-c[ \t]*:/im.test(text)
      && /^[ \t]*nic-hdl[ \t]*:/im.test(text);
    const isNicKz = !isRootHop
      && /^[ \t]*Domain Name[ \t.]*:/im.test(text)
      && /^[ \t]*Current Registar[ \t]*:/im.test(text)
      && /^[ \t]*Primary server[ \t.]*:/im.test(text);
    const isDnsLu = !isRootHop
      && /^[ \t]*domainname[ \t]*:/im.test(text)
      && /^[ \t]*domaintype[ \t]*:/im.test(text)
      && /^[ \t]*registrar-name[ \t]*:/im.test(text);
    const isNicMd = !isRootHop
      && /^[ \t]*Domain[ \t]+name[ \t]*:/im.test(text)
      && /^[ \t]*Domain state[ \t]*:/im.test(text)
      && /^[ \t]*Registered on[ \t]*:/im.test(text);
    const isThnic = !isRootHop
      && /^[ \t]*Domain Holder Organization[ \t]*:/im.test(text)
      && /^[ \t]*Created date[ \t]*:/im.test(text)
      && /^[ \t]*Exp date[ \t]*:/im.test(text);
    const isAtiTn = !isRootHop
      && /^[ \t]*NIC Whois server for cTLDs[ \t.]*:/im.test(text)
      && /^[ \t]*Domain name[ \t.]*:/im.test(text)
      && /^[ \t]*Creation date[ \t.]*:/im.test(text);
    const isMonic = !isRootHop
      && /^%[ \t]*Monic Whois Server Version[ \t]+\d/im.test(text)
      && /^[ \t]*Domain Name[ \t]*:/im.test(text)
      && /^[ \t]*Record created on[ \t]+[^:\r\n]/im.test(text)
      && /^[ \t]*Domain name servers[ \t]*:[ \t]*$/im.test(text);

    for (const [key, res] of Object.entries(patterns)) {
      // IANA's root hop describes the TLD and its operator, never a contact
      // for the queried registrable domain. Domain contacts therefore come
      // only from registry/registrar hops.
      if (isRootHop && /^(?:registrant|admin|tech|billing)/.test(key)) continue;
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
          const bounded = boundedWhoisValue(value, whoisFieldLimit(key));
          if (!bounded.value) continue;
          fields[key] = bounded.value;
          if (bounded.truncated) truncatedFields.add(key);
          break;
        }
      }
    }

    // A small set of ccTLD dialects reuse terse labels that would be unsafe
    // as global aliases (for example `org:` and `state:` also occur inside
    // contact/address blocks). Gate those fields on registry-specific marker
    // combinations, while retaining the same scalar/list bounds as the
    // generic parser and leaving endpoint discovery and authority untouched.
    if (!isRootHop) {
      if (isRegisterBg) {
        const domain = text.match(/^[ \t]*DOMAIN NAME[ \t]*:[ \t]*([a-z0-9.-]+)/im);
        if (domain) {
          const bounded = boundedWhoisValue(domain[1], whoisFieldLimit('domainName'));
          if (bounded.value) fields.domainName = bounded.value;
          if (bounded.truncated) truncatedFields.add('domainName');
        }
        for (const match of text.matchAll(/^[ \t]*registration status[ \t]*:[ \t]*([^\r\n]+)/gim)) {
          if (addBoundedWhoisSetValue(statuses, match[1], {
            maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
            field: 'statuses', truncatedFields,
          }) === 'capped') break;
        }
        collectBareWhoisNameservers(
          text,
          /^[ \t]*NAME SERVER INFORMATION[ \t]*:[ \t]*$/im,
          nameservers,
          truncatedFields,
        );
      }

      if (isEif) {
        const domainSection = parseBoundedWhoisSection(text, /^[ \t]*Domain[ \t]*:[ \t]*$/im);
        const registrantSection = parseBoundedWhoisSection(text, /^[ \t]*Registrant[ \t]*:[ \t]*$/im);
        const adminSection = parseBoundedWhoisSection(text, /^[ \t]*Administrative contact[ \t]*:[ \t]*$/im);
        const techSection = parseBoundedWhoisSection(text, /^[ \t]*Technical contact[ \t]*:[ \t]*$/im);
        const registrarSection = parseBoundedWhoisSection(text, /^[ \t]*Registrar[ \t]*:[ \t]*$/im);
        assignBoundedWhoisMatch(domainSection, fields, 'domainName', /^[ \t]*name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(registrantSection, fields, 'registrantName', /^[ \t]*name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(registrantSection, fields, 'registrantId', /^[ \t]*org id[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(registrantSection, fields, 'registrantCountry', /^[ \t]*country[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(adminSection, fields, 'adminName', /^[ \t]*name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(techSection, fields, 'techName', /^[ \t]*name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(registrarSection, fields, 'registrar', /^[ \t]*name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(registrarSection, fields, 'registrarUrl', /^[ \t]*url[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isIszt) {
        assignBoundedWhoisMatch(text, fields, 'createdDate', /^[ \t]*record created[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isIsnic) {
        const handle = text.match(/^[ \t]*registrant[ \t]*:[ \t]*(.+)$/im)?.[1] || null;
        if (handle) {
          const boundedHandle = boundedWhoisValue(handle, whoisFieldLimit('registrantId'));
          if (boundedHandle.value) fields.registrantId = boundedHandle.value;
          if (boundedHandle.truncated) truncatedFields.add('registrantId');
          delete fields.registrantName;
          const role = resolveIsnicRole(text, boundedHandle.value);
          if (role) {
            if (role.org.value) fields.registrantOrg = role.org.value;
            if (role.email.value) fields.registrantEmail = role.email.value;
            if (role.phone.value) fields.registrantPhone = role.phone.value;
            if (role.address.value) fields.registrantAddress = role.address.value;
            if (role.org.truncated) truncatedFields.add('registrantOrg');
            if (role.email.truncated) truncatedFields.add('registrantEmail');
            if (role.phone.truncated) truncatedFields.add('registrantPhone');
            if (role.address.truncated || role.truncated) truncatedFields.add('registrantAddress');
          }
        }
        assignBoundedWhoisMatch(text, fields, 'adminId', /^[ \t]*admin-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'techId', /^[ \t]*tech-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'billingId', /^[ \t]*billing-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isNicLv) {
        const holderSection = parseBoundedWhoisSection(text, /^[ \t]*\[Holder\][ \t]*$/im);
        assignBoundedWhoisMatch(holderSection, fields, 'registrantName', /^[ \t]*Name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(holderSection, fields, 'registrantId', /^[ \t]*RegNr[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(holderSection, fields, 'registrantAddress', /^[ \t]*Address[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(holderSection, fields, 'registrantCountry', /^[ \t]*Country[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isSidn) {
        const registrar = parseIndentedWhoisValue(
          text,
          /^[ \t]*Registrar[ \t]*:[ \t]*$/im,
          whoisFieldLimit('registrar'),
        );
        if (registrar?.value) fields.registrar = registrar.value;
        if (registrar?.truncated) truncatedFields.add('registrar');
        const abuse = parseIndentedContactBlock(text, /^[ \t]*Abuse Contact[ \t]*:[ \t]*$/im);
        if (abuse?.email) fields.abuseEmail = abuse.email;
        if (abuse?.phone) fields.abusePhone = abuse.phone;
        if (abuse?.truncated) {
          truncatedFields.add('abuseEmail');
          truncatedFields.add('abusePhone');
        }
        collectBareWhoisNameservers(
          text,
          /^[ \t]*Domain nameservers[ \t]*:[ \t]*$/im,
          nameservers,
          truncatedFields,
        );
      }

      if (isRnids) {
        assignBoundedWhoisMatch(text, fields, 'adminName', /^[ \t]*Administrative contact[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'techName', /^[ \t]*Technical contact[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'dnssec', /^[ \t]*DNSSEC signed[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        for (const match of text.matchAll(/^[ \t]*Domain status[ \t]*:[ \t]*(.*?)(?:[ \t]+https?:\/\/\S+)?[ \t]*$/gim)) {
          if (addBoundedWhoisSetValue(statuses, match[1], {
            maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
            field: 'statuses', truncatedFields,
          }) === 'capped') break;
        }
      }

      if (isCctldBy) {
        assignBoundedWhoisMatch(text, fields, 'registrantOrg', /^[ \t]*Org[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrantId', /^[ \t]*Registration or other identification number[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isHkirc) {
        assignBoundedWhoisMatch(text, fields, 'createdDate', /^[ \t]*Domain Name Commencement Date[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        collectBareWhoisNameservers(
          text,
          /^[ \t]*Name Servers Information[ \t]*:[ \t]*$/im,
          nameservers,
          truncatedFields,
        );
      }

      if (isIrnic) {
        const registrantId = text.match(/^[ \t]*holder-c[ \t]*:[ \t]*(.+)$/im)?.[1] || null;
        if (registrantId) {
          assignBoundedWhoisMatch(text, fields, 'registrantId', /^[ \t]*holder-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
          const contact = resolveIrnicContact(text, fields.registrantId);
          if (contact) {
            if (contact.name.value) fields.registrantName = contact.name.value;
            if (contact.org.value) fields.registrantOrg = contact.org.value;
            if (contact.email.value) fields.registrantEmail = contact.email.value;
            if (contact.phone.value) fields.registrantPhone = contact.phone.value;
            if (contact.address.value) fields.registrantAddress = contact.address.value;
            if (contact.name.truncated) truncatedFields.add('registrantName');
            if (contact.org.truncated) truncatedFields.add('registrantOrg');
            if (contact.email.truncated) truncatedFields.add('registrantEmail');
            if (contact.phone.truncated) truncatedFields.add('registrantPhone');
            if (contact.address.truncated || contact.truncated) truncatedFields.add('registrantAddress');
          }
        }
        assignBoundedWhoisMatch(text, fields, 'adminId', /^[ \t]*admin-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'techId', /^[ \t]*tech-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'billingId', /^[ \t]*bill-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isNicKz) {
        assignBoundedWhoisMatch(text, fields, 'createdDate', /^[ \t]*Domain created[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'updatedDate', /^[ \t]*Last modified[ \t.]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrar', /^[ \t]*Current Registar[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        for (const pattern of [
          /^[ \t]*Primary server[ \t.]*:[ \t]*([a-zA-Z0-9.-]+)/gim,
          /^[ \t]*Secondary server[ \t.]*:[ \t]*([a-zA-Z0-9.-]+)/gim,
        ]) {
          for (const match of text.matchAll(pattern)) {
            const result = addBoundedWhoisSetValue(nameservers, match[1], {
              maxEntries: MAX_WHOIS_NAMESERVERS, maxLength: 253,
              field: 'nameservers', truncatedFields,
            });
            if (result === 'capped') break;
          }
        }
      }

      if (isDnsLu) {
        assignBoundedWhoisMatch(text, fields, 'domainName', /^[ \t]*domainname[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrar', /^[ \t]*registrar-name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrarUrl', /^[ \t]*registrar-url[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isNicMd) {
        assignBoundedWhoisMatch(text, fields, 'domainName', /^[ \t]*Domain[ \t]+name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        for (const match of text.matchAll(/^[ \t]*Domain state[ \t]*:[ \t]*([^\r\n]+)/gim)) {
          if (addBoundedWhoisSetValue(statuses, match[1], {
            maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
            field: 'statuses', truncatedFields,
          }) === 'capped') break;
        }
      }

      if (isThnic) {
        assignBoundedWhoisMatch(text, fields, 'createdDate', /^[ \t]*Created date[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'expiryDate', /^[ \t]*Exp date[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrantOrg', /^[ \t]*Domain Holder Organization[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrantCountry', /^[ \t]*Domain Holder Country[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrantStreet', /^[ \t]*Domain Holder Street[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isMonic) {
        assignBoundedWhoisMatch(
          text,
          fields,
          'createdDate',
          /^[ \t]*Record created on[ \t]+(.+)$/im,
          truncatedFields,
        );
        collectBareWhoisNameservers(
          text,
          /^[ \t]*Domain name servers[ \t]*:[ \t]*$/im,
          nameservers,
          truncatedFields,
        );
      }

      const isRegistroBr = /^[ \t]*owner-c[ \t]*:/im.test(text)
        && /^[ \t]*country[ \t]*:[ \t]*BR(?:\s|$)/im.test(text);
      if (isRegistroBr) {
        assignBoundedWhoisMatch(text, fields, 'registrantName', /^[ \t]*owner[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrantId', /^[ \t]*owner-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'adminId', /^[ \t]*admin-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'techId', /^[ \t]*tech-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      const isAfnic = /^[ \t]*source[ \t]*:[ \t]*FRNIC(?:\s|$)/im.test(text);
      if (isAfnic) {
        assignBoundedWhoisMatch(text, fields, 'registrantId', /^[ \t]*holder-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'adminId', /^[ \t]*admin-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'techId', /^[ \t]*tech-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        for (const match of text.matchAll(/^[ \t]*eppstatus[ \t]*:[ \t]*(.+)$/gim)) {
          if (addBoundedWhoisSetValue(statuses, match[1], {
            maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
            field: 'statuses', truncatedFields,
          }) === 'capped') break;
        }
      }

      const isTci = /^[ \t]*source[ \t]*:[ \t]*TCI(?:\s|$)/im.test(text)
        && /^[ \t]*paid-till[ \t]*:/im.test(text);
      if (isTci) {
        assignBoundedWhoisMatch(text, fields, 'registrantOrg', /^[ \t]*org[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        for (const match of text.matchAll(/^[ \t]*state[ \t]*:[ \t]*(.+)$/gim)) {
          if (addBoundedWhoisSetValue(statuses, match[1], {
            maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
            field: 'statuses', truncatedFields,
          }) === 'capped') break;
        }
      }

      const isInternetstiftelsen = /^[ \t]*registry-lock[ \t]*:/im.test(text)
        && /^[ \t]*holder[ \t]*:/im.test(text);
      if (isInternetstiftelsen) {
        assignBoundedWhoisMatch(text, fields, 'registrantId', /^[ \t]*holder[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        for (const match of text.matchAll(/^[ \t]*state[ \t]*:[ \t]*(.+)$/gim)) {
          if (addBoundedWhoisSetValue(statuses, match[1], {
            maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
            field: 'statuses', truncatedFields,
          }) === 'capped') break;
        }
      }

      const isNask = /^[ \t]*DOMAIN NAME[ \t]*:/im.test(text)
        && /^[ \t]*registrant type[ \t]*:/im.test(text)
        && /^[ \t]*renewal date[ \t]*:/im.test(text)
        && /^[ \t]*REGISTRAR[ \t]*:[ \t]*$/im.test(text);
      if (isNask) {
        if (!fields.registrar) {
          const registrarHeader = text.match(/^[ \t]*REGISTRAR[ \t]*:[ \t]*$/im);
          const followingLines = registrarHeader
            ? text.slice((registrarHeader.index ?? 0) + registrarHeader[0].length).split('\n').slice(0, 8)
            : [];
          for (const line of followingLines) {
            if (!line.trim()) continue;
            const bounded = boundedWhoisValue(line, whoisFieldLimit('registrar'));
            if (bounded.value && !/^[a-z][a-z0-9+.-]*:\/\//i.test(bounded.value)
              && !/^[a-z][a-z0-9 -]{0,50}:[ \t]/i.test(bounded.value)) {
              fields.registrar = bounded.value;
            }
            if (bounded.truncated) truncatedFields.add('registrar');
            break;
          }
        }

        const nameserverHeader = text.match(/^[ \t]*nameservers[ \t]*:[ \t]*(.*)$/im);
        if (nameserverHeader) {
          const candidates = [
            nameserverHeader[1],
            ...text.slice((nameserverHeader.index ?? 0) + nameserverHeader[0].length)
              .split('\n').slice(1, MAX_WHOIS_NAMESERVERS + 2),
          ];
          let found = 0;
          for (const line of candidates) {
            const trimmed = line.trim();
            if (!trimmed) {
              if (found > 0) break;
              continue;
            }
            const hostMatch = trimmed.match(/^([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\.?(?:\s|$)/);
            if (!hostMatch) break;
            const result = addBoundedWhoisSetValue(nameservers, hostMatch[1].replace(/\.$/, ''), {
              maxEntries: MAX_WHOIS_NAMESERVERS, maxLength: 253,
              field: 'nameservers', truncatedFields,
            });
            if (result === 'capped') break;
            if (result === 'added') found += 1;
          }
        }
      }

      if ((isDnsBelgium || isEurid) && !fields.registrar) {
        const registrar = parseIndentedWhoisSubfield(
          text,
          /^[ \t]*Registrar[ \t]*:[ \t]*$/im,
          /^[ \t]*Name[ \t]*:[ \t]*(.+)$/i,
          whoisFieldLimit('registrar'),
        );
        if (registrar?.value) fields.registrar = registrar.value;
        if (registrar?.truncated) truncatedFields.add('registrar');
      }

      if (isNorid) {
        assignBoundedWhoisMatch(text, fields, 'registryDomainId', /^[ \t]*NORID Handle[ \t.]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrar', /^[ \t]*Registrar Handle[ \t.]*:[ \t]*(.+)$/im, truncatedFields);
      }

      // These aliases are meaningful only inside their registry's
      // distinctive response dialect. Keeping them marker-gated avoids
      // treating generic contact IDs, validity text, or service-provider
      // prose as domain-level evidence in unrelated WHOIS responses.
      if (isCnnic) {
        assignBoundedWhoisMatch(text, fields, 'registryDomainId', /^[ \t]*ROID[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'expiryDate', /^[ \t]*Expiration Time[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }
      if (isPandi) {
        assignBoundedWhoisMatch(text, fields, 'registryDomainId', /^[ \t]*Domain ID[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrar', /^[ \t]*Sponsoring Registrar Organization[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }
      if (isIsocIl) {
        assignBoundedWhoisMatch(text, fields, 'expiryDate', /^[ \t]*validity[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }
      if (isTwnic) {
        assignBoundedWhoisMatch(text, fields, 'registrar', /^[ \t]*Registration Service Provider[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'createdDate', /^[ \t]*Record created on[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'expiryDate', /^[ \t]*Record expires on[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }
    }

    // Sectioned legacy port-43 responses use a distinctive pair of section
    // headers and place several values on following indented lines. Gate the
    // dialect on both markers so generic responses with one blank field are
    // not reinterpreted. This is parser compatibility only: IANA still
    // selects the endpoint and authority analysis remains unchanged.
    const isSectionedRegistryResponse = !isRootHop
      && /^[ \t]*Relevant dates[ \t]*:[ \t]*$/im.test(text)
      && /^[ \t]*Registration status[ \t]*:[ \t]*$/im.test(text);
    if (isSectionedRegistryResponse) {
      for (const [key, headerRe] of [
        ['domainName', /^[ \t]*Domain(?: name)?[ \t]*:[ \t]*$/im],
        ['registrantName', /^[ \t]*Registrant[ \t]*:[ \t]*$/im],
        ['registrar', /^[ \t]*Registrar[ \t]*:[ \t]*$/im],
      ] as const) {
        if (fields[key]) continue;
        const parsed = parseIndentedWhoisValue(text, headerRe, whoisFieldLimit(key));
        if (!parsed?.value) continue;
        fields[key] = parsed.value;
        if (parsed.truncated) truncatedFields.add(key);
      }
      const registrationStatus = parseIndentedWhoisValue(
        text,
        /^[ \t]*Registration status[ \t]*:[ \t]*$/im,
        160,
      );
      if (registrationStatus?.value) {
        addBoundedWhoisSetValue(statuses, registrationStatus.value, {
          maxEntries: MAX_WHOIS_STATUSES,
          maxLength: 160,
          field: 'statuses',
          truncatedFields,
        });
      }

      const isChannelIslandsResponse = /^[ \t]*Domain Status[ \t]*:[ \t]*$/im.test(text)
        && /^[ \t]*WHOIS lookup made on[ \t]+[^\r\n]+$/im.test(text);
      if (isChannelIslandsResponse) {
        assignBoundedWhoisMatch(
          text,
          fields,
          'createdDate',
          /^[ \t]*Registered on[ \t]+(.+)$/im,
          truncatedFields,
        );
        const domainStatus = parseIndentedWhoisValue(
          text,
          /^[ \t]*Domain Status[ \t]*:[ \t]*$/im,
          160,
        );
        if (domainStatus?.value) {
          addBoundedWhoisSetValue(statuses, domainStatus.value, {
            maxEntries: MAX_WHOIS_STATUSES,
            maxLength: 160,
            field: 'statuses',
            truncatedFields,
          });
        }
      }
    }

    if (!isRootHop) {
      for (const [prefix, label] of [
        ['registrant', 'Registrant'], ['admin', 'Admin(?:istrative)?'],
        ['tech', 'Tech(?:nical)?'], ['billing', 'Billing'],
      ]) {
        const key = `${prefix}Street`;
        if (expandedStreetFields.has(key)) continue;
        const streetRe = new RegExp(`^[ \\t*]*${label} (?:Contact )?Street[ \\t.]*:[ \\t]*(.+)$`, 'gim');
        const lines: string[] = [];
        for (const match of text.matchAll(streetRe)) {
          const bounded = boundedWhoisValue(match[1], 300);
          if (bounded.truncated) truncatedFields.add(key);
          if (!bounded.value || lines.includes(bounded.value)) continue;
          if (lines.length >= 4) {
            truncatedFields.add(key);
            break;
          }
          lines.push(bounded.value);
        }
        if (lines.length) fields[key] = lines.join(', ');
        expandedStreetFields.add(key);
      }

      // The documented .nz protocol numbers up to two address lines using
      // underscore field names. Aggregate only those exact fields, keeping
      // the same four-line/300-character bounds as repeated ICANN-style
      // street fields and leaving city/province/postcode separately typed.
      for (const [prefix, nzPrefix] of [
        ['registrant', 'registrant'], ['admin', 'admin'], ['tech', 'technical'],
      ]) {
        const key = `${prefix}Street`;
        if (fields[key]) continue;
        const addressRe = new RegExp(`^[ \\t]*${nzPrefix}_contact_address(?:1|2)[ \\t]*:[ \\t]*(.+)$`, 'gim');
        const lines: string[] = [];
        for (const match of text.matchAll(addressRe)) {
          const bounded = boundedWhoisValue(match[1], 300);
          if (bounded.truncated) truncatedFields.add(key);
          if (!bounded.value || lines.includes(bounded.value)) continue;
          if (lines.length >= 4) {
            truncatedFields.add(key);
            break;
          }
          lines.push(bounded.value);
        }
        if (lines.length) fields[key] = lines.join(', ');
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
      const block = parseIndentedContactBlock(text, /^[ \t]*Registrant:[ \t]*$/im);
      if (block) {
        if (block.name) fields.registrantOrg = block.name;
        if (block.address) fields.registrantAddress = block.address;
        if (block.phone) fields.registrantPhone = block.phone;
        if (block.email) fields.registrantEmail = block.email;
        if (block.truncated) truncatedFields.add('registrantAddress');
      }
    }
    if (!isRootHop && !fields.adminName) {
      const block = parseIndentedContactBlock(text, /^[ \t]*Administrative Contact:[ \t]*$/im);
      if (block) {
        if (block.name) fields.adminName = block.name;
        if (block.address) fields.adminAddress = block.address;
        if (block.phone) fields.adminPhone = block.phone;
        if (block.email) fields.adminEmail = block.email;
        if (block.truncated) truncatedFields.add('adminAddress');
      }
    }
    if (!isRootHop && !fields.techName) {
      const block = parseIndentedContactBlock(text, /^[ \t]*Technical Contact:[ \t]*$/im);
      if (block) {
        if (block.name) fields.techName = block.name;
        if (block.address) fields.techAddress = block.address;
        if (block.phone) fields.techPhone = block.phone;
        if (block.email) fields.techEmail = block.email;
        if (block.truncated) truncatedFields.add('techAddress');
      }
    }
    if (!isRootHop && !fields.billingName) {
      const block = parseIndentedContactBlock(text, /^[ \t]*Billing Contact:[ \t]*$/im);
      if (block) {
        if (block.name) fields.billingName = block.name;
        if (block.address) fields.billingAddress = block.address;
        if (block.phone) fields.billingPhone = block.phone;
        if (block.email) fields.billingEmail = block.email;
        if (block.truncated) truncatedFields.add('billingAddress');
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
    for (const m of text.matchAll(/\[状態\][ \t]*(.+)/g)) {
      if (addBoundedWhoisSetValue(statuses, m[1], {
        maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
        field: 'statuses', truncatedFields,
      }) === 'capped') break;
    }
    for (const m of text.matchAll(/\[Name Server\][ \t]*([a-zA-Z0-9.\-]+)/gi)) {
      if (addBoundedWhoisSetValue(nameservers, m[1], {
        maxEntries: MAX_WHOIS_NAMESERVERS, maxLength: 253,
        field: 'nameservers', truncatedFields,
      }) === 'capped') break;
    }

    // "Name Server:" never collides with the IANA root hop (which uses
    // lowercase "nserver:" for the TLD's own root nameservers) so it's safe
    // on every hop; "nserver:"/"Host Name:"/"DNS:" are real per-domain
    // labels on some registries (e.g. .ru, .kr, .mx) but only once we're
    // past the root hop, for the same reason as the field patterns above.
    const nsLinePatterns = [/^[ \t*]*Name Server[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim];
    if (!isRootHop) {
      nsLinePatterns.push(
        /^[ \t*]*nserver[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim,
        /^[ \t*]*Nameserver[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim,
        /^[ \t*]*Host Name[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim,
        /^[ \t]*ns_name_\d{2}[ \t]*:[ \t]*([a-zA-Z0-9.\-]+)/gim
      );
      // Punktum dk uses `DNS: example.dk` for the queried domain, then
      // `Hostname:` inside its nameserver section. Other supported
      // registries use `DNS:` for an actual nameserver, so switch aliases
      // only when the full .dk marker set is present.
      nsLinePatterns.push(isPunktum
        ? /^[ \t*]*Hostname[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim
        : /^[ \t*]*DNS[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim);
    }
    for (const re of nsLinePatterns) {
      for (const m of text.matchAll(re)) {
        if (addBoundedWhoisSetValue(nameservers, m[1], {
          maxEntries: MAX_WHOIS_NAMESERVERS, maxLength: 253,
          field: 'nameservers', truncatedFields,
        }) === 'capped') break;
      }
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
      ? /^[ \t*]*Domain Status[ \t.]*:[ \t]*([a-zA-Z][a-zA-Z0-9_-]*)/gim
      : (isDnsBelgium || isPunktum || isIsocIl || isTwnic || isEif
          || isHkirc || isNicKz || isNicMd || isAtiTn)
        ? /^[ \t*]*(?:Domain Status|Status)[ \t.]*:[ \t]*([^\r\n]+)/gim
        : /^[ \t*]*(?:Domain Status|Status)[ \t.]*:[ \t]*([a-zA-Z][a-zA-Z0-9_-]*)/gim;
    if (!isRnids) {
      for (const m of text.matchAll(statusRe)) {
        if (addBoundedWhoisSetValue(statuses, m[1], {
          maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
          field: 'statuses', truncatedFields,
        }) === 'capped') break;
      }
    }
    if (!isRootHop) {
      for (const m of text.matchAll(/^[ \t]*query_status[ \t]*:[ \t]*(\d{3}(?:[ \t]+[^\r\n]+)?)/gim)) {
        if (addBoundedWhoisSetValue(statuses, m[1], {
          maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
          field: 'statuses', truncatedFields,
        }) === 'capped') break;
      }
    }

    // Some registries (e.g. .it, .tr) list nameservers as a bare header
    // ("Nameservers", "Domain Servers") followed by unlabeled lines -
    // sometimes just a hostname, sometimes "hostname  ip.addr" - rather
    // than a per-line "Name Server:" label. Only meaningful on non-root hops.
    if (!isRootHop && nameservers.size === 0) {
      const headerMatch = text.match(/^[ \t*]*(?:Name ?[Ss]ervers|Domain Servers|DNS servers)[ \t.]*:?[ \t]*$/mi);
      if (headerMatch) {
        let found = 0;
        for (const line of text.slice((headerMatch.index ?? 0) + headerMatch[0].length).split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) {
            if (found > 0) break; // blank line after >=1 hostname ends the section
            continue; // the header line's own line break - not a real gap yet
          }
          const hostMatch = trimmed.match(/^([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})(?:\s|$)/);
          if (hostMatch) {
            const result = addBoundedWhoisSetValue(nameservers, hostMatch[1], {
              maxEntries: MAX_WHOIS_NAMESERVERS, maxLength: 253,
              field: 'nameservers', truncatedFields,
            });
            if (result === 'capped') break;
            if (result === 'added') found += 1;
          } else {
            break;
          }
        }
      }
    }
  });

  // Dedicated legacy-format parsers above populate some fields outside the
  // generic pattern loop. Apply the same string/control bounds to every
  // scalar before constructing compatibility and normalized contact views.
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string') continue;
    const bounded = boundedWhoisValue(value, whoisFieldLimit(key));
    if (!bounded.value) delete fields[key];
    else fields[key] = bounded.value;
    if (bounded.truncated) truncatedFields.add(key);
  }

  fields.nameservers = [...nameservers];
  fields.statuses = [...statuses];
  fields.createdDateIso = registryDateIso(fields.createdDate);
  fields.expiryDateIso = registryDateIso(fields.expiryDate);
  fields.updatedDateIso = registryDateIso(fields.updatedDate);
  fields.lifecycle = {
    createdDate: fields.createdDate || null,
    expiryDate: fields.expiryDate || null,
    updatedDate: fields.updatedDate || null,
    createdDateIso: fields.createdDateIso,
    expiryDateIso: fields.expiryDateIso,
    updatedDateIso: fields.updatedDateIso,
  };
  const contactsByRole: Record<string, UnknownRecord[]> = {};
  for (const [prefix, role] of [
    ['registrant', 'registrant'], ['admin', 'administrative'],
    ['tech', 'technical'], ['billing', 'billing'],
  ]) {
    const contact = normalizedWhoisContact(fields, prefix, role, truncatedFields);
    if (contact) contactsByRole[role] = [contact];
  }
  if (fields.abuseEmail || fields.abusePhone) {
    contactsByRole.abuse = [{
      handle: null, roles: ['abuse'], name: null, names: [], org: fields.registrar || null,
      organizations: fields.registrar ? [fields.registrar] : [],
      email: fields.abuseEmail || null, emails: fields.abuseEmail ? [fields.abuseEmail] : [],
      phone: fields.abusePhone || null, phones: fields.abusePhone ? [fields.abusePhone] : [],
      address: null, addresses: [], publicIds: [], links: [],
    }];
  }
  fields.contactsByRole = contactsByRole;
  fields.fieldsTruncated = [...truncatedFields].sort();

  // Existence is decided authority-aware, not by a global "any hop said no
  // match" flag: positive registry evidence is never overridden by a later
  // registrar hop that failed, rate-limited, or returned "no match".
  const authority = analyzeWhoisChainAuthority(source);
  fields.notFound = authority.notFound;
  fields.notFoundSource = authority.notFoundSource;
  fields.authoritativeHop = authority.authoritativeHop;
  fields.failedHop = authority.failedHop;
  fields.conflictingHop = authority.conflictingHop;
  fields.registrationStatus = authority.registrationStatus;
  fields.chainStatus = authority.chainStatus;
  return fields;
}

export {
  buildWhoisChain,
  parseWhoisChain,
  analyzeWhoisChainAuthority,
  whoisQuery,
  queryWhoisAddress,
  buildWhoisChainUncached,
  fetchGtRegistryWhois,
};
