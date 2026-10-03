import { MAX_LOOKUP_DNS_RECORDS_PER_TYPE } from '../analysis/lookup-network-evidence-bounds.mts';
import { addressValue, canonicalIpAddress } from '../contracts/ip-address.mts';

/** Fixed values retained in Observation v1's existing diagnostic detail slot. */
export const DNS_QUERY_OUTCOMES = Object.freeze({
  records: { status: 'success', label: 'Records returned' },
  empty_answer: { status: 'not_found', label: 'No records returned' },
  no_data: { status: 'not_found', label: 'No data for this record type (NODATA)' },
  name_not_found: { status: 'not_found', label: 'Name not found by resolver' },
  timeout: { status: 'error', label: 'DNS query timed out' },
  server_failure: { status: 'error', label: 'DNS server failed to answer (SERVFAIL)' },
  refused: { status: 'error', label: 'DNS query refused' },
  invalid_response: { status: 'error', label: 'DNS answer could not be read completely' },
  error: { status: 'error', label: 'DNS query failed' },
  skipped: { status: 'skipped', label: 'Not queried' },
} as const);
export type DnsQueryOutcome = keyof typeof DNS_QUERY_OUTCOMES;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Legacy not_found diagnostics do not identify which negative answer occurred. */
export function readDnsQueryOutcome(value: unknown): DnsQueryOutcome | null {
  const diagnostic = record(value);
  const detail = diagnostic.detail;
  return typeof detail === 'string' && Object.hasOwn(DNS_QUERY_OUTCOMES, detail)
    && DNS_QUERY_OUTCOMES[detail as DnsQueryOutcome].status === diagnostic.status
    ? detail as DnsQueryOutcome : null;
}

export function dnsQueryFailureOutcome(code: unknown): DnsQueryOutcome {
  switch (code) {
    case 'ENODATA': return 'no_data';
    case 'ENOTFOUND': return 'name_not_found';
    case 'ETIMEOUT': return 'timeout';
    case 'ESERVFAIL': return 'server_failure';
    case 'EREFUSED': return 'refused';
    case 'EBADRESP': return 'invalid_response';
    default: return 'error';
  }
}

/** One family, one source state. Unrelated mail/delegation failures cannot erase it. */
export function dnsAddressFamilyEvidence(dnsValue: unknown, family: 'a' | 'aaaa') {
  const dns = record(dnsValue);
  const diagnostic = record(record(dns.diagnostics)[family]);
  const raw = record(dns.records)[family];
  const candidates = Array.isArray(raw) ? raw.slice(0, MAX_LOOKUP_DNS_RECORDS_PER_TYPE) : [];
  const addresses = candidates.flatMap(value => {
    const address = canonicalIpAddress(value);
    return address && addressValue(address)?.family === (family === 'a' ? 4 : 6) ? [address] : [];
  });
  const malformed = raw !== undefined && !Array.isArray(raw)
    || candidates.length !== addresses.length;
  const truncated = diagnostic.truncated === true
    || typeof diagnostic.discarded === 'number' && diagnostic.discarded > 0
    || Array.isArray(raw) && raw.length > candidates.length;
  const outcome = readDnsQueryOutcome(diagnostic);
  const inconsistent = outcome === 'records' && !addresses.length
    || outcome !== null && outcome !== 'records' && addresses.length > 0;
  const complete = !malformed && !truncated && !inconsistent && Array.isArray(raw)
    && outcome !== null && DNS_QUERY_OUTCOMES[outcome].status !== 'error' && outcome !== 'skipped';
  const state = malformed || inconsistent ? 'error'
    : truncated ? 'partial'
      : outcome ? DNS_QUERY_OUTCOMES[outcome].status
        : diagnostic.status === 'error' ? 'error'
          : diagnostic.status === 'skipped' || dns.status === 'skipped' ? 'skipped' : 'unknown';
  const value = addresses.length ? [...new Set(addresses)].sort().join(' · ')
    : malformed || inconsistent ? DNS_QUERY_OUTCOMES.invalid_response.label
      : truncated ? 'DNS answer incomplete'
        : outcome ? DNS_QUERY_OUTCOMES[outcome].label
          : state === 'error' ? DNS_QUERY_OUTCOMES.error.label
            : state === 'skipped' ? DNS_QUERY_OUTCOMES.skipped.label
              : diagnostic.status === 'not_found' ? 'Negative DNS outcome not recorded' : null;
  return { outcome, value, state, complete, truncated };
}
