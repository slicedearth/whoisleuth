// Bounded DNS evidence for investigative deep scans. This collector keeps
// authoritative absence distinct from resolver failure, preserves only record
// types that aid domain triage, and never treats shared infrastructure as proof
// of common ownership or maliciousness.

import { promises as dns } from 'node:dns';
import * as net from 'node:net';

import { classifyMxRecords } from './dns-mx.mts';
import {
  collectDnsDelegationHealth,
  skippedDnsDelegationHealth,
  type AuthorityQuery,
} from './dns-delegation-health.mts';
import { createObservation } from './observation.mts';
import { isPrivateAddress } from './safe-fetch.mts';
import { resolveServiceBindingRecords } from './service-binding-dns.mts';

type MxRecord = { priority: number; exchange: string };
type CaaRecord = { critical: number; tag: string; value: string };
type SoaRecord = {
  nsname: string;
  hostmaster: string;
  serial: number;
  refresh: number;
  retry: number;
  expire: number;
  minttl: number;
};
type NormalizedRecords<T> = { records: T[]; truncated: boolean; discarded: number };
type DnsQueryResult<T> = NormalizedRecords<T> & { status: 'success' | 'not_found' | 'error'; error: string | null };
type DnsResolver = (value: string) => Promise<unknown>;
type DnsIntelligenceOptions = {
  resolvers?: Record<string, DnsResolver>;
  includeExtendedContext?: boolean;
  timeoutMs?: number;
  now?: () => number;
  observedAt?: () => string;
  registryEvidence?: unknown;
  queryAuthority?: AuthorityQuery;
};
type ReverseDnsIntelligenceOptions = {
  resolver?: DnsResolver;
  isEligibleAddress?: (value: string) => boolean;
  timeoutMs?: number;
  now?: () => number;
  observedAt?: () => string;
};
type ServiceBindingRecord = {
  type: 'HTTPS';
  owner: string;
  ttl: number;
  priority: number;
  mode: 'alias' | 'service';
  target: string | null;
  targetIsOwner: boolean;
  serviceUnavailable: boolean;
  compatible: boolean;
  parametersIgnored: boolean;
  parameters: {
    mandatory: number[];
    alpn: string[];
    noDefaultAlpn: boolean;
    port: number | null;
    ipv4hint: string[];
    ipv6hint: string[];
    opaque: Array<{ key: number; name: string | null; length: number }>;
    unknownKeys: number[];
    unsupportedMandatoryKeys: number[];
  };
};

const DNS_TIMEOUT_MS = 5000;
const MAX_RECORDS_PER_TYPE = 16;
const MAX_PTR_RECORDS = 8;
const MAX_HOSTNAME_LENGTH = 253;
const MAX_POLICY_LENGTH = 1024;
const MAX_ERROR_LENGTH = 180;
const MAX_DNS_UINT32 = 0xffff_ffff;
const MAX_SERVICE_PARAMETER_KEYS = 24;
const MAX_SERVICE_ALPN_IDS = 16;
const MAX_SERVICE_ADDRESS_HINTS = 8;
const DNS_CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/u;
const MISSING_CODES = new Set(['ENODATA', 'ENOTFOUND', 'ENONAME']);

function skippedDnsIntelligence(
  detail = 'DNS intelligence is disabled by deployment policy.',
  { includeExtendedContext = false }: { includeExtendedContext?: boolean } = {},
) {
  const skipped = { status: 'skipped', error: null, truncated: false, discarded: 0 };
  const recordTypes = ['a', 'aaaa', 'cname', 'ns', 'mx', 'spf', 'dmarc', 'caa'];
  if (includeExtendedContext) recordTypes.push('soa', 'https');
  const diagnostics = Object.fromEntries(recordTypes
    .map((name) => [name, { ...skipped }]));
  return {
    ...createObservation({
      status: 'skipped',
      scanMode: 'deep',
      source: 'dns',
      complete: false,
      limitations: [detail],
      diagnostics,
    }),
    records: {
      a: [], aaaa: [], cname: [], ns: [], mx: [], spf: [], dmarc: [], caa: [],
      ...(includeExtendedContext ? { soa: [], https: [] } : {}),
    },
    hasMx: null,
    hasNullMx: null,
    mxHosts: [],
    hasSpf: null,
    hasDmarc: null,
    delegation: includeExtendedContext
      ? skippedDnsDelegationHealth(detail)
      : null,
  };
}

function skippedReverseDnsIntelligence(detail = 'Reverse DNS intelligence is disabled by deployment policy.') {
  return {
    ...createObservation({
      status: 'skipped',
      scanMode: 'deep',
      source: 'reverse_dns',
      complete: false,
      limitations: [detail],
      diagnostics: {
        ptr: { status: 'skipped', error: null, truncated: false, discarded: 0 },
      },
    }),
    records: { ptr: [] },
  };
}

function failedReverseDnsIntelligence(error: unknown) {
  const detail = boundedError(error);
  return {
    ...createObservation({
      status: 'error',
      scanMode: 'deep',
      source: 'reverse_dns',
      complete: false,
      limitations: [
        'Reverse DNS collection failed. Resolver failure is not evidence that no PTR record exists.',
      ],
      diagnostics: {
        ptr: { status: 'error', error: detail, truncated: false, discarded: 0 },
      },
    }),
    records: { ptr: [] },
  };
}

function boundedError(error: unknown): string {
  return String(error instanceof Error ? error.message : error || 'DNS query failed').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_ERROR_LENGTH);
}

function normalizeHostname(value: unknown): string | null {
  const hostname = String(value || '').trim().toLowerCase().replace(/\.+$/, '');
  if (!hostname || hostname.length > MAX_HOSTNAME_LENGTH || /[\u0000-\u0020\u007f]/.test(hostname)) return null;
  if (!hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  return hostname;
}

function boundedUnique(values: string[], limit = MAX_RECORDS_PER_TYPE): { records: string[]; truncated: boolean } {
  const unique = [...new Set(values)].sort();
  return { records: unique.slice(0, limit), truncated: unique.length > limit };
}

function normalizeAddresses(records: unknown, family: number): NormalizedRecords<string> {
  const values: string[] = [];
  let discarded = 0;
  for (const record of Array.isArray(records) ? records : []) {
    const value = typeof record === 'string' ? record : record && typeof record === 'object' ? (record as Record<string, unknown>).address : null;
    if (typeof value !== 'string' || net.isIP(value) !== family) discarded += 1;
    else values.push(value.toLowerCase());
  }
  return { ...boundedUnique(values), discarded };
}

function normalizeHostnames(records: unknown): NormalizedRecords<string> {
  const values: string[] = [];
  let discarded = 0;
  for (const record of Array.isArray(records) ? records : []) {
    const value = normalizeHostname(record);
    if (value) values.push(value);
    else discarded += 1;
  }
  return { ...boundedUnique(values), discarded };
}

function normalizeMx(records: unknown): NormalizedRecords<MxRecord> {
  const byKey = new Map<string, MxRecord>();
  let discarded = 0;
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') { discarded += 1; continue; }
    const value = record as Record<string, unknown>;
    const exchange = value.exchange === '' || value.exchange === '.' ? '' : normalizeHostname(value.exchange);
    const priority = Number(value.priority);
    if (exchange === null || !Number.isInteger(priority) || priority < 0 || priority > 65535) { discarded += 1; continue; }
    byKey.set(`${priority}:${exchange}`, { priority, exchange });
  }
  const values = [...byKey.values()].sort((a, b) => a.priority - b.priority || a.exchange.localeCompare(b.exchange));
  return { records: values.slice(0, MAX_RECORDS_PER_TYPE), truncated: values.length > MAX_RECORDS_PER_TYPE, discarded };
}

function normalizeTxtPolicies(records: unknown, prefix: string): NormalizedRecords<string> {
  const values: string[] = [];
  let discarded = 0;
  for (const chunks of Array.isArray(records) ? records : []) {
    if (!Array.isArray(chunks) || chunks.some((chunk) => typeof chunk !== 'string')) { discarded += 1; continue; }
    const value = chunks.join('').trim();
    if (!value.toLowerCase().startsWith(prefix) || !value || value.length > MAX_POLICY_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
      if (value.toLowerCase().startsWith(prefix)) discarded += 1;
      continue;
    }
    values.push(value);
  }
  return { ...boundedUnique(values), discarded };
}

function normalizeCaa(records: unknown): NormalizedRecords<CaaRecord> {
  const byKey = new Map<string, CaaRecord>();
  let discarded = 0;
  for (const record of Array.isArray(records) ? records : []) {
    const entry = record && typeof record === 'object' ? record as Record<string, unknown> : {};
    const critical = Number(entry.critical);
    const tag = String(entry.tag || '').trim().toLowerCase();
    const value = String(entry.value || '').trim();
    if (!Number.isInteger(critical) || critical < 0 || critical > 255 || !/^[a-z0-9-]{1,15}$/.test(tag) || !value || value.length > MAX_POLICY_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
      discarded += 1;
      continue;
    }
    byKey.set(`${critical}:${tag}:${value}`, { critical, tag, value });
  }
  const values = [...byKey.values()].sort((a, b) => a.tag.localeCompare(b.tag) || a.value.localeCompare(b.value) || a.critical - b.critical);
  return { records: values.slice(0, MAX_RECORDS_PER_TYPE), truncated: values.length > MAX_RECORDS_PER_TYPE, discarded };
}

function dnsUint32(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= MAX_DNS_UINT32
    ? number
    : null;
}

function normalizeSoa(record: unknown): NormalizedRecords<SoaRecord> {
  const entry = record && typeof record === 'object' && !Array.isArray(record)
    ? record as Record<string, unknown>
    : {};
  const nsname = normalizeHostname(entry.nsname);
  const hostmaster = normalizeHostname(entry.hostmaster);
  const serial = dnsUint32(entry.serial);
  const refresh = dnsUint32(entry.refresh);
  const retry = dnsUint32(entry.retry);
  const expire = dnsUint32(entry.expire);
  const minttl = dnsUint32(entry.minttl);
  if (!nsname || !hostmaster || [serial, refresh, retry, expire, minttl].some((value) => value === null)) {
    return { records: [], truncated: false, discarded: 1 };
  }
  return {
    records: [{
      nsname,
      hostmaster,
      serial: serial as number,
      refresh: refresh as number,
      retry: retry as number,
      expire: expire as number,
      minttl: minttl as number,
    }],
    truncated: false,
    discarded: 0,
  };
}

function boundedUint16List(value: unknown, limit: number): number[] | null {
  if (!Array.isArray(value)) return null;
  const values: number[] = [];
  for (const item of value.slice(0, limit)) {
    const number = Number(item);
    if (!Number.isInteger(number) || number < 0 || number > 0xffff) return null;
    values.push(number);
  }
  return values;
}

function boundedAlpnList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const values: string[] = [];
  for (const item of value.slice(0, MAX_SERVICE_ALPN_IDS)) {
    if (
      typeof item !== 'string'
      || !item
      || item.length > 132
      || DNS_CONTROL_CHARACTER_RE.test(item)
      || !/^(?:hex:[0-9a-f]+|[\x21-\x7e]+)$/u.test(item)
    ) return null;
    values.push(item);
  }
  return values;
}

function boundedAddressHints(value: unknown, family: 4 | 6): string[] | null {
  if (!Array.isArray(value)) return null;
  const values: string[] = [];
  for (const item of value.slice(0, MAX_SERVICE_ADDRESS_HINTS)) {
    if (typeof item !== 'string' || net.isIP(item) !== family) return null;
    values.push(item.toLowerCase());
  }
  return values;
}

function normalizeServiceBindings(value: unknown): NormalizedRecords<ServiceBindingRecord> {
  const envelope = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const input = Array.isArray(value)
    ? value
    : Array.isArray(envelope?.records)
      ? envelope.records
      : [];
  const records: ServiceBindingRecord[] = [];
  let discarded = 0;
  let truncated = envelope?.truncated === true || input.length > MAX_RECORDS_PER_TYPE;

  for (const candidate of input.slice(0, MAX_RECORDS_PER_TYPE)) {
    const record = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : {};
    const parameters = record.parameters && typeof record.parameters === 'object' && !Array.isArray(record.parameters)
      ? record.parameters as Record<string, unknown>
      : {};
    const owner = normalizeHostname(record.owner);
    const target = record.target === null ? null : normalizeHostname(record.target);
    const ttl = dnsUint32(record.ttl);
    const priority = Number(record.priority);
    const mode = record.mode;
    const mandatory = boundedUint16List(parameters.mandatory, MAX_SERVICE_PARAMETER_KEYS);
    const alpn = boundedAlpnList(parameters.alpn);
    const ipv4hint = boundedAddressHints(parameters.ipv4hint, 4);
    const ipv6hint = boundedAddressHints(parameters.ipv6hint, 6);
    const unknownKeys = boundedUint16List(parameters.unknownKeys, MAX_SERVICE_PARAMETER_KEYS);
    const unsupportedMandatoryKeys = boundedUint16List(
      parameters.unsupportedMandatoryKeys,
      MAX_SERVICE_PARAMETER_KEYS,
    );
    const port = parameters.port === null ? null : Number(parameters.port);
    const opaqueInput = Array.isArray(parameters.opaque) ? parameters.opaque : [];
    const opaque: Array<{ key: number; name: string | null; length: number }> = [];
    let invalidOpaque = opaqueInput.length > MAX_SERVICE_PARAMETER_KEYS;
    for (const item of opaqueInput.slice(0, MAX_SERVICE_PARAMETER_KEYS)) {
      const entry = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      const key = Number(entry.key);
      const length = Number(entry.length);
      const name = entry.name === null ? null : String(entry.name || '');
      if (
        !Number.isInteger(key) || key < 0 || key > 0xffff
        || !Number.isInteger(length) || length < 0 || length > 0xffff
        || (name !== null && !/^[a-z0-9-]{1,63}$/u.test(name))
      ) {
        invalidOpaque = true;
        break;
      }
      opaque.push({ key, name, length });
    }

    if (
      record.type !== 'HTTPS'
      || !owner
      || (record.serviceUnavailable !== true && !target)
      || ttl === null
      || !Number.isInteger(priority) || priority < 0 || priority > 0xffff
      || (mode !== 'alias' && mode !== 'service')
      || mode !== (priority === 0 ? 'alias' : 'service')
      || typeof record.targetIsOwner !== 'boolean'
      || typeof record.serviceUnavailable !== 'boolean'
      || typeof record.compatible !== 'boolean'
      || typeof record.parametersIgnored !== 'boolean'
      || !mandatory || !alpn || !ipv4hint || !ipv6hint || !unknownKeys || !unsupportedMandatoryKeys
      || invalidOpaque
      || typeof parameters.noDefaultAlpn !== 'boolean'
      || (port !== null && (!Number.isInteger(port) || port < 0 || port > 0xffff))
    ) {
      discarded += 1;
      continue;
    }

    records.push({
      type: 'HTTPS',
      owner,
      ttl,
      priority,
      mode,
      target,
      targetIsOwner: record.targetIsOwner,
      serviceUnavailable: record.serviceUnavailable,
      compatible: record.compatible,
      parametersIgnored: record.parametersIgnored,
      parameters: {
        mandatory,
        alpn,
        noDefaultAlpn: parameters.noDefaultAlpn,
        port,
        ipv4hint,
        ipv6hint,
        opaque,
        unknownKeys,
        unsupportedMandatoryKeys,
      },
    });
  }

  const unique = new Map(records.map((record) => [JSON.stringify(record), record]));
  return {
    records: [...unique.values()].sort((left, right) => (
      left.priority - right.priority
      || left.owner.localeCompare(right.owner)
      || String(left.target).localeCompare(String(right.target))
      || left.ttl - right.ttl
    )),
    truncated,
    discarded,
  };
}

function normalizePtr(records: unknown): NormalizedRecords<string> {
  const normalized = normalizeHostnames(records);
  return {
    records: normalized.records.slice(0, MAX_PTR_RECORDS),
    truncated: normalized.truncated || normalized.records.length > MAX_PTR_RECORDS,
    discarded: normalized.discarded,
  };
}

function withTimeout<T>(factory: () => Promise<T> | T, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DNS query timed out')), timeoutMs);
    Promise.resolve().then(factory).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

async function query<T>(factory: () => Promise<unknown>, normalize: (value: unknown) => NormalizedRecords<T>, timeoutMs: number): Promise<DnsQueryResult<T>> {
  try {
    const normalized = normalize(await withTimeout(factory, timeoutMs));
    return {
      status: normalized.records.length ? 'success' : 'not_found',
      records: normalized.records,
      error: null,
      truncated: normalized.truncated,
      discarded: normalized.discarded || 0,
    };
  } catch (error) {
    if (error && typeof error === 'object' && MISSING_CODES.has(String((error as NodeJS.ErrnoException).code))) return { status: 'not_found', records: [], error: null, truncated: false, discarded: 0 };
    return { status: 'error', records: [], error: boundedError(error), truncated: false, discarded: 0 };
  }
}

async function collectDnsIntelligence(domain: string, options: DnsIntelligenceOptions = {}) {
  const resolvers = options.resolvers || {};
  const includeExtendedContext = options.includeExtendedContext === true;
  const timeoutMs = options.timeoutMs || DNS_TIMEOUT_MS;
  const now = options.now || Date.now;
  const started = now();
  const invoke = (name: string, fallback: DnsResolver, value = domain) => () => (resolvers[name] || fallback)(value);
  const aPromise = query(invoke('resolve4', dns.resolve4), (records) => normalizeAddresses(records, 4), timeoutMs);
  const aaaaPromise = query(invoke('resolve6', dns.resolve6), (records) => normalizeAddresses(records, 6), timeoutMs);
  const cnamePromise = query(invoke('resolveCname', dns.resolveCname), normalizeHostnames, timeoutMs);
  const nsPromise = query(invoke('resolveNs', dns.resolveNs), normalizeHostnames, timeoutMs);
  const mxPromise = query(invoke('resolveMx', dns.resolveMx), normalizeMx, timeoutMs);
  const spfPromise = query(invoke('resolveTxt', dns.resolveTxt), (records) => normalizeTxtPolicies(records, 'v=spf1'), timeoutMs);
  const dmarcPromise = query(invoke('resolveTxt', dns.resolveTxt, `_dmarc.${domain}`), (records) => normalizeTxtPolicies(records, 'v=dmarc1'), timeoutMs);
  const caaPromise = query(invoke('resolveCaa', dns.resolveCaa), normalizeCaa, timeoutMs);
  const soaPromise = includeExtendedContext
    ? query(invoke('resolveSoa', dns.resolveSoa), normalizeSoa, timeoutMs)
    : Promise.resolve(null);
  const httpsPromise = includeExtendedContext
    ? query(
        invoke(
          'resolveHttps',
          (value) => resolveServiceBindingRecords(value, 'HTTPS', { timeoutMs }),
        ),
        normalizeServiceBindings,
        timeoutMs,
      )
    : Promise.resolve(null);
  const delegationPromise = includeExtendedContext
    ? nsPromise.then((parentNameservers) => collectDnsDelegationHealth(domain, parentNameservers, {
        registryEvidence: options.registryEvidence,
        resolve4: (resolvers.resolve4 || dns.resolve4) as (hostname: string) => Promise<unknown>,
        resolve6: (resolvers.resolve6 || dns.resolve6) as (hostname: string) => Promise<unknown>,
        ...(options.queryAuthority ? { queryAuthority: options.queryAuthority } : {}),
        timeoutMs,
        now,
        ...(options.observedAt ? { observedAt: options.observedAt } : {}),
      }))
    : Promise.resolve(null);
  const [a, aaaa, cname, ns, mx, spf, dmarc, caa, soa, https, delegation] = await Promise.all([
    aPromise,
    aaaaPromise,
    cnamePromise,
    nsPromise,
    mxPromise,
    spfPromise,
    dmarcPromise,
    caaPromise,
    soaPromise,
    httpsPromise,
    delegationPromise,
  ]);
  const queries = {
    a, aaaa, cname, ns, mx, spf, dmarc, caa,
    ...(soa ? { soa } : {}),
    ...(https ? { https } : {}),
  };
  const values = Object.values(queries);
  const errorCount = values.filter((item) => item.status === 'error').length;
  const truncated = values.some((item) => item.truncated) || delegation?.truncated === true;
  const discardedCount = values.reduce((sum, item) => sum + item.discarded, 0);
  const incomplete = errorCount > 0
    || truncated
    || discardedCount > 0
    || (delegation !== null && delegation.status !== 'success');
  const classifiedMx = mx.status === 'error' ? null : classifyMxRecords(mx.records);

  return {
    ...createObservation({
    status: errorCount === values.length ? 'error' : incomplete ? 'partial' : 'success',
    observedAt: (options.observedAt || (() => new Date().toISOString()))(),
    scanMode: 'deep',
    source: 'dns',
    durationMs: Math.max(0, now() - started),
    complete: !incomplete,
    truncated,
    limitations: [
      'DNS answers are point-in-time resolver observations and may change or differ by location.',
      'CNAME targets are not followed recursively, and shared DNS infrastructure does not prove common ownership.',
      'Only SPF and DMARC policy TXT records are retained; unrelated TXT records are discarded.',
      ...(soa ? ['SOA publication is operator context and does not prove hosting control, ownership, intent, or maliciousness.'] : []),
      ...(https ? [
        'HTTPS service-binding records are published connection hints. WHOISleuth does not follow their aliases or connect to their targets, ports, or address hints.',
        'SVCB uses protocol-specific underscored query names. The domain lookup therefore queries the HTTPS-compatible record only; the shared resolver supports SVCB for explicit future service queries.',
      ] : []),
      ...(delegation ? ['Delegation health compares separately attributed registry, recursive parent-view, and direct nameserver evidence and never decides domain availability.'] : []),
    ],
    diagnostics: {
      ...Object.fromEntries(Object.entries(queries).map(([name, item]) => [name, {
        status: item.status,
        error: item.error,
        truncated: item.truncated,
        discarded: item.discarded,
      }])),
      ...(delegation ? {
        delegation: {
          status: delegation.status,
          truncated: delegation.truncated,
          count: delegation.authorities.length,
        },
      } : {}),
    },
    }),
    records: {
      a: a.records,
      aaaa: aaaa.records,
      cname: cname.records,
      ns: ns.records,
      mx: mx.records,
      spf: spf.records,
      dmarc: dmarc.records,
      caa: caa.records,
      ...(soa ? { soa: soa.records } : {}),
      ...(https ? { https: https.records } : {}),
    },
    hasMx: classifiedMx ? classifiedMx.hasMx : null,
    hasNullMx: classifiedMx ? classifiedMx.hasNullMx : null,
    mxHosts: classifiedMx ? classifiedMx.mxHosts : [],
    hasSpf: spf.status === 'error' ? null : spf.records.length > 0,
    hasDmarc: dmarc.status === 'error' ? null : dmarc.records.length > 0,
    delegation,
  };
}

async function collectReverseDnsIntelligence(
  address: string,
  options: ReverseDnsIntelligenceOptions = {},
) {
  const eligible = options.isEligibleAddress
    || ((value: string) => net.isIP(value) !== 0 && !isPrivateAddress(value));
  if (!eligible(address)) {
    return {
      ...createObservation({
        status: 'unsupported',
        scanMode: 'deep',
        source: 'reverse_dns',
        complete: false,
        limitations: [
          'Reverse DNS is collected only for validated public IP addresses.',
        ],
        diagnostics: {
          ptr: {
            status: 'unsupported',
            detail: 'The address is invalid, private, reserved, or otherwise outside the public PTR lookup boundary.',
            truncated: false,
            discarded: 0,
          },
        },
      }),
      records: { ptr: [] },
    };
  }

  const timeoutMs = options.timeoutMs || DNS_TIMEOUT_MS;
  const now = options.now || Date.now;
  const started = now();
  const ptr = await query(
    () => (options.resolver || dns.resolvePtr)(address),
    normalizePtr,
    timeoutMs,
  );
  const incomplete = ptr.status === 'error' || ptr.truncated || ptr.discarded > 0;
  return {
    ...createObservation({
      status: ptr.status === 'error'
        ? 'error'
        : incomplete
          ? 'partial'
          : ptr.status,
      observedAt: (options.observedAt || (() => new Date().toISOString()))(),
      scanMode: 'deep',
      source: 'reverse_dns',
      durationMs: Math.max(0, now() - started),
      complete: !incomplete,
      truncated: ptr.truncated,
      limitations: [
        'PTR records are point-in-time reverse-DNS publications controlled by the address operator.',
        'A PTR name can be absent, stale, generic, or misleading and does not prove hosting control, ownership, service identity, intent, or maliciousness.',
      ],
      diagnostics: {
        ptr: {
          status: ptr.status,
          error: ptr.error,
          truncated: ptr.truncated,
          discarded: ptr.discarded,
        },
      },
    }),
    records: { ptr: ptr.records },
  };
}

export {
  collectDnsIntelligence,
  collectReverseDnsIntelligence,
  failedReverseDnsIntelligence,
  skippedDnsIntelligence,
  skippedReverseDnsIntelligence,
  normalizeAddresses,
  normalizeHostnames,
  normalizeMx,
  normalizeTxtPolicies,
  normalizeCaa,
  normalizeSoa,
  normalizeServiceBindings,
  normalizePtr,
};
