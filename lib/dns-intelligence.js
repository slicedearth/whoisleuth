// Bounded DNS evidence for investigative deep scans. This collector keeps
// authoritative absence distinct from resolver failure, preserves only record
// types that aid domain triage, and never treats shared infrastructure as proof
// of common ownership or maliciousness.

const dns = require('dns').promises;
const net = require('net');
const { classifyMxRecords } = require('./dns-mx');
const { createObservation } = require('./observation');

const DNS_TIMEOUT_MS = 5000;
const MAX_RECORDS_PER_TYPE = 16;
const MAX_HOSTNAME_LENGTH = 253;
const MAX_POLICY_LENGTH = 1024;
const MAX_ERROR_LENGTH = 180;
const MISSING_CODES = new Set(['ENODATA', 'ENOTFOUND', 'ENONAME']);

function boundedError(error) {
  return String(error && error.message ? error.message : error || 'DNS query failed').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_ERROR_LENGTH);
}

function normalizeHostname(value) {
  const hostname = String(value || '').trim().toLowerCase().replace(/\.+$/, '');
  if (!hostname || hostname.length > MAX_HOSTNAME_LENGTH || /[\u0000-\u0020\u007f]/.test(hostname)) return null;
  if (!hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  return hostname;
}

function boundedUnique(values, limit = MAX_RECORDS_PER_TYPE) {
  const unique = [...new Set(values)].sort();
  return { records: unique.slice(0, limit), truncated: unique.length > limit };
}

function normalizeAddresses(records, family) {
  const values = [];
  let discarded = 0;
  for (const record of Array.isArray(records) ? records : []) {
    const value = typeof record === 'string' ? record : record && record.address;
    if (typeof value !== 'string' || net.isIP(value) !== family) discarded += 1;
    else values.push(value.toLowerCase());
  }
  return { ...boundedUnique(values), discarded };
}

function normalizeHostnames(records) {
  const values = [];
  let discarded = 0;
  for (const record of Array.isArray(records) ? records : []) {
    const value = normalizeHostname(record);
    if (value) values.push(value);
    else discarded += 1;
  }
  return { ...boundedUnique(values), discarded };
}

function normalizeMx(records) {
  const byKey = new Map();
  let discarded = 0;
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') { discarded += 1; continue; }
    const exchange = record.exchange === '' || record.exchange === '.' ? '' : normalizeHostname(record.exchange);
    const priority = Number(record.priority);
    if (exchange === null || !Number.isInteger(priority) || priority < 0 || priority > 65535) { discarded += 1; continue; }
    byKey.set(`${priority}:${exchange}`, { priority, exchange });
  }
  const values = [...byKey.values()].sort((a, b) => a.priority - b.priority || a.exchange.localeCompare(b.exchange));
  return { records: values.slice(0, MAX_RECORDS_PER_TYPE), truncated: values.length > MAX_RECORDS_PER_TYPE, discarded };
}

function normalizeTxtPolicies(records, prefix) {
  const values = [];
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

function normalizeCaa(records) {
  const byKey = new Map();
  let discarded = 0;
  for (const record of Array.isArray(records) ? records : []) {
    const critical = Number(record && record.critical);
    const tag = String(record && record.tag || '').trim().toLowerCase();
    const value = String(record && record.value || '').trim();
    if (!Number.isInteger(critical) || critical < 0 || critical > 255 || !/^[a-z0-9-]{1,15}$/.test(tag) || !value || value.length > MAX_POLICY_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
      discarded += 1;
      continue;
    }
    byKey.set(`${critical}:${tag}:${value}`, { critical, tag, value });
  }
  const values = [...byKey.values()].sort((a, b) => a.tag.localeCompare(b.tag) || a.value.localeCompare(b.value) || a.critical - b.critical);
  return { records: values.slice(0, MAX_RECORDS_PER_TYPE), truncated: values.length > MAX_RECORDS_PER_TYPE, discarded };
}

function withTimeout(factory, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DNS query timed out')), timeoutMs);
    Promise.resolve().then(factory).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

async function query(factory, normalize, timeoutMs) {
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
    if (MISSING_CODES.has(error && error.code)) return { status: 'not_found', records: [], error: null, truncated: false, discarded: 0 };
    return { status: 'error', records: [], error: boundedError(error), truncated: false, discarded: 0 };
  }
}

/**
 * @param {string} domain
 * @param {{ resolvers?: Record<string, Function>, timeoutMs?: number, now?: () => number, observedAt?: () => string }} [options]
 */
async function collectDnsIntelligence(domain, options = {}) {
  const resolvers = options.resolvers || {};
  const timeoutMs = options.timeoutMs || DNS_TIMEOUT_MS;
  const now = options.now || Date.now;
  const started = now();
  const invoke = (name, fallback, value = domain) => () => (resolvers[name] || fallback)(value);
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

module.exports = {
  collectDnsIntelligence,
  normalizeAddresses,
  normalizeHostnames,
  normalizeMx,
  normalizeTxtPolicies,
  normalizeCaa,
};
