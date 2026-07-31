export const RDAP_NAMESERVER_SEARCH_SCHEMA = 'whoisleuth.rdap-nameserver-search';
export const RDAP_NAMESERVER_SEARCH_VERSION = 1;
export const MAX_RDAP_NAMESERVER_SEARCH_RESULTS = 200;

const states = new Set([
  'success',
  'partial',
  'no_results',
  'unsupported',
  'rate_limited',
  'unavailable',
] as const);

export type RdapNameserverSearchState =
  | 'success'
  | 'partial'
  | 'no_results'
  | 'unsupported'
  | 'rate_limited'
  | 'unavailable';

export type RdapNameserverSearchMatch = {
  domain: string;
  unicodeDomain: string | null;
  statuses: string[];
  nameserverObserved: boolean | null;
  partial: boolean;
};

export type RdapNameserverSearchView = {
  state: RdapNameserverSearchState;
  nameserver: string;
  registryScope: string;
  observedAt: string;
  endpoint: string | null;
  resultCount: number;
  domains: RdapNameserverSearchMatch[];
  truncated: boolean;
  omittedInvalid: number;
  limitations: string[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function bounded(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  return value.trim() || null;
}

function hostname(value: unknown): string | null {
  const text = bounded(value, 1_024);
  if (!text) return null;
  let ascii = '';
  try {
    ascii = new URL(`https://${text.replace(/\.+$/u, '')}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!ascii || ascii.length > 253 || !ascii.includes('.')) return null;
  return ascii.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(label))
    ? ascii
    : null;
}

function registryScope(value: unknown): string | null {
  const text = bounded(value, 63);
  if (!text || text.includes('.')) return null;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(text) ? text.toLowerCase() : null;
}

function domainMatch(value: unknown, scope: string): RdapNameserverSearchMatch | null {
  const item = record(value);
  if (!item) return null;
  const domain = hostname(item.domain);
  if (!domain || !domain.endsWith(`.${scope}`)) return null;
  const statuses = Array.isArray(item.statuses)
    ? item.statuses
        .map((entry) => bounded(entry, 160))
        .filter((entry): entry is string => entry !== null)
        .slice(0, 12)
    : [];
  return {
    domain,
    unicodeDomain: bounded(item.unicodeDomain, 253),
    statuses,
    nameserverObserved: typeof item.nameserverObserved === 'boolean'
      ? item.nameserverObserved
      : null,
    partial: item.partial === true,
  };
}

export function normalizeRdapNameserverSearchResponse(
  value: unknown,
): RdapNameserverSearchView | null {
  const source = record(value);
  if (!source
    || source.schema !== RDAP_NAMESERVER_SEARCH_SCHEMA
    || source.version !== RDAP_NAMESERVER_SEARCH_VERSION
    || source.lowerBound !== true
    || !states.has(source.state as RdapNameserverSearchState)
    || !Array.isArray(source.domains)) return null;
  const nameserver = hostname(source.nameserver);
  const scope = registryScope(source.registryScope);
  const observedAt = bounded(source.observedAt, 64);
  if (!nameserver || !scope || !observedAt || Number.isNaN(Date.parse(observedAt))) return null;
  const domains: RdapNameserverSearchMatch[] = [];
  const seen = new Set<string>();
  for (const raw of source.domains.slice(0, MAX_RDAP_NAMESERVER_SEARCH_RESULTS)) {
    const match = domainMatch(raw, scope);
    if (!match || seen.has(match.domain)) continue;
    seen.add(match.domain);
    domains.push(match);
  }
  const sourceMetadata = record(source.source);
  const endpointValue = bounded(sourceMetadata?.endpoint, 2_048);
  let endpoint: string | null = null;
  if (endpointValue) {
    try {
      const parsed = new URL(endpointValue);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') endpoint = endpointValue;
    } catch {
      endpoint = null;
    }
  }
  const limitations = Array.isArray(source.limitations)
    ? source.limitations
        .map((entry) => bounded(entry, 500))
        .filter((entry): entry is string => entry !== null)
        .slice(0, 6)
    : [];
  return {
    state: source.state as RdapNameserverSearchState,
    nameserver,
    registryScope: scope,
    observedAt,
    endpoint,
    resultCount: domains.length,
    domains,
    truncated: source.truncated === true || source.domains.length > domains.length,
    omittedInvalid: Number.isSafeInteger(source.omittedInvalid)
      && (source.omittedInvalid as number) >= 0
      && (source.omittedInvalid as number) <= 10_000
      ? source.omittedInvalid as number
      : 0,
    limitations,
  };
}
