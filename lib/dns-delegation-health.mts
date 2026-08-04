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
  soa?: unknown;
  errorCode: unknown;
  error: unknown;
};
type AuthorityQuery = (input: {
  domain: string;
  nameserver: string;
  address: string;
  timeoutMs: number;
}) => Promise<AuthorityQueryResult>;
type AuthorityRecordType = 'A' | 'AAAA' | 'CAA' | 'MX';
type AuthorityRecordSet = {
  type: AuthorityRecordType;
  state: 'success' | 'not_found' | 'error';
  values: string[];
  error: string | null;
};
type AuthorityRecordQuery = (input: {
  domain: string;
  nameserver: string;
  address: string;
  timeoutMs: number;
}) => Promise<AuthorityRecordSet[]>;
type DnsDelegationHealthOptions = {
  registryEvidence?: unknown;
  resolve4?: (hostname: string) => Promise<unknown>;
  resolve6?: (hostname: string) => Promise<unknown>;
  queryAuthority?: AuthorityQuery;
  queryAuthorityRecords?: AuthorityRecordQuery;
  timeoutMs?: number;
  now?: () => number;
  observedAt?: () => string;
};

const DNS_DELEGATION_HEALTH_VERSION = 1;
const MAX_AUTHORITIES = 4;
const MAX_AUTHORITY_ADDRESSES = 2;
const MAX_NAMESERVERS = 16;
const MAX_ERROR_LENGTH = 180;
const MAX_AUTHORITY_RECORD_VALUES = 16;
const DNS_DELEGATION_TIMEOUT_MS = 2200;
const LAME_CODES = new Set(['ENOTAUTH', 'EREFUSED']);
const MAX_SOA_VALUE = 0xffff_ffff;

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

function observedAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80 || /[\u0000-\u0020\u007f%]/u.test(value)) return null;
  const normalised = value.toLowerCase();
  return net.isIP(normalised) ? normalised : null;
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

function soaProjection(value: unknown) {
  const source = record(value);
  const nsname = hostname(source.nsname);
  const hostmaster = hostname(source.hostmaster);
  const number = (field: unknown): number | null => (
    typeof field === 'number'
    && Number.isSafeInteger(field)
    && field >= 0
    && field <= MAX_SOA_VALUE
      ? field
      : null
  );
  const projection = {
    nsname,
    hostmaster,
    serial: number(source.serial),
    refresh: number(source.refresh),
    retry: number(source.retry),
    expire: number(source.expire),
    minttl: number(source.minttl),
  };
  return Object.values(projection).every((field) => field === null) ? null : projection;
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
    const soaValue = soa.status === 'fulfilled' ? soaProjection(soa.value) : null;
    return {
      nameservers: nameservers.status === 'fulfilled' ? nameservers.value : [],
      soaPrimary: soaValue?.nsname ?? null,
      soa: soaValue,
      errorCode: errorCode(reason),
      error: errorDetail(reason),
    };
  }
  const soaValue = soa.status === 'fulfilled' ? soaProjection(soa.value) : null;
  return {
    nameservers: nameservers.status === 'fulfilled' ? nameservers.value : [],
    soaPrimary: soaValue?.nsname ?? null,
    soa: soaValue,
    errorCode: null,
    error: null,
  };
}

function normaliseAuthorityValues(type: AuthorityRecordType, value: unknown): string[] {
  const rows = Array.isArray(value) ? value : [];
  const values = rows.flatMap((item): string[] => {
    if (type === 'A' || type === 'AAAA') {
      // Returned record data is evidence, not a transport destination. Retain
      // syntactically valid private and reserved addresses while continuing to
      // require public addresses for the direct nameserver connection itself.
      const address = observedAddress(item);
      return address && net.isIP(address) === (type === 'A' ? 4 : 6) ? [address] : [];
    }
    const source = record(item);
    if (type === 'MX') {
      const exchange = hostname(source.exchange);
      const priority = Number(source.priority);
      return exchange && Number.isSafeInteger(priority) && priority >= 0 && priority <= 65_535
        ? [`${priority} ${exchange}`]
        : [];
    }
    const critical = Number(source.critical);
    const properties = ['issue', 'issuewild', 'iodef'].flatMap((key) => {
      const candidate = boundedText(source[key], 500);
      return candidate ? [`${Number.isSafeInteger(critical) && critical >= 0 && critical <= 255 ? critical : 0} ${key} ${candidate}`] : [];
    });
    return properties;
  });
  return [...new Set(values)].sort().slice(0, MAX_AUTHORITY_RECORD_VALUES);
}

async function defaultAuthorityRecordQuery(input: {
  domain: string;
  address: string;
  timeoutMs: number;
}): Promise<AuthorityRecordSet[]> {
  const resolver = new dns.Resolver({
    timeout: Math.max(250, Math.min(input.timeoutMs, DNS_DELEGATION_TIMEOUT_MS)),
    tries: 1,
  });
  resolver.setServers([net.isIP(input.address) === 6 ? `[${input.address}]:53` : input.address]);
  const queries: ReadonlyArray<readonly [AuthorityRecordType, Promise<unknown>]> = [
    ['A', resolver.resolve4(input.domain)],
    ['AAAA', resolver.resolve6(input.domain)],
    ['CAA', resolver.resolveCaa(input.domain)],
    ['MX', resolver.resolveMx(input.domain)],
  ];
  return Promise.all(queries.map(async ([type, promise]) => {
    try {
      const response = await withTimeout(promise, input.timeoutMs);
      return { type, state: 'success' as const, values: normaliseAuthorityValues(type, response), error: null };
    } catch (error) {
      const code = errorCode(error);
      const missing = code === 'ENODATA' || code === 'ENOTFOUND';
      return { type, state: missing ? 'not_found' as const : 'error' as const, values: [], error: missing ? null : errorDetail(error) };
    }
  }));
}

function authorityRecordMatrix(authorities: readonly {
  nameserver: string;
  recordSets: readonly AuthorityRecordSet[];
}[]) {
  const types: AuthorityRecordType[] = ['A', 'AAAA', 'CAA', 'MX'];
  return types.map((type) => {
    const observations = authorities.map((authority) => {
      const result = authority.recordSets.find((item) => item.type === type);
      return {
        nameserver: authority.nameserver,
        state: result?.state ?? 'not_collected',
        values: result?.values ?? [],
        error: result?.error ?? null,
      };
    });
    const complete = observations.filter((item) => item.state === 'success' || item.state === 'not_found');
    const signatures = new Set(complete.map((item) => JSON.stringify(item.values)));
    return {
      type,
      state: observations.some((item) => item.state === 'error') ? 'partial' as const
        : complete.length < 2 ? 'insufficient' as const
          : observations.some((item) => item.state === 'not_collected') ? 'partial' as const
          : signatures.size === 1 ? 'aligned' as const : 'different' as const,
      observations,
    };
  });
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
    recordMatrix: [],
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
  const queryAuthorityRecords = options.queryAuthorityRecords
    ?? (options.queryAuthority ? null : defaultAuthorityRecordQuery);
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
        const soa = soaProjection(query.soa)
          ?? soaProjection({ nsname: query.soaPrimary });
        const soaPrimary = soa?.nsname ?? hostname(query.soaPrimary);
        const hasAnswer = nameservers.length > 0 || soaPrimary !== null || soa !== null;
        const state = error && hasAnswer
          ? 'partial' as const
          : code && LAME_CODES.has(code)
            ? 'lame' as const
            : error || !hasAnswer
              ? 'unreachable' as const
              : 'success' as const;
        return { address, state, nameservers, soaPrimary, soa, errorCode: code, error };
      } catch (error) {
        const code = errorCode(error);
        return {
          address,
          state: LAME_CODES.has(code) ? 'lame' as const : 'unreachable' as const,
          nameservers: [],
          soaPrimary: null,
          soa: null,
          errorCode: code || null,
          error: errorDetail(error),
        };
      }
    }));
    const successful = attempts.find((attempt) => attempt.state === 'success');
    const partial = attempts.find((attempt) => attempt.state === 'partial');
    const retained = successful ?? partial;
    let recordSets: AuthorityRecordSet[] = [];
    const recordAddress = retained?.address ?? addresses[0];
    if (queryAuthorityRecords && recordAddress) {
      try {
        recordSets = (await withTimeout(queryAuthorityRecords({ domain, nameserver, address: recordAddress, timeoutMs }), timeoutMs))
          .filter((item) => ['A', 'AAAA', 'CAA', 'MX'].includes(item.type))
          .slice(0, 4)
          .map((item) => ({
            type: item.type,
            state: item.state,
            values: [...new Set(item.values.map((value) => boundedText(value, 500)).filter((value): value is string => value !== null))].sort().slice(0, MAX_AUTHORITY_RECORD_VALUES),
            error: boundedText(item.error, MAX_ERROR_LENGTH),
          }));
      } catch (error) {
        recordSets = ['A', 'AAAA', 'CAA', 'MX'].map((type) => ({
          type: type as AuthorityRecordType,
          state: 'error' as const,
          values: [],
          error: errorDetail(error),
        }));
      }
    }
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
      soa: retained?.soa ?? null,
      recordSets,
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
  const retainedSoa = authorities
    .filter((authority) => authority.state === 'success' || authority.state === 'partial')
    .map((authority) => ({ nameserver: authority.nameserver, soa: authority.soa }))
    .filter((entry): entry is { nameserver: string; soa: NonNullable<typeof entry.soa> } => entry.soa !== null);
  const soaSerials = [...new Set(retainedSoa
    .map((entry) => entry.soa.serial)
    .filter((serial): serial is number => serial !== null))];
  const soaPrimaries = [...new Set(retainedSoa
    .map((entry) => entry.soa.nsname)
    .filter((primary): primary is string => primary !== null))];
  const soaSerialConflict = soaSerials.length > 1;
  const soaPrimaryConflict = soaPrimaries.length > 1;
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
  const recordMatrix = authorityRecordMatrix(authorities);
  const recordDifferences = recordMatrix.filter((row) => row.state === 'different');
  const recordPartial = recordMatrix.filter((row) => row.state === 'partial');
  const recordInsufficient = recordMatrix.filter((row) => row.state === 'insufficient');

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
      'authority_soa_consistency',
      'Authoritative SOA consistency',
      retainedSoa.length < 2 || soaSerials.length < 1 || soaPrimaries.length < 1
        ? 'unknown'
        : soaSerialConflict || soaPrimaryConflict ? 'warning' : 'healthy',
      retainedSoa.length < 2
        ? 'Fewer than two authority SOA observations were available'
        : soaSerialConflict
          ? 'Authoritative servers published different SOA serials'
          : soaPrimaryConflict
            ? 'Authoritative servers published different SOA primary nameservers'
            : 'Observed authority SOA serials and primary nameservers agree',
      retainedSoa.map((entry) => (
        `${entry.nameserver}: serial ${entry.soa.serial ?? 'unavailable'}, primary ${entry.soa.nsname ?? 'unavailable'}, refresh ${entry.soa.refresh ?? 'unavailable'}, retry ${entry.soa.retry ?? 'unavailable'}, expire ${entry.soa.expire ?? 'unavailable'}`
      )).join(' | ') || 'No complete SOA observation was available.',
      'Confirm zone propagation and the intended SOA primary before relying on a DNS change or secondary-server state.',
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
    ...(authorities.some((authority) => authority.recordSets.length) ? [finding(
        'authority_record_consistency',
        'Authoritative record consistency',
        recordDifferences.length ? 'warning'
          : recordPartial.length || recordInsufficient.length ? 'unknown' : 'healthy',
        recordDifferences.length
          ? `Direct authority answers differ for ${recordDifferences.map((row) => row.type).join(', ')}`
          : recordPartial.length
            ? 'Extended authority record comparison is incomplete'
            : recordInsufficient.length
              ? 'Fewer than two complete authority observations were available for one or more record types'
            : 'Observed A, AAAA, CAA, and MX answers agree across selected authorities',
        recordMatrix.map((row) => `${row.type}: ${row.state}`).join(' · '),
        'Review propagation timing and the intended zone values before relying on a DNS change.',
      )] : []),
  ];
  const collectionIncomplete = parentStatus === 'error'
    || parentQuery.truncated === true
    || registry.truncated
    || authorities.some((authority) => authority.state !== 'success')
    || recordPartial.length > 0;
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
        'Extended A, AAAA, CAA, and MX comparison uses only one selected validated public address per nameserver and caps each record set at sixteen values.',
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
    recordMatrix,
    findings,
  };
}

export {
  DNS_DELEGATION_HEALTH_VERSION,
  DNS_DELEGATION_TIMEOUT_MS,
  MAX_AUTHORITIES,
  MAX_AUTHORITY_ADDRESSES,
  collectDnsDelegationHealth,
  normaliseAuthorityValues,
  skippedDnsDelegationHealth,
};

export type {
  AuthorityQuery,
  AuthorityRecordQuery,
  AuthorityRecordSet,
  AuthorityQueryResult,
  DnsDelegationHealthOptions,
  ParentNameserverQuery,
};
