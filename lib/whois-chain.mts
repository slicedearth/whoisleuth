// WHOIS referral-chain orchestration. Transport remains isolated in
// whois-transport.mts; this module applies registry query profiles, follows
// bounded referrals, and adapts the registry-web fallback into WHOIS text.

import { domainToUnicode } from 'node:url';

import { cached } from './lookup-cache.mts';
import { registryCapabilityFor, type WhoisQueryProfile } from './registry-capabilities.mts';
import { readTextCapped, safeFetch } from './safe-fetch.mts';
import { whoisQuery, type WhoisQuery } from './whois-transport.mts';

type UnknownRecord = Record<string, unknown>;

export type WhoisHop = {
  server: string;
  address?: string | null;
  queriedAt?: string;
  queryProfile?: string;
  responseEncoding?: string;
  response?: string;
  error?: string;
};

export type WhoisChain = WhoisHop[];

type GtRegistryResult =
  | { registered: false }
  | {
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

const IANA_WHOIS = 'whois.iana.org';
const WHOIS_HOP_DEADLINE_MS = 12_000;
const WHOIS_CHAIN_DEADLINE_MS = 25_000;
const MAX_GT_REGISTRY_HTML_BYTES = 500_000;

const WHOIS_QUERY_FORMATTERS: Record<WhoisQueryProfile, (domain: string) => string> = {
  'plain-domain': (domain) => domain,
  'denic-domain-ace': (domain) => `-T dn,ace ${domain}`,
  'jprs-domain-english': (domain) => `${domain}/e`,
  'registry-domain-unicode': (domain) => domainToUnicode(domain),
};

function whoisTransportForHop(
  domain: string,
  hop: number,
): {
  query: string;
  queryProfile: WhoisQueryProfile;
  responseEncoding: 'utf-8';
} {
  const capability = registryCapabilityFor(domain);
  const queryProfile =
    hop === 1 && capability?.whoisQueryScope === 'first-referral'
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

function extractReferral(whoisText: string): string | null {
  // Horizontal whitespace is intentional. `\s*` can cross a blank line and
  // misread the next field label when a registry publishes an empty referral.
  const patterns = [
    /^[ \t]*refer:[ \t]*([a-zA-Z0-9.\-]+)/mi,
    /^[ \t]*ReferralServer:[ \t]*whois:\/\/([a-zA-Z0-9.\-]+)/mi,
    /^[ \t]*whois:[ \t]*([a-zA-Z0-9.\-]+)/mi,
  ];
  for (const pattern of patterns) {
    const referral = whoisText.match(pattern)?.[1]?.trim();
    if (referral) return referral;
  }
  return null;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sectionBetween(html: string, startRe: RegExp, endRes: RegExp[]): string {
  const startMatch = html.match(startRe);
  if (!startMatch) return '';
  const rest = html.slice((startMatch.index ?? 0) + startMatch[0].length);
  let endIndex = rest.length;
  for (const endRe of endRes) {
    const match = rest.match(endRe);
    if (!match) continue;
    const matchIndex = match.index ?? 0;
    const index = match[0].startsWith('>') ? matchIndex + 1 : matchIndex;
    if (index < endIndex) endIndex = index;
  }
  return rest.slice(0, endIndex);
}

function extractIconFields(
  html: string,
  iconMap: Record<string, string>,
): Record<string, string> {
  let marked = html;
  for (const [icon, key] of Object.entries(iconMap)) {
    marked = marked.replace(
      new RegExp(`<i[^>]*\\b${icon}\\b[^>]*></i>`, 'gi'),
      `\n@@${key}@@\n`,
    );
  }
  const parts = stripTags(marked).split(/@@(\w+)@@/);
  const fields: Record<string, string> = {};
  for (let index = 1; index < parts.length; index += 2) {
    const value = (parts[index + 1] || '').trim();
    const key = parts[index];
    if (key && value && !fields[key]) fields[key] = value;
  }
  return fields;
}

export async function fetchGtRegistryWhois(
  domain: string,
  {
    fetcher = safeFetch,
  }: { fetcher?: (url: string, options: RequestInit) => Promise<Response> } = {},
): Promise<GtRegistryResult | null> {
  const url = `https://www.gt/sitio/whois.php?dn=${encodeURIComponent(domain)}.&lang=en`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DomainStatusChecker/1.0)' },
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const body = await readTextCapped(response, MAX_GT_REGISTRY_HTML_BYTES);
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
    const adminSection = sectionBetween(
      html,
      />\s*ADMINISTRATIVE\s*</i,
      [/>\s*TECHNICAL\s*</i, />\s*BILLING\s*</i],
    );
    const admin = extractIconFields(adminSection, {
      'fa-user': 'name',
      'fa-envelope': 'email',
      'fa-address-card': 'address',
      'fa-building': 'org',
    });
    const serversSection = sectionBetween(html, /Servers\s*<\/h4>/i, [
      /<div class="span6">/i,
    ]);
    const nameservers = [
      ...serversSection.matchAll(/<strong>\s*([a-zA-Z0-9.\-]+)\.?\s*<\/strong>/gi),
    ]
      .map((match) => match[1]?.trim())
      .filter((value): value is string => Boolean(value));

    return {
      registered: true,
      status: statusMatch?.[1]?.trim() || null,
      expiryDate: expiryMatch?.[1]?.trim() || null,
      registrantOrg: org.org || null,
      registrantAddress: org.address || null,
      registrantPhone: org.phone || null,
      adminName: admin.name || null,
      adminOrg: admin.org || null,
      adminEmail: admin.email || null,
      nameservers,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function formatGtResultAsText(domain: string, result: GtRegistryResult): string {
  if (!result.registered) return `No match for domain ${domain.toUpperCase()}.`;
  const lines = [`Domain Name: ${domain.toUpperCase()}`];
  if (result.status) lines.push(`Domain Status: ${result.status}`);
  if (result.expiryDate) lines.push(`Registry Expiry Date: ${result.expiryDate}`);
  if (result.registrantOrg) lines.push(`Registrant Organization: ${result.registrantOrg}`);
  if (result.registrantAddress) lines.push(`Registrant Address: ${result.registrantAddress}`);
  if (result.registrantPhone) lines.push(`Registrant Phone: ${result.registrantPhone}`);
  if (result.adminName) lines.push(`Admin Name: ${result.adminName}`);
  if (result.adminOrg) lines.push(`Admin Organization: ${result.adminOrg}`);
  if (result.adminEmail) lines.push(`Admin Email: ${result.adminEmail}`);
  for (const nameserver of result.nameservers) lines.push(`Name Server: ${nameserver}`);
  return lines.join('\n');
}

export async function buildWhoisChainUncached(
  query: string,
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
    const transport = whoisTransportForHop(query, hop);
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

    let responseText: string;
    let address: string | null = null;
    const queriedAt = new Date().toISOString();
    try {
      responseText = await queryWhois(currentServer, transport.query, {
        timeoutMs: Math.min(10_000, remainingMs),
        totalDeadlineMs: Math.min(WHOIS_HOP_DEADLINE_MS, remainingMs),
        onAddressSelected: (selected) => {
          address = selected;
        },
      });
    } catch (cause) {
      chain.push({
        server: currentServer,
        queriedAt,
        queryProfile: transport.queryProfile,
        responseEncoding: transport.responseEncoding,
        error: errorMessage(cause, 'WHOIS request failed'),
      });
      break;
    }
    chain.push({
      server: currentServer,
      address,
      queriedAt,
      queryProfile: transport.queryProfile,
      responseEncoding: transport.responseEncoding,
      response: responseText,
    });
    const referral = extractReferral(responseText);
    if (!referral || referral.toLowerCase() === currentServer.toLowerCase()) break;
    currentServer = referral;
  }

  const firstHop = chain[0];
  if (
    query.toLowerCase().endsWith('.gt') &&
    chain.length === 1 &&
    firstHop &&
    !('error' in firstHop)
  ) {
    try {
      const result = await fetchGtWhois(query);
      if (result) {
        chain.push({
          server: 'www.gt (registry website - .gt has no WHOIS:43 server)',
          queriedAt: new Date().toISOString(),
          queryProfile: 'gt-registry-web',
          responseEncoding: 'utf-8',
          response: formatGtResultAsText(query, result),
        });
      }
    } catch {
      // Best-effort registry fallback. The IANA hop remains explicit on failure.
    }
  }
  return chain;
}

export async function buildWhoisChain(query: string): Promise<WhoisChain> {
  return cached(`whois:${query.toLowerCase()}`, () => buildWhoisChainUncached(query));
}
