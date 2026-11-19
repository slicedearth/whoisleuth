// Groups an admitted HAR request sequence by registrable domain and origin, so
// an analyst can see which hosts a recorded page contacted and which received
// a state-changing request. It derives everything from the retained request
// records (origin, method, status and type); queries, headers, bodies and
// initiators are never available here.

import { canonicalRegistrableDomain } from '../analysis/registrable-domain.mts';
import type { HarEntry } from '../contracts/har-review.mts';

export const MAX_HAR_HOST_GROUPS = 50;
export const MAX_HAR_HOST_ORIGINS = 10;

const WRITE_METHODS = new Set<HarEntry['method']>(['POST', 'PUT', 'PATCH', 'DELETE']);

export type HarHostOrigin = Readonly<{
  origin: string;
  requests: number;
  writes: number;
  failures: number;
  resourceTypes: readonly HarEntry['resourceType'][];
}>;

export type HarHostGroup = Readonly<{
  /** Registrable domain, or the host itself for IP literals and other non-domain hosts. */
  label: string;
  registrableDomain: string | null;
  /** Same registrable domain as the recorded page; null when the page domain is unknown. */
  firstParty: boolean | null;
  requests: number;
  writes: number;
  failures: number;
  origins: readonly HarHostOrigin[];
  omittedOrigins: number;
}>;

export type HarHostSummary = Readonly<{
  pageOrigin: string | null;
  pageDomain: string | null;
  groups: readonly HarHostGroup[];
  thirdPartyWrites: number;
  requestsWithoutOrigin: number;
  omittedGroups: number;
}>;

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).hostname.replace(/^\[|\]$/gu, '');
  } catch {
    return null;
  }
}

/** The page is the earliest document request, then the earliest HTML response, then the first request. */
function pageEntry(entries: readonly HarEntry[]): HarEntry | undefined {
  const withOrigin = entries.filter((entry) => entry.origin !== null);
  return withOrigin.find((entry) => entry.resourceType === 'document')
    ?? withOrigin.find((entry) => entry.mimeCategory === 'html')
    ?? withOrigin[0];
}

export function summariseHarHosts(entries: readonly HarEntry[]): HarHostSummary {
  const ordered = [...entries].sort((left, right) => left.sequence - right.sequence);
  const pageOrigin = pageEntry(ordered)?.origin ?? null;
  const pageHost = pageOrigin === null ? null : hostOf(pageOrigin);
  const pageDomain = pageHost === null ? null : canonicalRegistrableDomain(pageHost);
  const groups = new Map<string, { registrableDomain: string | null; origins: Map<string, { requests: number; writes: number; failures: number; types: Set<HarEntry['resourceType']> }> }>();
  let requestsWithoutOrigin = 0;

  for (const entry of ordered) {
    const host = entry.origin === null ? null : hostOf(entry.origin);
    if (entry.origin === null || host === null) { requestsWithoutOrigin += 1; continue; }
    const registrableDomain = canonicalRegistrableDomain(host);
    const key = registrableDomain ?? host;
    const group = groups.get(key) ?? { registrableDomain, origins: new Map() };
    groups.set(key, group);
    const origin = group.origins.get(entry.origin) ?? { requests: 0, writes: 0, failures: 0, types: new Set() };
    group.origins.set(entry.origin, origin);
    origin.requests += 1;
    if (WRITE_METHODS.has(entry.method)) origin.writes += 1;
    if (entry.reportedFailure || (entry.status !== null && entry.status >= 400)) origin.failures += 1;
    origin.types.add(entry.resourceType);
  }

  const summarised = [...groups].map(([label, group]): HarHostGroup => {
    const origins = [...group.origins].map(([origin, item]) => Object.freeze({
      origin, requests: item.requests, writes: item.writes, failures: item.failures,
      resourceTypes: Object.freeze([...item.types].sort()),
    })).sort((left, right) => right.requests - left.requests || left.origin.localeCompare(right.origin));
    const total = (field: 'requests' | 'writes' | 'failures') => origins.reduce((sum, item) => sum + item[field], 0);
    return Object.freeze({
      label,
      registrableDomain: group.registrableDomain,
      firstParty: pageDomain === null ? null : group.registrableDomain === pageDomain,
      requests: total('requests'), writes: total('writes'), failures: total('failures'),
      origins: Object.freeze(origins.slice(0, MAX_HAR_HOST_ORIGINS)),
      omittedOrigins: Math.max(0, origins.length - MAX_HAR_HOST_ORIGINS),
    });
  }).sort((left, right) => Number(right.firstParty === true) - Number(left.firstParty === true)
    || right.requests - left.requests || left.label.localeCompare(right.label));

  return Object.freeze({
    pageOrigin,
    pageDomain,
    groups: Object.freeze(summarised.slice(0, MAX_HAR_HOST_GROUPS)),
    thirdPartyWrites: summarised.reduce((sum, group) => sum + (group.firstParty === false ? group.writes : 0), 0),
    requestsWithoutOrigin,
    omittedGroups: Math.max(0, summarised.length - MAX_HAR_HOST_GROUPS),
  });
}
