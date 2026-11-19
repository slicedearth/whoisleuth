// Groups an admitted HAR request sequence by registrable domain and origin, so
// an analyst can see which hosts a recorded page contacted and which received a
// POST, PUT, PATCH or DELETE request. It derives everything from the retained
// request records (origin, method, status and type); queries, headers, bodies
// and initiators are never available here. A method alone does not show that
// anything was sent or changed, and a shared registrable domain does not show
// common ownership, so the summary reports only what the records contain.

import { canonicalRegistrableDomain } from '../analysis/registrable-domain.mts';
import type { HarEntry } from '../contracts/har-review.mts';

export const MAX_HAR_HOST_GROUPS = 50;
export const MAX_HAR_HOST_ORIGINS = 10;

/** Methods that can change server state; the HAR records the method, not the effect. */
export const HAR_WRITE_METHODS: ReadonlySet<HarEntry['method']> = new Set<HarEntry['method']>(['POST', 'PUT', 'PATCH', 'DELETE']);

export type HarHostOrigin = Readonly<{
  origin: string;
  requests: number;
  writeMethods: number;
  failures: number;
  resourceTypes: readonly HarEntry['resourceType'][];
}>;

export type HarHostGroup = Readonly<{
  /** Registrable domain, or the host itself for IP literals and other non-domain hosts. */
  label: string;
  registrableDomain: string | null;
  /** Same registrable domain as the recorded page; null when either side has no known registrable domain. */
  samePageDomain: boolean | null;
  requests: number;
  writeMethods: number;
  failures: number;
  origins: readonly HarHostOrigin[];
  omittedOrigins: number;
}>;

export type HarHostSummary = Readonly<{
  pageOrigin: string | null;
  pageDomain: string | null;
  /**
   * Which recorded evidence identified the page: a document request, or an
   * inference from an HTML response whose request type was not recorded.
   */
  pageEvidence: 'document' | 'inferred_html_response' | null;
  groups: readonly HarHostGroup[];
  /** POST, PUT, PATCH and DELETE requests to registrable domains other than the page's. */
  otherDomainWriteMethods: number;
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

/**
 * The page is the earliest document request. Without one, it is inferred from
 * the earliest HTML response whose request type was not recorded; a response
 * recorded as a fetch, XHR or other subresource never identifies the page.
 * Without either, the page stays unknown rather than assumed from another request.
 */
function pageEntry(entries: readonly HarEntry[]): Readonly<{ entry: HarEntry; evidence: 'document' | 'inferred_html_response' }> | null {
  const withOrigin = entries.filter((entry) => entry.origin !== null);
  const document = withOrigin.find((entry) => entry.resourceType === 'document');
  if (document) return { entry: document, evidence: 'document' };
  const html = withOrigin.find((entry) => entry.mimeCategory === 'html' && entry.resourceType === 'unknown');
  return html ? { entry: html, evidence: 'inferred_html_response' } : null;
}

export function summariseHarHosts(entries: readonly HarEntry[]): HarHostSummary {
  const ordered = [...entries].sort((left, right) => left.sequence - right.sequence);
  const page = pageEntry(ordered);
  const pageOrigin = page?.entry.origin ?? null;
  const pageHost = pageOrigin === null ? null : hostOf(pageOrigin);
  const pageDomain = pageHost === null ? null : canonicalRegistrableDomain(pageHost);
  const groups = new Map<string, { registrableDomain: string | null; origins: Map<string, { requests: number; writeMethods: number; failures: number; types: Set<HarEntry['resourceType']> }> }>();
  let requestsWithoutOrigin = 0;

  for (const entry of ordered) {
    const host = entry.origin === null ? null : hostOf(entry.origin);
    if (entry.origin === null || host === null) { requestsWithoutOrigin += 1; continue; }
    const registrableDomain = canonicalRegistrableDomain(host);
    const key = registrableDomain ?? host;
    const group = groups.get(key) ?? { registrableDomain, origins: new Map() };
    groups.set(key, group);
    const origin = group.origins.get(entry.origin) ?? { requests: 0, writeMethods: 0, failures: 0, types: new Set() };
    group.origins.set(entry.origin, origin);
    origin.requests += 1;
    if (HAR_WRITE_METHODS.has(entry.method)) origin.writeMethods += 1;
    if (entry.reportedFailure || (entry.status !== null && entry.status >= 400)) origin.failures += 1;
    origin.types.add(entry.resourceType);
  }

  const summarised = [...groups].map(([label, group]): HarHostGroup => {
    const origins = [...group.origins].map(([origin, item]) => Object.freeze({
      origin, requests: item.requests, writeMethods: item.writeMethods, failures: item.failures,
      resourceTypes: Object.freeze([...item.types].sort()),
    })).sort((left, right) => right.requests - left.requests || left.origin.localeCompare(right.origin));
    const total = (field: 'requests' | 'writeMethods' | 'failures') => origins.reduce((sum, item) => sum + item[field], 0);
    return Object.freeze({
      label,
      registrableDomain: group.registrableDomain,
      samePageDomain: pageDomain === null || group.registrableDomain === null ? null : group.registrableDomain === pageDomain,
      requests: total('requests'), writeMethods: total('writeMethods'), failures: total('failures'),
      origins: Object.freeze(origins.slice(0, MAX_HAR_HOST_ORIGINS)),
      omittedOrigins: Math.max(0, origins.length - MAX_HAR_HOST_ORIGINS),
    });
  }).sort((left, right) => Number(right.samePageDomain === true) - Number(left.samePageDomain === true)
    || right.requests - left.requests || left.label.localeCompare(right.label));

  return Object.freeze({
    pageOrigin,
    pageDomain,
    pageEvidence: page?.evidence ?? null,
    groups: Object.freeze(summarised.slice(0, MAX_HAR_HOST_GROUPS)),
    otherDomainWriteMethods: summarised.reduce((sum, group) => sum + (group.samePageDomain === false ? group.writeMethods : 0), 0),
    requestsWithoutOrigin,
    omittedGroups: Math.max(0, summarised.length - MAX_HAR_HOST_GROUPS),
  });
}

/** Browser intake and the CLI describe each host group with these labels. */
export function harHostDomainLabel(group: Pick<HarHostGroup, 'samePageDomain' | 'registrableDomain'>): string {
  if (group.registrableDomain === null) return 'No registrable domain';
  return group.samePageDomain === null ? 'Page domain unknown' : group.samePageDomain ? 'Page domain' : 'Other domain';
}

/** Where the page came from, or why hosts are not compared with its domain. */
export function harHostPageNote(summary: Pick<HarHostSummary, 'pageOrigin' | 'pageDomain' | 'pageEvidence'>): string {
  const source = summary.pageEvidence === 'document'
    ? 'from the first recorded document request'
    : 'inferred from the first HTML response whose request type was not recorded';
  if (summary.pageDomain) return `Page domain ${summary.pageDomain}, ${source}.`;
  if (summary.pageOrigin) return `Page origin ${summary.pageOrigin}, ${source}, has no registrable domain, so hosts are not compared by domain.`;
  return 'No document request identifies the page, so hosts are not compared with a page domain.';
}

export function harHostWriteMethodNote(summary: Pick<HarHostSummary, 'otherDomainWriteMethods'>): string | null {
  const count = summary.otherDomainWriteMethods;
  return count
    ? `${count} POST, PUT, PATCH or DELETE request${count === 1 ? '' : 's'} went to other registrable domains. The method alone does not show what was sent or changed.`
    : null;
}
