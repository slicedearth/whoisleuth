// Deliberate, registry-scoped RFC 9082 nameserver search. This is not a
// global reverse-DNS or passive-DNS query: the selected IANA bootstrap service
// can return only the domains it serves, and registry result caps can make that
// already-scoped set incomplete.

import { domainToASCII } from 'node:url';

import { findRdapBases, uniqueRdapBases } from './rdap-bootstrap.mts';
import { cached } from './lookup-cache.mts';
import {
  parseRdap,
  summarizeRdapServerTruncation,
  summarizeRdapTextBlocks,
} from './rdap-normalization.mts';
import { rdapAttempt } from './rdap-attempts.mts';
import { fetchRdapWithTimeout, type RdapFetch } from './rdap-transport.mts';
import type {
  LooseRdapRecord,
  NormalizedRdapDomainRecord,
  NormalizedRdapTextBlock,
  RdapAttempt,
} from './rdap-types.mts';

export const RDAP_NAMESERVER_SEARCH_SCHEMA = 'whoisleuth.rdap-nameserver-search';
export const RDAP_NAMESERVER_SEARCH_VERSION = 1;
export const MAX_RDAP_NAMESERVER_SEARCH_RESULTS = 200;

const MAX_RDAP_SEARCH_ENDPOINTS = 3;
const MAX_RDAP_SEARCH_INSPECTED_RESULTS = MAX_RDAP_NAMESERVER_SEARCH_RESULTS * 4;
const RDAP_SEARCH_TIMEOUT_MS = 7_000;
const RDAP_SEARCH_TOTAL_DEADLINE_MS = 12_000;
const UNSUPPORTED_STATUSES = new Set([400, 405, 501]);

type SearchState =
  | 'success'
  | 'partial'
  | 'no_results'
  | 'unsupported'
  | 'rate_limited'
  | 'unavailable';

type NameserverSearchMatch = {
  domain: string;
  unicodeDomain: string | null;
  handle: string | null;
  statuses: string[];
  nameservers: string[];
  nameserverObserved: boolean | null;
  createdDate: string | null;
  expiryDate: string | null;
  updatedDate: string | null;
  partial: boolean;
};

type NormalizedSearchPayload = {
  domains: NameserverSearchMatch[];
  localTruncated: boolean;
  serverTruncated: boolean;
  serverTruncationReasons: string[];
  notices: NormalizedRdapTextBlock[];
  remarks: NormalizedRdapTextBlock[];
  metadataTruncated: boolean;
  omittedInvalid: number;
};

type NameserverSearchResult = {
  schema: typeof RDAP_NAMESERVER_SEARCH_SCHEMA;
  version: typeof RDAP_NAMESERVER_SEARCH_VERSION;
  state: SearchState;
  nameserver: string;
  registryScope: string;
  lowerBound: true;
  observedAt: string;
  source: {
    endpoint: string | null;
    transportSecurity: 'https' | 'http' | null;
    status: number | null;
    attempts: RdapAttempt[];
  };
  domains: NameserverSearchMatch[];
  resultCount: number;
  truncated: boolean;
  localTruncated: boolean;
  serverTruncated: boolean;
  serverTruncationReasons: string[];
  notices: NormalizedRdapTextBlock[];
  remarks: NormalizedRdapTextBlock[];
  omittedInvalid: number;
  limitations: string[];
};

type SearchOptions = {
  fetchUpstream?: RdapFetch;
  now?: () => number;
};

export class RdapNameserverSearchInputError extends Error {
  readonly code = 'INVALID_RDAP_NAMESERVER_SEARCH';
}

export function normalizeRdapNameserver(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1_024 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new RdapNameserverSearchInputError('Enter a valid nameserver hostname.');
  }
  const trimmed = value.trim().replace(/\.+$/u, '');
  const ascii = domainToASCII(trimmed).toLowerCase();
  if (!ascii
    || ascii.length > 253
    || !ascii.includes('.')
    || !ascii.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(label))) {
    throw new RdapNameserverSearchInputError('Enter a valid nameserver hostname.');
  }
  return ascii;
}

export function normalizeRdapRegistryScope(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new RdapNameserverSearchInputError('Enter one registry suffix, such as com.');
  }
  const trimmed = value.trim().toLowerCase().replace(/^\./u, '').replace(/\.$/u, '');
  const ascii = domainToASCII(trimmed).toLowerCase();
  if (!ascii
    || ascii.includes('.')
    || ascii.length > 63
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(ascii)) {
    throw new RdapNameserverSearchInputError('Enter one registry suffix, such as com.');
  }
  return ascii;
}

function canonicalDomain(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1_024) return null;
  const ascii = domainToASCII(value.trim().replace(/\.+$/u, '')).toLowerCase();
  if (!ascii || ascii.length > 253) return null;
  return ascii.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(label))
    ? ascii
    : null;
}

function domainWithinScope(domain: string, scope: string): boolean {
  return domain.endsWith(`.${scope}`);
}

function normalizeMatch(
  value: unknown,
  nameserver: string,
  registryScope: string,
): NameserverSearchMatch | null {
  const parsed = parseRdap('domain', value);
  if (!parsed) return null;
  const domain = canonicalDomain(parsed.domain);
  if (!domain || !domainWithinScope(domain, registryScope)) return null;
  const publishedNameservers = parsed.nameservers
    .map(canonicalDomain)
    .filter((entry): entry is string => entry !== null)
    .slice(0, 12);
  return {
    domain,
    unicodeDomain: typeof parsed.unicodeDomain === 'string'
      ? parsed.unicodeDomain.slice(0, 253)
      : null,
    handle: typeof parsed.handle === 'string' ? parsed.handle.slice(0, 300) : null,
    statuses: parsed.statuses.slice(0, 12),
    nameservers: publishedNameservers,
    nameserverObserved: publishedNameservers.length
      ? publishedNameservers.includes(nameserver)
      : null,
    createdDate: parsed.lifecycle.createdDateIso,
    expiryDate: parsed.lifecycle.expiryDateIso,
    updatedDate: parsed.lifecycle.updatedDateIso,
    partial: parsed.nameserversTruncated
      || parsed.statusesTruncated
      || parsed.eventsTruncated
      || parsed.serverTruncated,
  };
}

export function normalizeRdapNameserverSearchPayload(
  value: unknown,
  nameserver: string,
  registryScope: string,
): NormalizedSearchPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as LooseRdapRecord;
  if (record.objectClassName !== undefined
    && String(record.objectClassName).toLowerCase() !== 'domainsearchresults') return null;
  if (!Array.isArray(record.domainSearchResults)) return null;

  const source = record.domainSearchResults;
  const seen = new Set<string>();
  const domains: NameserverSearchMatch[] = [];
  let omittedInvalid = 0;
  let inspected = 0;
  for (const candidate of source.slice(0, MAX_RDAP_SEARCH_INSPECTED_RESULTS)) {
    inspected += 1;
    const match = normalizeMatch(candidate, nameserver, registryScope);
    if (!match || seen.has(match.domain)) {
      omittedInvalid += 1;
      continue;
    }
    seen.add(match.domain);
    domains.push(match);
    if (domains.length >= MAX_RDAP_NAMESERVER_SEARCH_RESULTS) break;
  }
  const notices = summarizeRdapTextBlocks(record.notices);
  const remarks = summarizeRdapTextBlocks(record.remarks);
  const serverTruncationReasons = summarizeRdapServerTruncation(record.notices, record.remarks);
  return {
    domains,
    localTruncated: inspected < source.length,
    serverTruncated: serverTruncationReasons.length > 0,
    serverTruncationReasons,
    notices: notices.items,
    remarks: remarks.items,
    metadataTruncated: notices.truncated || remarks.truncated,
    omittedInvalid,
  };
}

function limitations(scope: string): string[] {
  return [
    `Results cover only the .${scope} registry selected for this request; they are not an internet-wide reverse-nameserver inventory.`,
    'The returned set is a lower bound and may be capped, filtered, stale, incomplete, or unsupported by the registry.',
    'A shared nameserver is an infrastructure pivot, not proof of common ownership, control, intent, activity, or maliciousness.',
    'No result does not establish that the nameserver is unused outside the selected registry or absent from unreturned records.',
  ];
}

function result(
  state: SearchState,
  nameserver: string,
  registryScope: string,
  observedAt: string,
  source: NameserverSearchResult['source'],
  payload?: NormalizedSearchPayload,
): NameserverSearchResult {
  const domains = payload?.domains ?? [];
  const truncated = Boolean(payload
    && (payload.localTruncated
      || payload.serverTruncated
      || payload.metadataTruncated
      || payload.omittedInvalid > 0
      || payload.domains.some((domain) => domain.partial)));
  return {
    schema: RDAP_NAMESERVER_SEARCH_SCHEMA,
    version: RDAP_NAMESERVER_SEARCH_VERSION,
    state,
    nameserver,
    registryScope,
    lowerBound: true,
    observedAt,
    source,
    domains,
    resultCount: domains.length,
    truncated,
    localTruncated: payload?.localTruncated ?? false,
    serverTruncated: payload?.serverTruncated ?? false,
    serverTruncationReasons: payload?.serverTruncationReasons ?? [],
    notices: payload?.notices ?? [],
    remarks: payload?.remarks ?? [],
    omittedInvalid: payload?.omittedInvalid ?? 0,
    limitations: limitations(registryScope),
  };
}

export async function searchRdapNameserverFromBases(
  nameserver: string,
  registryScope: string,
  bases: unknown,
  options: SearchOptions = {},
): Promise<NameserverSearchResult> {
  const fetchUpstream = options.fetchUpstream ?? fetchRdapWithTimeout;
  const now = options.now ?? Date.now;
  const candidates = uniqueRdapBases(bases).slice(0, MAX_RDAP_SEARCH_ENDPOINTS);
  const startedAt = now();
  const attempts: RdapAttempt[] = [];
  for (const base of candidates) {
    const remaining = RDAP_SEARCH_TOTAL_DEADLINE_MS - (now() - startedAt);
    if (remaining <= 0) break;
    const endpoint = `${base.replace(/\/$/u, '')}/domains?nsLdhName=${encodeURIComponent(nameserver)}`;
    try {
      const upstream = await fetchUpstream(
        endpoint,
        { headers: { Accept: 'application/rdap+json' } },
        Math.min(RDAP_SEARCH_TIMEOUT_MS, remaining),
      );
      const observedAt = new Date(now()).toISOString();
      if (upstream.status === 404) {
        attempts.push(rdapAttempt(endpoint, 'no_results', {
          status: upstream.status,
          detail: `The .${registryScope} registry returned no matching domain search results.`,
          selected: true,
        }));
        return result('no_results', nameserver, registryScope, observedAt, {
          endpoint,
          transportSecurity: /^https:/iu.test(endpoint) ? 'https' : 'http',
          status: upstream.status,
          attempts,
        });
      }
      if (UNSUPPORTED_STATUSES.has(upstream.status)) {
        attempts.push(rdapAttempt(endpoint, 'unsupported', {
          status: upstream.status,
          detail: `The .${registryScope} registry did not accept RFC 9082 nameserver search.`,
        }));
        continue;
      }
      if (!upstream.ok) {
        attempts.push(rdapAttempt(endpoint, upstream.status === 429 ? 'rate_limited' : 'server_error', {
          status: upstream.status,
          detail: `The endpoint returned HTTP ${upstream.status}.`,
        }));
        continue;
      }
      let data: unknown;
      try {
        data = JSON.parse(upstream.text);
      } catch {
        attempts.push(rdapAttempt(endpoint, 'invalid_json', {
          status: upstream.status,
          detail: 'The endpoint returned invalid JSON.',
        }));
        continue;
      }
      const payload = normalizeRdapNameserverSearchPayload(data, nameserver, registryScope);
      if (!payload) {
        attempts.push(rdapAttempt(endpoint, 'invalid_response', {
          status: upstream.status,
          detail: 'The endpoint did not return a bounded RDAP domain-search result.',
        }));
        continue;
      }
      const incomplete = payload.localTruncated
        || payload.serverTruncated
        || payload.metadataTruncated
        || payload.omittedInvalid > 0
        || payload.domains.some((domain) => domain.partial);
      const state: SearchState = incomplete
        ? 'partial'
        : payload.domains.length === 0
          ? 'no_results'
          : 'success';
      attempts.push(rdapAttempt(endpoint, state, {
        status: upstream.status,
        detail: state === 'partial'
          ? 'The registry returned usable nameserver-search results with explicit limitations.'
          : `The registry returned ${payload.domains.length} bounded nameserver-search result(s).`,
        selected: true,
      }));
      return result(state, nameserver, registryScope, observedAt, {
        endpoint,
        transportSecurity: /^https:/iu.test(endpoint) ? 'https' : 'http',
        status: upstream.status,
        attempts,
      }, payload);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'request failed';
      attempts.push(rdapAttempt(endpoint, cause instanceof Error && cause.name === 'AbortError' ? 'timeout' : 'network_error', {
        detail: message.slice(0, 300),
      }));
    }
  }

  const observedAt = new Date(now()).toISOString();
  const unsupported = attempts.length > 0 && attempts.every((attempt) => attempt.outcome === 'unsupported');
  const rateLimited = !unsupported && attempts.some((attempt) => attempt.outcome === 'rate_limited');
  return result(unsupported ? 'unsupported' : rateLimited ? 'rate_limited' : 'unavailable', nameserver, registryScope, observedAt, {
    endpoint: null,
    transportSecurity: null,
    status: null,
    attempts,
  });
}

export async function searchRdapNameserver(
  nameserverInput: unknown,
  registryScopeInput: unknown,
): Promise<NameserverSearchResult> {
  const nameserver = normalizeRdapNameserver(nameserverInput);
  const registryScope = normalizeRdapRegistryScope(registryScopeInput);
  return cached(`rdap-nameserver-search:${registryScope}:${nameserver}`, async () => {
    const bases = await findRdapBases('domain', `scope.${registryScope}`);
    if (bases.length === 0) {
      return result('unavailable', nameserver, registryScope, new Date().toISOString(), {
        endpoint: null,
        transportSecurity: null,
        status: null,
        attempts: [],
      });
    }
    return searchRdapNameserverFromBases(nameserver, registryScope, bases);
  });
}

export type {
  NameserverSearchMatch,
  NameserverSearchResult,
  SearchState as RdapNameserverSearchState,
};
