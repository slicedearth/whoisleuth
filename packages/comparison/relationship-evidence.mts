// Bounded, scan-local relationship evidence for Bulk. Shared
// observations can help an analyst pivot between domains, but they are not
// proof of common ownership, coordination, intent, or maliciousness. This
// module deliberately produces no aggregate score and is never a persistence
// boundary.

import { normalizeDomain } from '../cases/case-model.mts';
import { groupBySimilarFavicon } from './favicon-similarity.mts';
import {
  RELATIONSHIP_EVIDENCE_SCHEMA,
  RELATIONSHIP_EVIDENCE_VERSION,
  SUPPORTED_TLS_RELATIONSHIP_PROFILE_VERSIONS,
  TLS_RELATIONSHIP_PROFILE_VERSION,
} from '../contracts/offline-comparison.mts';

export {
  RELATIONSHIP_EVIDENCE_SCHEMA,
  RELATIONSHIP_EVIDENCE_VERSION,
  SUPPORTED_TLS_RELATIONSHIP_PROFILE_VERSIONS,
  TLS_RELATIONSHIP_PROFILE_VERSION,
};
export const MAX_RELATIONSHIP_ROWS = 2000;
export const MAX_RELATIONSHIP_GROUPS = 100;
export const MAX_RELATIONSHIP_DOMAINS = 50;
export const MAX_NAMESERVERS_PER_ROW = 20;
export const MAX_IPS_PER_ROW = 50;
export const MAX_TRACKING_IDS_PER_ROW = 30;
export const MAX_OFFICIAL_ASSET_HOSTS_PER_ROW = 30;
export const MAX_OFFICIAL_DOMAINS = 200;
export const MAX_FAVICON_ROWS = 250;

const CONTROL_RE = /[\x00-\x1f\x7f]/;
const FAVICON_SHA_RE = /^[a-f0-9]{64}$/i;
const FAVICON_PHASH_RE = /^[a-f0-9]{16}$/i;
const CERTIFICATE_SHA_RE = /^[a-f0-9]{64}$/i;

export interface RelationshipObservation {
  version: typeof RELATIONSHIP_EVIDENCE_VERSION;
  nameservers: string[];
  ipAddresses: string[];
  trackingIdentifiers: string[];
  officialAssetHosts: string[];
  faviconHash: string | null;
  faviconPHash: string | null;
  certificateFingerprint: string | null;
  truncated: boolean;
}

export interface ScanRelationshipGroup {
  type: string;
  label: string;
  method: string;
  value: string;
  normalizedValue: string;
  domains: string[];
  description: string;
}

export interface ScanRelationshipSummary {
  version: typeof RELATIONSHIP_EVIDENCE_VERSION;
  groups: ScanRelationshipGroup[];
  truncated: boolean;
  limitations: string[];
}

interface RelationshipRow {
  domain?: unknown;
  trusted?: unknown;
  relationship?: unknown;
}

interface NormalizedRelationshipRow {
  domain: string;
  observation: Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hostname(value: unknown): string {
  if (typeof value !== 'string' || value.length > 253 || CONTROL_RE.test(value)) return '';
  return normalizeDomain(value.replace(/\.$/, ''));
}

function ipv4(value: unknown): string {
  if (typeof value !== 'string' || value.length > 15 || CONTROL_RE.test(value)) return '';
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return '';
  return parts.map((part) => String(Number(part))).join('.');
}

function ipv6(value: unknown): string {
  if (typeof value !== 'string' || value.length > 45 || CONTROL_RE.test(value)
    || !value.includes(':') || !/^[0-9a-f:.]+$/i.test(value)) return '';
  try {
    const normalized = new URL(`http://[${value}]/`).hostname.toLowerCase();
    return normalized.startsWith('[') && normalized.endsWith(']') ? normalized.slice(1, -1) : '';
  } catch {
    return '';
  }
}

function ipAddress(value: unknown): string {
  return ipv4(value) || ipv6(value);
}

function boundedSet(
  values: unknown[],
  normalize: (value: unknown) => string,
  limit: number,
): { values: string[]; truncated: boolean } {
  const output = new Set<string>();
  let truncated = values.length > limit * 4;
  for (const candidate of values.slice(0, limit * 4)) {
    const normalized = normalize(candidate);
    if (!normalized || output.has(normalized)) continue;
    if (output.size >= limit) truncated = true;
    else output.add(normalized);
  }
  return { values: [...output].sort(), truncated };
}

function identifier(value: unknown): string {
  const item = record(value);
  if (!item || typeof item.type !== 'string' || typeof item.value !== 'string') return '';
  if (!/^[a-z-]{1,40}$/.test(item.type) || !/^[A-Z0-9-]{1,64}$/.test(item.value)) return '';
  return `${item.type}:${item.value}`;
}

function trackingCandidates(availability: Record<string, unknown>): unknown[] {
  const identity = record(availability.pageIdentity);
  const fingerprints = record(identity?.fingerprints);
  const identifiers = record(fingerprints?.identifiers);
  if (Array.isArray(identifiers?.values)) return identifiers.values;
  return Array.isArray(identity?.trackingIdentifiers) ? identity.trackingIdentifiers : [];
}

function dnsRecords(availability: Record<string, unknown>): Record<string, unknown> {
  const dns = record(availability.dns);
  return record(dns?.records) || {};
}

function tlsCertificateFingerprint(availability: Record<string, unknown>): string | null {
  const tls = record(availability.tls);
  const certificate = record(tls?.certificate);
  const fingerprint = certificate?.fingerprintSha256;
  const status = tls?.status;
  if (tls?.source !== 'tls' || !SUPPORTED_TLS_RELATIONSHIP_PROFILE_VERSIONS.some((version) => version === Number(tls?.profileVersion))
    || typeof status !== 'string' || !['success', 'partial'].includes(status) || typeof fingerprint !== 'string'
    || fingerprint.length !== 64 || !CERTIFICATE_SHA_RE.test(fingerprint)) return null;
  return fingerprint.toLowerCase();
}

/**
 * Normalizes only the observations used by the current Bulk result set. The
 * returned object is transient and contains no raw HTML, response bodies,
 * complete DNS payload, URLs, certificate bodies, or Certificate Transparency
 * rows. The TLS field is an exact normalized leaf-certificate digest only.
 * @param {unknown} rawAvailability
 * @param {unknown} rawOfficialDomains
 */
export function relationshipObservation(
  rawAvailability: unknown,
  rawOfficialDomains: unknown = [],
): RelationshipObservation {
  const availability = record(rawAvailability) || {};
  const records = dnsRecords(availability);
  const nameserverSource = [
    ...(Array.isArray(availability.nameservers) ? availability.nameservers : []),
    ...(Array.isArray(records.ns) ? records.ns : []),
  ];
  const addressSource = [
    ...(Array.isArray(records.a) ? records.a : []),
    ...(Array.isArray(records.aaaa) ? records.aaaa : []),
  ];
  const nameservers = boundedSet(nameserverSource, hostname, MAX_NAMESERVERS_PER_ROW);
  const ipAddresses = boundedSet(addressSource, ipAddress, MAX_IPS_PER_ROW);
  const trackingIdentifiers = boundedSet(trackingCandidates(availability), identifier, MAX_TRACKING_IDS_PER_ROW);
  const officialDomainSource = Array.isArray(rawOfficialDomains) ? rawOfficialDomains : [];
  const officialDomains = new Set(
    officialDomainSource
      .slice(0, MAX_OFFICIAL_DOMAINS)
      .map(normalizeDomain)
      .filter((domain): domain is string => Boolean(domain)),
  );
  const assets = boundedSet(
    Array.isArray(availability.externalAssetHosts) ? availability.externalAssetHosts : [],
    hostname,
    MAX_OFFICIAL_ASSET_HOSTS_PER_ROW,
  );
  const officialAssetHosts = assets.values.filter(
    (host) => [...officialDomains].some((domain) => host === domain || host.endsWith(`.${domain}`)),
  );
  const faviconHash = typeof availability.faviconHash === 'string' && FAVICON_SHA_RE.test(availability.faviconHash)
    ? availability.faviconHash.toLowerCase() : null;
  const faviconPHash = typeof availability.faviconPHash === 'string' && FAVICON_PHASH_RE.test(availability.faviconPHash)
    ? availability.faviconPHash.toLowerCase() : null;
  return {
    version: RELATIONSHIP_EVIDENCE_VERSION,
    nameservers: nameservers.values,
    ipAddresses: ipAddresses.values,
    trackingIdentifiers: trackingIdentifiers.values,
    officialAssetHosts,
    faviconHash,
    faviconPHash,
    certificateFingerprint: tlsCertificateFingerprint(availability),
    truncated: nameservers.truncated || ipAddresses.truncated || trackingIdentifiers.truncated || assets.truncated
      || officialDomainSource.length > MAX_OFFICIAL_DOMAINS,
  };
}

function addBucket(buckets: Map<string, Set<string>>, value: string, domain: string): void {
  if (!value) return;
  if (!buckets.has(value)) buckets.set(value, new Set());
  buckets.get(value)?.add(domain);
}

function group(
  type: string,
  label: string,
  method: string,
  value: string,
  domains: string[],
  description: string,
  normalizedValue = value,
): ScanRelationshipGroup {
  return { type, label, method, value, normalizedValue, domains, description };
}

/**
 * @param {Array<{domain?:unknown,trusted?:unknown,relationship?:unknown}>} rawRows
 */
export function buildScanRelationships(rawRows: RelationshipRow[]): ScanRelationshipSummary {
  const input = Array.isArray(rawRows) ? rawRows : [];
  let truncated = input.length > MAX_RELATIONSHIP_ROWS;
  const rows: NormalizedRelationshipRow[] = [];
  for (const raw of input.slice(0, MAX_RELATIONSHIP_ROWS)) {
    const domain = normalizeDomain(raw?.domain);
    const observation = record(raw?.relationship);
    if (!domain || raw?.trusted || !observation || observation.version !== RELATIONSHIP_EVIDENCE_VERSION) continue;
    rows.push({ domain, observation });
    if (observation.truncated === true) truncated = true;
  }

  const nameserverSets = new Map<string, Set<string>>();
  const addresses = new Map<string, Set<string>>();
  const identifiers = new Map<string, Set<string>>();
  const certificates = new Map<string, Set<string>>();
  const officialAssets = new Map<string, Set<string>>();
  for (const { domain, observation } of rows) {
    const nameserverSource = Array.isArray(observation.nameservers) ? observation.nameservers : [];
    const addressSource = Array.isArray(observation.ipAddresses) ? observation.ipAddresses : [];
    const identifierSource = Array.isArray(observation.trackingIdentifiers) ? observation.trackingIdentifiers : [];
    const assetSource = Array.isArray(observation.officialAssetHosts) ? observation.officialAssetHosts : [];
    if (nameserverSource.length > MAX_NAMESERVERS_PER_ROW || addressSource.length > MAX_IPS_PER_ROW
      || identifierSource.length > MAX_TRACKING_IDS_PER_ROW || assetSource.length > MAX_OFFICIAL_ASSET_HOSTS_PER_ROW) truncated = true;
    const nameservers = nameserverSource.slice(0, MAX_NAMESERVERS_PER_ROW).map(hostname).filter(Boolean);
    if (nameservers.length) addBucket(nameserverSets, [...new Set(nameservers)].sort().join(' · '), domain);
    for (const value of addressSource.slice(0, MAX_IPS_PER_ROW)) addBucket(addresses, ipAddress(value), domain);
    for (const value of identifierSource.slice(0, MAX_TRACKING_IDS_PER_ROW)) {
      if (typeof value === 'string' && /^[a-z-]{1,40}:[A-Z0-9-]{1,64}$/.test(value)) {
        addBucket(identifiers, value, domain);
      }
    }
    const certificateFingerprint = typeof observation.certificateFingerprint === 'string'
      && observation.certificateFingerprint.length === 64
      && CERTIFICATE_SHA_RE.test(observation.certificateFingerprint)
      ? observation.certificateFingerprint.toLowerCase()
      : '';
    addBucket(certificates, certificateFingerprint, domain);
    for (const value of assetSource.slice(0, MAX_OFFICIAL_ASSET_HOSTS_PER_ROW)) addBucket(officialAssets, hostname(value), domain);
  }

  const output: ScanRelationshipGroup[] = [];
  for (const [value, domains] of nameserverSets) if (domains.size >= 2) output.push(group('nameserver_set', 'Shared nameserver set', 'Exact normalised set', value, [...domains].sort(), 'These domains reported the same normalised nameserver set retained by this scan.'));
  for (const [value, domains] of addresses) if (domains.size >= 2) output.push(group('ip_address', 'Shared IP address', 'Exact normalised address', value, [...domains].sort(), 'These domains resolved to the same IP address in this scan. Shared hosting and CDNs are common.'));
  for (const [value, domains] of certificates) if (domains.size >= 2) output.push(group('certificate', 'Shared TLS certificate', 'Exact leaf-certificate SHA-256', value, [...domains].sort(), 'These domains presented the same leaf certificate in this scan. Multi-domain certificates, shared hosting, CDNs, and managed platforms are common.'));
  for (const [value, domains] of identifiers) if (domains.size >= 2) output.push(group('tracking_identifier', 'Shared tracking identifier', 'Exact public identifier', value, [...domains].sort(), 'These pages exposed the same recognised public tracking identifier in bounded static HTML.'));

  const faviconRows = rows.slice(0, MAX_FAVICON_ROWS).map(({ domain, observation }) => ({
    domain,
    faviconHash: typeof observation.faviconHash === 'string' && FAVICON_SHA_RE.test(observation.faviconHash)
      ? observation.faviconHash.toLowerCase() : null,
    faviconPHash: typeof observation.faviconPHash === 'string' && FAVICON_PHASH_RE.test(observation.faviconPHash)
      ? observation.faviconPHash.toLowerCase() : null,
  }));
  if (rows.length > MAX_FAVICON_ROWS) truncated = true;
  for (const domains of groupBySimilarFavicon(faviconRows, 6)) {
    const distinctDomains = [...new Set(domains)].sort();
    if (distinctDomains.length >= 2) {
      const evidenceByDomain = new Map(faviconRows.map((row) => [row.domain, row]));
      const normalizedValue = distinctDomains.map((domain) => {
        const evidence = evidenceByDomain.get(domain);
        return `${domain}=${[
          evidence?.faviconHash ? `sha256:${evidence.faviconHash}` : '',
          evidence?.faviconPHash ? `dhash:${evidence.faviconPHash}` : '',
        ].filter(Boolean).join(',')}`;
      }).join('|');
      output.push(group(
        'favicon',
        'Similar favicon',
        'Exact SHA-256 or perceptual dHash distance ≤ 6',
        '',
        distinctDomains,
        'These domains used an identical or perceptually similar favicon in this scan.',
        normalizedValue,
      ));
    }
  }
  for (const [value, domains] of officialAssets) output.push(group('official_asset', 'Official asset relationship', 'Configured-domain host match', value, [...domains].sort(), 'One or more pages loaded an asset from this configured official domain or its subdomain.'));

  const order = new Map<string, number>(
    ['nameserver_set', 'ip_address', 'certificate', 'tracking_identifier', 'favicon', 'official_asset']
      .map((value, index) => [value, index]),
  );
  output.sort((left, right) => (Number(order.get(left.type)) - Number(order.get(right.type))) || left.value.localeCompare(right.value) || left.domains.join('|').localeCompare(right.domains.join('|')));
  if (output.length > MAX_RELATIONSHIP_GROUPS) truncated = true;
  const groups = output.slice(0, MAX_RELATIONSHIP_GROUPS).map((item) => {
    if (item.domains.length <= MAX_RELATIONSHIP_DOMAINS) return item;
    truncated = true;
    return { ...item, domains: item.domains.slice(0, MAX_RELATIONSHIP_DOMAINS) };
  });
  return {
    version: RELATIONSHIP_EVIDENCE_VERSION,
    groups,
    truncated,
    limitations: [
      'Shared observations are investigation pivots, not proof of common ownership, coordination, intent, or maliciousness.',
      'Certificate relationships use exact native TLS leaf-certificate SHA-256 values only. Certificate Transparency counts and hostnames are never treated as certificate reuse.',
      'A shared certificate can reflect a multi-domain certificate, shared hosting, CDN, or managed platform and does not establish common control.',
    ],
  };
}
