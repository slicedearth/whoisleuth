import { normalizeExplicitIsoTimestamp } from './observation.mts';
import { normalizeDomain } from './domain-name.mts';

export const DOMAIN_POSTURE_COMPARISON_VERSION = 1;
export const MAX_POSTURE_CHECKS = 32;
export const MAX_POSTURE_CHECK_RECORDS = 64;
export const MAX_POSTURE_RECORD_LENGTH = 4096;

export type DomainPostureSourceContext = Readonly<{
  version: typeof DOMAIN_POSTURE_COMPARISON_VERSION;
  source: 'dns_ns' | 'dns_mx' | 'dns_caa' | 'registry_rdap';
  observedAt: string | null;
  state: 'complete' | 'partial' | 'unavailable';
  omittedRecords: number | null;
}>;

export type DomainPostureProfileContext = Readonly<{
  version: typeof DOMAIN_POSTURE_COMPARISON_VERSION;
  domain: string;
  profileId: string;
  profileFingerprint: string;
}>;

export type DomainPostureCheck = {
  id: string;
  label: string;
  status: 'danger' | 'info' | 'pass' | 'warning';
  summary: string;
  detail: string;
  records: string[];
  remediation: string;
  sourceContext?: DomainPostureSourceContext;
};

function contextRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length) throw new TypeError(`${label} has an invalid structure.`);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError(`${label} requires ordinary data fields.`);
    result[key] = descriptor.value;
  }
  if (result.version !== DOMAIN_POSTURE_COMPARISON_VERSION) throw new TypeError(`${label} has an unsupported comparison version.`);
  return result;
}

/** Missing legacy provenance stays missing; declared malformed or future context is rejected. */
export function normalizeDomainPostureSourceContext(value: unknown): DomainPostureSourceContext | undefined {
  if (value === undefined) return undefined;
  const source = contextRecord(value, ['version', 'source', 'observedAt', 'state', 'omittedRecords'], 'Posture source context');
  const observedAt = normalizeExplicitIsoTimestamp(source.observedAt);
  if (typeof source.source !== 'string' || !['dns_ns', 'dns_mx', 'dns_caa', 'registry_rdap'].includes(source.source)
    || typeof source.state !== 'string' || !['complete', 'partial', 'unavailable'].includes(source.state)
    || (source.observedAt !== null && observedAt === null)
    || (source.omittedRecords !== null && (!Number.isSafeInteger(source.omittedRecords) || Number(source.omittedRecords) < 0))
    || (source.state === 'complete' && source.omittedRecords !== 0)) {
    throw new TypeError('Posture source context has invalid provenance or omission counts.');
  }
  return Object.freeze({ ...source, observedAt }) as DomainPostureSourceContext;
}

export function normalizeDomainPostureProfileContext(value: unknown): DomainPostureProfileContext | undefined {
  if (value === undefined) return undefined;
  const source = contextRecord(value, ['version', 'domain', 'profileId', 'profileFingerprint'], 'Posture profile context');
  const domain = typeof source.domain === 'string' ? normalizeDomain(source.domain) : '';
  if (!domain || domain !== source.domain || typeof source.profileId !== 'string'
    || !source.profileId.trim() || source.profileId.length > 200 || /[\u0000-\u001f\u007f]/u.test(source.profileId)
    || typeof source.profileFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(source.profileFingerprint)) {
    throw new TypeError('Posture profile context has an invalid target or collection identity.');
  }
  return Object.freeze(source) as DomainPostureProfileContext;
}

export const POSTURE_CHECK_SOURCES = Object.freeze({
  nameservers: 'dns_ns', mx: 'dns_mx', caa: 'dns_caa', registration_lock: 'registry_rdap',
} as const);

export const POSTURE_SOURCE_LABELS: Readonly<Record<DomainPostureSourceContext['source'], string>> = Object.freeze({
  dns_ns: 'DNS NS', dns_mx: 'DNS MX', dns_caa: 'DNS CAA', registry_rdap: 'Registry RDAP',
});

export function postureTransferRestriction(records: readonly string[]): 'required' | 'not_required' | null {
  if (!records.length) return null;
  return records.some((value) => value === 'clienttransferprohibited' || value === 'servertransferprohibited')
    ? 'required' : 'not_required';
}

export function postureSourceAdmission(
  check: Pick<DomainPostureCheck, 'id' | 'sourceContext'> | undefined,
  capturedAt: unknown,
  now: unknown,
): string | null {
  if (!check?.sourceContext) return 'Source comparison context is unavailable for this retained check.';
  const context = check.sourceContext;
  const expected = POSTURE_CHECK_SOURCES[check.id as keyof typeof POSTURE_CHECK_SOURCES];
  if (context.version !== DOMAIN_POSTURE_COMPARISON_VERSION || !expected || expected !== context.source) return 'The source or comparison version does not match this field.';
  const captured = normalizeExplicitIsoTimestamp(capturedAt);
  const observed = normalizeExplicitIsoTimestamp(context.observedAt);
  const reviewed = normalizeExplicitIsoTimestamp(now);
  if (!captured || !observed || !reviewed) return 'A source, capture or review time is unavailable.';
  if (Date.parse(observed) > Date.parse(captured) || Date.parse(captured) > Date.parse(reviewed)) return 'The source or capture time is later than its review.';
  if (context.state !== 'complete' || context.omittedRecords !== 0) return 'The source observation is incomplete; retained values cannot establish alignment or drift.';
  return null;
}
