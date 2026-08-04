import { domainToASCII } from 'node:url';

import { exactKeys } from './bounded-contract-normalizers.mts';
import { normaliseRdata } from './zone-intent-review.mts';

export const DOMAIN_CHANGE_INPUT_SCHEMA = 'whoisleuth.domain-change.input';
export const DOMAIN_CHANGE_REVIEW_SCHEMA = 'whoisleuth.domain-change.review';
export const DOMAIN_CHANGE_REVIEW_VERSION = 1;
export const MAX_DOMAIN_CHANGE_VANTAGES = 16;
export const MAX_DOMAIN_CHANGE_RECORDS = 500;

type UnknownRecord = Record<string, unknown>;
type EvidenceState = 'observed' | 'partial' | 'unavailable';
type RecordType = 'A' | 'AAAA' | 'CAA' | 'CDNSKEY' | 'CDS' | 'CNAME' | 'CSYNC' | 'HTTPS' | 'MX' | 'NS' | 'SRV' | 'SVCB' | 'TLSA' | 'TXT';

const ROOT_KEYS = new Set(['schema', 'version', 'domain', 'authoritySnapshots', 'resolverSnapshots', 'acmeDependencies', 'certificate', 'hsts']);
const SNAPSHOT_KEYS = new Set(['label', 'source', 'state', 'observedAt', 'records']);
const RECORD_KEYS = new Set(['owner', 'type', 'value', 'ttl']);
const ACME_KEYS = new Set(['method', 'owner', 'target', 'provider', 'state']);
const CERTIFICATE_KEYS = new Set(['state', 'observedAt', 'currentSpkiSha256', 'plannedSpkiSha256', 'mustStaple', 'ocspStapled', 'embeddedSctCount']);
const HSTS_KEYS = new Set(['state', 'observedAt', 'header', 'preloadState', 'source']);
const TYPES = new Set<RecordType>(['A', 'AAAA', 'CAA', 'CDNSKEY', 'CDS', 'CNAME', 'CSYNC', 'HTTPS', 'MX', 'NS', 'SRV', 'SVCB', 'TLSA', 'TXT']);

function object(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as UnknownRecord;
}

function text(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== 'string' || value.length > maximum * 4 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be bounded text without control characters.`);
  }
  const normalised = value.replace(/\s+/gu, ' ').trim();
  if (!normalised || normalised.length > maximum) throw new TypeError(`${label} must contain from 1 to ${maximum} characters.`);
  return normalised;
}

function optionalText(value: unknown, label: string, maximum = 500): string | null {
  return value === null || value === undefined || value === '' ? null : text(value, label, maximum);
}

function timestamp(value: unknown, label: string): string {
  const parsed = Date.parse(text(value, label, 64));
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be a valid timestamp.`);
  return new Date(parsed).toISOString();
}

function domain(value: unknown, label: string): string {
  const ascii = domainToASCII(text(value, label, 253).toLowerCase().replace(/\.$/u, ''));
  if (!ascii || !ascii.includes('.') || ascii.length > 253 || ascii.split('.').some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(part))) {
    throw new TypeError(`${label} must be a valid domain name.`);
  }
  return ascii;
}

function owner(value: unknown, apex: string, label: string): string {
  const raw = text(value, label, 253).toLowerCase().replace(/\.$/u, '');
  const candidate = raw === '@' ? apex : raw;
  if (candidate.startsWith('*.')) return `*.${domain(candidate.slice(2), label)}`;
  const service = candidate.split('.');
  if (candidate.length > 253 || service.some((part) => !/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/u.test(part))) {
    throw new TypeError(`${label} must be a valid DNS owner name.`);
  }
  return candidate;
}

function evidenceState(value: unknown, label: string): EvidenceState {
  if (value !== 'observed' && value !== 'partial' && value !== 'unavailable') throw new TypeError(`${label} is unsupported.`);
  return value;
}

function normaliseValue(type: RecordType, value: unknown, label: string): { value: string; treatment: 'normalised' | 'sha256' } {
  const raw = text(value, label, 16_384);
  const normalised = normaliseRdata(type, raw, null);
  return {
    value: normalised.value,
    treatment: normalised.valueTreatment,
  };
}

function normaliseRecord(value: unknown, apex: string, label: string) {
  const input = object(value, label);
  exactKeys(input, RECORD_KEYS, label);
  const type = text(input.type, `${label}.type`, 16).toUpperCase() as RecordType;
  if (!TYPES.has(type)) throw new TypeError(`${label}.type is unsupported.`);
  const ttl = input.ttl === undefined || input.ttl === null
    ? null
    : Number.isSafeInteger(input.ttl) && Number(input.ttl) >= 0 && Number(input.ttl) <= 0x7fff_ffff
      ? Number(input.ttl)
      : (() => { throw new TypeError(`${label}.ttl is outside its supported range.`); })();
  return Object.freeze({ owner: owner(input.owner, apex, `${label}.owner`), type, ttl, ...normaliseValue(type, input.value, `${label}.value`) });
}

function normaliseSnapshots(value: unknown, apex: string, label: string) {
  if (!Array.isArray(value) || value.length > MAX_DOMAIN_CHANGE_VANTAGES) throw new TypeError(`${label} must contain no more than ${MAX_DOMAIN_CHANGE_VANTAGES} snapshots.`);
  let totalRecords = 0;
  const snapshots = value.map((raw, index) => {
    const item = object(raw, `${label}[${index}]`);
    exactKeys(item, SNAPSHOT_KEYS, `${label}[${index}]`);
    const state = evidenceState(item.state, `${label}[${index}].state`);
    if (!Array.isArray(item.records)) throw new TypeError(`${label}[${index}].records must be an array.`);
    totalRecords += item.records.length;
    if (totalRecords > MAX_DOMAIN_CHANGE_RECORDS) throw new TypeError(`Domain change review is limited to ${MAX_DOMAIN_CHANGE_RECORDS} records.`);
    const records = item.records.map((recordValue, recordIndex) => normaliseRecord(recordValue, apex, `${label}[${index}].records[${recordIndex}]`));
    if (state === 'unavailable' && records.length) throw new TypeError(`${label}[${index}] cannot contain records when unavailable.`);
    return Object.freeze({
      label: text(item.label, `${label}[${index}].label`, 120),
      source: text(item.source, `${label}[${index}].source`, 240),
      state,
      observedAt: timestamp(item.observedAt, `${label}[${index}].observedAt`),
      records: Object.freeze(records),
    });
  });
  if (new Set(snapshots.map((item) => item.label.toLowerCase())).size !== snapshots.length) throw new TypeError(`${label} labels must be unique.`);
  return Object.freeze(snapshots);
}

function recordMatrix(snapshots: ReturnType<typeof normaliseSnapshots>) {
  const keys = [...new Set(snapshots.flatMap((snapshot) => snapshot.records.map((item) => `${item.owner}\u0000${item.type}`)))].sort();
  return Object.freeze(keys.map((key) => {
    const [recordOwner, type] = key.split('\u0000') as [string, RecordType];
    const observations = snapshots.map((snapshot) => {
      const matches = snapshot.records.filter((item) => item.owner === recordOwner && item.type === type);
      const ttls = matches.map((item) => item.ttl).filter((ttl): ttl is number => ttl !== null);
      return Object.freeze({
        label: snapshot.label,
        source: snapshot.source,
        state: snapshot.state,
        values: Object.freeze([...new Set(matches.map((item) => item.value))].sort()),
        ttlRange: ttls.length ? Object.freeze({
          minimum: Math.min(...ttls),
          maximum: Math.max(...ttls),
        }) : null,
      });
    });
    const complete = observations.filter((item) => item.state === 'observed');
    const signatures = new Set(complete.map((item) => JSON.stringify(item.values)));
    return Object.freeze({
      owner: recordOwner,
      type,
      state: complete.length < 2 ? 'insufficient' as const : signatures.size === 1 ? 'aligned' as const : 'different' as const,
      observations: Object.freeze(observations),
    });
  }));
}

function reviewDnssecAutomation(matrix: ReturnType<typeof recordMatrix>) {
  const automation = matrix.filter((row) => row.type === 'CDS' || row.type === 'CDNSKEY' || row.type === 'CSYNC');
  const byType = (type: RecordType) => automation.find((row) => row.type === type);
  const cds = byType('CDS');
  const cdnskey = byType('CDNSKEY');
  const csync = byType('CSYNC');
  const conflicts = automation.filter((row) => row.state === 'different');
  const partial = automation.some((row) => row.observations.some((observation) => observation.state !== 'observed'));
  return Object.freeze({
    state: !automation.length ? 'not_observed' as const
      : conflicts.length ? 'conflict' as const
        : partial ? 'partial' as const
          : 'review_ready' as const,
    cdsObserved: Boolean(cds),
    cdnskeyObserved: Boolean(cdnskey),
    csyncObserved: Boolean(csync),
    conflictingTypes: Object.freeze(conflicts.map((row) => row.type)),
    detail: !automation.length
      ? 'No CDS, CDNSKEY, or CSYNC record was supplied.'
      : conflicts.length
        ? `Complete authority observations differ for ${conflicts.map((row) => row.type).join(', ')}.`
        : partial
          ? 'Automation records were supplied, but at least one authority observation is partial or unavailable.'
          : 'Supplied complete authority observations agree for the observed automation records.',
  });
}

function normaliseAcme(value: unknown, apex: string) {
  if (!Array.isArray(value) || value.length > 64) throw new TypeError('acmeDependencies must contain no more than 64 entries.');
  return Object.freeze(value.map((raw, index) => {
    const item = object(raw, `acmeDependencies[${index}]`);
    exactKeys(item, ACME_KEYS, `acmeDependencies[${index}]`);
    const method = item.method;
    if (method !== 'dns-01' && method !== 'http-01' && method !== 'tls-alpn-01') throw new TypeError(`acmeDependencies[${index}].method is unsupported.`);
    const state = item.state;
    if (state !== 'confirmed' && state !== 'partial' && state !== 'unknown') throw new TypeError(`acmeDependencies[${index}].state is unsupported.`);
    return Object.freeze({
      method,
      owner: owner(item.owner, apex, `acmeDependencies[${index}].owner`),
      target: optionalText(item.target, `acmeDependencies[${index}].target`, 253),
      provider: optionalText(item.provider, `acmeDependencies[${index}].provider`, 120),
      state,
    });
  }));
}

function normaliseCertificate(value: unknown) {
  if (value === null || value === undefined) return null;
  const item = object(value, 'certificate');
  exactKeys(item, CERTIFICATE_KEYS, 'certificate');
  const state = evidenceState(item.state, 'certificate.state');
  const digest = (candidate: unknown, label: string) => {
    const supplied = optionalText(candidate, label, 80);
    if (supplied && !/^[a-f0-9]{64}$/iu.test(supplied)) throw new TypeError(`${label} must be a SHA-256 hexadecimal digest.`);
    return supplied?.toLowerCase() ?? null;
  };
  const nullableBoolean = (candidate: unknown, label: string) => {
    if (candidate === null || candidate === undefined) return null;
    if (typeof candidate !== 'boolean') throw new TypeError(`${label} must be true, false, or null.`);
    return candidate;
  };
  const embeddedSctCount = item.embeddedSctCount === null || item.embeddedSctCount === undefined
    ? null
    : Number.isSafeInteger(item.embeddedSctCount) && Number(item.embeddedSctCount) >= 0 && Number(item.embeddedSctCount) <= 100
      ? Number(item.embeddedSctCount)
      : (() => { throw new TypeError('certificate.embeddedSctCount is outside its supported range.'); })();
  return Object.freeze({
    state,
    observedAt: timestamp(item.observedAt, 'certificate.observedAt'),
    currentSpkiSha256: digest(item.currentSpkiSha256, 'certificate.currentSpkiSha256'),
    plannedSpkiSha256: digest(item.plannedSpkiSha256, 'certificate.plannedSpkiSha256'),
    mustStaple: nullableBoolean(item.mustStaple, 'certificate.mustStaple'),
    ocspStapled: nullableBoolean(item.ocspStapled, 'certificate.ocspStapled'),
    embeddedSctCount,
  });
}

function reviewCertificate(certificate: ReturnType<typeof normaliseCertificate>) {
  if (!certificate) return Object.freeze({ state: 'not_supplied' as const, continuity: 'unknown' as const, findings: Object.freeze([]) });
  const continuity = !certificate.currentSpkiSha256 || !certificate.plannedSpkiSha256
    ? 'unknown' as const
    : certificate.currentSpkiSha256 === certificate.plannedSpkiSha256 ? 'retained' as const : 'changes' as const;
  const findings = [
    ...(certificate.mustStaple === true && certificate.ocspStapled !== true
      ? ['The certificate requires OCSP stapling, but stapled-response evidence was not confirmed.'] : []),
    ...(certificate.embeddedSctCount === 0
      ? ['No embedded certificate-transparency timestamp was observed; this does not establish that the certificate was not logged by another mechanism.'] : []),
  ];
  return Object.freeze({ state: certificate.state, continuity, findings: Object.freeze(findings) });
}

function normaliseHsts(value: unknown) {
  if (value === null || value === undefined) return null;
  const item = object(value, 'hsts');
  exactKeys(item, HSTS_KEYS, 'hsts');
  const preloadState = item.preloadState;
  if (preloadState !== 'listed' && preloadState !== 'not_listed' && preloadState !== 'unavailable') throw new TypeError('hsts.preloadState is unsupported.');
  return Object.freeze({
    state: evidenceState(item.state, 'hsts.state'),
    observedAt: timestamp(item.observedAt, 'hsts.observedAt'),
    header: optionalText(item.header, 'hsts.header', 1_024),
    preloadState,
    source: text(item.source, 'hsts.source', 240),
  });
}

function serviceInventory(snapshots: readonly ReturnType<typeof normaliseSnapshots>[number][]) {
  return Object.freeze(snapshots.flatMap((snapshot) => snapshot.records
    .filter((item) => item.type === 'SRV')
    .map((item) => Object.freeze({ owner: item.owner, value: item.value, source: snapshot.source, state: snapshot.state, observedAt: snapshot.observedAt })))
    .sort((left, right) => left.owner.localeCompare(right.owner) || left.value.localeCompare(right.value)));
}

export function reviewDomainChange(inputRaw: unknown, generatedAtValue = new Date().toISOString()) {
  const input = object(inputRaw, 'Domain change input');
  if (input.schema !== DOMAIN_CHANGE_INPUT_SCHEMA || input.version !== 1) throw new TypeError(`Domain change input must use ${DOMAIN_CHANGE_INPUT_SCHEMA} version 1.`);
  exactKeys(input, ROOT_KEYS, 'Domain change input');
  const apex = domain(input.domain, 'domain');
  const authoritySnapshots = normaliseSnapshots(input.authoritySnapshots ?? [], apex, 'authoritySnapshots');
  const resolverSnapshots = normaliseSnapshots(input.resolverSnapshots ?? [], apex, 'resolverSnapshots');
  const authorityMatrix = recordMatrix(authoritySnapshots);
  const resolverMatrix = recordMatrix(resolverSnapshots);
  const acmeDependencies = normaliseAcme(input.acmeDependencies ?? [], apex);
  const certificate = normaliseCertificate(input.certificate);
  const hsts = normaliseHsts(input.hsts);
  const differentAuthorityRows = authorityMatrix.filter((row) => row.state === 'different');
  const differentResolverRows = resolverMatrix.filter((row) => row.state === 'different');
  const incompleteVantages = [...authoritySnapshots, ...resolverSnapshots].filter((item) => item.state !== 'observed');
  const reviewRequired = differentAuthorityRows.length > 0
    || differentResolverRows.length > 0
    || incompleteVantages.length > 0
    || acmeDependencies.some((item) => item.state !== 'confirmed')
    || reviewCertificate(certificate).findings.length > 0;
  return Object.freeze({
    schema: DOMAIN_CHANGE_REVIEW_SCHEMA,
    version: DOMAIN_CHANGE_REVIEW_VERSION,
    generatedAt: timestamp(generatedAtValue, 'generatedAt'),
    domain: apex,
    state: reviewRequired ? 'review' as const : 'ready' as const,
    authoritativeRecordMatrix: authorityMatrix,
    resolverDivergenceMatrix: resolverMatrix,
    dnssecAutomation: reviewDnssecAutomation(authorityMatrix),
    acmeDependencies,
    certificate: reviewCertificate(certificate),
    services: serviceInventory([...authoritySnapshots, ...resolverSnapshots]),
    hsts,
    gate: Object.freeze({
      pass: !reviewRequired,
      reasons: Object.freeze([
        ...differentAuthorityRows.map((row) => `Authority observations differ for ${row.owner} ${row.type}.`),
        ...differentResolverRows.map((row) => `Resolver observations differ for ${row.owner} ${row.type}.`),
        ...incompleteVantages.map((item) => `${item.label} evidence is ${item.state}.`),
        ...acmeDependencies.filter((item) => item.state !== 'confirmed').map((item) => `${item.method} dependency for ${item.owner} is ${item.state}.`),
        ...reviewCertificate(certificate).findings,
      ]),
    }),
    limitations: Object.freeze([
      'This local review uses only analyst-supplied observations and makes no DNS, HTTP, certificate, certificate-authority, preload-list, or provider request.',
      'Different observations can reflect propagation, caching, split-horizon DNS, resolver policy, or collection timing; they do not establish misconfiguration by themselves.',
      'Partial or unavailable evidence is never treated as record absence. TXT values are represented only by SHA-256 digests.',
      'DNSSEC automation readiness describes CDS, CDNSKEY, and CSYNC publication consistency; it does not validate a cryptographic chain or authorise a registry-side change.',
      'HSTS preload state is an analyst-supplied, source-attributed observation and must be refreshed against the nominated source before a change.',
    ]),
  });
}
