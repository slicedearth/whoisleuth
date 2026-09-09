import { Buffer } from 'node:buffer';
import { latestObservationCohort } from '../packages/evidence/latest-observations.mts';
import { canonicalCaaRecord, canonicalDsRecord, canonicalMxRecord, canonicalDomainControlRecords, canonicalPostureRecords } from '../packages/evidence/domain-control-runtime.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';
import { postureTransferRestriction } from '../packages/evidence/domain-posture-context.mts';
import { MAX_DOMAIN_CONTROL_INPUT_RECORDS, PUBLIC_DOMAIN_CONTROL_MANIFEST_VERSION } from '../packages/contracts/domain-control-manifest.mts';

import {
  scanBoundedJson,
} from '../lib/bounded-json.mts';
import {
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_KEYS,
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  CLI_DOMAIN_CONTROL_REVIEW_LIMITATIONS,
  CLI_DOMAIN_CONTROL_REVIEW_SCHEMA,
  CLI_DOMAIN_CONTROL_REVIEW_VERSION,
  PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_VERSION,
  SUPPORTED_CLI_DOMAIN_CONTROL_REVIEW_VERSIONS,
  DOMAIN_CONTROL_REVIEW_VERSION,
  MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_DEPTH,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_KEYS,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_VALUES,
  MAX_DOMAIN_CONTROL_REVIEW_LOOKUPS,
  MIN_DOMAIN_CONTROL_REVIEW_LOOKUPS,
  type DomainControlReviewField,
} from '../packages/contracts/domain-control-review.mts';
import {
  MAX_FLIGHT_RECORDER_VALUES,
  mergeConcurrentDomainControlFields,
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

export {
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  CLI_DOMAIN_CONTROL_REVIEW_SCHEMA,
  CLI_DOMAIN_CONTROL_REVIEW_VERSION,
  MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_DEPTH,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_KEYS,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_VALUES,
  MAX_DOMAIN_CONTROL_REVIEW_LOOKUPS,
};

const CLI_REVIEW_INPUT_KEY_SET = new Set<string>(CLI_DOMAIN_CONTROL_REVIEW_INPUT_KEYS);

type Field = DomainControlFlightRecorderObservation['fields'][number];

export const DOMAIN_CONTROL_REVIEW_SOURCE_FIELDS: Readonly<Partial<Record<DomainControlFlightRecorderField, DomainControlReviewField>>> = Object.freeze({
  registry_nameservers: 'nameservers', delegation_ds: 'ds', mail_exchangers: 'mx', caa_policy: 'caa',
  tls_certificate: 'tlsIssuer', tls_public_key: 'tlsSpkiSha256', registrar_lock: 'registrarLock',
});

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
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const normalized = value.trim();
  return normalized || null;
}

function sourceClock(...values: unknown[]): string | null {
  const declared = values.filter((value) => value !== undefined && value !== null);
  const times = declared.map(normalizeExplicitIsoTimestamp);
  return times.length && times.every((time) => time !== null && time === times[0]) ? times[0]! : null;
}

function sourceState(value: UnknownRecord): DomainControlObservationState {
  const result = state(value.status);
  return result === 'observed' && (value.complete === false || value.truncated === true) ? 'partial' : result;
}

function dnsRecordState(dns: UnknownRecord, name: string): DomainControlObservationState {
  const query = record(record(dns.diagnostics)[name]);
  if (!Object.keys(query).length) return sourceState(dns);
  const values = record(dns.records)[name];
  const contradictoryAbsence = query.status === 'not_found' && Array.isArray(values) && values.length > 0;
  if ((query.status === 'success' || query.status === 'not_found') && query.truncated === false && query.discarded === 0
    && !contradictoryAbsence && (query.error === undefined || query.error === null)) return 'observed';
  return state(query.status) === 'observed' || query.status === 'not_found' ? 'partial' : state(query.status);
}

function field(
  id: DomainControlFlightRecorderField,
  source: string,
  sourceState: DomainControlObservationState,
  values: readonly string[],
  observedAt: string | null,
): Field {
  return Object.freeze({ id, source, state: sourceState, values: Object.freeze([...values].sort()), observedAt });
}

function recordField(
  id: DomainControlFlightRecorderField,
  source: string,
  sourceState: DomainControlObservationState,
  input: unknown,
  normalize: (value: unknown) => string,
  observedAt: string | null,
): Field {
  const rows = Array.isArray(input) ? input.slice(0, MAX_DOMAIN_CONTROL_INPUT_RECORDS) : [];
  const values = new Set<string>();
  let invalid = Array.isArray(input) || (input === undefined && sourceState !== 'observed') ? 0 : 1;
  for (const row of rows) {
    let value = '';
    try {
      value = normalize(row);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    if (value) values.add(value);
    else invalid += 1;
  }
  const sorted = [...values].sort();
  const omitted = Math.max(0, (Array.isArray(input) ? input.length : 0) - rows.length)
    + Math.max(0, sorted.length - MAX_FLIGHT_RECORDER_VALUES);
  return field(
    id,
    invalid || omitted ? `${source} (${invalid} invalid; ${omitted} omitted records)` : source,
    sourceState === 'observed' && (invalid || omitted) ? 'partial' : sourceState,
    sorted.slice(0, MAX_FLIGHT_RECORDER_VALUES),
    observedAt,
  );
}

function diagnostic(document: SavedLookupDocument, key: string): DomainControlObservationState {
  return sourceState(record(record(document.diagnostics)[key]));
}

function registryClock(document: SavedLookupDocument, key: 'rdap' | 'whois'): string | null {
  const detail = record(record(document.diagnostics)[key]);
  const publication = record(document[key]);
  const named = key === 'rdap' ? 'fetchedAt' : 'queriedAt';
  return sourceClock(detail.observedAt, detail[named], publication.observedAt, publication[named]);
}

function registryParsed(document: SavedLookupDocument): Readonly<{ parsed: UnknownRecord; source: string; sourceState: DomainControlObservationState; observedAt: string | null }> {
  const rdapState = diagnostic(document, 'rdap');
  const whoisState = diagnostic(document, 'whois');
  const rdap = record(record(document.rdap).parsed);
  if (rdapState === 'observed' && Object.keys(rdap).length) return { parsed: rdap, source: 'Registry RDAP', sourceState: rdapState, observedAt: registryClock(document, 'rdap') };
  const whois = record(record(document.whois).parsed);
  return { parsed: whois, source: 'WHOIS', sourceState: whoisState, observedAt: registryClock(document, 'whois') };
}

function lockValue(parsed: UnknownRecord): string | null {
  const input = parsed.statuses ?? parsed.status;
  const statuses = Array.isArray(input) ? canonicalPostureRecords('registration_lock', input) : null;
  return statuses ? postureTransferRestriction(statuses) : null;
}

function pageIdentityValue(availability: UnknownRecord): string[] {
  const identity = record(availability.pageIdentity);
  const components = [
    text(identity.bodySha256, 64),
    text(identity.faviconHash, 128),
    text(identity.title, 240),
  ].filter((item): item is string => Boolean(item));
  return components.length ? [components.join(' | ')] : [];
}

export function domainControlObservationFromSavedLookup(document: SavedLookupDocument): DomainControlFlightRecorderObservation {
  const availability = record(document.availability);
  const dns = record(availability.dns);
  const dnsRecords = record(dns.records);
  const dnsAt = sourceClock(dns.observedAt, dns.checkedAt);
  const delegation = record(dns.delegation);
  const delegationRecords = record(delegation.records);
  const tls = record(availability.tls);
  const tlsState = sourceState(tls);
  const tlsAt = sourceClock(tls.observedAt, tls.checkedAt);
  const certificate = record(tls.certificate);
  const publicKey = record(certificate.publicKey);
  const http = record(availability.http);
  const registry = registryParsed(document);
  const rdapParsed = record(record(document.rdap).parsed);
  const rdapState = diagnostic(document, 'rdap');
  const rdapAt = registryClock(document, 'rdap');
  const scalar = (id: DomainControlFlightRecorderField, source: string, status: DomainControlObservationState, value: unknown, observedAt: string | null, maximum = 500) =>
    recordField(id, source, status, [value], (item) => text(item, maximum) ?? '', observedAt);
  const hostname = (value: unknown) => canonicalDomainControlRecords([value], 'nameservers')[0] ?? '';
  const identity = record(availability.pageIdentity);
  const identityValues = pageIdentityValue(availability);
  const fields: Field[] = [
    scalar('registrar', registry.source, registry.sourceState, record(registry.parsed.registrar).name ?? registry.parsed.registrar, registry.observedAt, 300),
    scalar('registrar_lock', registry.source, registry.sourceState, lockValue(registry.parsed), registry.observedAt, 20),
    scalar('registry_dnssec', 'Registry RDAP', rdapState, rdapParsed.dnssec, rdapAt, 80),
    recordField('registry_nameservers', 'Registry RDAP', rdapState, rdapParsed.nameservers, hostname, rdapAt),
    recordField('whois_nameservers', 'WHOIS', diagnostic(document, 'whois'), record(record(document.whois).parsed).nameservers, hostname, registryClock(document, 'whois')),
    recordField('delegated_nameservers', 'DNS NS', dnsRecordState(dns, 'ns'), dnsRecords.ns, hostname, dnsAt),
    recordField('delegation_ds', 'DNS delegation', Object.hasOwn(delegationRecords, 'ds') ? sourceState(delegation) : 'unsupported', delegationRecords.ds, canonicalDsRecord, sourceClock(delegation.observedAt)),
    recordField('mail_exchangers', 'DNS MX', dnsRecordState(dns, 'mx'), dnsRecords.mx, canonicalMxRecord, dnsAt),
    recordField('caa_policy', 'DNS CAA', dnsRecordState(dns, 'caa'), dnsRecords.caa, canonicalCaaRecord, dnsAt),
    scalar('tls_certificate', 'TLS', tlsState, certificate.fingerprintSha256 ?? tls.fingerprintSha256, tlsAt, 128),
    scalar('tls_public_key', 'TLS', tlsState, publicKey.fingerprintSha256 ?? tls.spkiSha256, tlsAt, 128),
    scalar('http_origin', 'HTTP', sourceState(http), http.finalOrigin, sourceClock(http.observedAt, http.checkedAt)),
    field('page_identity', 'Static page identity', sourceState(identity) === 'observed' && !identityValues.length ? 'partial' : sourceState(identity), identityValues, sourceClock(identity.observedAt)),
  ];
  return Object.freeze({
    domain: document.registrableDomain, capturedAt: document.generatedAt, collectionDepth: document.mode,
    fields: Object.freeze(fields.map((item) => item.state === 'observed' && item.observedAt !== null
      && Date.parse(item.observedAt) > Date.parse(document.generatedAt) ? Object.freeze({ ...item, state: 'partial' as const }) : item)),
  });
}

function reviewFields(document: SavedLookupDocument, observation: DomainControlFlightRecorderObservation): Field[] {
  return observation.fields.map((candidate) => {
    if (candidate.id !== 'tls_certificate') return candidate;
    const issuer = record(record(record(document.availability).tls).certificate).issuer;
    const value = record(issuer);
    const commonNames = Array.isArray(value.commonNames) ? value.commonNames : [];
    const organisationNames = Array.isArray(value.organizationNames) ? value.organizationNames : [];
    return recordField(candidate.id, candidate.source, candidate.state,
      [commonNames[0] ?? organisationNames[0] ?? issuer], (item) => text(item, 300) ?? '', candidate.observedAt);
  });
}

export function buildCliDomainControlReview(inputText: string, generatedAt = new Date().toISOString()) {
  const reviewTime = normalizeExplicitIsoTimestamp(generatedAt);
  if (!reviewTime) throw new CliUsageError('Domain-control review time must include a valid explicit timezone.');
  generatedAt = reviewTime;
  if (Buffer.byteLength(inputText, 'utf8') > MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES) {
    throw new CliUsageError(`Domain-control review input is limited to ${MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES} bytes.`);
  }
  const normalizedInput = inputText.replace(/^\uFEFF/u, '');
  try {
    scanBoundedJson(normalizedInput, {
      maximumDepth: MAX_DOMAIN_CONTROL_REVIEW_JSON_DEPTH,
      maximumKeys: MAX_DOMAIN_CONTROL_REVIEW_JSON_KEYS,
      maximumValues: MAX_DOMAIN_CONTROL_REVIEW_JSON_VALUES,
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : '';
    if (detail === 'Artefact input is not valid JSON.') {
      throw new CliUsageError('Domain-control review input must be valid JSON.');
    }
    const boundedDetail = detail.replace(/^Artefact JSON /u, '');
    throw new CliUsageError(boundedDetail
      ? `Domain-control review input ${boundedDetail}`
      : 'Domain-control review input must be valid JSON.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedInput);
  } catch {
    throw new CliUsageError('Domain-control review input must be valid JSON.');
  }
  const input = record(parsed);
  if (input.schema !== CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA
    || !SUPPORTED_CLI_DOMAIN_CONTROL_REVIEW_VERSIONS.some((version) => version === input.version)
    || !Array.isArray(input.lookups)) {
    throw new CliUsageError(`Domain-control review input must use ${CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA} version ${CLI_DOMAIN_CONTROL_REVIEW_VERSION}.`);
  }
  if (Object.keys(input).some((key) => !CLI_REVIEW_INPUT_KEY_SET.has(key))) {
    throw new CliUsageError('Domain-control review input contains an unsupported field.');
  }
  if (input.lookups.length < MIN_DOMAIN_CONTROL_REVIEW_LOOKUPS
    || input.lookups.length > MAX_DOMAIN_CONTROL_REVIEW_LOOKUPS) {
    throw new CliUsageError(`Domain-control review requires from ${MIN_DOMAIN_CONTROL_REVIEW_LOOKUPS} to ${MAX_DOMAIN_CONTROL_REVIEW_LOOKUPS} saved Lookup documents.`);
  }
  const manifest = verifyDomainControlManifest(input.manifest);
  if (input.version === PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_VERSION && manifest.version !== PUBLIC_DOMAIN_CONTROL_MANIFEST_VERSION) {
    throw new CliUsageError(`Public domain-control review input version ${PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_VERSION} requires manifest version ${PUBLIC_DOMAIN_CONTROL_MANIFEST_VERSION}.`);
  }
  const lookups = input.lookups.map((item, index) => parseSavedLookupDocument(JSON.stringify(item), { label: `Lookup ${index + 1}` }));
  const byDomain = new Map<string, SavedLookupDocument[]>();
  for (const lookup of lookups) {
    const group = byDomain.get(lookup.registrableDomain) ?? [];
    group.push(lookup);
    byDomain.set(lookup.registrableDomain, group);
  }
  let ignoredHistoricalLookups = 0;
  const selected = [...byDomain.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([domain, documents]) => {
    const cohort = latestObservationCohort(documents, (document) => document.generatedAt);
    ignoredHistoricalLookups += cohort.superseded;
    const captures = cohort.latest.map((document) => ({ document, observation: domainControlObservationFromSavedLookup(document) }));
    const first = captures[0];
    if (!first || !cohort.observedAt || cohort.undated.length) throw new CliUsageError('Saved Lookup observation times could not be ordered.');
    const mergedFields = mergeConcurrentDomainControlFields(captures.map((capture) => capture.observation.fields));
    const futureCapture = Date.parse(cohort.observedAt) > Date.parse(generatedAt);
    const observation: DomainControlFlightRecorderObservation = Object.freeze({
      domain,
      capturedAt: cohort.observedAt,
      collectionDepth: captures.every((capture) => capture.observation.collectionDepth === first.observation.collectionDepth)
        ? first.observation.collectionDepth : 'unknown',
      fields: futureCapture ? mergedFields.map((field) => ({ ...field, state: 'partial' as const })) : mergedFields,
    });
    const fields = mergeConcurrentDomainControlFields(captures.map((capture) => reviewFields(capture.document, capture.observation)));
    return { observation, reviewFields: futureCapture || observation.collectionDepth === 'unknown'
      ? fields.map((field) => ({ ...field, state: 'partial' as const })) : fields };
  });
  const observations = selected.map((item) => item.observation);
  const review = reviewDomainControlManifest({
    schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
    version: DOMAIN_CONTROL_REVIEW_VERSION,
    manifest,
    observations: selected.map(({ observation, reviewFields: fields }) => ({
      domain: observation.domain,
      fields: Object.fromEntries(fields.flatMap((candidate) => {
        const target = DOMAIN_CONTROL_REVIEW_SOURCE_FIELDS[candidate.id];
        if (!target) return [];
        return [[target, { state: candidate.state, values: candidate.values, source: candidate.source, observedAt: candidate.observedAt }]];
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
      ignoredHistoricalLookups,
    }),
    limitations: CLI_DOMAIN_CONTROL_REVIEW_LIMITATIONS,
  });
}

export function buildControlReviewInput(manifest: DomainControlManifest, lookupDocuments: readonly SavedLookupDocument[]) {
  return Object.freeze({
    schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
    version: CLI_DOMAIN_CONTROL_REVIEW_VERSION,
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
