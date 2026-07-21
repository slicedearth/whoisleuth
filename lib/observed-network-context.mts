// Bounded network-registration context for one public address already selected
// by a deep domain lookup. The collector prefers the successful TLS connection
// address and falls back deterministically to retained public A then AAAA
// evidence. It performs one logical IP RDAP enrichment through the existing
// cached, SSRF-safe RDAP boundary and never participates in domain availability.

import * as net from 'node:net';

import { createObservation } from './observation.mts';
import { fetchRdapRecord } from './rdap.mts';
import { isPrivateAddress } from './safe-fetch.mts';

type UnknownRecord = Record<string, unknown>;
type AddressSource = 'tls_connection' | 'dns_a' | 'dns_aaaa';
type AddressSelection = {
  address: string;
  family: 4 | 6;
  selectedFrom: AddressSource;
};
type RdapAttempt = {
  endpoint: string | null;
  transportSecurity: 'https' | 'http' | null;
  status: number | null;
  outcome: string | null;
  detail: string | null;
  selected: boolean;
};
type ObservedNetworkContextOptions = {
  fetchRdapRecord?: typeof fetchRdapRecord;
  now?: () => number;
  observedAt?: () => string;
};

const OBSERVED_NETWORK_CONTEXT_VERSION = 1;
const MAX_NETWORK_CIDRS = 16;
const MAX_NETWORK_ATTEMPTS = 3;
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_DETAIL_LENGTH = 240;
const MAX_NAME_LENGTH = 300;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function boundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.replace(/\s+/g, ' ').trim() || null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function publicAddress(value: unknown, family?: 4 | 6): string | null {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u0020\u007f%]/.test(value)) return null;
  const normalized = value.toLowerCase();
  const detected = net.isIP(normalized);
  if (![4, 6].includes(detected) || (family && detected !== family) || isPrivateAddress(normalized)) return null;
  return normalized;
}

function eligibleDnsAddresses(value: unknown, family: 4 | 6): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .slice(0, 16)
    .map((item) => publicAddress(item, family))
    .filter((item): item is string => item !== null))]
    .sort((left, right) => left.localeCompare(right));
}

function selectObservedNetworkAddress(availabilityValue: unknown): AddressSelection | null {
  const availability = record(availabilityValue);
  const tls = record(availability.tls);
  if (tls.source === 'tls' && ['success', 'partial'].includes(String(tls.status))) {
    const address = publicAddress(tls.connectedAddress);
    if (address) return {
      address,
      family: net.isIP(address) as 4 | 6,
      selectedFrom: 'tls_connection',
    };
  }

  const dns = record(availability.dns);
  if (dns.source !== 'dns' || !['success', 'partial'].includes(String(dns.status))) return null;
  const records = record(dns.records);
  const diagnostics = record(dns.diagnostics);
  const a = record(diagnostics.a);
  const aaaa = record(diagnostics.aaaa);
  if (a.status === 'success') {
    const address = eligibleDnsAddresses(records.a, 4)[0];
    if (address) return { address, family: 4, selectedFrom: 'dns_a' };
  }
  if (aaaa.status === 'success') {
    const address = eligibleDnsAddresses(records.aaaa, 6)[0];
    if (address) return { address, family: 6, selectedFrom: 'dns_aaaa' };
  }
  return null;
}

function normalizedEndpoint(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_ENDPOINT_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, MAX_ENDPOINT_LENGTH);
  } catch {
    return null;
  }
}

function boundedHttpStatus(value: unknown): number | null {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function normalizeAttempts(value: unknown): RdapAttempt[] {
  return (Array.isArray(value) ? value : []).slice(0, MAX_NETWORK_ATTEMPTS).map((entry) => {
    const attempt = record(entry);
    const endpoint = normalizedEndpoint(attempt.endpoint);
    return {
      endpoint,
      transportSecurity: endpoint ? endpoint.startsWith('https:') ? 'https' : 'http' : null,
      status: boundedHttpStatus(attempt.status),
      outcome: boundedString(attempt.outcome, 40),
      detail: boundedString(attempt.detail, MAX_DETAIL_LENGTH),
      selected: attempt.selected === true,
    };
  });
}

function normalizedCidr(value: unknown, family: 4 | 6): string | null {
  if (typeof value !== 'string' || value.length > 96 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  const [prefix, lengthValue, ...rest] = value.split('/');
  if (rest.length || !prefix || lengthValue === undefined || net.isIP(prefix) !== family || !/^\d{1,3}$/.test(lengthValue)) return null;
  const length = Number(lengthValue);
  if (!Number.isInteger(length) || length < 0 || length > (family === 4 ? 32 : 128)) return null;
  return `${prefix.toLowerCase()}/${length}`;
}

function networkHolder(value: unknown): string | null {
  const holder = record(value);
  const organizations = Array.isArray(holder.organizations) ? holder.organizations : [];
  return boundedString(holder.name, MAX_NAME_LENGTH)
    || boundedString(holder.org, MAX_NAME_LENGTH)
    || boundedString(organizations[0], MAX_NAME_LENGTH)
    || boundedString(holder.handle, 200);
}

function networkSummary(parsedValue: unknown, family: 4 | 6) {
  const parsed = record(parsedValue);
  const lifecycle = record(parsed.lifecycle);
  const sourceCidrs = Array.isArray(parsed.cidrs) ? parsed.cidrs : [];
  const cidrs = [...new Set(sourceCidrs
    .slice(0, MAX_NETWORK_CIDRS)
    .map((item) => normalizedCidr(item, family))
    .filter((item): item is string => item !== null))]
    .sort((left, right) => left.localeCompare(right));
  const startAddress = publicAddress(parsed.startAddress, family);
  const endAddress = publicAddress(parsed.endAddress, family);
  const country = boundedString(parsed.country, 2);
  const truncated = parsed.serverTruncated === true
    || parsed.cidrsTruncated === true
    || parsed.entitiesTruncated === true
    || sourceCidrs.length > MAX_NETWORK_CIDRS;
  return {
    value: {
      handle: boundedString(parsed.handle, MAX_NAME_LENGTH),
      name: boundedString(parsed.name, MAX_NAME_LENGTH),
      holder: networkHolder(parsed.org),
      cidrs,
      startAddress,
      endAddress,
      country: country && /^[a-z]{2}$/i.test(country) ? country.toUpperCase() : null,
      networkType: boundedString(parsed.networkType, 160),
      databaseUpdatedAt: isoTimestamp(lifecycle.databaseUpdatedDateIso || lifecycle.databaseUpdatedDate),
    },
    truncated,
    serverTruncated: parsed.serverTruncated === true,
  };
}

function baseContext(selection: AddressSelection | null, input: {
  status: 'success' | 'partial' | 'not_found' | 'unsupported' | 'error';
  observedAt: unknown;
  durationMs: number | null;
  complete: boolean;
  truncated: boolean;
  limitations: string[];
  diagnostics: Record<string, unknown>;
  detail: string;
  rdap?: unknown;
  network?: unknown;
}) {
  return {
    contextVersion: OBSERVED_NETWORK_CONTEXT_VERSION,
    ...createObservation({
      status: input.status,
      observedAt: input.observedAt,
      scanMode: 'deep',
      source: 'ip_rdap',
      durationMs: input.durationMs,
      complete: input.complete,
      truncated: input.truncated,
      limitations: input.limitations,
      diagnostics: input.diagnostics,
    }),
    detail: input.detail,
    endpoint: selection,
    rdap: input.rdap || null,
    network: input.network || null,
  };
}

async function collectObservedNetworkContext(
  availabilityValue: unknown,
  options: ObservedNetworkContextOptions = {},
) {
  const selection = selectObservedNetworkAddress(availabilityValue);
  const now = options.now || Date.now;
  const observedAt = options.observedAt || (() => new Date().toISOString());
  if (!selection) return baseContext(null, {
    status: 'unsupported', observedAt: observedAt(), durationMs: 0, complete: false, truncated: false,
    detail: 'No validated public endpoint address was available from the retained TLS or DNS evidence.',
    limitations: [
      'No IP RDAP request was made because the deep lookup did not retain an eligible public address.',
      'Missing network context is not evidence that the domain has no website, network registration, or hosting provider.',
    ],
    diagnostics: { requestCount: 0, addressSource: 'none' },
  });

  const started = now();
  const fetchRdap = options.fetchRdapRecord || fetchRdapRecord;
  const type = selection.family === 4 ? 'ipv4' : 'ipv6';
  try {
    const source = await fetchRdap(type, selection.address);
    const durationMs = Math.max(0, now() - started);
    if (!source) return baseContext(selection, {
      status: 'unsupported', observedAt: observedAt(), durationMs, complete: false, truncated: false,
      detail: 'No IP RDAP service was available for the selected public address.',
      limitations: [
        'The selected address remains a point-in-time endpoint observation even when IP RDAP is unsupported.',
        'Network registration does not identify a definitive origin host or prove control, ownership, or intent.',
      ],
      diagnostics: { requestCount: 1, addressSource: selection.selectedFrom },
    });

    const rdapRecord = record(source);
    const endpoint = normalizedEndpoint(rdapRecord.rdapServer);
    const rdap = {
      endpoint,
      transportSecurity: endpoint ? endpoint.startsWith('https:') ? 'https' : 'http' : null,
      httpStatus: boundedHttpStatus(rdapRecord.upstreamStatus),
      fetchedAt: isoTimestamp(rdapRecord.fetchedAt),
      attempts: normalizeAttempts(rdapRecord.attempts),
    };
    if (rdap.httpStatus === 404) return baseContext(selection, {
      status: 'not_found', observedAt: rdap.fetchedAt || observedAt(), durationMs, complete: true, truncated: false,
      detail: 'The authoritative IP RDAP service reported no matching network object.',
      limitations: [
        'An IP RDAP not-found response is source evidence only and is not a domain availability or safety finding.',
        'The selected address is a point-in-time endpoint observation and may represent shared edge infrastructure.',
      ],
      diagnostics: { requestCount: 1, addressSource: selection.selectedFrom, httpStatus: 404 },
      rdap,
    });

    const parsed = record(rdapRecord.parsed);
    if (rdap.httpStatus !== 200 || !Object.keys(parsed).length) throw new Error('IP RDAP returned no usable normalized object');
    const summary = networkSummary(parsed, selection.family);
    const partial = summary.truncated;
    return baseContext(selection, {
      status: partial ? 'partial' : 'success',
      observedAt: rdap.fetchedAt || observedAt(),
      durationMs,
      complete: !partial,
      truncated: partial,
      detail: 'The selected public endpoint address was mapped to its separately attributed IP RDAP registration.',
      limitations: [
        'This identifies the registered network for one point-in-time endpoint address, not a definitive origin host or hosting provider.',
        'CDNs, reverse proxies, load balancers, shared hosting, and location-dependent DNS can present different networks.',
        'Network registration is an investigative lead and does not prove control, ownership, intent, or maliciousness.',
        ...(summary.serverTruncated ? ['The RDAP server declared that part of its response was truncated.'] : []),
        ...(sourceCidrsWereCapped(parsed) ? ['The network CIDR summary reached its local retention limit.'] : []),
      ],
      diagnostics: {
        requestCount: 1,
        addressSource: selection.selectedFrom,
        httpStatus: rdap.httpStatus || 200,
        cidrCount: summary.value.cidrs.length,
      },
      rdap,
      network: summary.value,
    });
  } catch (error) {
    const durationMs = Math.max(0, now() - started);
    const attempts = normalizeAttempts(record(error).attempts);
    return baseContext(selection, {
      status: 'error', observedAt: observedAt(), durationMs, complete: false, truncated: false,
      detail: 'IP RDAP enrichment could not be completed for the selected public address.',
      limitations: [
        'An IP RDAP failure is inconclusive and is not evidence that the address lacks a registered network or hosting service.',
        'The selected address remains a point-in-time endpoint observation and may represent shared edge infrastructure.',
      ],
      diagnostics: { requestCount: 1, addressSource: selection.selectedFrom },
      rdap: attempts.length ? { endpoint: null, transportSecurity: null, httpStatus: null, fetchedAt: null, attempts } : null,
    });
  }
}

function sourceCidrsWereCapped(parsed: UnknownRecord): boolean {
  return parsed.cidrsTruncated === true
    || (Array.isArray(parsed.cidrs) && parsed.cidrs.length > MAX_NETWORK_CIDRS);
}

export {
  MAX_NETWORK_ATTEMPTS,
  MAX_NETWORK_CIDRS,
  OBSERVED_NETWORK_CONTEXT_VERSION,
  collectObservedNetworkContext,
  selectObservedNetworkAddress,
};

export type { AddressSelection, AddressSource, ObservedNetworkContextOptions };
