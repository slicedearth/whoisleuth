import { Buffer } from 'node:buffer';
import { latestObservationCohort } from '../packages/evidence/latest-observations.mts';
import { canonicalCaaRecord, canonicalDsRecord, canonicalMxRecord } from '../packages/evidence/domain-control-runtime.mts';
import { MAX_DOMAIN_CONTROL_INPUT_RECORDS } from '../packages/contracts/domain-control-manifest.mts';

import {
  scanBoundedJson,
} from '../lib/bounded-json.mts';
import {
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_KEYS,
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  CLI_DOMAIN_CONTROL_REVIEW_LIMITATIONS,
  CLI_DOMAIN_CONTROL_REVIEW_SCHEMA,
  CLI_DOMAIN_CONTROL_REVIEW_VERSION,
  DOMAIN_CONTROL_REVIEW_VERSION,
  MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_DEPTH,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_KEYS,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_VALUES,
  MAX_DOMAIN_CONTROL_REVIEW_LOOKUPS,
  MIN_DOMAIN_CONTROL_REVIEW_LOOKUPS,
} from '../packages/contracts/domain-control-review.mts';
import {
  DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS,
  MAX_FLIGHT_RECORDER_VALUES,
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

function field(
  id: DomainControlFlightRecorderField,
  source: string,
  sourceState: DomainControlObservationState,
  values: readonly string[],
): Field {
  return Object.freeze({ id, source, state: sourceState, values: Object.freeze([...values].sort()) });
}

function recordField(
  id: DomainControlFlightRecorderField,
  source: string,
  sourceState: DomainControlObservationState,
  input: unknown,
  normalize: (value: unknown) => string,
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
  );
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
    recordField('delegation_ds', 'DNS delegation', state(delegation.status), delegationRecords.ds, canonicalDsRecord),
    recordField('mail_exchangers', 'DNS', dnsState, dnsRecords.mx, canonicalMxRecord),
    recordField('caa_policy', 'DNS', state(record(dns.caaPolicy).status ?? dns.status), record(dns.caaPolicy).records ?? dnsRecords.caa, canonicalCaaRecord),
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

function concurrentFieldValues(candidates: readonly Field[]): Pick<Field, 'source' | 'state' | 'values'> {
  const first = candidates[0]!;
  const identity = (candidate: Field) => JSON.stringify([candidate.source, candidate.state, candidate.values]);
  if (candidates.every((candidate) => identity(candidate) === identity(first))) return first;
  const sources = new Set(candidates.map((candidate) => candidate.source));
  const values = [...new Set(candidates.flatMap((candidate) => candidate.values))].sort();
  const omitted = Math.max(0, values.length - MAX_FLIGHT_RECORDER_VALUES);
  return {
    source: `${sources.size === 1 ? first.source : 'Multiple retained sources'} (conflicting latest observations${omitted ? `; ${omitted} values omitted` : ''})`,
    state: 'partial',
    values: values.slice(0, MAX_FLIGHT_RECORDER_VALUES),
  };
}

function reviewFields(document: SavedLookupDocument, observation: DomainControlFlightRecorderObservation): Field[] {
  return observation.fields.map((candidate) => {
    if (candidate.id !== 'tls_certificate') return candidate;
    const issuer = record(record(record(document.availability).tls).certificate).issuer;
    return { ...candidate, values: list([issuer], (value) => {
      const recordValue = record(value);
      const commonNames = Array.isArray(recordValue.commonNames) ? recordValue.commonNames : [];
      const organisationNames = Array.isArray(recordValue.organizationNames) ? recordValue.organizationNames : [];
      return text(commonNames[0] ?? organisationNames[0] ?? value, 300);
    }) };
  });
}

function mergeConcurrentFields(observations: readonly (readonly Field[])[]): readonly Field[] {
  return Object.freeze((observations[0] ?? []).map((first) => {
    const merged = concurrentFieldValues(observations.flatMap((fields) => fields.filter((candidate) => candidate.id === first.id)));
    return field(first.id, merged.source, merged.state, merged.values);
  }));
}

export function buildCliDomainControlReview(inputText: string, generatedAt = new Date().toISOString()) {
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
    || input.version !== CLI_DOMAIN_CONTROL_REVIEW_VERSION
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
    const observation: DomainControlFlightRecorderObservation = Object.freeze({
      domain,
      observedAt: cohort.observedAt,
      collectionDepth: captures.every((capture) => capture.observation.collectionDepth === first.observation.collectionDepth)
        ? first.observation.collectionDepth : 'unknown',
      fields: mergeConcurrentFields(captures.map((capture) => capture.observation.fields)),
    });
    return { observation, reviewFields: mergeConcurrentFields(captures.map((capture) => reviewFields(capture.document, capture.observation))) };
  });
  const observations = selected.map((item) => item.observation);
  const review = reviewDomainControlManifest({
    schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
    version: DOMAIN_CONTROL_REVIEW_VERSION,
    manifest,
    observations: selected.map(({ observation, reviewFields: fields }) => ({
      domain: observation.domain,
      fields: Object.fromEntries(fields.flatMap((candidate) => {
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
        return [[target, { state: candidate.state, values: candidate.values, source: candidate.source, observedAt: observation.observedAt }]];
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
