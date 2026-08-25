// WHOIS referral-chain orchestration. Transport remains isolated in
// whois-transport.mts; this module applies registry query profiles and follows
// bounded referrals.

import { domainToUnicode } from 'node:url';

import { cached } from './lookup-cache.mts';
import {
  registryCapabilityFor,
  registryServiceAdmissionFor,
  type WhoisQueryProfile,
} from './registry-capabilities.mts';
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

const IANA_WHOIS = 'whois.iana.org';
const WHOIS_HOP_DEADLINE_MS = 12_000;
const WHOIS_CHAIN_DEADLINE_MS = 25_000;
const MAX_WHOIS_QUERY_HOPS = 6;

function incompleteReferralHop(server: string, reason: 'hop_limit' | 'referral_loop'): WhoisHop {
  return {
    server,
    queryProfile: 'not-issued',
    responseEncoding: 'utf-8',
    error: reason === 'hop_limit'
      ? 'WHOIS referral chain reached the bounded hop limit; this referral was not queried.'
      : 'WHOIS referral chain repeated a previously queried server; this referral was not queried.',
  };
}

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

export async function buildWhoisChainUncached(
  query: string,
  options: {
    whoisQuery?: WhoisQuery;
    now?: () => number;
    chainDeadlineMs?: number;
  } = {},
): Promise<WhoisChain> {
  const admission = registryServiceAdmissionFor(query, 'whois');
  if (admission && !admission.allowed) {
    return [{
      server: 'registry capability policy',
      queryProfile: 'not-issued',
      responseEncoding: 'utf-8',
      error: admission.state === 'permission_required'
        ? 'WHOIS collection requires registry permission or source authorisation; no socket was opened.'
        : 'IANA publishes no domain WHOIS service for this suffix; no socket was opened.',
    }];
  }
  const queryWhois = options.whoisQuery || whoisQuery;
  const now = options.now || Date.now;
  const chainDeadlineMs = options.chainDeadlineMs || WHOIS_CHAIN_DEADLINE_MS;
  const chain: WhoisChain = [];
  const visited = new Set<string>();
  let currentServer = IANA_WHOIS;
  const startedAt = now();

  for (let hop = 0; hop < MAX_WHOIS_QUERY_HOPS; hop += 1) {
    if (visited.has(currentServer.toLowerCase())) {
      chain.push(incompleteReferralHop(currentServer, 'referral_loop'));
      break;
    }
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
    if (!referral) break;
    const referralKey = referral.toLowerCase();
    if (visited.has(referralKey)) {
      chain.push(incompleteReferralHop(referral, 'referral_loop'));
      break;
    }
    if (hop + 1 >= MAX_WHOIS_QUERY_HOPS) {
      chain.push(incompleteReferralHop(referral, 'hop_limit'));
      break;
    }
    currentServer = referral;
  }

  return chain;
}

export async function buildWhoisChain(query: string): Promise<WhoisChain> {
  return cached(`whois:${query.toLowerCase()}`, () => buildWhoisChainUncached(query));
}
