import { promises as dns } from 'node:dns';
import { parse as parseDomain } from 'tldts';
import { validateDmarcExternalReporting, type DmarcExternalAuthorization } from './domain-posture-analysis.mts';
import { requireDmarcDomain, walkDmarcTree, type DmarcDnsObservation } from './dmarc-discovery.mts';
import { buildDnssecQuery, DNS_TYPE_NS, normalizeResolverEndpoint, parseDnssecResponse } from './dnssec-chain-validation.mts';
import { defaultTcpExchange, type DnsExchange } from './service-binding-dns.mts';
import { isValidAsciiHostname } from '../packages/contracts/domain-name.mts';
import type { DomainPostureCheck } from '../packages/evidence/domain-posture-context.mts';

type DnsObservation = DmarcDnsObservation;
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
export const MAX_DMARC_REVIEW_QUERIES = 32;
const MISSING = new Set(['ENODATA', 'ENOTFOUND', 'ENONAME']);

/** Explicit query parameter; malformed opt-ins never broaden collection. */
export function parseInheritedDnsSelection(value: unknown): true | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === '1') return true;
  throw new TypeError('includeInheritedDns must be 1 when requested.');
}

function check(id: string, label: string, status: DomainPostureCheck['status'], summary: string, detail: string, records: string[]): DomainPostureCheck {
  return { id, label, status, summary, detail, records, remediation: '' };
}

/** RFC 9989 sections 4.10–4.10.2; at most eight owners including the exact name. */
export async function reviewInheritedDmarc(
  domain: string,
  exact: DnsObservation,
  resolve: (owner: string) => Promise<DnsObservation>,
): Promise<DomainPostureCheck> {
  const { rows, available, boundary, incomplete, organisationalDomain } = await walkDmarcTree(domain, exact, resolve, 'policy');
  const explicit = rows[0]!.valid ? rows[0] : null;
  const selected = explicit ?? available.find(row => row.owner === organisationalDomain) ?? (boundary?.psd === 'y' ? boundary : null);
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
  requireDmarcDomain(domain);
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

export async function collectDnsInheritanceReview(
  domain: string,
  exact: DnsObservation,
  recursive: DnsObservation,
  options: { signal?: AbortSignal } = {},
  injected?: InheritanceDnsDependencies,
): Promise<{ checks: DomainPostureCheck[]; dmarcAuthorizations: DmarcExternalAuthorization[] }> {
  requireDmarcDomain(domain);
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
  let questions = 0;
  const cache = new Map<string, Promise<DnsObservation>>([[`_dmarc.${domain}`, Promise.resolve(exact)]]);
  const query = async (owner: string): Promise<DnsObservation> => {
    signal.throwIfAborted();
    if (owner.length > 253) return { records: [], error: 'The DNS question exceeds the name limit.' };
    questions += 1;
    try { return { records: await dependencies.resolveTxt(owner), error: null, observedAt: dependencies.now().toISOString() }; }
    catch (error) {
      options.signal?.throwIfAborted();
      return { records: [], error: MISSING.has(String((error as {code?: unknown})?.code)) ? null : 'DNS observation unavailable.', observedAt: dependencies.now().toISOString() };
    }
  };
  const resolve = (owner: string): Promise<DnsObservation> => {
    options.signal?.throwIfAborted();
    const existing = cache.get(owner);
    if (existing) return existing;
    if (questions >= MAX_DMARC_REVIEW_QUERIES) return Promise.resolve({ records: [], error: 'The shared DMARC query budget was reached.' });
    const pending = query(owner);
    cache.set(owner, pending);
    return pending;
  };
  const organisations = new Map<string, Promise<string | null>>();
  const boundaryRecords = new Map<string, string>();
  const boundaryResults = new Map<string, string>();
  const resolveOrganisationalDomain = (owner: string): Promise<string | null> => {
    const existing = organisations.get(owner);
    if (existing) return existing;
    const pending = (async () => {
      const walk = await walkDmarcTree(owner, await resolve(`_dmarc.${owner}`), resolve, 'organisation');
      for (const row of walk.rows) if (cache.has(`_dmarc.${row.owner}`)) boundaryRecords.set(row.owner, row.record);
      boundaryResults.set(owner, `${owner}: organisational domain ${walk.organisationalDomain ?? 'unknown'}.`);
      return walk.organisationalDomain;
    })();
    organisations.set(owner, pending);
    return pending;
  };
  const operations = [
    reviewInheritedDmarc(domain, exact, resolve),
    reviewParentDelegation(domain, recursive, dependencies, signal),
    validateDmarcExternalReporting(domain, exact, resolve, resolveOrganisationalDomain),
  ] as const;
  try {
    const [policy, parent, reporting] = await Promise.allSettled(operations);
    options.signal?.throwIfAborted();
    const checks = [policy, parent].map((result, index) => result.status === 'fulfilled' ? result.value : check(
      index === 0 ? 'dmarc_inheritance' : 'parent_delegation', index === 0 ? 'Inherited DMARC policy' : 'Direct parent delegation',
      'warning', 'The additional review could not complete.', 'No absence or effective-policy conclusion is available from the incomplete review.', [],
    ));
    const dmarcAuthorizations = reporting.status === 'fulfilled' ? reporting.value : [];
    if (organisations.size) checks.push(check('dmarc_reporting_boundaries', 'DMARC reporting boundaries',
      reporting.status === 'rejected' || dmarcAuthorizations.some(item => !['self', 'authorized'].includes(item.state)) ? 'warning' : 'info',
      'Reporting destinations were reviewed using DNS-derived organisational boundaries.',
      `${questions} additional DMARC TXT questions used; the shared limit is ${MAX_DMARC_REVIEW_QUERIES} within ten seconds. Each tree walk examines at most eight owners. Unavailable boundaries remain unknown; a missing optional authorisation record does not establish a configuration error.`,
      [...boundaryResults.values(), ...boundaryRecords.values()]));
    return { checks, dmarcAuthorizations };
  } finally { signal.removeEventListener('abort', cancel); cancel(); }
}
