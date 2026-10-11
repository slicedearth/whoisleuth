import { MAX_WHOIS_QUERY_HOPS } from '../../../../lib/whois-contracts.mts';
import { MAX_LOOKUP_DNS_RECORDS_PER_TYPE, MAX_LOOKUP_TLS_ALT_NAMES } from '../../../../packages/analysis/lookup-network-evidence-bounds.mts';
import { DNS_QUERY_OUTCOMES, dnsAddressFamilyEvidence, readDnsQueryOutcome } from '../../../../packages/evidence/dns-query-outcome.mts';
import { lookupObservationHostname } from '../../../../packages/evidence/lookup-target.mts';
import { MAX_OBSERVATION_DIAGNOSTICS, normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';
import { formatEvidenceDate } from './evidence-time.ts';
import { rec, records, show, statusLabel, stringList, type JsonRecord } from './lookup-display-shared.ts';
import { lookupHttpScopeRows } from './lookup-http-display.ts';
import { createLookupViewModel, type LookupHttpResponse } from './lookup-response.ts';

type ScopeRow = Readonly<{ label: string; value: string }>;
type ScopeSource = Readonly<{
  id: string;
  label: string;
  state: string;
  observedAt: string | null;
  rows: readonly ScopeRow[];
  note: string;
}>;

function retained(value: unknown): string {
  return typeof value === 'string' && value.trim() ? show(value) : 'Not retained';
}

function source(id: string, label: string, evidence: JsonRecord, rows: ScopeRow[], note: string): ScopeSource {
  return {
    id, label, rows, note,
    state: typeof evidence.status === 'string' ? statusLabel(show(evidence.status)) : 'Source state not retained',
    observedAt: normalizeExplicitIsoTimestamp(evidence.observedAt),
  };
}

function dnsOutcome(dns: JsonRecord, family: string): string {
  const diagnostic = rec(rec(dns.diagnostics)[family]);
  if (family === 'a' || family === 'aaaa') {
    const address = dnsAddressFamilyEvidence(dns, family);
    if (address.state === 'partial') return 'DNS answer incomplete';
    if (address.state === 'error' && (address.outcome === null
      || DNS_QUERY_OUTCOMES[address.outcome].status !== 'error')) return 'DNS answer and outcome are inconsistent or unreadable';
  }
  const outcome = readDnsQueryOutcome(diagnostic);
  if (outcome) return DNS_QUERY_OUTCOMES[outcome].label;
  if (diagnostic.status === 'skipped' || dns.status === 'skipped') return 'Not queried';
  if (diagnostic.status === 'error') return 'DNS query failed';
  return 'Exact outcome not retained';
}

/** Read-only projection of an admitted result. Editable input is deliberately not an input. */
export function buildLookupEvidenceScope(original: LookupHttpResponse) {
  if (original.type !== 'domain') return { context: [] as ScopeRow[], sources: [] as ScopeSource[] };
  const view = createLookupViewModel(original);
  const hostname = lookupObservationHostname(view.availability);
  const rdapDiagnostic = rec(view.diagnostics.rdap);
  const whoisDiagnostic = rec(view.diagnostics.whois);
  const sources: ScopeSource[] = [source('registry', 'Registry RDAP', {
    ...rdapDiagnostic,
    observedAt: view.rdap.fetchedAt ?? rdapDiagnostic.fetchedAt ?? null,
  }, [{ label: 'Returned domain', value: retained(view.rdapParsed.domain) }],
  'The returned identity belongs to this publication; request context is not a substitute for it.')];

  if (Object.keys(view.registrarRdap).length) {
    sources.push(source('registrar', 'Registrar RDAP', {
      ...view.registrarRdap, observedAt: view.registrarRdap.fetchedAt ?? null,
    }, [{ label: 'Returned domain', value: retained(view.registrarRdapParsed.domain) }],
    'This is a separate registrar publication, not the registry response.'));
  }
  sources.push(source('whois', 'WHOIS', { status: whoisDiagnostic.status ?? null }, [
    { label: 'Returned domain', value: retained(view.whoisParsed.domainName) },
    ...records(view.whois.chain, MAX_WHOIS_QUERY_HOPS).map((hop, index) => ({
      label: `Hop ${index + 1} · ${retained(hop.server)}`,
      value: formatEvidenceDate(normalizeExplicitIsoTimestamp(hop.queriedAt), 'Query time not retained'),
    })),
  ], 'Referral hops keep their own query times. A hop time is not a single observation time for the merged WHOIS record.'));

  const dnsRows: ScopeRow[] = [{ label: 'Collection hostname', value: hostname ?? 'Not retained' }];
  // These are retained record fields, not a second catalogue of collector questions.
  let familyCount = 0;
  for (const family in view.dnsRecords) {
    if (!Object.hasOwn(view.dnsRecords, family)) continue;
    if (familyCount++ >= MAX_OBSERVATION_DIAGNOSTICS) break;
    const type = family === 'spf' || family === 'dmarc' ? `TXT (${family.toUpperCase()})` : show(family.toUpperCase());
    dnsRows.push({ label: `${type} outcome`, value: dnsOutcome(view.dnsEvidence, family) });
  }
  if (familyCount > MAX_OBSERVATION_DIAGNOSTICS) dnsRows.push({ label: 'Record family coverage', value: 'Incomplete; additional fields were omitted' });
  const httpsOwners = records(view.dnsRecords.https, MAX_LOOKUP_DNS_RECORDS_PER_TYPE)
    .map(record => retained(record.owner)).filter(owner => owner !== 'Not retained');
  dnsRows.push({ label: 'Retained HTTPS answer owners', value: httpsOwners.join(', ') || 'Not retained' });
  const delegation = rec(view.dnsEvidence.delegation);
  if (Object.keys(delegation).length) dnsRows.push({ label: 'Delegation review domain', value: retained(delegation.domain) });
  sources.push(source('dns', 'DNS', view.dnsEvidence, dnsRows,
    'The collection hostname is retained request context. Most record families do not retain individual answer owners; record values such as mail servers are not those owners. Missing diagnostics do not establish an empty answer.'));

  const caa = rec(view.dnsEvidence.caaPolicy);
  if (caa.policyVersion === 1) sources.push(source('caa', 'CAA policy', caa, [
    { label: 'Effective policy owner', value: retained(caa.effectiveOwner) },
    { label: 'Inherited', value: caa.inherited === true ? 'Yes' : caa.inherited === false ? 'No' : 'Unknown' },
  ], 'An inherited policy describes the effective policy owner, not a direct answer from every descendant.'));

  sources.push(source('http', 'HTTP', view.httpEvidence, [
    ...lookupHttpScopeRows(view.httpEvidence),
    { label: 'Query and fragment', value: 'Not retained' },
  ], 'Only retained, sanitised URLs are shown. Ordinary pasted paths and queries are not recovered from the query field.'));
  const certificateNames = stringList(view.tlsAltNames.dnsNames, MAX_LOOKUP_TLS_ALT_NAMES, 253);
  const certificateAddresses = stringList(view.tlsAltNames.ipAddresses, MAX_LOOKUP_TLS_ALT_NAMES - certificateNames.length, 64);
  sources.push(source('tls', 'TLS connection and certificate', view.tlsEvidence, [
    { label: 'Connection hostname (SNI)', value: retained(view.tlsEvidence.sniHost) },
    { label: 'Certificate DNS names', value: certificateNames.join(', ') || 'Not retained' },
    { label: 'Certificate IP addresses', value: certificateAddresses.join(', ') || 'Not retained' },
    { label: 'Certificate name coverage', value: view.tlsAltNames.truncated === true
      || (Array.isArray(view.tlsAltNames.dnsNames) ? view.tlsAltNames.dnsNames.length : 0)
        + (Array.isArray(view.tlsAltNames.ipAddresses) ? view.tlsAltNames.ipAddresses.length : 0) > MAX_LOOKUP_TLS_ALT_NAMES
      ? 'Incomplete; some certificate names were omitted' : 'Retained names only' },
  ], 'Certificate names, including wildcards, are publication scope. They do not establish collection, ownership or control of every matching host.'));
  return {
    context: [
      { label: 'Submitted hostname', value: retained(original.inputHostname) },
      { label: 'Registration request', value: retained(original.registrableDomain ?? view.availability.domain) },
    ],
    sources,
  };
}
