import { isValidAsciiHostname } from '../packages/contracts/domain-name.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';
import { parseDmarcRecords } from './domain-posture-parsers.mts';

export type DmarcDnsObservation = { records: unknown[]; error: string | null; observedAt?: string | null };
export type DmarcResolver = (name: string) => Promise<DmarcDnsObservation>;

export function requireDmarcDomain(domain: string): void {
  if (typeof domain !== 'string' || domain.length > 253 || !isValidAsciiHostname(domain) || domain !== domain.toLowerCase()) {
    throw new TypeError('The additional DNS review requires a normalised domain.');
  }
}

export function dmarcPolicyObservation(owner: string, observation: DmarcDnsObservation) {
  const records = observation.records;
  let bytes = 0;
  const admitted = Array.isArray(records) && records.length <= 64 && records.every(raw => {
    const parts = typeof raw === 'string' ? [raw] : raw;
    return Array.isArray(parts) && parts.length <= 256 && parts.every(part => {
      if (typeof part !== 'string' || part.length > 4096) return false;
      bytes += Buffer.byteLength(part, 'utf8');
      return bytes <= 65_536;
    });
  });
  const parsed = parseDmarcRecords(admitted ? records : []);
  const unavailable = Boolean(observation.error) || !admitted;
  const psd = parsed.tags.psd?.toLowerCase() ?? 'u';
  const valid = !unavailable && parsed.valid && ['u', 'n', 'y'].includes(psd);
  const incomplete = unavailable || (!valid && parsed.records.length === 1);
  const state = unavailable ? 'unavailable' : valid ? 'observed' : parsed.records.length ? 'invalid' : 'not found';
  const description = valid
    ? `p=${parsed.policy}; sp=${parsed.subdomainPolicy}; np=${parsed.nonexistentSubdomainPolicy}; psd=${psd}; test=${parsed.testMode ? 'yes' : 'no'}`
    : state;
  const time = typeof observation.observedAt === 'string' && observation.observedAt.length <= 64
    ? normalizeExplicitIsoTimestamp(observation.observedAt) : null;
  return { owner, parsed, psd, valid, unavailable, incomplete,
    record: `Recursive DNS TXT _dmarc.${owner} · ${time ?? 'time unavailable'} · ${description}` };
}

/** RFC 9989 sections 4.10–4.10.2: at most eight owners, never PSL inference. */
export async function walkDmarcTree(domain: string, exact: DmarcDnsObservation, resolve: DmarcResolver, purpose: 'policy' | 'organisation') {
  requireDmarcDomain(domain);
  const rows = [dmarcPolicyObservation(domain, exact)];
  const first = rows[0]!;
  const labels = domain.split('.');
  let next = labels.length >= 8 ? labels.slice(-7) : labels.slice(1);
  const policyOnly = purpose === 'policy' && first.valid;
  if (!policyOnly && !first.unavailable && !(first.valid && ['n', 'y'].includes(first.psd))) {
    while (next.length) {
      const owner = next.join('.');
      const row = dmarcPolicyObservation(owner, await resolve(`_dmarc.${owner}`));
      rows.push(row);
      if (row.unavailable || (row.valid && ['n', 'y'].includes(row.psd))) break;
      next = next.slice(1);
    }
  }
  const available = rows.filter(row => row.valid);
  const boundary = available.find(row => row.psd === 'n' || (row.psd === 'y' && row.owner !== domain));
  const incomplete = rows.some(row => row.incomplete);
  // An exact policy alone does not establish the organisational boundary.
  const organisationalDomain = incomplete || (policyOnly && !['n', 'y'].includes(first.psd)) ? null
    : boundary?.psd === 'y'
      ? labels.slice(-(boundary.owner.split('.').length + 1)).join('.')
      : boundary?.owner ?? available.at(-1)?.owner ?? domain;
  return { rows, available, boundary, incomplete, organisationalDomain };
}
