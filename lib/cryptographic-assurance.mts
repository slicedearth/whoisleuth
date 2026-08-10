import { validateDnssecEvidence, type DnssecEvidenceReport } from './dnssec-evidence-validation.mts';
import { reviewRpkiRoute, type RpkiEvidenceReport } from './rpki-evidence.mts';
import { analyzeTlsaEvidence, type TlsaEvidenceReport } from './tlsa-evidence.mts';

const CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA = 'whoisleuth.cryptographic-assurance.input';
const CRYPTOGRAPHIC_ASSURANCE_SCHEMA = 'whoisleuth.cryptographic-assurance.review';
const CRYPTOGRAPHIC_ASSURANCE_VERSION = 1;

type AssuranceFamily = 'dnssec_validation' | 'route_origin_authorisation' | 'dane_tlsa';
type AssuranceCompleteness = 'complete' | 'partial' | 'unavailable';
type UnknownRecord = Record<string, unknown>;

type CryptographicAssuranceCard = Readonly<{
  family: AssuranceFamily;
  label: string;
  authority: string;
  source: string | null;
  observedAt: string | null;
  state: string;
  completeness: AssuranceCompleteness;
  result: DnssecEvidenceReport | RpkiEvidenceReport | TlsaEvidenceReport | null;
  limitations: readonly string[];
}>;

type CryptographicAssuranceReview = Readonly<{
  schema: typeof CRYPTOGRAPHIC_ASSURANCE_SCHEMA;
  version: typeof CRYPTOGRAPHIC_ASSURANCE_VERSION;
  generatedAt: string;
  cards: readonly CryptographicAssuranceCard[];
  combinedState: null;
  limitations: readonly string[];
}>;

function exactRecord(value: unknown, keys: ReadonlySet<string>, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be one object.`);
  const record = value as UnknownRecord;
  const unexpected = Object.keys(record).find((key) => !keys.has(key));
  if (unexpected) throw new TypeError(`${label} contains unsupported field "${unexpected}".`);
  return record;
}

function sourceLabel(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label}.source must be text.`);
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > 160) throw new TypeError(`${label}.source must contain from 1 to 160 characters.`);
  return normalized;
}

function observationTime(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label}.observedAt must be one ISO-compatible timestamp.`);
  }
  return new Date(value).toISOString();
}

function suppliedEvidence(value: unknown, label: string): { source: string; observedAt: string; evidence: UnknownRecord } | null {
  if (value === null || value === undefined) return null;
  const wrapper = exactRecord(value, new Set(['source', 'observedAt', 'evidence']), label);
  if (!wrapper.evidence || typeof wrapper.evidence !== 'object' || Array.isArray(wrapper.evidence)) {
    throw new TypeError(`${label}.evidence must be one object.`);
  }
  return {
    source: sourceLabel(wrapper.source, label),
    observedAt: observationTime(wrapper.observedAt, label),
    evidence: wrapper.evidence as UnknownRecord,
  };
}

function unavailableCard(family: AssuranceFamily, label: string, authority: string): CryptographicAssuranceCard {
  return Object.freeze({
    family,
    label,
    authority,
    source: null,
    observedAt: null,
    state: 'unavailable',
    completeness: 'unavailable',
    result: null,
    limitations: Object.freeze([`No ${label.toLowerCase()} evidence was supplied. No state was inferred from another assurance family.`]),
  });
}

function dnssecCompleteness(report: DnssecEvidenceReport): AssuranceCompleteness {
  return report.state === 'consistent' || report.state === 'conflict' || report.state === 'unsigned'
    ? 'complete'
    : report.state === 'invalid' ? 'unavailable' : 'partial';
}

function rpkiCompleteness(report: RpkiEvidenceReport): AssuranceCompleteness {
  return report.state === 'partial' ? 'partial' : report.state === 'invalid_input' ? 'unavailable' : 'complete';
}

function tlsaCompleteness(report: TlsaEvidenceReport): AssuranceCompleteness {
  return report.state === 'matched' || report.state === 'different' || report.state === 'untrusted'
    ? 'complete'
    : report.state === 'invalid' || report.state === 'unavailable' ? 'unavailable' : 'partial';
}

function buildCryptographicAssuranceReview(inputValue: unknown, generatedAt = new Date().toISOString()): CryptographicAssuranceReview {
  const input = exactRecord(inputValue, new Set(['schema', 'version', 'dnssec', 'routeOrigin', 'tlsa']), 'Cryptographic assurance input');
  if (input.schema !== CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA || input.version !== CRYPTOGRAPHIC_ASSURANCE_VERSION) {
    throw new TypeError(`Cryptographic assurance input must use ${CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA} version ${CRYPTOGRAPHIC_ASSURANCE_VERSION}.`);
  }
  const dnssecInput = suppliedEvidence(input.dnssec, 'dnssec');
  const routeInput = suppliedEvidence(input.routeOrigin, 'routeOrigin');
  const tlsaInput = suppliedEvidence(input.tlsa, 'tlsa');
  if (!dnssecInput && !routeInput && !tlsaInput) throw new TypeError('Cryptographic assurance input must supply at least one evidence family.');

  const dnssec = dnssecInput ? validateDnssecEvidence({
    ownerName: dnssecInput.evidence.ownerName,
    delegationSigned: dnssecInput.evidence.delegationSigned,
    dsRecords: dnssecInput.evidence.dsRecords,
    dnskeyRecords: dnssecInput.evidence.dnskeyRecords,
    rrSigRecords: dnssecInput.evidence.rrSigRecords,
    observedAt: dnssecInput.evidence.observedAt ?? dnssecInput.observedAt,
  }) : null;
  const routeOrigin = routeInput ? reviewRpkiRoute({
    routePrefix: routeInput.evidence.routePrefix,
    originAsn: routeInput.evidence.originAsn,
    authorizations: routeInput.evidence.authorizations,
  }) : null;
  const tlsa = tlsaInput ? analyzeTlsaEvidence({
    serviceName: tlsaInput.evidence.serviceName,
    dnssecState: tlsaInput.evidence.dnssecState,
    pkixValidationState: tlsaInput.evidence.pkixValidationState,
    records: tlsaInput.evidence.records,
    certificateDerBase64: tlsaInput.evidence.certificateDerBase64,
    spkiDerBase64: tlsaInput.evidence.spkiDerBase64,
    authorityMaterials: tlsaInput.evidence.authorityMaterials,
  }) : null;

  const cards: CryptographicAssuranceCard[] = [
    dnssec && dnssecInput ? Object.freeze({
      family: 'dnssec_validation' as const,
      label: 'DNSSEC evidence review',
      authority: 'Supplied delegation, DS, DNSKEY, and signature-time evidence',
      source: dnssecInput.source,
      observedAt: dnssecInput.observedAt,
      state: dnssec.state,
      completeness: dnssecCompleteness(dnssec),
      result: dnssec,
      limitations: dnssec.limitations,
    }) : unavailableCard('dnssec_validation', 'DNSSEC evidence review', 'Supplied delegation, DS, DNSKEY, and signature-time evidence'),
    routeOrigin && routeInput ? Object.freeze({
      family: 'route_origin_authorisation' as const,
      label: 'Route-origin authorisation',
      authority: 'Analyst-supplied validated route-origin snapshot',
      source: routeInput.source,
      observedAt: routeInput.observedAt,
      state: routeOrigin.state,
      completeness: rpkiCompleteness(routeOrigin),
      result: routeOrigin,
      limitations: routeOrigin.limitations,
    }) : unavailableCard('route_origin_authorisation', 'Route-origin authorisation', 'Analyst-supplied validated route-origin snapshot'),
    tlsa && tlsaInput ? Object.freeze({
      family: 'dane_tlsa' as const,
      label: 'DANE and TLSA evidence review',
      authority: 'Supplied TLSA, DNSSEC, PKIX, and certificate material',
      source: tlsaInput.source,
      observedAt: tlsaInput.observedAt,
      state: tlsa.state,
      completeness: tlsaCompleteness(tlsa),
      result: tlsa,
      limitations: tlsa.limitations,
    }) : unavailableCard('dane_tlsa', 'DANE and TLSA evidence review', 'Supplied TLSA, DNSSEC, PKIX, and certificate material'),
  ];
  return Object.freeze({
    schema: CRYPTOGRAPHIC_ASSURANCE_SCHEMA,
    version: CRYPTOGRAPHIC_ASSURANCE_VERSION,
    generatedAt: observationTime(generatedAt, 'generatedAt'),
    cards: Object.freeze(cards),
    combinedState: null,
    limitations: Object.freeze([
      'DNSSEC, route-origin authorisation, and DANE or TLSA remain independently sourced evidence families with separate states, observation times, completeness, and limitations.',
      'No scalar score or combined verdict is produced. A missing, failed, partial, or unsupported family is never inferred from another family.',
      'These reviews do not establish ownership, availability, activity, safety, or maliciousness.',
    ]),
  });
}

export {
  CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA,
  CRYPTOGRAPHIC_ASSURANCE_SCHEMA,
  CRYPTOGRAPHIC_ASSURANCE_VERSION,
  buildCryptographicAssuranceReview,
};

export type {
  AssuranceCompleteness,
  AssuranceFamily,
  CryptographicAssuranceCard,
  CryptographicAssuranceReview,
};
