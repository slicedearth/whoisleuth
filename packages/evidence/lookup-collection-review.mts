import { LOOKUP_CHOICE_KEYS, LOOKUP_CHOICE_SOURCES, parseLookupCollectionReceipt, type LookupCollectionSource, type LookupSourceId } from './lookup-collection-receipt.mts';

export const LOOKUP_SOURCE_LABELS: Readonly<Record<LookupSourceId, string>> = Object.freeze({
  rdap: 'Registry RDAP', whois: 'WHOIS chain', domain_evidence: 'Domain evidence',
  reverse_dns: 'Reverse DNS', registrar_rdap: 'Registrar RDAP', network_context: 'Network context',
  security_txt: 'security.txt', external_intelligence: 'Archived web intelligence',
  malware_host_intelligence: 'Malware host intelligence', malware_ioc_intelligence: 'Malware infrastructure intelligence',
});
const ADMISSION_LABELS = Object.freeze({
  admitted: 'Admitted', disabled: 'Disabled by policy', unsupported: 'Unsupported', not_applicable: 'Not applicable',
  prerequisite_unavailable: 'Required earlier evidence unavailable', unknown: 'Admission not recorded',
});
const ATTEMPT_LABELS = Object.freeze({ started: 'Collector started', not_started: 'Collector not started', unknown: 'Collector start unknown' });

/** Inert guidance from recorded states, never an admission or retry decision. */
export function lookupSourceStateExplanation(
  state: string | null,
  source?: LookupSourceId,
  receipt?: LookupCollectionSource,
): string {
  if (receipt && receipt.source === source && receipt.attempt === 'not_started') {
    if (receipt.intent === 'not_requested') return 'Not requested in this Lookup. Select it explicitly in a new Lookup if needed.';
    if (receipt.admission === 'disabled') return 'Collection was disabled by policy. Retrying does not change that policy.';
    if (receipt.admission === 'prerequisite_unavailable') return 'Required earlier evidence was unavailable, so this collector did not start. Review that source first.';
    if (receipt.admission === 'not_applicable') return 'This collector did not apply to the submitted target or mode.';
    if (receipt.admission === 'unsupported') return 'Collection was not supported for this target; retrying unchanged inputs will not add evidence.';
  }
  switch (state) {
    case 'success':
    case 'complete':
      return 'Collection completed within this source’s scope. Review its observations and time below.';
    case 'not_found':
      return 'This source returned no matching record. Its authority and search scope determine what that means.';
    case 'partial':
    case 'inconclusive':
      return 'Evidence is incomplete or inconclusive. Missing fields remain unknown; a later retry may help if source conditions change.';
    case 'error':
    case 'unavailable':
      return 'Usable evidence was not obtained. This is not an absence finding; retry may help after the reported problem changes.';
    case 'rate_limited':
      return 'The source reported a rate limit. Wait for its permitted retry window; no reset time is assumed.';
    case 'unsupported':
      return source === 'rdap' || source === 'whois'
        ? 'No applicable service was recorded by registry policy or discovery. Retrying unchanged discovery may not add evidence.'
        : 'This source does not support the target or request. Use an applicable source rather than repeating the same request.';
    case 'skipped':
      return 'This source was not queried under the selected mode or access policy. Review its source details before requesting it again.';
    case 'disabled':
      return 'Collection was disabled by policy. Retrying does not change that policy.';
    case 'not_applicable':
      return 'This source does not apply to the submitted target or mode.';
    case 'stale':
      return 'Retained evidence is out of date for this review. A deliberate refresh may provide a newer observation.';
    default:
      return 'The source outcome was not retained. Its request history and retry usefulness are unknown.';
  }
}

/** One presentation of the closed receipt vocabulary for browser and terminal. */
export function lookupCollectionReceiptReview(raw: unknown) {
  const receipt = parseLookupCollectionReceipt(raw);
  if (!receipt) return null;
  return {
    receipt,
    selection: `${receipt.requestedDepth === 'deep' ? 'Deep' : 'Fast'} Lookup · ${receipt.webSelection === 'selected_url'
      ? 'selected URL' : receipt.webSelection === 'hostname' ? 'hostname' : 'no web target'}`,
    choices: LOOKUP_CHOICE_KEYS.map(choice => ({ label: LOOKUP_SOURCE_LABELS[LOOKUP_CHOICE_SOURCES[choice]], selected: receipt.originalChoices[choice] })),
    sources: receipt.sources.map(row => ({
      id: row.source, label: LOOKUP_SOURCE_LABELS[row.source],
      summary: `${row.intent === 'requested' ? 'Requested' : 'Not requested'} · ${ADMISSION_LABELS[row.admission]} · ${ATTEMPT_LABELS[row.attempt]}`,
      outcome: `Source result: ${row.settlement.replaceAll('_', ' ')} · ${row.complete === null ? 'completeness unknown' : row.complete ? 'complete' : 'not complete'} · ${row.truncated === null ? 'truncation unknown' : row.truncated ? 'truncated' : 'not truncated'}`,
      explanation: lookupSourceStateExplanation(row.settlement, row.source, row),
    })),
  };
}
