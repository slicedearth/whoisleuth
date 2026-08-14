// Bounded normalization for imported and collected WHOIS referral chains.
// Keeping this separate lets authority analysis and field parsing share the
// exact same defensive input boundary.

import { MAX_WHOIS_BYTES } from './whois-transport.mts';
import type { WhoisChain } from './whois-chain.mts';

type UnknownRecord = Record<string, unknown>;

// Collection performs at most six network queries and may retain one seventh,
// non-issued hop explaining a loop or hop-limit termination.
const MAX_WHOIS_HOPS = 7;

export function normalizeWhoisChain(value: unknown): WhoisChain {
  if (!Array.isArray(value)) return [];
  const normalized: WhoisChain = [];
  for (const hopValue of value.slice(0, MAX_WHOIS_HOPS)) {
    if (!hopValue || typeof hopValue !== 'object' || Array.isArray(hopValue)) continue;
    const hop = hopValue as UnknownRecord;
    if (typeof hop.server !== 'string' || !hop.server.trim()) continue;
    normalized.push({
      server: hop.server.slice(0, 300),
      ...(typeof hop.address === 'string' || hop.address === null ? { address: hop.address } : {}),
      ...(typeof hop.queriedAt === 'string' ? { queriedAt: hop.queriedAt.slice(0, 64) } : {}),
      ...(typeof hop.queryProfile === 'string' ? { queryProfile: hop.queryProfile.slice(0, 80) } : {}),
      ...(typeof hop.responseEncoding === 'string' ? { responseEncoding: hop.responseEncoding.slice(0, 40) } : {}),
      ...(typeof hop.response === 'string' ? { response: hop.response.slice(0, MAX_WHOIS_BYTES) } : {}),
      ...(typeof hop.error === 'string' ? { error: hop.error.slice(0, 1000) } : {}),
    });
  }
  return normalized;
}
