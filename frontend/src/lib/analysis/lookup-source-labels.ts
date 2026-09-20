import type { LookupTimingSource } from '../../../../lib/lookup-diagnostics.mts';

export const LOOKUP_SOURCE_LABELS: Readonly<Record<LookupTimingSource, string>> = Object.freeze({
  rdap: 'Registry RDAP',
  whois: 'WHOIS chain',
  domain_evidence: 'Domain evidence',
  reverse_dns: 'Reverse DNS',
  registrar_rdap: 'Registrar RDAP',
  network_context: 'Network context',
  security_txt: 'security.txt',
  external_intelligence: 'Archived web intelligence',
  malware_host_intelligence: 'Malware host intelligence',
  malware_ioc_intelligence: 'Malware infrastructure intelligence',
});
