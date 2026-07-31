// Bounded delegation-health evidence for deep single-domain Lookup. Registry
// publication, recursive parent-view answers, and direct nameserver queries
// remain separately attributed. The result never participates in registration
// availability and never treats a failed query as record absence.

import { promises as dns } from 'node:dns';
import * as net from 'node:net';

import { createObservation } from './observation.mts';
import { isPrivateAddress } from './safe-fetch.mts';

type UnknownRecord = Record<string, unknown>;
type QueryState = 'success' | 'not_found' | 'error';
type ParentNameserverQuery = {
  status: QueryState;
  records: unknown[];
  error: string | null;
  truncated: boolean;
  discarded: number;
};
type AuthorityQueryResult = {
  nameservers: unknown[];
  soaPrimary: unknown;
  errorCode: unknown;
  error: unknown;
};
type AuthorityQuery = (input: {
  domain: string;
  nameserver: string;
  address: string;
  timeoutMs: number;
}) => Promise<AuthorityQueryResult>;
type DnsDelegationHealthOptions = {
  registryEvidence?: unknown;
  resolve4?: (hostname: string) => Promise<unknown>;
  resolve6?: (hostname: string) => Promise<unknown>;
  queryAuthority?: AuthorityQuery;
  timeoutMs?: number;
  now?: () => number;
  observedAt?: () => string;
};

const DNS_DELEGATION_HEALTH_VERSION = 1;
const MAX_AUTHORITIES = 4;
const MAX_AUTHORITY_ADDRESSES = 2;
const MAX_NAMESERVERS = 16;
const MAX_ERROR_LENGTH = 180;
const DNS_DELEGATION_TIMEOUT_MS = 2200;
const LAME_CODES = new Set(['ENOTAUTH', 'EREFUSED']);

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  return value.replace(/\s+/gu, ' ').trim() || null;
}

function hostname(value: unknown): string | null {
  const normalized = boundedText(value, 253)?.toLowerCase().replace(/\.+$/u, '') ?? '';
  if (!normalized || !normalized.includes('.')) return null;
  return normalized.split('.').every((label) => (
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(label)
  )) ? normalized : null;
}

function hostnames(value: unknown, maximum = MAX_NAMESERVERS): string[] {
  const output = new Set<string>();
  for (const item of Array.isArray(value) ? value.slice(0, maximum * 2) : []) {
    const normalized = hostname(item);
    if (normalized) output.add(normalized);
    if (output.size >= maximum) break;
  }
  return [...output].sort();
}

function publicAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80 || /[\u0000-\u0020\u007f%]/u.test(value)) return null;
  const normalized = value.toLowerCase();
  return net.isIP(normalized) && !isPrivateAddress(normalized) ? normalized : null;
}

function errorCode(error: unknown): string {
  const value = record(error).code;
  return typeof value === 'string' ? value.slice(0, 40) : '';
}

function errorDetail(error: unknown): string {
  return String(error instanceof Error ? error.message : error || 'DNS query failed')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_ERROR_LENGTH) || 'DNS query failed';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('DNS query timed out'), { code: 'ETIMEOUT' })), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function defaultAuthorityQuery(input: {
  domain: string;
  address: string;
  timeoutMs: number;
}): Promise<AuthorityQueryResult> {
  const resolver = new dns.Resolver({
    timeout: Math.max(250, Math.min(input.timeoutMs, DNS_DELEGATION_TIMEOUT_MS)),
    tries: 1,
  });
  resolver.setServers([net.isIP(input.address) === 6 ? `[${input.address}]:53` : input.address]);
  const [nameservers, soa] = await Promise.allSettled([
    resolver.resolveNs(input.domain),
    resolver.resolveSoa(input.domain),
  ]);
  const reason = nameservers.status === 'rejected'
    ? nameservers.reason
    : soa.status === 'rejected'
      ? soa.reason
      : null;
  if (reason !== null) {
    return {
      nameservers: nameservers.status === 'fulfilled' ? nameservers.value : [],
      soaPrimary: soa.status === 'fulfilled' ? soa.value.nsname : null,
      errorCode: errorCode(reason),
      error: errorDetail(reason),
    };
  }
  return {
    nameservers: nameservers.status === 'fulfilled' ? nameservers.value : [],
    soaPrimary: soa.status === 'fulfilled' ? soa.value.nsname : null,
    errorCode: null,
    error: null,
  };
}

function registryProjection(value: unknown) {
  const registry = record(value);
  const nameserverDetails = (Array.isArray(registry.nameserverDetails)
    ? registry.nameserverDetails
    : [])
    .slice(0, MAX_NAMESERVERS)
    .map((item) => {
      const detail = record(item);
      const name = hostname(detail.name);
      if (!name) return null;
      const addresses = [...new Set((Array.isArray(detail.addresses) ? detail.addresses : [])
        .map(publicAddress)
        .filter((address): address is string => address !== null))]
        .slice(0, MAX_AUTHORITY_ADDRESSES);
      return { name, addresses };
    })
    .filter((item): item is { name: string; addresses: string[] } => item !== null);
  return {
    nameservers: hostnames(registry.nameservers),
    nameserverDetails,
    delegationSigned: typeof registry.delegationSigned === 'boolean'
      ? registry.delegationSigned
      : null,
    dsRecordCount: Array.isArray(registry.dsData) ? Math.min(registry.dsData.length, 50) : 0,
    truncated: registry.nameserversTruncated === true
      || registry.nameserverAddressesTruncated === true
      || registry.dsDataTruncated === true,
  };
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function finding(
  id: string,
  label: string,
  state: 'healthy' | 'warning' | 'danger' | 'unknown',
  summary: string,
  detail: string,
  remediation: string,
) {
  return { id, label, state, summary, detail, remediation };
}

function skippedDnsDelegationHealth(detail = 'Authoritative delegation checks were not collected for this lookup.') {
  return {
    delegationHealthVersion: DNS_DELEGATION_HEALTH_VERSION,
    ...createObservation({
      status: 'skipped',
      scanMode: 'deep',
      source: 'dns_delegation',
      complete: false,
      limitations: [
        detail,
        'A skipped delegation check is not evidence that the delegation is healthy or unhealthy.',
      ],
      diagnostics: { authorityCount: 0, queriedAddressCount: 0 },
    }),
    detail,
    parent: { state: 'not_collected', nameservers: [], error: null },
    registry: {
      nameservers: [],
      nameserverDetails: [],
      delegationSigned: null,
      dsRecordCount: 0,
      truncated: false,
    },
    authorities: [],
    findings: [],
  };
}

async function collectDnsDelegationHealth(
  domainValue: string,
  parentQueryValue: ParentNameserverQuery,
  options: DnsDelegationHealthOptions = {},
) {
  const domain = hostname(domainValue);
  if (!domain) return skippedDnsDelegationHealth('The domain was not eligible for authoritative delegation checks.');
  const registry = registryProjection(options.registryEvidence);
  const parentQuery = record(parentQueryValue);
  const parentStatus = parentQuery.status === 'success' || parentQuery.status === 'not_found'
    ? parentQuery.status
    : 'error';
  const parentNameservers = hostnames(parentQuery.records);
  const candidates = [...new Set([...parentNameservers, ...registry.nameservers])]
    .sort()
    .slice(0, MAX_AUTHORITIES);
  const resolve4 = options.resolve4 || dns.resolve4;
  const resolve6 = options.resolve6 || dns.resolve6;
  const queryAuthority = options.queryAuthority || defaultAuthorityQuery;
  const timeoutMs = Math.max(250, Math.min(5000, Number(options.timeoutMs) || DNS_DELEGATION_TIMEOUT_MS));
  const now = options.now || Date.now;
  const started = now();

  const authorities = await Promise.all(candidates.map(async (nameserver) => {
    const glue = registry.nameserverDetails.find((item) => item.name === nameserver)?.addresses ?? [];
    const resolved = glue.length
      ? glue
      : (await Promise.allSettled([
          withTimeout(Promise.resolve(resolve4(nameserver)), timeoutMs),
          withTimeout(Promise.resolve(resolve6(nameserver)), timeoutMs),
        ])).flatMap((result) => result.status === 'fulfilled' && Array.isArray(result.value)
          ? result.value
          : [])
          .map(publicAddress)
          .filter((address): address is string => address !== null);
    const addresses = [...new Set(resolved)].slice(0, MAX_AUTHORITY_ADDRESSES);
    const attempts = await Promise.all(addresses.map(async (address) => {
      try {
        const raw = await withTimeout(
          queryAuthority({ domain, nameserver, address, timeoutMs }),
          timeoutMs,
        );
        const query = record(raw);
        const code = boundedText(query.errorCode, 40);
        const error = boundedText(query.error, MAX_ERROR_LENGTH);
        const nameservers = hostnames(query.nameservers);
        const soaPrimary = hostname(query.soaPrimary);
        const hasAnswer = nameservers.length > 0 || soaPrimary !== null;
        const state = error && hasAnswer
          ? 'partial' as const
          : code && LAME_CODES.has(code)
            ? 'lame' as const
            : error || !hasAnswer
              ? 'unreachable' as const
              : 'success' as const;
        return { address, state, nameservers, soaPrimary, errorCode: code, error };
      } catch (error) {
        const code = errorCode(error);
        return {
          address,
          state: LAME_CODES.has(code) ? 'lame' as const : 'unreachable' as const,
          nameservers: [],
          soaPrimary: null,
          errorCode: code || null,
          error: errorDetail(error),
        };
      }
    }));
    const successful = attempts.find((attempt) => attempt.state === 'success');
    const partial = attempts.find((attempt) => attempt.state === 'partial');
    const retained = successful ?? partial;
    return {
      nameserver,
      addressSource: glue.length ? 'registry_glue' as const : 'recursive_address' as const,
      addresses,
      state: successful
        ? 'success' as const
        : partial
          ? 'partial' as const
          : attempts.some((attempt) => attempt.state === 'lame')
            ? 'lame' as const
            : 'unreachable' as const,
      nameservers: retained?.nameservers ?? [],
      soaPrimary: retained?.soaPrimary ?? null,
      attempts,
    };
  }));

  const successfulAuthorities = authorities.filter((authority) => authority.state === 'success');
  const partialAuthorities = authorities.filter((authority) => authority.state === 'partial');
  const lameAuthorities = authorities.filter((authority) => authority.state === 'lame');
  const unreachableAuthorities = authorities.filter((authority) => authority.state === 'unreachable');
  const authoritySets = successfulAuthorities.map((authority) => authority.nameservers);
  const inconsistentAuthoritySets = authoritySets.some((set) => (
    !sameSet(set, authoritySets[0] ?? [])
    || (parentNameservers.length > 0 && !sameSet(set, parentNameservers))
  ));
  const inBailiwick = candidates.filter((nameserver) => (
    nameserver === domain || nameserver.endsWith(`.${domain}`)
  ));
  const missingGlue = inBailiwick.filter((nameserver) => (
    !(registry.nameserverDetails.find((item) => item.name === nameserver)?.addresses.length)
  ));
  const dnssecMismatch = (
    registry.delegationSigned === true && registry.dsRecordCount === 0
  ) || (
    registry.delegationSigned === false && registry.dsRecordCount > 0
  );

  const findings = [
    finding(
      'parent_registry_ns',
      'Parent and registry nameservers',
      !parentNameservers.length || !registry.nameservers.length
        ? 'unknown'
        : sameSet(parentNameservers, registry.nameservers) ? 'healthy' : 'warning',
      !parentNameservers.length || !registry.nameservers.length
        ? 'Comparison is incomplete'
        : sameSet(parentNameservers, registry.nameservers)
          ? 'Parent view and registry publication agree'
          : 'Parent view and registry publication differ',
      `Parent view: ${parentNameservers.join(', ') || 'unavailable'}. Registry publication: ${registry.nameservers.join(', ') || 'unavailable'}.`,
      'Confirm the intended delegation with the registry and DNS operator before changing nameservers.',
    ),
    finding(
      'authority_reachability',
      'Direct nameserver reachability',
      lameAuthorities.length ? 'danger'
        : partialAuthorities.length || unreachableAuthorities.length ? 'warning'
          : successfulAuthorities.length ? 'healthy' : 'unknown',
      lameAuthorities.length
        ? `${lameAuthorities.length} nameserver${lameAuthorities.length === 1 ? '' : 's'} refused or was not authoritative`
        : partialAuthorities.length
          ? `${partialAuthorities.length} nameserver${partialAuthorities.length === 1 ? '' : 's'} returned only part of the direct NS and SOA evidence`
          : unreachableAuthorities.length
          ? `${unreachableAuthorities.length} nameserver${unreachableAuthorities.length === 1 ? '' : 's'} could not be confirmed`
          : successfulAuthorities.length
            ? 'Selected nameservers answered direct NS and SOA queries'
            : 'No eligible public nameserver address was available',
      `Successful: ${successfulAuthorities.length}. Partial: ${partialAuthorities.length}. Lame or refused: ${lameAuthorities.length}. Unreachable or unresolved: ${unreachableAuthorities.length}.`,
      'Restore authoritative service on every delegated nameserver and verify public address reachability before relying on the delegation.',
    ),
    finding(
      'authority_ns_consistency',
      'Authoritative nameserver agreement',
      !successfulAuthorities.length ? 'unknown'
        : inconsistentAuthoritySets ? 'warning' : 'healthy',
      !successfulAuthorities.length
        ? 'No direct authority answer was available'
        : inconsistentAuthoritySets
          ? 'Direct nameserver answers are inconsistent'
          : 'Direct nameserver answers agree with the observed parent view',
      successfulAuthorities.map((authority) => `${authority.nameserver}: ${authority.nameservers.join(', ') || 'no NS answer'}`).join(' | ') || 'No direct answers.',
      'Align the NS set served by every authority with the intended parent delegation before cutover.',
    ),
    finding(
      'in_bailiwick_glue',
      'In-bailiwick glue',
      !inBailiwick.length ? 'healthy' : missingGlue.length ? 'warning' : 'healthy',
      !inBailiwick.length
        ? 'No in-bailiwick nameserver requires registry glue'
        : missingGlue.length
          ? 'Registry glue was not observed for every in-bailiwick nameserver'
          : 'Registry publication includes observed glue for each in-bailiwick nameserver',
      missingGlue.length ? `Missing observed glue: ${missingGlue.join(', ')}.` : `In-bailiwick nameservers: ${inBailiwick.join(', ') || 'none'}.`,
      'Publish current A and AAAA glue at the registry for every in-bailiwick nameserver.',
    ),
    finding(
      'dnssec_delegation',
      'DNSSEC delegation publication',
      dnssecMismatch ? 'warning'
        : registry.delegationSigned === null && registry.dsRecordCount === 0 ? 'unknown' : 'healthy',
      dnssecMismatch
        ? 'Registry DNSSEC fields are internally inconsistent'
        : registry.delegationSigned === null && registry.dsRecordCount === 0
          ? 'Registry DNSSEC publication was unavailable'
          : registry.delegationSigned
            ? `${registry.dsRecordCount} registry DS record${registry.dsRecordCount === 1 ? '' : 's'} observed`
            : 'Registry publication marks the delegation unsigned',
      `delegationSigned: ${registry.delegationSigned === null ? 'unavailable' : registry.delegationSigned}. DS records: ${registry.dsRecordCount}.`,
      'Confirm the registry DS set matches the intended zone-signing keys before enabling, rotating, or removing DNSSEC.',
    ),
  ];
  const collectionIncomplete = parentStatus === 'error'
    || parentQuery.truncated === true
    || registry.truncated
    || authorities.some((authority) => authority.state !== 'success');
  const status = !candidates.length && parentStatus === 'error'
    ? 'error'
    : collectionIncomplete ? 'partial' : 'success';
  const observedAt = (options.observedAt || (() => new Date().toISOString()))();
  return {
    delegationHealthVersion: DNS_DELEGATION_HEALTH_VERSION,
    ...createObservation({
      status,
      observedAt,
      scanMode: 'deep',
      source: 'dns_delegation',
      durationMs: Math.max(0, now() - started),
      complete: !collectionIncomplete,
      truncated: parentQuery.truncated === true || registry.truncated,
      limitations: [
        'The parent nameserver set is a point-in-time recursive resolver view; registry nameservers and glue come from the separately attributed RDAP publication.',
        'Direct queries use at most four selected nameservers and two validated public addresses per nameserver.',
        'A direct answer does not prove global reachability, and a failed query is not evidence that the record is absent.',
        'DNS health does not decide registration availability, ownership, control, intent, safety, or maliciousness.',
        'The DNSSEC check compares bounded registry publication fields; it does not validate the full cryptographic chain.',
      ],
      diagnostics: {
        authorityCount: authorities.length,
        queriedAddressCount: authorities.reduce((sum, authority) => sum + authority.attempts.length, 0),
        successfulAuthorityCount: successfulAuthorities.length,
        partialAuthorityCount: partialAuthorities.length,
        lameAuthorityCount: lameAuthorities.length,
        unreachableAuthorityCount: unreachableAuthorities.length,
      },
    }),
    detail: status === 'success'
      ? 'The bounded delegation-health collection completed.'
      : status === 'partial'
        ? 'The delegation-health collection is partial; review each source state before changing DNS.'
        : 'The delegation-health collection could not confirm a parent or direct authority view.',
    parent: {
      state: parentStatus,
      nameservers: parentNameservers,
      error: parentStatus === 'error' ? boundedText(parentQuery.error, MAX_ERROR_LENGTH) : null,
    },
    registry,
    authorities,
    findings,
  };
}

export {
  DNS_DELEGATION_HEALTH_VERSION,
  DNS_DELEGATION_TIMEOUT_MS,
  MAX_AUTHORITIES,
  MAX_AUTHORITY_ADDRESSES,
  collectDnsDelegationHealth,
  skippedDnsDelegationHealth,
};

export type {
  AuthorityQuery,
  AuthorityQueryResult,
  DnsDelegationHealthOptions,
  ParentNameserverQuery,
};
