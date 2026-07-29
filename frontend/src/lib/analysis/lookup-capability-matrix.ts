export type LookupCapabilityState = 'collected' | 'conditional' | 'not_collected' | 'not_applicable';
export type LookupCapabilityTarget = 'domain' | 'ip' | 'asn';
export type LookupCapabilityRow = Readonly<{
  id: string;
  field: string;
  targets: readonly LookupCapabilityTarget[];
  source: string;
  fast: LookupCapabilityState;
  bulkDeep: LookupCapabilityState;
  singleDeep: LookupCapabilityState;
  limitation: string;
}>;

export const LOOKUP_CAPABILITY_MATRIX_VERSION = 1;

export const LOOKUP_CAPABILITY_ROWS: readonly LookupCapabilityRow[] = Object.freeze([
  row('availability', 'Registration availability decision', ['domain'], 'Registry RDAP and authority-aware DNS fallback', 'collected', 'collected', 'collected', 'Missing or inconclusive sources never establish availability.'),
  row('registration-core', 'Registrar, lifecycle and status', ['domain'], 'Registry RDAP; WHOIS in Deep modes', 'conditional', 'collected', 'collected', 'Published fields vary by registry, registrar, privacy policy and source health.'),
  row('contacts', 'Registration contacts and abuse route', ['domain'], 'Registry RDAP and WHOIS', 'conditional', 'conditional', 'collected', 'Bulk retains only compact contact/abuse fields; full Lookup keeps sources separately attributed.'),
  row('delegation', 'Nameservers, DNSSEC and DS evidence', ['domain'], 'Registry RDAP, WHOIS and DNS', 'conditional', 'collected', 'collected', 'DNSSEC consistency can be inconclusive when registry publication is partial or truncated.'),
  row('dns-core', 'A, AAAA, CNAME, NS, MX, TXT, CAA', ['domain'], 'DNS resolver', 'not_collected', 'collected', 'collected', 'A resolver response is point-in-time evidence and not proof of provider ownership.'),
  row('dns-extended', 'SOA, HTTPS and service-binding context', ['domain'], 'DNS resolver', 'not_collected', 'not_collected', 'collected', 'Extended DNS remains single-Deep-only to preserve compact Bulk request and storage bounds.'),
  row('http', 'HTTP response and redirect evidence', ['domain'], 'Bounded safe homepage request', 'not_collected', 'collected', 'collected', 'Bulk retains a compact response summary; full redirect and response detail stays in single Deep Lookup.'),
  row('tls', 'TLS certificate and connection evidence', ['domain'], 'One bounded TLS connection', 'not_collected', 'collected', 'collected', 'Bulk retains compact state; single Deep exposes bounded certificate and connection detail.'),
  row('mail', 'MX, SPF and DMARC triage signals', ['domain'], 'DNS resolver', 'not_collected', 'collected', 'collected', 'No SMTP connection, mailbox test or catch-all probe is performed.'),
  row('page-identity', 'Page identity, forms and fingerprints', ['domain'], 'Captured static homepage HTML', 'not_collected', 'not_collected', 'collected', 'Static evidence only; referenced resources are not fetched and JavaScript is not executed.'),
  row('page-analysis', 'Technology, role, behaviour and posture profiles', ['domain'], 'Derived from bounded HTTP, HTML, TLS and DNS evidence', 'not_collected', 'not_collected', 'collected', 'Heuristic profiles are review leads, not proof of purpose, vulnerability, safety or maliciousness.'),
  row('registrar-rdap', 'Registrar RDAP publication', ['domain'], 'Eligible registry-published HTTPS related link', 'not_collected', 'not_collected', 'conditional', 'At most one eligible link is followed and it never overwrites registry evidence.'),
  row('network-context', 'Observed endpoint network RDAP', ['domain'], 'One observed public endpoint and IP RDAP', 'not_collected', 'not_collected', 'conditional', 'Represents one observed endpoint, not every host, route or origin used by the site.'),
  row('security-txt', 'security.txt disclosure route', ['domain'], 'Exact-host bounded HTTPS request', 'not_collected', 'not_collected', 'conditional', 'Collected only when explicitly selected; publication is not authorization or safety evidence.'),
  row('external-intelligence', 'Optional external intelligence', ['domain'], 'Explicitly enabled configured providers', 'not_collected', 'not_collected', 'conditional', 'Provider misses and failures remain neutral; exact target disclosure and terms vary by provider.'),
  row('ip-rdap', 'IP network registration', ['ip'], 'IANA-bootstrap IP RDAP', 'collected', 'not_applicable', 'collected', 'Network registration does not prove current route operation, hosting control or ownership.'),
  row('reverse-dns', 'Reverse DNS names', ['ip'], 'Bounded PTR lookup', 'not_collected', 'not_applicable', 'conditional', 'PTR names are publisher-controlled labels and do not prove ownership or service identity.'),
  row('asn-rdap', 'ASN registration and lifecycle', ['asn'], 'IANA-bootstrap ASN RDAP', 'collected', 'not_applicable', 'collected', 'Allocation registration does not prove current routing, reachability or operational control.'),
]);

function row(
  id: string,
  field: string,
  targets: readonly LookupCapabilityTarget[],
  source: string,
  fast: LookupCapabilityState,
  bulkDeep: LookupCapabilityState,
  singleDeep: LookupCapabilityState,
  limitation: string,
): LookupCapabilityRow {
  return Object.freeze({ id, field, targets: Object.freeze([...targets]), source, fast, bulkDeep, singleDeep, limitation });
}

export function lookupCapabilityRows(target: unknown = 'all'): readonly LookupCapabilityRow[] {
  if (target === 'all') return LOOKUP_CAPABILITY_ROWS;
  if (!['domain', 'ip', 'asn'].includes(String(target))) return [];
  return LOOKUP_CAPABILITY_ROWS.filter((candidate) => candidate.targets.includes(target as LookupCapabilityTarget));
}

export function lookupCapabilityStateLabel(state: LookupCapabilityState): string {
  return {
    collected: 'Collected',
    conditional: 'Conditional',
    not_collected: 'Not collected',
    not_applicable: 'Not applicable',
  }[state];
}
