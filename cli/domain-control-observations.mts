import { Buffer } from 'node:buffer';

import {
  DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS,
  type DomainControlFlightRecorderField,
  type DomainControlFlightRecorderObservation,
  type DomainControlObservationState,
} from '../lib/domain-control-flight-recorder.mts';
import {
  DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  reviewDomainControlManifest,
  verifyDomainControlManifest,
  type DomainControlManifest,
} from '../lib/domain-control-manifest.mts';
import { CliUsageError } from './errors.mts';
import { parseSavedLookupDocument, type SavedLookupDocument, type UnknownRecord } from './saved-lookup.mts';

export const CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA = 'whoisleuth.cli.domain-control-review-input';
export const CLI_DOMAIN_CONTROL_REVIEW_SCHEMA = 'whoisleuth.cli.domain-control-review';
export const CLI_DOMAIN_CONTROL_REVIEW_VERSION = 1;
export const MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES = 32 * 1024 * 1024;

type Field = DomainControlFlightRecorderObservation['fields'][number];

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function state(value: unknown): DomainControlObservationState {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (normalized === 'success' || normalized === 'complete') return 'observed';
  if (normalized === 'partial' || normalized === 'not_found') return 'partial';
  if (normalized === 'unsupported' || normalized === 'not_applicable') return 'unsupported';
  return 'unavailable';
}

function text(value: unknown, maximum = 500): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum);
  return normalized || null;
}

function list(value: unknown, normalizer: (item: unknown) => string | null = (item) => text(item)): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 128).flatMap((item) => {
    const normalized = normalizer(item);
    return normalized ? [normalized.toLowerCase()] : [];
  }))].sort().slice(0, 32);
}

function hostname(value: unknown): string | null {
  return text(value, 253)?.toLowerCase().replace(/\.$/u, '') ?? null;
}

function mxValue(value: unknown): string | null {
  const item = record(value);
  const exchange = hostname(item.exchange ?? item.host ?? item.value);
  if (!exchange) return text(value);
  const priority = Number.isSafeInteger(item.priority) && Number(item.priority) >= 0 ? Number(item.priority) : null;
  return priority === null ? exchange : `${priority} ${exchange}`;
}

function caaValue(value: unknown): string | null {
  const item = record(value);
  const tag = text(item.tag, 32)?.toLowerCase();
  const recordValue = text(item.value, 500)?.toLowerCase();
  if (!tag || !recordValue) return text(value);
  const critical = Number.isSafeInteger(item.critical) ? Number(item.critical) : Number.isSafeInteger(item.flags) ? Number(item.flags) : 0;
  return `${critical} ${tag} ${recordValue}`;
}

function dsValue(value: unknown): string | null {
  const item = record(value);
  const keyTag = Number.isSafeInteger(item.keyTag) ? item.keyTag : null;
  const algorithm = Number.isSafeInteger(item.algorithm) ? item.algorithm : null;
  const digestType = Number.isSafeInteger(item.digestType) ? item.digestType : null;
  const digest = text(item.digest, 512)?.toLowerCase();
  return keyTag !== null && algorithm !== null && digestType !== null && digest
    ? `${keyTag} ${algorithm} ${digestType} ${digest}`
    : text(value);
}

function field(
  id: DomainControlFlightRecorderField,
  source: string,
  sourceState: DomainControlObservationState,
  values: readonly string[],
): Field {
  return Object.freeze({ id, source, state: sourceState, values: Object.freeze([...values].sort()) });
}

function diagnostic(document: SavedLookupDocument, key: string): DomainControlObservationState {
  return state(record(document.diagnostics)[key] && record(record(document.diagnostics)[key]).status);
}

function registryParsed(document: SavedLookupDocument): Readonly<{ parsed: UnknownRecord; source: string; sourceState: DomainControlObservationState }> {
  const rdapState = diagnostic(document, 'rdap');
  const whoisState = diagnostic(document, 'whois');
  const rdap = record(record(document.rdap).parsed);
  if (rdapState === 'observed' && Object.keys(rdap).length) return { parsed: rdap, source: 'Registry RDAP', sourceState: rdapState };
  const whois = record(record(document.whois).parsed);
  return { parsed: whois, source: 'WHOIS', sourceState: whoisState };
}

function lockValue(parsed: UnknownRecord): string[] {
  const statuses = list(parsed.statuses ?? parsed.status, (item) => text(item, 120)?.replace(/[\s_-]+/gu, '').toLowerCase() ?? null);
  return [statuses.some((item) => item.includes('transferprohibited')) ? 'required' : 'not_required'];
}

function pageIdentityValue(availability: UnknownRecord): string[] {
  const identity = record(availability.pageIdentity);
  const components = [
    text(identity.bodySha256 ?? availability.pageBodySha256, 64),
    text(identity.faviconHash ?? availability.faviconHash, 128),
    text(identity.title ?? availability.pageTitle, 240),
  ].filter((item): item is string => Boolean(item));
  return components.length ? [components.join(' | ').toLowerCase()] : [];
}

export function domainControlObservationFromSavedLookup(document: SavedLookupDocument): DomainControlFlightRecorderObservation {
  const availability = record(document.availability);
  const dns = record(availability.dns);
  const dnsRecords = record(dns.records);
  const delegation = record(dns.delegation);
  const delegationRecords = record(delegation.records);
  const tls = record(availability.tls);
  const tlsState = state(tls.status);
  const certificate = record(tls.certificate);
  const publicKey = record(certificate.publicKey);
  const http = record(availability.http);
  const httpState = state(http.status);
  const registry = registryParsed(document);
  const rdapParsed = record(record(document.rdap).parsed);
  const rdapState = diagnostic(document, 'rdap');
  const dnsState = state(dns.status);
  const fields: Field[] = [
    field('registrar', registry.source, registry.sourceState, list([record(registry.parsed.registrar).name ?? registry.parsed.registrar], (item) => text(item, 300))),
    field('registrar_lock', registry.source, registry.sourceState, registry.sourceState === 'observed' ? lockValue(registry.parsed) : []),
    field('registry_dnssec', 'Registry RDAP', rdapState, list([rdapParsed.dnssec], (item) => text(item, 80))),
    field('registry_nameservers', 'Registry RDAP', rdapState, list(rdapParsed.nameservers, hostname)),
    field('whois_nameservers', 'WHOIS', diagnostic(document, 'whois'), list(record(record(document.whois).parsed).nameservers, hostname)),
    field('delegated_nameservers', 'DNS', dnsState, list(dnsRecords.ns, hostname)),
    field('delegation_ds', 'DNS delegation', state(delegation.status ?? dns.status), list(delegationRecords.ds ?? rdapParsed.dsData, dsValue)),
    field('mail_exchangers', 'DNS', dnsState, list(dnsRecords.mx, mxValue)),
    field('caa_policy', 'DNS', dnsState, list(record(dns.caaPolicy).records ?? dnsRecords.caa, caaValue)),
    field('tls_certificate', 'TLS', tlsState, list([certificate.fingerprintSha256 ?? tls.fingerprintSha256], (item) => text(item, 128))),
    field('tls_public_key', 'TLS', tlsState, list([publicKey.fingerprintSha256 ?? tls.spkiSha256], (item) => text(item, 128))),
    field('http_origin', 'HTTP', httpState, list([http.finalOrigin ?? availability.httpFinalOrigin], (item) => text(item, 500))),
    field('page_identity', 'Static page identity', state(record(availability.pageIdentity).status ?? availability.pageIdentityStatus ?? http.status), pageIdentityValue(availability)),
  ];
  return Object.freeze({
    domain: document.registrableDomain,
    observedAt: document.generatedAt,
    collectionDepth: document.mode,
    fields: Object.freeze(fields.filter((item) => DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS.includes(item.id))),
  });
}

export function buildCliDomainControlReview(inputText: string, generatedAt = new Date().toISOString()) {
  if (Buffer.byteLength(inputText, 'utf8') > MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES) {
    throw new CliUsageError(`Domain-control review input is limited to ${MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(inputText.replace(/^\uFEFF/u, ''));
  } catch {
    throw new CliUsageError('Domain-control review input must be valid JSON.');
  }
  const input = record(parsed);
  if (input.schema !== CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA || input.version !== 1 || !Array.isArray(input.lookups)) {
    throw new CliUsageError(`Domain-control review input must use ${CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA} version 1.`);
  }
  if (Object.keys(input).some((key) => !new Set(['schema', 'version', 'manifest', 'lookups']).has(key))) {
    throw new CliUsageError('Domain-control review input contains an unsupported field.');
  }
  if (input.lookups.length < 1 || input.lookups.length > 100) {
    throw new CliUsageError('Domain-control review requires from 1 to 100 saved Lookup documents.');
  }
  const manifest = verifyDomainControlManifest(input.manifest);
  const lookups = input.lookups.map((item, index) => parseSavedLookupDocument(JSON.stringify(item), { label: `Lookup ${index + 1}` }));
  const latest = new Map<string, SavedLookupDocument>();
  for (const lookup of lookups) {
    const current = latest.get(lookup.registrableDomain);
    if (!current || Date.parse(lookup.generatedAt) > Date.parse(current.generatedAt)) latest.set(lookup.registrableDomain, lookup);
  }
  const observations = [...latest.values()].map(domainControlObservationFromSavedLookup);
  const review = reviewDomainControlManifest({
    schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
    version: 1,
    manifest,
    observations: observations.map((item) => ({
      domain: item.domain,
      fields: Object.fromEntries(item.fields.flatMap((candidate) => {
        const mapping: Partial<Record<DomainControlFlightRecorderField, string>> = {
          registry_nameservers: 'nameservers',
          delegation_ds: 'ds',
          mail_exchangers: 'mx',
          caa_policy: 'caa',
          tls_certificate: 'tlsIssuer',
          tls_public_key: 'tlsSpkiSha256',
          registrar_lock: 'registrarLock',
        };
        const target = mapping[candidate.id];
        if (!target) return [];
        const candidateValues = candidate.id === 'tls_certificate'
          ? list([record(record(record(latest.get(item.domain)?.availability).tls).certificate).issuer], (value) => {
              const issuer = record(value);
              const commonNames = Array.isArray(issuer.commonNames) ? issuer.commonNames : [];
              const organisationNames = Array.isArray(issuer.organizationNames) ? issuer.organizationNames : [];
              return text(commonNames[0] ?? organisationNames[0] ?? value, 300);
            })
          : candidate.values;
        return [[target, { state: candidate.state, values: candidateValues, source: candidate.source, observedAt: item.observedAt }]];
      })),
    })),
  }, generatedAt);
  return Object.freeze({
    schema: CLI_DOMAIN_CONTROL_REVIEW_SCHEMA,
    version: CLI_DOMAIN_CONTROL_REVIEW_VERSION,
    generatedAt,
    review,
    observations: Object.freeze(observations),
    input: Object.freeze({
      lookupsReceived: lookups.length,
      latestDomainObservations: observations.length,
      ignoredHistoricalLookups: lookups.length - observations.length,
    }),
    limitations: Object.freeze([
      'The review uses only supplied saved Lookup documents and performs no request.',
      'The newest supplied observation per domain is used for desired-state comparison; all supplied observations remain available to a separate flight-recorder review.',
      'Raw RDAP, WHOIS, HTTP, TLS, and page payloads are not copied into this output.',
    ]),
  });
}

export function buildControlReviewInput(manifest: DomainControlManifest, lookupDocuments: readonly SavedLookupDocument[]) {
  return Object.freeze({
    schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
    version: 1,
    manifest,
    lookups: Object.freeze(lookupDocuments),
  });
}

export function formatCliDomainControlReview(document: ReturnType<typeof buildCliDomainControlReview>): string {
  const review = document.review;
  return [
    'Domain-control evidence review',
    `State       ${review.state}`,
    `Domains     ${review.domains.length}`,
    `Lookups     ${document.input.lookupsReceived}`,
    `Drift       ${review.counts.drift ?? 0}`,
    `Incomplete  ${(review.counts.partial ?? 0) + (review.counts.unavailable ?? 0) + (review.counts.unsupported ?? 0)}`,
    '',
    ...review.domains.map((item) => `${item.domain}  ${item.state}`),
    '',
    ...document.limitations.map((item) => `Limitation: ${item}`),
    '',
  ].join('\n');
}
