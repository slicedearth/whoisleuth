import { normalizeEvidenceDomain } from './case-model.ts';
import {
  MAX_RDAP_NAMESERVER_SEARCH_RESULTS,
  RDAP_NAMESERVER_SEARCH_SCHEMA,
  RDAP_NAMESERVER_SEARCH_VERSION,
  type RdapNameserverSearchState,
} from '../../../../packages/contracts/rdap-nameserver-search.mts';

export {
  MAX_RDAP_NAMESERVER_SEARCH_RESULTS,
  RDAP_NAMESERVER_SEARCH_SCHEMA,
  RDAP_NAMESERVER_SEARCH_VERSION,
};

const states = new Set([
  'success',
  'partial',
  'no_results',
  'unsupported',
  'rate_limited',
  'unavailable',
] as const);

export type { RdapNameserverSearchState };

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
  const normalized = normalizeEvidenceDomain(value);
  return normalized || null;
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
  const statusInput = Array.isArray(item.statuses) ? item.statuses : [];
  const statuses = statusInput.slice(0, 12)
    .map((entry) => bounded(entry, 160))
    .filter((entry): entry is string => entry !== null);
  const statusesPartial = !Array.isArray(item.statuses)
    || item.statuses.length > 12
    || statuses.length < Math.min(statusInput.length, 12);
  return {
    domain,
    unicodeDomain: bounded(item.unicodeDomain, 253),
    statuses,
    nameserverObserved: typeof item.nameserverObserved === 'boolean'
      ? item.nameserverObserved
      : null,
    partial: typeof item.partial !== 'boolean' || item.partial || statusesPartial,
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
  let locallyOmittedInvalid = 0;
  for (const raw of source.domains.slice(0, MAX_RDAP_NAMESERVER_SEARCH_RESULTS)) {
    const match = domainMatch(raw, scope);
    if (!match) {
      locallyOmittedInvalid += 1;
      continue;
    }
    if (seen.has(match.domain)) {
      locallyOmittedInvalid += 1;
      continue;
    }
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
  const omittedInvalidKnown = Number.isSafeInteger(source.omittedInvalid)
    && (source.omittedInvalid as number) >= 0
    && (source.omittedInvalid as number) <= 10_000;
  const upstreamOmittedInvalid = omittedInvalidKnown
    ? source.omittedInvalid as number
    : 0;
  const truncatedKnown = typeof source.truncated === 'boolean';
  const sourceState = source.state as RdapNameserverSearchState;
  const positiveState = sourceState === 'success' || sourceState === 'partial';
  const incomplete = sourceState === 'partial'
    || !truncatedKnown
    || !omittedInvalidKnown
    || source.truncated === true
    || source.domains.length > MAX_RDAP_NAMESERVER_SEARCH_RESULTS
    || upstreamOmittedInvalid > 0
    || locallyOmittedInvalid > 0
    || domains.some((domain) => domain.partial);
  if ((!positiveState && (source.domains.length !== 0 || incomplete))
    || (sourceState === 'success' && domains.length === 0)) return null;
  return {
    state: sourceState === 'success' && incomplete ? 'partial' : sourceState,
    nameserver,
    registryScope: scope,
    observedAt,
    endpoint,
    resultCount: domains.length,
    domains,
    truncated: incomplete,
    omittedInvalid: Math.min(10_000, upstreamOmittedInvalid + locallyOmittedInvalid),
    limitations,
  };
}
