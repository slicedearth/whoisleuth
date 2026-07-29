// Pure, bounded projection of an already-collected Lookup result into
// analyst-selectable case facts. It performs no collection and stores only
// the facts the analyst explicitly selects.

import { LOOKUP_EVIDENCE_SCHEMA_VERSION } from './evidence-export.ts';
import {
  createLookupViewModel,
  isJsonObject,
  type JsonObject,
  type LookupHttpResponse,
} from './lookup-response.ts';
import type {
  CaseEvidencePin,
  CaseTransitionExpectation,
} from './case-response-model.ts';

export const CASE_EVIDENCE_CHECKPOINT_VERSION = 1;
export const MAX_CHECKPOINT_FACTS = 20;
export const MAX_CHECKPOINT_LIMITATIONS = 6;

export type CheckpointComparisonState =
  | 'changed'
  | 'conflicting'
  | 'equal'
  | 'missing'
  | 'not_recorded'
  | 'unavailable';

export type CheckpointFact = Readonly<{
  version: 1;
  field: string;
  category: 'dns' | 'http' | 'network' | 'page_identity' | 'registration' | 'tls';
  label: string;
  value: string | null;
  source: string;
  sourceState: string;
  observedAt: string;
  collectionDepth: 'deep' | 'fast' | 'unknown';
  completeness: 'complete' | 'inconclusive' | 'partial' | 'unknown';
  truncated: boolean | null;
  limitations: string[];
  sourceSchema: {
    collection: 'lookup_result';
    schema: 'whoisleuth.lookup-evidence';
    version: typeof LOOKUP_EVIDENCE_SCHEMA_VERSION;
  };
}>;

export type CheckpointComparison = Readonly<{
  field: string;
  category: string;
  label: string;
  before: string;
  after: string | null;
  state: CheckpointComparisonState;
  source: string;
  observedAt: string;
  limitations: string[];
}>;

export type AcquisitionTransitionState =
  | 'change_not_observed'
  | 'indeterminate'
  | 'manual_review'
  | 'unexpected_change'
  | 'verified_change'
  | 'verified_preserved';

export type AcquisitionTransitionComparison = CheckpointComparison & Readonly<{
  expectation: CaseTransitionExpectation;
  transitionState: AcquisitionTransitionState;
}>;

const UNAVAILABLE_STATES = new Set([
  'disabled',
  'error',
  'failed',
  'rate_limited',
  'skipped',
  'unavailable',
  'unsupported',
]);
const CONFLICT_STATES = new Set(['conflict', 'conflicting']);
const CONTROL_REPLACE_RE = /[\u0000-\u001f\u007f]+/gu;

function text(value: unknown, maximum = 300): string {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_REPLACE_RE, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum);
}

function timestamp(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length <= 64) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return fallback;
}

function record(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

function normalizedStrings(value: unknown, maximum = 20): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .slice(0, maximum * 2)
    .map((item) => text(item, 300))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, maximum);
}

function factValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Observed' : 'Not observed';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const values = normalizedStrings(value);
    return values.length ? values.join(' · ') : null;
  }
  return text(value, 1_000) || null;
}

function sourceState(value: unknown): string {
  return text(value, 40).toLowerCase().replace(/\s+/gu, '_') || 'unknown';
}

function completeness(state: string): CheckpointFact['completeness'] {
  if (['complete', 'not_found', 'success'].includes(state)) return 'complete';
  if (state === 'partial') return 'partial';
  if (CONFLICT_STATES.has(state)) return 'inconclusive';
  return 'unknown';
}

function sourceLimitations(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .slice(0, MAX_CHECKPOINT_LIMITATIONS * 2)
    .map((item) => text(item, 240))
    .filter(Boolean))]
    .slice(0, MAX_CHECKPOINT_LIMITATIONS);
}

function origin(value: unknown): string | null {
  const candidate = text(value, 2_048);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

function entityName(value: unknown): string | null {
  const entity = record(value);
  return factValue(entity.name ?? entity.org ?? entity.handle);
}

function lifecycleValue(value: JsonObject, field: 'createdDate' | 'expiryDate' | 'updatedDate'): unknown {
  const lifecycle = record(value.lifecycle);
  return lifecycle[`${field}Iso`] ?? lifecycle[field] ?? value[`${field}Iso`] ?? value[field] ?? null;
}

export function buildLookupCheckpointFacts(
  response: LookupHttpResponse,
  options: Readonly<{
    collectionDepth?: 'deep' | 'fast' | 'unknown';
    generatedAt?: string;
  }> = {},
): CheckpointFact[] {
  if (response.type !== 'domain') return [];
  const view = createLookupViewModel(response);
  const generatedAt = timestamp(options.generatedAt, new Date().toISOString());
  const depth = options.collectionDepth ?? 'unknown';
  const rdapDiagnostic = record(view.diagnostics.rdap);
  const whoisDiagnostic = record(view.diagnostics.whois);
  const registrationState = sourceState(rdapDiagnostic.status ?? whoisDiagnostic.status);
  const registrationObservedAt = timestamp(view.rdap.fetchedAt ?? response.fetchedAt, generatedAt);
  const registrationTruncated = view.rdapParsed.serverTruncated === true ? true : null;
  const dns = record(view.availability.dns);
  const dnsRecords = record(dns.records);
  const dnsState = sourceState(dns.status);
  const dnsObservedAt = timestamp(dns.observedAt, generatedAt);
  const tls = record(view.availability.tls);
  const tlsState = sourceState(tls.status);
  const tlsObservedAt = timestamp(tls.observedAt, generatedAt);
  const tlsCertificate = record(tls.certificate);
  const tlsIssuer = record(tlsCertificate.issuer ?? tls.issuer);
  const network = record(view.observedNetworkContext);
  const networkRegistration = record(network.network);
  const networkEndpoint = record(network.endpoint);
  const networkState = sourceState(network.status);
  const networkObservedAt = timestamp(network.observedAt, generatedAt);
  const http = record(view.availability.http);
  const httpResponse = record(http.response);
  const httpState = sourceState(http.status);
  const httpObservedAt = timestamp(http.observedAt, generatedAt);
  const availability = view.availability;
  const pageState = sourceState(availability.websiteProbeStatus ?? http.status);

  const specifications: Array<Omit<CheckpointFact, 'version' | 'sourceSchema'>> = [
    { field: 'registration.registrar', category: 'registration', label: 'Registrar', value: entityName(view.rdapParsed.registrar) ?? entityName(view.whoisParsed.registrar), source: 'registry RDAP or WHOIS', sourceState: registrationState, observedAt: registrationObservedAt, collectionDepth: depth, completeness: completeness(registrationState), truncated: registrationTruncated, limitations: ['Registrar publication is point-in-time registration context and does not prove present control.'] },
    { field: 'registration.statuses', category: 'registration', label: 'Registration statuses', value: factValue(view.rdapParsed.statuses ?? view.whoisParsed.statuses), source: 'registry RDAP or WHOIS', sourceState: registrationState, observedAt: registrationObservedAt, collectionDepth: depth, completeness: completeness(registrationState), truncated: registrationTruncated, limitations: sourceLimitations(view.rdapParsed.limitations) },
    { field: 'registration.created', category: 'registration', label: 'Creation date', value: factValue(lifecycleValue(view.rdapParsed, 'createdDate') ?? lifecycleValue(view.whoisParsed, 'createdDate')), source: 'registry RDAP or WHOIS', sourceState: registrationState, observedAt: registrationObservedAt, collectionDepth: depth, completeness: completeness(registrationState), truncated: registrationTruncated, limitations: [] },
    { field: 'registration.updated', category: 'registration', label: 'Updated date', value: factValue(lifecycleValue(view.rdapParsed, 'updatedDate') ?? lifecycleValue(view.whoisParsed, 'updatedDate')), source: 'registry RDAP or WHOIS', sourceState: registrationState, observedAt: registrationObservedAt, collectionDepth: depth, completeness: completeness(registrationState), truncated: registrationTruncated, limitations: [] },
    { field: 'registration.expires', category: 'registration', label: 'Expiry date', value: factValue(lifecycleValue(view.rdapParsed, 'expiryDate') ?? lifecycleValue(view.whoisParsed, 'expiryDate')), source: 'registry RDAP or WHOIS', sourceState: registrationState, observedAt: registrationObservedAt, collectionDepth: depth, completeness: completeness(registrationState), truncated: registrationTruncated, limitations: [] },
    { field: 'dns.nameservers', category: 'dns', label: 'Nameservers', value: factValue(availability.nameservers ?? view.rdapParsed.nameservers), source: 'DNS or registry publication', sourceState: dnsState, observedAt: dnsObservedAt, collectionDepth: depth, completeness: completeness(dnsState), truncated: dns.truncated === true ? true : null, limitations: sourceLimitations(dns.limitations) },
    { field: 'dns.addresses', category: 'dns', label: 'A and AAAA addresses', value: factValue([...normalizedStrings(dnsRecords.a), ...normalizedStrings(dnsRecords.aaaa)]), source: 'DNS', sourceState: dnsState, observedAt: dnsObservedAt, collectionDepth: depth, completeness: completeness(dnsState), truncated: dns.truncated === true ? true : null, limitations: sourceLimitations(dns.limitations) },
    { field: 'dns.mx', category: 'dns', label: 'MX hosts', value: factValue(availability.mxHosts ?? dnsRecords.mx), source: 'DNS', sourceState: dnsState, observedAt: dnsObservedAt, collectionDepth: depth, completeness: completeness(dnsState), truncated: dns.truncated === true ? true : null, limitations: sourceLimitations(dns.limitations) },
    { field: 'dns.spf', category: 'dns', label: 'SPF publication', value: factValue(availability.hasSpf), source: 'DNS', sourceState: dnsState, observedAt: dnsObservedAt, collectionDepth: depth, completeness: completeness(dnsState), truncated: dns.truncated === true ? true : null, limitations: sourceLimitations(dns.limitations) },
    { field: 'dns.dmarc', category: 'dns', label: 'DMARC publication', value: factValue(availability.hasDmarc), source: 'DNS', sourceState: dnsState, observedAt: dnsObservedAt, collectionDepth: depth, completeness: completeness(dnsState), truncated: dns.truncated === true ? true : null, limitations: sourceLimitations(dns.limitations) },
    { field: 'tls.protocol', category: 'tls', label: 'TLS protocol', value: factValue(tls.protocol), source: 'TLS', sourceState: tlsState, observedAt: tlsObservedAt, collectionDepth: depth, completeness: completeness(tlsState), truncated: tls.truncated === true ? true : null, limitations: sourceLimitations(tls.limitations) },
    { field: 'tls.certificate_sha256', category: 'tls', label: 'TLS certificate SHA-256', value: factValue(tlsCertificate.fingerprintSha256), source: 'TLS', sourceState: tlsState, observedAt: tlsObservedAt, collectionDepth: depth, completeness: completeness(tlsState), truncated: tls.truncated === true ? true : null, limitations: sourceLimitations(tls.limitations) },
    { field: 'tls.issuer', category: 'tls', label: 'TLS issuer', value: entityName(tlsIssuer), source: 'TLS certificate', sourceState: tlsState, observedAt: tlsObservedAt, collectionDepth: depth, completeness: completeness(tlsState), truncated: tls.truncated === true ? true : null, limitations: sourceLimitations(tls.limitations) },
    { field: 'network.selected_address', category: 'network', label: 'Observed network address', value: factValue(networkEndpoint.address), source: 'IP RDAP context', sourceState: networkState, observedAt: networkObservedAt, collectionDepth: depth, completeness: completeness(networkState), truncated: network.truncated === true ? true : null, limitations: sourceLimitations(network.limitations) },
    { field: 'network.registration', category: 'network', label: 'Observed network registration', value: factValue(networkRegistration.name ?? networkRegistration.handle), source: 'IP RDAP context', sourceState: networkState, observedAt: networkObservedAt, collectionDepth: depth, completeness: completeness(networkState), truncated: network.truncated === true ? true : null, limitations: sourceLimitations(network.limitations) },
    { field: 'network.cidrs', category: 'network', label: 'Observed network CIDRs', value: factValue(networkRegistration.cidrs), source: 'IP RDAP context', sourceState: networkState, observedAt: networkObservedAt, collectionDepth: depth, completeness: completeness(networkState), truncated: network.truncated === true ? true : null, limitations: sourceLimitations(network.limitations) },
    { field: 'http.final_origin', category: 'http', label: 'Final website origin', value: origin(http.finalUrl), source: 'HTTP', sourceState: httpState, observedAt: httpObservedAt, collectionDepth: depth, completeness: completeness(httpState), truncated: http.truncated === true ? true : null, limitations: sourceLimitations(http.limitations) },
    { field: 'http.response_status', category: 'http', label: 'HTTP response status', value: factValue(httpResponse.status), source: 'HTTP', sourceState: httpState, observedAt: httpObservedAt, collectionDepth: depth, completeness: completeness(httpState), truncated: http.truncated === true ? true : null, limitations: sourceLimitations(http.limitations) },
    { field: 'page.title', category: 'page_identity', label: 'Page title', value: factValue(availability.pageTitle), source: 'static homepage observation', sourceState: pageState, observedAt: httpObservedAt, collectionDepth: depth, completeness: completeness(pageState), truncated: http.truncated === true ? true : null, limitations: sourceLimitations(http.limitations) },
    { field: 'page.password_field', category: 'page_identity', label: 'Password field', value: factValue(availability.hasPasswordField), source: 'static homepage observation', sourceState: pageState, observedAt: httpObservedAt, collectionDepth: depth, completeness: completeness(pageState), truncated: http.truncated === true ? true : null, limitations: ['Static HTML evidence does not execute JavaScript and may not represent the rendered page.'] },
  ];

  return specifications.map<CheckpointFact>((fact) => ({
    version: 1,
    ...fact,
    sourceSchema: {
      collection: 'lookup_result',
      schema: 'whoisleuth.lookup-evidence',
      version: LOOKUP_EVIDENCE_SCHEMA_VERSION,
    },
  })).slice(0, MAX_CHECKPOINT_FACTS);
}

function checkpointId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `checkpoint-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function checkpointPinInputs(
  facts: readonly CheckpointFact[],
  selectedFields: readonly string[],
  options: Readonly<{
    checkpointId?: string;
    transitionExpectations?: Readonly<Record<string, CaseTransitionExpectation>>;
  }> = {},
): Array<Omit<CaseEvidencePin, 'createdAt' | 'id'>> {
  const selected = new Set(selectedFields.slice(0, MAX_CHECKPOINT_FACTS));
  const id = options.checkpointId && /^[A-Za-z0-9_-]{1,64}$/u.test(options.checkpointId)
    ? options.checkpointId
    : checkpointId();
  return facts
    .filter((fact) => selected.has(fact.field) && fact.value !== null)
    .slice(0, MAX_CHECKPOINT_FACTS)
    .map((fact) => ({
      checkpointId: id,
      field: fact.field,
      category: fact.category,
      label: fact.label,
      value: fact.value ?? '',
      source: fact.source,
      sourceState: fact.sourceState,
      sourceSchema: fact.sourceSchema,
      observedAt: fact.observedAt,
      collectionDepth: fact.collectionDepth,
      completeness: fact.completeness,
      truncated: fact.truncated,
      transitionExpectation: options.transitionExpectations?.[fact.field] ?? null,
      limitations: [...fact.limitations],
    }));
}

export function compareAcquisitionTransitionPins(
  pins: readonly CaseEvidencePin[],
  currentFacts: readonly CheckpointFact[],
): AcquisitionTransitionComparison[] {
  const comparisons = new Map(compareCheckpointPins(pins, currentFacts).map((item) => [item.field, item]));
  return pins
    .filter((pin): pin is CaseEvidencePin & { transitionExpectation: CaseTransitionExpectation } =>
      Boolean(pin.field && pin.transitionExpectation))
    .slice(-MAX_CHECKPOINT_FACTS)
    .flatMap((pin) => {
      const comparison = comparisons.get(pin.field ?? '');
      if (!comparison) return [];
      let transitionState: AcquisitionTransitionState = 'indeterminate';
      if (comparison.state === 'unavailable'
        || comparison.state === 'conflicting'
        || comparison.state === 'missing'
        || comparison.state === 'not_recorded') {
        transitionState = 'indeterminate';
      } else if (pin.transitionExpectation === 'review') {
        transitionState = 'manual_review';
      } else if (pin.transitionExpectation === 'preserve') {
        transitionState = comparison.state === 'equal' ? 'verified_preserved' : 'unexpected_change';
      } else {
        transitionState = comparison.state === 'changed' ? 'verified_change' : 'change_not_observed';
      }
      return [{
        ...comparison,
        expectation: pin.transitionExpectation,
        transitionState,
      }];
    });
}

export function compareCheckpointPins(
  pins: readonly CaseEvidencePin[],
  currentFacts: readonly CheckpointFact[],
): CheckpointComparison[] {
  const currentByField = new Map(currentFacts.map((fact) => [fact.field, fact]));
  return pins
    .filter((pin) => pin.checkpointId && pin.field)
    .slice(-MAX_CHECKPOINT_FACTS)
    .map((pin) => {
      const current = currentByField.get(pin.field ?? '');
      let state: CheckpointComparisonState = 'not_recorded';
      if (current) {
        if (UNAVAILABLE_STATES.has(current.sourceState)) state = 'unavailable';
        else if (CONFLICT_STATES.has(current.sourceState)) state = 'conflicting';
        else if (current.value === null) state = 'missing';
        else state = current.value === pin.value ? 'equal' : 'changed';
      }
      return {
        field: pin.field ?? '',
        category: pin.category ?? 'other',
        label: pin.label,
        before: pin.value,
        after: current?.value ?? null,
        state,
        source: current?.source ?? pin.source,
        observedAt: current?.observedAt ?? pin.observedAt,
        limitations: current?.limitations ?? pin.limitations,
      };
    });
}
