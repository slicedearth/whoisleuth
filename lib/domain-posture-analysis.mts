// Bounded analysis for owned-domain posture evidence. Network access is
// injected so every traversal can be fixture-tested and the caller retains the
// existing DNS timeout and missing/error semantics.

import { parse as parseDomain } from 'tldts';

import { parseDmarcRecords, parseSpfRecords } from './domain-posture-parsers.mts';

type DnsQuery = {
  records: unknown[];
  error: string | null;
};

type SpfBranchState = 'cycle' | 'invalid' | 'limit' | 'not_found' | 'success' | 'unavailable';
type SpfBranch = {
  domain: string;
  parent: string | null;
  relation: 'include' | 'redirect' | 'root';
  depth: number;
  state: SpfBranchState;
  terminalPolicy: string | null;
  dnsLookupTerms: number;
  issues: string[];
};
type SpfExpansion = {
  version: 1;
  state: 'complete' | 'invalid' | 'partial' | 'unavailable';
  lookupLimit: number;
  lookupsUsed: number;
  voidLookupLimit: number;
  voidLookups: number;
  maxDepth: number;
  dnsLookupTerms: number;
  branches: SpfBranch[];
  issues: string[];
};

type DmarcAuthorizationState = 'authorized' | 'invalid_destination' | 'not_found' | 'self' | 'unavailable';
type DmarcExternalAuthorization = {
  destination: string;
  reportType: 'aggregate' | 'failure';
  recordName: string | null;
  state: DmarcAuthorizationState;
  error: string | null;
};

type DependencyKind = 'dmarc_reporting' | 'mail_exchange' | 'nameserver' | 'spf_include' | 'spf_redirect';
type ExternalDependency = {
  kind: DependencyKind;
  target: string;
  source: string;
  scope: 'external' | 'same_registrable_domain' | 'unknown';
  state: 'observed' | 'unavailable';
  limitation: string;
};

type SpfQueueItem = {
  domain: string;
  parent: string | null;
  relation: 'include' | 'redirect' | 'root';
  depth: number;
  path: string[];
  records?: unknown[];
  error?: string | null;
};

const SPF_LOOKUP_LIMIT = 10;
const SPF_VOID_LOOKUP_LIMIT = 2;
const SPF_MAX_DEPTH = 5;
const SPF_MAX_BRANCHES = 32;
const MAX_DMARC_DESTINATIONS = 10;
const MAX_DEPENDENCIES = 64;

function strictHostname(value: unknown): string | null {
  const raw = String(value || '').trim().toLowerCase().replace(/\.+$/u, '');
  if (!raw || raw.length > 253 || raw.includes('%')) return null;
  if (!raw.split('.').every((label) => /^(?:_?[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?)$/iu.test(label))) return null;
  return raw.includes('.') ? raw : null;
}

function branchFor(
  item: SpfQueueItem,
  state: SpfBranchState,
  terminalPolicy: string | null,
  dnsLookupTerms: number,
  issues: string[],
): SpfBranch {
  return {
    domain: item.domain,
    parent: item.parent,
    relation: item.relation,
    depth: item.depth,
    state,
    terminalPolicy,
    dnsLookupTerms,
    issues: issues.slice(0, 12),
  };
}

async function expandSpfPolicy(
  rootDomain: string,
  rootQuery: DnsQuery,
  resolveTxt: (domain: string) => Promise<DnsQuery>,
): Promise<SpfExpansion> {
  const queue: SpfQueueItem[] = [{
    domain: rootDomain,
    parent: null,
    relation: 'root',
    depth: 0,
    path: [rootDomain],
    records: rootQuery.records,
    error: rootQuery.error,
  }];
  const branches: SpfBranch[] = [];
  const issues: string[] = [];
  let lookupsUsed = 1;
  let voidLookups = 0;
  let dnsLookupTerms = 0;
  let boundReached = false;

  while (queue.length > 0 && branches.length < SPF_MAX_BRANCHES) {
    const item = queue.shift();
    if (!item) break;

    if (item.depth > SPF_MAX_DEPTH) {
      boundReached = true;
      branches.push(branchFor(item, 'limit', null, 0, [`Maximum SPF expansion depth ${SPF_MAX_DEPTH} was reached.`]));
      continue;
    }
    if (item.path.slice(0, -1).includes(item.domain)) {
      branches.push(branchFor(item, 'cycle', null, 0, ['The include or redirect chain contains a cycle.']));
      continue;
    }

    let query: DnsQuery;
    if (item.records !== undefined) {
      query = { records: item.records, error: item.error || null };
    } else if (lookupsUsed >= SPF_LOOKUP_LIMIT) {
      boundReached = true;
      branches.push(branchFor(item, 'limit', null, 0, [`Maximum SPF policy-query budget ${SPF_LOOKUP_LIMIT} was reached.`]));
      continue;
    } else {
      lookupsUsed += 1;
      query = await resolveTxt(item.domain);
    }

    if (query.error) {
      branches.push(branchFor(item, 'unavailable', null, 0, [query.error]));
      continue;
    }
    if (query.records.length === 0) {
      voidLookups += 1;
      branches.push(branchFor(item, 'not_found', null, 0, ['No SPF policy record was returned for this branch.']));
      if (voidLookups > SPF_VOID_LOOKUP_LIMIT) {
        boundReached = true;
        issues.push(`The SPF expansion exceeded the ${SPF_VOID_LOOKUP_LIMIT}-answer void-lookup budget.`);
      }
      continue;
    }

    const parsed = parseSpfRecords(query.records);
    dnsLookupTerms += parsed.dnsLookupTerms;
    branches.push(branchFor(
      item,
      parsed.valid ? 'success' : 'invalid',
      parsed.terminalPolicy,
      parsed.dnsLookupTerms,
      parsed.issues,
    ));
    if (!parsed.valid) continue;
    if (dnsLookupTerms > SPF_LOOKUP_LIMIT) {
      boundReached = true;
      issues.push(`The expanded policy declares more than ${SPF_LOOKUP_LIMIT} DNS-querying terms.`);
      continue;
    }
    if (voidLookups > SPF_VOID_LOOKUP_LIMIT) continue;

    const dependencies = [
      ...parsed.includes.map((domain) => ({ relation: 'include' as const, domain })),
      ...(parsed.redirect ? [{ relation: 'redirect' as const, domain: parsed.redirect }] : []),
    ];
    for (const dependency of dependencies) {
      const normalized = strictHostname(dependency.domain);
      if (!normalized) {
        branches.push(branchFor({
          domain: String(dependency.domain || '').slice(0, 253),
          parent: item.domain,
          relation: dependency.relation,
          depth: item.depth + 1,
          path: item.path,
        }, 'invalid', null, 0, ['The SPF dependency is not a literal public hostname; macros are not expanded by this audit.']));
        continue;
      }
      queue.push({
        domain: normalized,
        parent: item.domain,
        relation: dependency.relation,
        depth: item.depth + 1,
        path: [...item.path, normalized],
      });
    }
  }

  if (queue.length > 0 || branches.length >= SPF_MAX_BRANCHES) {
    boundReached = true;
    issues.push(`The SPF branch inventory was capped at ${SPF_MAX_BRANCHES} entries.`);
  }
  const root = branches[0];
  const incomplete = boundReached || branches.some((branch) => !['success'].includes(branch.state));
  const state = root?.state === 'unavailable'
    ? 'unavailable'
    : root?.state === 'invalid'
      ? 'invalid'
      : incomplete
        ? 'partial'
        : 'complete';
  return {
    version: 1,
    state,
    lookupLimit: SPF_LOOKUP_LIMIT,
    lookupsUsed,
    voidLookupLimit: SPF_VOID_LOOKUP_LIMIT,
    voidLookups,
    maxDepth: SPF_MAX_DEPTH,
    dnsLookupTerms,
    branches,
    issues: [...new Set(issues)].slice(0, 12),
  };
}

function reportDestinationDomain(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!/^mailto:/iu.test(raw)) return null;
  const address = raw.slice(7).split('!')[0] || '';
  const at = address.lastIndexOf('@');
  return at > 0 ? strictHostname(address.slice(at + 1)) : null;
}

async function validateDmarcExternalReporting(
  ownerDomain: string,
  dmarcQuery: DnsQuery,
  resolveTxt: (domain: string) => Promise<DnsQuery>,
): Promise<DmarcExternalAuthorization[]> {
  if (dmarcQuery.error) return [];
  const parsed = parseDmarcRecords(dmarcQuery.records);
  if (!parsed.valid) return [];
  const destinations = [
    ...parsed.aggregateDestinations.map((destination) => ({ destination, reportType: 'aggregate' as const })),
    ...parsed.failureDestinations.map((destination) => ({ destination, reportType: 'failure' as const })),
  ].slice(0, MAX_DMARC_DESTINATIONS);
  const results: DmarcExternalAuthorization[] = [];
  const cache = new Map<string, DnsQuery>();

  for (const item of destinations) {
    const destinationDomain = reportDestinationDomain(item.destination);
    if (!destinationDomain) {
      results.push({
        destination: item.destination.slice(0, 512),
        reportType: item.reportType,
        recordName: null,
        state: 'invalid_destination',
        error: null,
      });
      continue;
    }
    if (destinationDomain === ownerDomain || destinationDomain.endsWith(`.${ownerDomain}`)) {
      results.push({
        destination: destinationDomain,
        reportType: item.reportType,
        recordName: null,
        state: 'self',
        error: null,
      });
      continue;
    }
    const recordName = `${ownerDomain}._report._dmarc.${destinationDomain}`;
    let query = cache.get(recordName);
    if (!query) {
      query = await resolveTxt(recordName);
      cache.set(recordName, query);
    }
    const authorized = query.records.some((record) => (
      String(Array.isArray(record) ? record.join('') : record || '').trim().toUpperCase().startsWith('V=DMARC1')
    ));
    results.push({
      destination: destinationDomain,
      reportType: item.reportType,
      recordName,
      state: query.error ? 'unavailable' : authorized ? 'authorized' : 'not_found',
      error: query.error,
    });
  }
  return results;
}

function dependencyScope(ownerDomain: string, target: string): ExternalDependency['scope'] {
  const owner = parseDomain(ownerDomain).domain;
  const dependency = parseDomain(target).domain;
  if (!owner || !dependency) return 'unknown';
  return owner === dependency ? 'same_registrable_domain' : 'external';
}

function buildExternalDependencies({
  domain,
  nameservers,
  mx,
  spfExpansion,
  dmarcAuthorizations,
}: {
  domain: string;
  nameservers: DnsQuery;
  mx: DnsQuery;
  spfExpansion: SpfExpansion;
  dmarcAuthorizations: DmarcExternalAuthorization[];
}): ExternalDependency[] {
  const output: ExternalDependency[] = [];
  const seen = new Set<string>();
  const add = (kind: DependencyKind, targetValue: unknown, source: string, state: ExternalDependency['state']) => {
    const target = strictHostname(targetValue);
    if (!target) return;
    const key = `${kind}:${target}`;
    if (seen.has(key) || output.length >= MAX_DEPENDENCIES) return;
    seen.add(key);
    output.push({
      kind,
      target,
      source,
      scope: dependencyScope(domain, target),
      state,
      limitation: 'A shared or external dependency is an operational review lead, not evidence of common ownership, insecurity, exploitability, or availability.',
    });
  };

  for (const nameserver of nameservers.records) add('nameserver', nameserver, 'DNS NS', nameservers.error ? 'unavailable' : 'observed');
  for (const record of mx.records) {
    const exchange = record && typeof record === 'object' && !Array.isArray(record)
      ? (record as Record<string, unknown>).exchange
      : null;
    add('mail_exchange', exchange, 'DNS MX', mx.error ? 'unavailable' : 'observed');
  }
  for (const branch of spfExpansion.branches) {
    if (branch.relation === 'root') continue;
    add(
      branch.relation === 'include' ? 'spf_include' : 'spf_redirect',
      branch.domain,
      `SPF ${branch.relation}`,
      branch.state === 'success' ? 'observed' : 'unavailable',
    );
  }
  for (const authorization of dmarcAuthorizations) {
    add(
      'dmarc_reporting',
      authorization.destination,
      `DMARC ${authorization.reportType} reporting`,
      ['authorized', 'self'].includes(authorization.state) ? 'observed' : 'unavailable',
    );
  }
  return output;
}

export {
  SPF_LOOKUP_LIMIT,
  SPF_MAX_DEPTH,
  SPF_VOID_LOOKUP_LIMIT,
  buildExternalDependencies,
  expandSpfPolicy,
  reportDestinationDomain,
  validateDmarcExternalReporting,
};
export type {
  DmarcExternalAuthorization,
  DnsQuery,
  ExternalDependency,
  SpfExpansion,
};
