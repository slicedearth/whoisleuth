import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';

import type { DnsResolver } from './dns-intelligence.mts';
import { isPrivateAddress } from './safe-fetch.mts';

const MAX_SELECTED_DNS_RESOLVERS = 3;
const MAX_SELECTED_DNS_RESOLVER_TEXT = 256;

function normalizeSelectedDnsResolvers(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_SELECTED_DNS_RESOLVER_TEXT) {
    throw new TypeError(`DNS resolver selection must contain at most ${MAX_SELECTED_DNS_RESOLVER_TEXT} characters.`);
  }
  const values = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  if (!values.length || values.length > MAX_SELECTED_DNS_RESOLVERS
    || values.some((item) => isIP(item) === 0 || isPrivateAddress(item))) {
    throw new TypeError(`DNS resolver selection requires 1 to ${MAX_SELECTED_DNS_RESOLVERS} publicly routable literal IPv4 or IPv6 addresses.`);
  }
  return values;
}

function createSelectedDnsResolvers(servers: readonly string[]): Record<string, DnsResolver> {
  if (!Array.isArray(servers) || !servers.length || servers.length > MAX_SELECTED_DNS_RESOLVERS
    || servers.some((item) => typeof item !== 'string' || isIP(item) === 0 || isPrivateAddress(item))) {
    throw new TypeError('Validated publicly routable DNS resolver addresses are required.');
  }
  const resolver = new Resolver();
  resolver.setServers([...servers]);
  return Object.freeze({
    resolve4: (value: string) => resolver.resolve4(value),
    resolve6: (value: string) => resolver.resolve6(value),
    resolveCname: (value: string) => resolver.resolveCname(value),
    resolveNs: (value: string) => resolver.resolveNs(value),
    resolveMx: (value: string) => resolver.resolveMx(value),
    resolveTxt: (value: string) => resolver.resolveTxt(value),
    resolveCaa: (value: string) => resolver.resolveCaa(value),
    resolveSoa: (value: string) => resolver.resolveSoa(value),
  });
}

export {
  MAX_SELECTED_DNS_RESOLVERS,
  MAX_SELECTED_DNS_RESOLVER_TEXT,
  createSelectedDnsResolvers,
  normalizeSelectedDnsResolvers,
};
