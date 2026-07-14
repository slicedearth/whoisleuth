// Bounded DNS evidence for investigative deep scans. This collector keeps
// authoritative absence distinct from resolver failure, preserves only record
// types that aid domain triage, and never treats shared infrastructure as proof
// of common ownership or maliciousness.

import { promises as dns } from 'node:dns';
import * as net from 'node:net';

import { classifyMxRecords } from './dns-mx.mts';
import { createObservation } from './observation.mts';

type MxRecord = { priority: number; exchange: string };
type CaaRecord = { critical: number; tag: string; value: string };
type NormalizedRecords<T> = { records: T[]; truncated: boolean; discarded: number };
type DnsQueryResult<T> = NormalizedRecords<T> & { status: 'success' | 'not_found' | 'error'; error: string | null };
type DnsResolver = (value: string) => Promise<unknown>;
type DnsIntelligenceOptions = {
  resolvers?: Record<string, DnsResolver>;
  timeoutMs?: number;
  now?: () => number;
  observedAt?: () => string;
};

const DNS_TIMEOUT_MS = 5000;
const MAX_RECORDS_PER_TYPE = 16;
const MAX_HOSTNAME_LENGTH = 253;
const MAX_POLICY_LENGTH = 1024;
const MAX_ERROR_LENGTH = 180;
const MISSING_CODES = new Set(['ENODATA', 'ENOTFOUND', 'ENONAME']);

function skippedDnsIntelligence(detail = 'DNS intelligence is disabled by deployment policy.') {
  const skipped = { status: 'skipped', error: null, truncated: false, discarded: 0 };
  const diagnostics = Object.fromEntries(['a', 'aaaa', 'cname', 'ns', 'mx', 'spf', 'dmarc', 'caa']
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
    records: { a: [], aaaa: [], cname: [], ns: [], mx: [], spf: [], dmarc: [], caa: [] },
    hasMx: null,
    hasNullMx: null,
    mxHosts: [],
    hasSpf: null,
    hasDmarc: null,
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
  const timeoutMs = options.timeoutMs || DNS_TIMEOUT_MS;
  const now = options.now || Date.now;
  const started = now();
  const invoke = (name: string, fallback: DnsResolver, value = domain) => () => (resolvers[name] || fallback)(value);
  const [a, aaaa, cname, ns, mx, spf, dmarc, caa] = await Promise.all([
    query(invoke('resolve4', dns.resolve4), (records) => normalizeAddresses(records, 4), timeoutMs),
    query(invoke('resolve6', dns.resolve6), (records) => normalizeAddresses(records, 6), timeoutMs),
    query(invoke('resolveCname', dns.resolveCname), normalizeHostnames, timeoutMs),
    query(invoke('resolveNs', dns.resolveNs), normalizeHostnames, timeoutMs),
    query(invoke('resolveMx', dns.resolveMx), normalizeMx, timeoutMs),
    query(invoke('resolveTxt', dns.resolveTxt), (records) => normalizeTxtPolicies(records, 'v=spf1'), timeoutMs),
    query(invoke('resolveTxt', dns.resolveTxt, `_dmarc.${domain}`), (records) => normalizeTxtPolicies(records, 'v=dmarc1'), timeoutMs),
    query(invoke('resolveCaa', dns.resolveCaa), normalizeCaa, timeoutMs),
  ]);
  const queries = { a, aaaa, cname, ns, mx, spf, dmarc, caa };
  const values = Object.values(queries);
  const errorCount = values.filter((item) => item.status === 'error').length;
  const truncated = values.some((item) => item.truncated);
  const discardedCount = values.reduce((sum, item) => sum + item.discarded, 0);
  const incomplete = errorCount > 0 || truncated || discardedCount > 0;
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
    ],
    diagnostics: Object.fromEntries(Object.entries(queries).map(([name, item]) => [name, {
      status: item.status,
      error: item.error,
      truncated: item.truncated,
      discarded: item.discarded,
    }])),
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
    },
    hasMx: classifiedMx ? classifiedMx.hasMx : null,
    hasNullMx: classifiedMx ? classifiedMx.hasNullMx : null,
    mxHosts: classifiedMx ? classifiedMx.mxHosts : [],
    hasSpf: spf.status === 'error' ? null : spf.records.length > 0,
    hasDmarc: dmarc.status === 'error' ? null : dmarc.records.length > 0,
  };
}

export {
  collectDnsIntelligence,
  skippedDnsIntelligence,
  normalizeAddresses,
  normalizeHostnames,
  normalizeMx,
  normalizeTxtPolicies,
  normalizeCaa,
};
