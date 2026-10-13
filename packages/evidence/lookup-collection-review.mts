import { LOOKUP_CHOICE_KEYS, LOOKUP_CHOICE_SOURCES, parseLookupCollectionReceipt, type LookupSourceId } from './lookup-collection-receipt.mts';

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
    })),
  };
}
