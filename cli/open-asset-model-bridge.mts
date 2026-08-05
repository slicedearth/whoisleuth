import { isIP } from 'node:net';

import {
  parseExternalFindingsDocument,
  type ExternalFindingsDocument,
} from '../frontend/src/lib/analysis/external-findings-import.ts';
import { requireIsoTimestamp } from '../lib/bounded-contract-normalizers.mts';

export const OPEN_ASSET_MODEL_BRIDGE_SCHEMA = 'whoisleuth.open-asset-model-bridge';
export const OPEN_ASSET_MODEL_BRIDGE_VERSION = 1;
const SHA256_RE = /^[a-f0-9]{64}$/u;

function fqdnId(domain: string): string {
  return `FQDN/${domain}`;
}

function certificateId(digest: string): string {
  return `TLSCertificate/sha256:${digest}`;
}

function ipId(address: string): string {
  return `IPAddress/${address}`;
}

function earlier(left: string, right: string): string {
  return left.localeCompare(right) <= 0 ? left : right;
}

function later(left: string, right: string): string {
  return left.localeCompare(right) >= 0 ? left : right;
}

function combinedCompleteness(left: unknown, right: string): string {
  return left === right ? right : 'partial';
}

function setObservedAsset(
  assets: Map<string, Record<string, unknown>>,
  key: string,
  value: Record<string, unknown>,
  observedAt: string,
  completeness: string,
): void {
  const existing = assets.get(key);
  const existingDiscovery = existing?.discovery && typeof existing.discovery === 'object'
    ? existing.discovery as Record<string, unknown>
    : null;
  if (!existing || !existingDiscovery || typeof existingDiscovery.observed_at !== 'string') {
    assets.set(key, value);
    return;
  }
  assets.set(key, {
    ...existing,
    discovery: {
      ...existingDiscovery,
      observed_at: later(existingDiscovery.observed_at, observedAt),
      completeness: combinedCompleteness(existingDiscovery.completeness, completeness),
    },
  });
}

function setObservedRelation(
  relations: Map<string, Record<string, unknown>>,
  key: string,
  value: Record<string, unknown>,
  observedAt: string,
  completeness: string,
): void {
  const existing = relations.get(key);
  const existingDiscovery = existing?.discovery && typeof existing.discovery === 'object'
    ? existing.discovery as Record<string, unknown>
    : null;
  if (
    !existing
    || typeof existing.created_at !== 'string'
    || typeof existing.last_seen !== 'string'
    || !existingDiscovery
  ) {
    relations.set(key, value);
    return;
  }
  relations.set(key, {
    ...existing,
    created_at: earlier(existing.created_at, observedAt),
    last_seen: later(existing.last_seen, observedAt),
    discovery: {
      ...existingDiscovery,
      completeness: combinedCompleteness(existingDiscovery.completeness, completeness),
    },
  });
}

export function buildOpenAssetModelBridge(input: unknown, generatedAtValue = new Date().toISOString()) {
  const document: ExternalFindingsDocument = parseExternalFindingsDocument(input);
  const generatedAt = requireIsoTimestamp(generatedAtValue, 'generatedAt');
  const assets = new Map<string, Record<string, unknown>>();
  const relations = new Map<string, Record<string, unknown>>();
  for (const finding of document.findings) {
    const domainAssetId = fqdnId(finding.domain);
    setObservedAsset(assets, domainAssetId, {
      key: domainAssetId,
      type: 'FQDN',
      attributes: { name: finding.domain },
      discovery: { source: document.source.name, observed_at: finding.observedAt, completeness: finding.completeness },
    }, finding.observedAt, finding.completeness);
    const observation = finding.structuredObservation;
    if (!observation) continue;
    if (
      observation.sourceSchema === 'whoisleuth.certificate-observation-rows'
      && (observation.field === 'certificateSha256' || observation.field === 'fingerprintSha256')
    ) {
      const digest = observation.value.toLowerCase();
      if (!SHA256_RE.test(digest)) throw new TypeError('Certificate bridge observations require a SHA-256 hexadecimal digest.');
      const certificateAssetId = certificateId(digest);
      setObservedAsset(assets, certificateAssetId, {
        key: certificateAssetId,
        type: 'TLSCertificate',
        attributes: {
          sha256: digest,
          issuer_common_name: observation.issuer,
          not_after: observation.notAfter,
        },
        discovery: { source: document.source.name, observed_at: finding.observedAt, completeness: finding.completeness },
      }, finding.observedAt, finding.completeness);
      const relationKey = `${certificateAssetId}\u0000san_dns_name\u0000${domainAssetId}`;
      setObservedRelation(relations, relationKey, {
        type: 'SimpleRelation',
        label: 'san_dns_name',
        source: certificateAssetId,
        target: domainAssetId,
        created_at: finding.observedAt,
        last_seen: finding.observedAt,
        discovery: { source: document.source.name, completeness: finding.completeness },
      }, finding.observedAt, finding.completeness);
    }
    if (
      observation.sourceSchema === 'whoisleuth.dns-observation-rows'
      && (observation.field === 'A' || observation.field === 'AAAA')
    ) {
      const ipVersion = isIP(observation.value);
      const targetId = ipVersion ? ipId(observation.value) : null;
      if (!targetId) continue;
      if ((observation.field === 'A' && ipVersion !== 4) || (observation.field === 'AAAA' && ipVersion !== 6)) continue;
      setObservedAsset(assets, targetId, {
        key: targetId,
        type: 'IPAddress',
        attributes: { address: observation.value, type: ipVersion === 4 ? 'IPv4' : 'IPv6' },
        discovery: { source: document.source.name, observed_at: finding.observedAt, completeness: finding.completeness },
      }, finding.observedAt, finding.completeness);
      const relationKey = `${domainAssetId}\u0000dns_record\u0000${targetId}`;
      setObservedRelation(relations, relationKey, {
        type: 'BasicDNSRelation',
        label: 'dns_record',
        source: domainAssetId,
        target: targetId,
        created_at: finding.observedAt,
        last_seen: finding.observedAt,
        discovery: { source: document.source.name, completeness: finding.completeness },
      }, finding.observedAt, finding.completeness);
    }
  }
  return Object.freeze({
    schema: OPEN_ASSET_MODEL_BRIDGE_SCHEMA,
    version: OPEN_ASSET_MODEL_BRIDGE_VERSION,
    generatedAt,
    model: Object.freeze({
      name: 'OWASP Open Asset Model',
      profile: 'WHOISleuth bounded external-findings projection',
      reference: 'https://github.com/owasp-amass/open-asset-model',
    }),
    assets: Object.freeze([...assets.values()].sort((left, right) => String(left.key).localeCompare(String(right.key)))),
    relations: Object.freeze([...relations.values()].sort((left, right) => String(left.source).localeCompare(String(right.source)) || String(left.target).localeCompare(String(right.target)))),
    provenance: Object.freeze({
      source: document.source,
      findingsReviewed: document.findings.length,
      evidenceClasses: Object.freeze([...new Set(document.findings.map((finding) => finding.evidenceClass))].sort()),
    }),
    limitations: Object.freeze([
      'This is a versioned WHOISleuth bridge projection using documented Open Asset Model asset and relation vocabulary; receiving tools must still validate it against their supported model version.',
      'Only bounded FQDN, IPAddress, TLSCertificate, dns_record, and san_dns_name projections are emitted. Unsupported finding categories remain represented only by their FQDN asset.',
      'Source completeness is preserved as discovery metadata and is not converted into an Open Asset Model confidence score.',
      'Relations are observations and investigation pivots, not proof of ownership, control, coordination, intent, safety, or maliciousness.',
    ]),
  });
}

export function formatOpenAssetModelBridge(document: ReturnType<typeof buildOpenAssetModelBridge>): string {
  return [
    'Open Asset Model bridge',
    `Assets       ${document.assets.length}`,
    `Relations    ${document.relations.length}`,
    `Findings     ${document.provenance.findingsReviewed}`,
    `Source       ${document.provenance.source.name}`,
    '',
    'Output is a bounded bridge projection; validate it against the receiving implementation before import.',
    '',
  ].join('\n');
}
