// Minimal presentation-only source settlement summaries for incremental Deep
// Lookup. These deliberately exclude raw RDAP/WHOIS bodies, contacts, URLs,
// provider payloads, and request errors. The ordinary final Lookup response
// remains the only authoritative and persistable result.

import type { ClassifiedQuery } from './classify.mts';
import type {
  LookupProgressSource,
  LookupProgressState,
} from './lookup-progress.mts';

type LookupSourceSettlement = Readonly<{
  source: LookupProgressSource;
  state: LookupProgressState;
  complete: boolean;
  truncated: boolean;
  fragment: Readonly<{
    status: LookupProgressState;
    resultState?: string;
    limitation?: string;
  }>;
}>;

type PlannedLookupProgressOptions = Readonly<{
  externalIntelligence?: boolean;
  malwareHostIntelligence?: boolean;
  malwareIocIntelligence?: boolean;
  securityTxt?: boolean;
}>;

type UnknownRecord = Record<string, unknown>;

const RESULT_STATES = new Set([
  'available',
  'expiring',
  'for_sale',
  'registered',
  'unknown',
]);
const DIRECT_STATES = new Set<LookupProgressState>([
  'success',
  'partial',
  'not_found',
  'skipped',
  'error',
  'unsupported',
  'unavailable',
  'rate_limited',
]);

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function plannedLookupProgressSources(
  classified: ClassifiedQuery,
  options: PlannedLookupProgressOptions = {},
): readonly LookupProgressSource[] {
  const sources: LookupProgressSource[] = ['rdap', 'whois'];
  if (classified.type === 'domain') {
    sources.push('domain_evidence', 'registrar_rdap', 'network_context');
    if (options.securityTxt) sources.push('security_txt');
    if (options.externalIntelligence) sources.push('external_intelligence');
    if (options.malwareHostIntelligence) sources.push('malware_host_intelligence');
    if (options.malwareIocIntelligence) sources.push('malware_ioc_intelligence');
  } else if (classified.type === 'ipv4' || classified.type === 'ipv6') {
    sources.push('reverse_dns');
  }
  return Object.freeze(sources);
}

function normalizedState(
  source: LookupProgressSource,
  outcome: 'fulfilled' | 'rejected',
  value: unknown,
): LookupProgressState {
  if (outcome === 'rejected') return 'error';
  if (value === null || value === undefined) return 'skipped';

  if (source === 'rdap') {
    const rdap = record(value);
    if (rdap.upstreamStatus === 404) return 'not_found';
    return rdap.upstreamStatus === 200 ? 'success' : 'unsupported';
  }
  if (source === 'whois') {
    if (!Array.isArray(value)) return 'error';
    if (value.length <= 1) return 'unsupported';
    return 'success';
  }
  if (source === 'domain_evidence') {
    return record(value).deepScanComplete === false ? 'partial' : 'success';
  }

  const status = record(value).status;
  if (typeof status === 'string' && DIRECT_STATES.has(status as LookupProgressState)) {
    return status as LookupProgressState;
  }
  if (status === 'complete' || status === 'observed' || status === 'found') return 'success';
  if (status === 'not_applicable' || status === 'disabled') return 'skipped';
  return 'success';
}

function normalizeLookupSourceSettlement(
  source: LookupProgressSource,
  outcome: 'fulfilled' | 'rejected',
  value: unknown,
): LookupSourceSettlement {
  const state = normalizedState(source, outcome, value);
  const sourceRecord = record(value);
  const resultState = source === 'domain_evidence'
    && typeof sourceRecord.state === 'string'
    && RESULT_STATES.has(sourceRecord.state)
    ? sourceRecord.state
    : null;
  const complete = !['partial', 'error', 'unavailable', 'rate_limited'].includes(state);
  const truncated = sourceRecord.truncated === true
    || sourceRecord.recordsTruncated === true
    || sourceRecord.bodyTruncated === true;
  const limitation = outcome === 'rejected'
    ? 'This source did not complete. No absence or safety conclusion was inferred.'
    : state === 'skipped'
      ? 'This source was not requested or was not applicable to the target.'
      : state === 'unsupported'
        ? 'This source could not provide authoritative evidence for this target.'
        : state === 'partial'
          ? 'This source returned incomplete evidence; missing fields remain unknown.'
          : null;
  return Object.freeze({
    source,
    state,
    complete,
    truncated,
    fragment: Object.freeze({
      status: state,
      ...(resultState ? { resultState } : {}),
      ...(limitation ? { limitation } : {}),
    }),
  });
}

export {
  normalizeLookupSourceSettlement,
  plannedLookupProgressSources,
};
export type {
  LookupSourceSettlement,
  PlannedLookupProgressOptions,
};
