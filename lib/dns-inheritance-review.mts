import { promises as dns } from 'node:dns';
import { parse as parseDomain } from 'tldts';
import { parseDmarcRecords } from './domain-posture-parsers.mts';
import { buildDnssecQuery, DNS_TYPE_NS, normalizeResolverEndpoint, parseDnssecResponse } from './dnssec-chain-validation.mts';
import { defaultTcpExchange, type DnsExchange } from './service-binding-dns.mts';
import { isValidAsciiHostname } from './hostname.mts';
import type { DomainPostureCheck } from '../packages/evidence/domain-posture-context.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';

type DnsObservation = { records: unknown[]; error: string | null; observedAt?: string | null };
export type InheritanceDnsDependencies = Readonly<{
  resolveTxt: (name: string) => Promise<unknown[]>;
  resolveNs: (name: string) => Promise<unknown[]>;
  resolve4: (name: string) => Promise<unknown[]>;
  resolve6: (name: string) => Promise<unknown[]>;
  exchange: DnsExchange;
  now: () => Date;
}>;
const MAX_PARENT_SERVERS = 2;
const MAX_NS = 16;
const QUERY_TIMEOUT_MS = 2200;
const REVIEW_TIMEOUT_MS = 10_000;
const MISSING = new Set(['ENODATA', 'ENOTFOUND', 'ENONAME']);

function requireDomain(domain: string): void {
  if (typeof domain !== 'string' || domain.length > 253 || !isValidAsciiHostname(domain) || domain !== domain.toLowerCase()) {
    throw new TypeError('The additional DNS review requires a normalised domain.');
  }
}

/** Explicit query parameter; malformed opt-ins never broaden collection. */
export function parseInheritedDnsSelection(value: unknown): true | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === '1') return true;
  throw new TypeError('includeInheritedDns must be 1 when requested.');
}

function check(id: string, label: string, status: DomainPostureCheck['status'], summary: string, detail: string, records: string[]): DomainPostureCheck {
  return { id, label, status, summary, detail, records, remediation: '' };
}

function policyObservation(owner: string, observation: DnsObservation) {
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
  const valid = !unavailable && parsed.valid && ['u', 'n', 'y'].includes(parsed.tags.psd?.toLowerCase() ?? 'u');
  const state = unavailable ? 'unavailable' : valid ? 'observed' : parsed.records.length ? 'invalid' : 'not found';
  const description = valid
    ? `p=${parsed.policy}; sp=${parsed.subdomainPolicy}; np=${parsed.nonexistentSubdomainPolicy}; psd=${parsed.tags.psd?.toLowerCase() ?? 'u'}; test=${parsed.testMode ? 'yes' : 'no'}`
    : state;
  const time = typeof observation.observedAt === 'string' && observation.observedAt.length <= 64
    ? normalizeExplicitIsoTimestamp(observation.observedAt) : null;
  return { owner, parsed, valid, unavailable, record: `Recursive DNS TXT _dmarc.${owner} · ${time ?? 'time unavailable'} · ${description}` };
}

/** RFC 9989 sections 4.10–4.10.2; at most eight owners including the exact name. */
export async function reviewInheritedDmarc(
  domain: string,
  exact: DnsObservation,
  resolve: (owner: string) => Promise<DnsObservation>,
): Promise<DomainPostureCheck> {
  requireDomain(domain);
  const rows = [policyObservation(domain, exact)];
  const labels = domain.split('.');
  let next = labels.length >= 8 ? labels.slice(-7) : labels.slice(1);
  if (!rows[0]!.valid && !rows[0]!.unavailable) {
    while (next.length) {
      const owner = next.join('.');
      const row = policyObservation(owner, await resolve(`_dmarc.${owner}`));
      rows.push(row);
      if (row.unavailable || (row.valid && ['n', 'y'].includes(row.parsed.tags.psd?.toLowerCase() ?? ''))) break;
      next = next.slice(1);
    }
  }
  const available = rows.filter(row => row.valid);
  const explicit = rows[0]!.valid ? rows[0] : null;
  const boundary = available.find(row => row.parsed.tags.psd?.toLowerCase() === 'n' || row.parsed.tags.psd?.toLowerCase() === 'y');
  const organisational = boundary?.parsed.tags.psd?.toLowerCase() === 'y'
    ? domain.split('.').slice(-(boundary.owner.split('.').length + 1)).join('.')
    : boundary?.owner ?? available.at(-1)?.owner ?? null;
  const selected = explicit ?? available.find(row => row.owner === organisational) ?? (boundary?.parsed.tags.psd?.toLowerCase() === 'y' ? boundary : null);
  const incomplete = rows.some(row => row.unavailable || (!row.valid && row.parsed.records.length === 1));
  const summary = incomplete ? 'Inherited policy could not be determined from the collected records.'
    : selected ? `${selected.owner === domain ? 'Exact-name' : 'Inherited'} policy published at _dmarc.${selected.owner}.`
      : 'No applicable DMARC policy was found in the completed tree walk.';
  const detail = !incomplete && selected
    ? selected.owner === domain
      ? `Published policy: ${selected.parsed.policy}. Test mode: ${selected.parsed.testMode ? 'yes' : 'no'}.`
      : `For an existing name: ${selected.parsed.subdomainPolicy}. For a nonexistent name: ${selected.parsed.nonexistentSubdomainPolicy}. Test mode: ${selected.parsed.testMode ? 'yes' : 'no'}. Name existence is not inferred from this review.`
    : 'Invalid or unavailable records do not establish absence or a usable inherited policy.';
  return check('dmarc_inheritance', 'Inherited DMARC policy', incomplete || !selected ? 'warning' : 'info', summary,
    `${detail} Discovery follows RFC 9989 with at most eight owners. This is publication evidence, not message authentication or a guarantee of receiver behaviour.`, rows.map(row => row.record));
}

function nameservers(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_NS) return null;
  const names = value.map(raw => typeof raw === 'string' && raw.length <= 254 ? raw.toLowerCase().replace(/\.$/u, '') : '');
  return names.every(name => name.length <= 253 && isValidAsciiHostname(name)) ? [...new Set(names)].sort() : null;
}

export async function reviewParentDelegation(
  domain: string,
  recursive: DnsObservation,
  dependencies: InheritanceDnsDependencies,
  signal?: AbortSignal,
): Promise<DomainPostureCheck> {
  requireDomain(domain);
  const parsed = parseDomain(domain, { allowPrivateDomains: false });
  const child = parsed.domain;
  const parent = parsed.publicSuffix;
  const records: string[] = [];
  let referrals = 0;
  let differs = false;
  let parentDiffers = false;
  let firstReferral: string[] | null = null;
  let incomplete = false;
  const observed = recursive.error || domain !== child ? null : nameservers(recursive.records);
  const finish = () => check('parent_delegation', 'Direct parent delegation', differs || parentDiffers || incomplete || !referrals ? 'warning' : 'info',
    parentDiffers ? 'Sampled parent servers returned different delegation referrals.'
      : differs ? 'Parent referral and recursive nameserver observations differ.'
      : referrals ? `${referrals} parent server${referrals === 1 ? '' : 's'} returned a delegation referral for ${child}.`
        : 'No direct parent referral was established.',
    `Registration-domain scope: ${child ?? 'unavailable'}; parent candidate: ${parent ?? 'unavailable'}. At most two discovered parent servers are queried over pinned public-address DNS/TCP, without recursion. This is a sample, not full delegation or DNSSEC validation.${incomplete ? ' Some discovery or direct observations were unavailable or incomplete.' : ''}${!observed ? ' No complete same-scope recursive comparison is available.' : ''}`,
    records);
  if (!child || !parent || child === parent) return finish();
  signal?.throwIfAborted();
  let discovered: string[] | null;
  try { discovered = nameservers(await dependencies.resolveNs(parent)); }
  catch { signal?.throwIfAborted(); incomplete = true; return finish(); }
  if (!discovered?.length) { incomplete = true; return finish(); }
  records.push(`Recursive DNS NS ${parent} · ${dependencies.now().toISOString()} · ${discovered.length} discovered; ${Math.min(MAX_PARENT_SERVERS, discovered.length)} selected.`);
  for (const server of discovered.slice(0, MAX_PARENT_SERVERS)) {
    signal?.throwIfAborted();
    const resolutions = await Promise.allSettled([dependencies.resolve4(server), dependencies.resolve6(server)]);
    signal?.throwIfAborted();
    const failed = resolutions.some(result => result.status === 'fulfilled'
      ? !Array.isArray(result.value) || result.value.length > 16
      : !MISSING.has(String((result.reason as {code?: unknown})?.code)));
    if (failed) {
      incomplete = true; records.push(`${server}: public-address discovery unavailable or rejected.`); continue;
    }
    const addresses = resolutions.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    const endpoints = addresses.map(normalizeResolverEndpoint);
    if (!addresses.length || endpoints.some(endpoint => !endpoint)) {
      incomplete = true; records.push(`${server}: public-address discovery unavailable or rejected.`); continue;
    }
    const endpoint = endpoints.filter((value): value is NonNullable<typeof value> => value !== null)
      .sort((a, b) => a.address < b.address ? -1 : a.address > b.address ? 1 : 0)[0]!;
    const query = buildDnssecQuery(child, DNS_TYPE_NS);
    query.writeUInt16BE(0, 2); // No recursion or authenticated-data assertion is requested.
    try {
      const responseBytes = await dependencies.exchange(query, endpoint, { timeoutMs: QUERY_TIMEOUT_MS, ...(signal ? { signal } : {}) });
      signal?.throwIfAborted();
      if (responseBytes.byteLength > 65_535) throw new RangeError('The DNS response exceeds the wire limit.');
      const response = parseDnssecResponse(responseBytes, { transactionId: query.readUInt16BE(0), name: child, type: DNS_TYPE_NS });
      const referred = nameservers(response.records.filter(row => row.section === 'authority' && row.owner === child && row.type === DNS_TYPE_NS && row.class === 1)
        .flatMap(row => row.data.kind === 'NS' ? [row.data.name] : []));
      records.push(`Direct DNS/TCP ${server} [${endpoint.address}] · ${dependencies.now().toISOString()} · ${child} NS · response ${response.rcode}.`);
      if (response.rcode !== 0 || !referred?.length) { incomplete = true; continue; }
      referrals += 1;
      if (firstReferral && JSON.stringify(firstReferral) !== JSON.stringify(referred)) parentDiffers = true;
      firstReferral ??= referred;
      for (const name of referred) records.push(`${server} authority section: ${child} NS ${name}`);
      if (observed && JSON.stringify(observed) !== JSON.stringify(referred)) differs = true;
    } catch {
      signal?.throwIfAborted(); incomplete = true; records.push(`${server}: bounded direct referral query failed.`);
    }
  }
  return finish();
}

export async function collectDnsInheritanceChecks(
  domain: string,
  exact: DnsObservation,
  recursive: DnsObservation,
  options: { signal?: AbortSignal } = {},
  injected?: InheritanceDnsDependencies,
): Promise<DomainPostureCheck[]> {
  requireDomain(domain);
  options.signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(REVIEW_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const resolver = injected ? null : new dns.Resolver({ timeout: QUERY_TIMEOUT_MS, tries: 1 });
  const cancel = () => resolver?.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  const dependencies = injected ?? {
    resolveTxt: (name: string) => resolver!.resolveTxt(name), resolveNs: (name: string) => resolver!.resolveNs(name),
    resolve4: (name: string) => resolver!.resolve4(name), resolve6: (name: string) => resolver!.resolve6(name),
    exchange: defaultTcpExchange, now: () => new Date(),
  };
  const resolve = async (owner: string): Promise<DnsObservation> => {
    signal.throwIfAborted();
    if (owner.length > 253) return { records: [], error: 'The DNS question exceeds the name limit.' };
    try { return { records: await dependencies.resolveTxt(owner), error: null, observedAt: dependencies.now().toISOString() }; }
    catch (error) {
      options.signal?.throwIfAborted();
      return { records: [], error: MISSING.has(String((error as {code?: unknown})?.code)) ? null : 'DNS observation unavailable.', observedAt: dependencies.now().toISOString() };
    }
  };
  const operations = [reviewInheritedDmarc(domain, exact, resolve), reviewParentDelegation(domain, recursive, dependencies, signal)];
  try { return await Promise.all(operations); }
  catch {
    options.signal?.throwIfAborted();
    const settled = await Promise.allSettled(operations);
    return settled.map((result, index) => result.status === 'fulfilled' ? result.value : check(
      index === 0 ? 'dmarc_inheritance' : 'parent_delegation', index === 0 ? 'Inherited DMARC policy' : 'Direct parent delegation',
      'warning', 'The additional review could not complete.', 'No absence or effective-policy conclusion is available from the incomplete review.', [],
    ));
  } finally { await Promise.allSettled(operations); signal.removeEventListener('abort', cancel); cancel(); }
}
