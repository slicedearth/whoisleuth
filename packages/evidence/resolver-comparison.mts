import { isValidAsciiDomainName } from '../contracts/domain-name.mts';
import { DNS_QUERY_OUTCOMES, type DnsQueryOutcome } from './dns-query-outcome.mts';
import { normalizeExplicitIsoTimestamp } from './observation.mts';
import { canonicalIpAddress, addressValue } from '../contracts/ip-address.mts';

export const RESOLVER_COMPARISON_SCHEMA = 'whoisleuth.resolver-comparison';
export const RESOLVER_COMPARISON_VERSION = 1;
export const RESOLVER_RESPONSE_BYTES = 64 * 1024;
export const RESOLVER_COMPARISON_BYTES = 128 * 1024;
export const RESOLVER_COMPARISON_TIMEOUT_MS = 10_000;
export const RESOLVER_PROVIDERS = Object.freeze([
  Object.freeze({ id: 'cloudflare', label: 'Cloudflare', endpoint: 'https://cloudflare-dns.com/dns-query',
    termsUrl: 'https://developers.cloudflare.com/1.1.1.1/terms-of-use/',
    privacyUrl: 'https://developers.cloudflare.com/1.1.1.1/privacy/public-dns-resolver/' }),
  Object.freeze({ id: 'google', label: 'Google Public DNS', endpoint: 'https://dns.google/resolve',
    termsUrl: 'https://developers.google.com/speed/public-dns/terms',
    privacyUrl: 'https://developers.google.com/speed/public-dns/privacy' }),
] as const);
export type ResolverProviderId = typeof RESOLVER_PROVIDERS[number]['id'];
export const RESOLVER_RECORD_TYPES = Object.freeze(['A', 'AAAA'] as const);
export type ResolverRecordType = typeof RESOLVER_RECORD_TYPES[number];
export type ResolverQuery = Readonly<{
  provider: ResolverProviderId; type: ResolverRecordType; observedAt: string;
  requestStarted: boolean; outcome: DnsQueryOutcome;
  comparisonState: 'observed' | 'partial' | 'unavailable';
  values: readonly Readonly<{ value: string; ttl: number }>[];
  authenticatedData: boolean | null; aliasObserved: boolean; truncated: boolean;
}>;
export type ResolverComparison = Readonly<{
  schema: typeof RESOLVER_COMPARISON_SCHEMA; version: 1; hostname: string;
  startedAt: string; completedAt: string; queries: readonly ResolverQuery[];
  rows: readonly Readonly<{ type: ResolverRecordType; state: 'incomplete' | 'insufficient' | 'divergent' | 'unexpected' | 'converged' }>[];
}>;

export function normaliseResolverComparisonRequest(hostname: unknown, selection: unknown) {
  if (typeof hostname !== 'string' || hostname.length > 254 || hostname.trim() !== hostname) {
    throw new TypeError('Select one hostname, without a URL or surrounding whitespace.');
  }
  const name = hostname.toLowerCase().replace(/\.$/u, '');
  if (!isValidAsciiDomainName(name) || /^\d+(?:\.\d+)*$/u.test(name)) throw new TypeError('Select a valid DNS hostname.');
  const ids = typeof selection === 'string' && selection.length <= 80 ? selection.split(',').map(value => value.trim())
    : Array.isArray(selection) && selection.length <= RESOLVER_PROVIDERS.length ? selection : [];
  if (ids.length !== 2 || new Set(ids).size !== ids.length
    || ids.some(id => !RESOLVER_PROVIDERS.some(provider => provider.id === id))) {
    throw new TypeError('Explicitly select two different supported resolvers.');
  }
  return Object.freeze({ hostname: name, resolvers: Object.freeze(ids as ResolverProviderId[]) });
}

/** Revalidate our bounded backend report before displaying provider-controlled data. */
export function readResolverComparison(value: unknown, expectedHostname?: string): ResolverComparison {
  const fail = (): never => { throw new TypeError('Resolver comparison response is invalid.'); };
  const object = (raw: unknown): Record<string, unknown> => raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : fail();
  const root = object(value);
  const hostname = normaliseResolverComparisonRequest(root.hostname, RESOLVER_PROVIDERS.map(provider => provider.id)).hostname;
  if (root.schema !== RESOLVER_COMPARISON_SCHEMA || root.version !== RESOLVER_COMPARISON_VERSION
    || expectedHostname !== undefined && hostname !== expectedHostname) fail();
  const startedAt = normalizeExplicitIsoTimestamp(root.startedAt) ?? fail();
  const completedAt = normalizeExplicitIsoTimestamp(root.completedAt) ?? fail();
  if (completedAt < startedAt || !Array.isArray(root.queries) || root.queries.length !== 4) fail();
  const seen = new Set<string>();
  const queries = (root.queries as unknown[]).map(raw => {
    const item = object(raw);
    if (!RESOLVER_PROVIDERS.some(provider => provider.id === item.provider)
      || !RESOLVER_RECORD_TYPES.includes(item.type as ResolverRecordType)
      || typeof item.outcome !== 'string' || !Object.hasOwn(DNS_QUERY_OUTCOMES, item.outcome)
      || !['observed', 'partial', 'unavailable'].includes(String(item.comparisonState))
      || typeof item.requestStarted !== 'boolean' || typeof item.aliasObserved !== 'boolean' || typeof item.truncated !== 'boolean'
      || item.authenticatedData !== null && typeof item.authenticatedData !== 'boolean'
      || !Array.isArray(item.values) || item.values.length > 100) fail();
    const observedAt = normalizeExplicitIsoTimestamp(item.observedAt) ?? fail();
    if (observedAt < startedAt || observedAt > completedAt) fail();
    const key = `${String(item.provider)}:${String(item.type)}`;
    if (seen.has(key)) fail();
    seen.add(key);
    const values = (item.values as unknown[]).map(rawValue => {
      const entry = object(rawValue);
      const ip = canonicalIpAddress(entry.value);
      if (!ip || addressValue(ip)?.family !== (item.type === 'A' ? 4 : 6)
        || !Number.isSafeInteger(entry.ttl) || Number(entry.ttl) < 0 || Number(entry.ttl) > 0x7fff_ffff) fail();
      return Object.freeze({ value: ip!, ttl: Number(entry.ttl) });
    });
    if ((!item.requestStarted && (item.outcome !== 'skipped' || values.length || item.comparisonState !== 'unavailable'))
      || item.outcome !== 'records' && values.length
      || item.outcome === 'records' && !values.length
      || item.comparisonState === 'observed' && (item.truncated || item.aliasObserved
        || item.outcome !== 'records' && item.outcome !== 'no_data')
      || item.comparisonState === 'unavailable' && values.length) fail();
    return Object.freeze({ provider: item.provider, type: item.type, observedAt, requestStarted: item.requestStarted,
      outcome: item.outcome, comparisonState: item.comparisonState, values: Object.freeze(values),
      authenticatedData: item.authenticatedData, aliasObserved: item.aliasObserved, truncated: item.truncated }) as ResolverQuery;
  });
  if (!Array.isArray(root.rows) || root.rows.length !== RESOLVER_RECORD_TYPES.length) fail();
  const rows = (root.rows as unknown[]).map((raw, index) => {
    const item = object(raw);
    if (item.type !== RESOLVER_RECORD_TYPES[index]
      || !['incomplete', 'insufficient', 'divergent', 'unexpected', 'converged'].includes(String(item.state))) fail();
    return Object.freeze({ type: item.type, state: item.state }) as ResolverComparison['rows'][number];
  });
  return Object.freeze({ schema: RESOLVER_COMPARISON_SCHEMA, version: RESOLVER_COMPARISON_VERSION,
    hostname, startedAt, completedAt, queries: Object.freeze(queries), rows: Object.freeze(rows) });
}
