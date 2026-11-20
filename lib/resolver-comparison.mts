import { normalizeEncryptedDnsAdapter, planEncryptedDnsQuery } from './encrypted-dns-contract.mts';
import { safeFetch } from './safe-fetch.mts';
import { requestJsonCapped } from './bounded-json-response.mts';
import { parseBoundedJson } from './bounded-json.mts';
import { reviewDnsConvergence, DNS_CONVERGENCE_INPUT_SCHEMA, DNS_CONVERGENCE_INPUT_VERSION } from './dns-convergence-review.mts';
import { canonicalIpAddress, addressValue } from '../packages/contracts/ip-address.mts';
import {
  RESOLVER_PROVIDERS, RESOLVER_RECORD_TYPES, RESOLVER_RESPONSE_BYTES, RESOLVER_COMPARISON_TIMEOUT_MS,
  RESOLVER_COMPARISON_SCHEMA, RESOLVER_COMPARISON_VERSION, MAX_RESOLVER_ALIAS_HOPS, normaliseResolverComparisonRequest,
  readResolverComparison, resolverDnsName, type ResolverQuery, type ResolverRecordType,
} from '../packages/evidence/resolver-comparison.mts';

const QUERY_TYPES = Object.freeze({ A: 1, AAAA: 28 });
const adapters = RESOLVER_PROVIDERS.map(provider => normalizeEncryptedDnsAdapter({ ...provider,
  method: 'GET', representation: 'dns-json', reviewedAt: '2026-11-18T00:00:00.000Z', queryRetention: 'provider_defined',
  maxResponseBytes: RESOLVER_RESPONSE_BYTES, timeoutMs: 4_000 }));
type CollectorOptions = Readonly<{ signal?: AbortSignal }>;
type CollectorDependencies = Readonly<{ fetch?: typeof safeFetch; now?: () => string }>;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid DNS response.');
  return value as Record<string, unknown>;
};
const name = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 254) throw new TypeError('Invalid DNS owner.');
  if (value === '.') return '.';
  const result = resolverDnsName(value);
  if (!result) throw new TypeError('Invalid DNS owner.');
  return result;
};
function answerRows(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new TypeError('DNS record limit exceeded.');
  return value.map(raw => {
    const row = record(raw);
    if (!Number.isSafeInteger(row.type) || Number(row.type) < 1 || Number(row.type) > 65535
      || !Number.isSafeInteger(row.TTL) || Number(row.TTL) < 0 || Number(row.TTL) > 0x7fff_ffff
      || typeof row.data !== 'string' || row.data.length > 4096 || /[\u0000-\u001f\u007f]/u.test(row.data)) {
      throw new TypeError('Invalid DNS record.');
    }
    return { owner: name(row.name), type: Number(row.type), ttl: Number(row.TTL), data: row.data };
  });
}
/** Follow only an unbranched CNAME chain from the hostname inside one resolver answer. */
function followAliases(answers: ReturnType<typeof answerRows>, hostname: string) {
  const aliases = answers.filter(row => row.type === 5);
  const chain: string[] = [];
  const seen = new Set([hostname]);
  let current = hostname, bounded = false;
  for (;;) {
    const next = aliases.filter(row => row.owner === current);
    if (!next.length) break;
    if (next.length > 1) throw new TypeError('Contradictory DNS alias.');
    if (chain.length >= MAX_RESOLVER_ALIAS_HOPS) { bounded = true; break; }
    const target = name(next[0]!.data);
    if (target === '.' || seen.has(target)) throw new TypeError('Invalid DNS alias chain.');
    seen.add(target); chain.push(target); current = target;
  }
  const followedOwners = new Set([hostname, ...chain].slice(0, chain.length));
  return { chain, finalOwner: current, unfollowed: bounded || aliases.some(row => !followedOwners.has(row.owner)) };
}
function negativeSoa(row: ReturnType<typeof answerRows>[number], hostname: string) {
  if (row.type !== 6 || row.owner !== '.' && hostname !== row.owner && !hostname.endsWith(`.${row.owner}`)) return false;
  const parts = row.data.trim().split(/\s+/u);
  if (parts.length !== 7) return false;
  try { name(parts[0]); name(parts[1]); } catch { return false; }
  return parts.slice(2).every(part => /^\d{1,10}$/u.test(part) && Number(part) <= 0xffff_ffff);
}
function parseAnswer(raw: unknown, hostname: string, type: ResolverRecordType): Pick<ResolverQuery,
  'outcome' | 'comparisonState' | 'values' | 'authenticatedData' | 'aliasObserved' | 'truncated' | 'aliasChain'> {
  const input = record(raw);
  if (!Number.isSafeInteger(input.Status) || Number(input.Status) < 0 || Number(input.Status) > 15
    || typeof input.TC !== 'boolean' || typeof input.RA !== 'boolean' || typeof input.AD !== 'boolean'
    || input.CD === true || !Array.isArray(input.Question) || input.Question.length !== 1) throw new TypeError('Invalid DNS response.');
  const question = record(input.Question[0]);
  if (name(question.name) !== hostname || question.type !== QUERY_TYPES[type]) throw new TypeError('Mismatched DNS question.');
  const answers = answerRows(input.Answer);
  const authority = answerRows(input.Authority);
  answerRows(input.Additional);
  const alias = followAliases(answers, hostname);
  // DNAME, branches beyond the followed chain and records for other names stay partial.
  const aliasObserved = alias.unfollowed || answers.some(row => row.type === 39
    || row.type === QUERY_TYPES[type] && row.owner !== alias.finalOwner);
  const values = answers.filter(row => row.owner === alias.finalOwner && row.type === QUERY_TYPES[type]).map(row => {
    const value = canonicalIpAddress(row.data);
    if (!value || addressValue(value)?.family !== (type === 'A' ? 4 : 6)) throw new TypeError('Invalid address answer.');
    return { value, ttl: row.ttl };
  });
  const base = { authenticatedData: input.AD, aliasObserved, truncated: input.TC, aliasChain: Object.freeze(alias.chain) };
  if (input.Status !== 0) {
    if (values.length) throw new TypeError('Contradictory DNS response.');
    return { ...base, outcome: input.Status === 3 ? 'name_not_found' : input.Status === 2 ? 'server_failure'
      : input.Status === 5 ? 'refused' : 'invalid_response', comparisonState: 'unavailable', values: [] };
  }
  if (!input.RA) throw new TypeError('Recursive resolution unavailable.');
  const outcome = values.length ? 'records' : !aliasObserved && authority.some(row => negativeSoa(row, alias.finalOwner)) ? 'no_data' : 'empty_answer';
  const complete = !input.TC && !aliasObserved && outcome !== 'empty_answer';
  return { ...base, outcome, comparisonState: complete ? 'observed' : 'partial', values };
}

/** Explicit action only. No target connection, custom endpoint, retry or shared cache. */
export async function collectResolverComparison(hostname: unknown, selection: unknown,
  options: CollectorOptions = {}, dependencies: CollectorDependencies = {}) {
  const request = normaliseResolverComparisonRequest(hostname, selection);
  const now = dependencies.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const deadline = AbortSignal.timeout(RESOLVER_COMPARISON_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  options.signal?.throwIfAborted();
  const groups = await Promise.all(request.resolvers.map(async provider => {
    const adapter = adapters.find(item => item.id === provider)!;
    const queries: ResolverQuery[] = [];
    for (const type of RESOLVER_RECORD_TYPES) {
      options.signal?.throwIfAborted();
      if (signal.aborted) {
        queries.push({ provider, type, observedAt: now(), requestStarted: false, outcome: 'skipped',
          comparisonState: 'unavailable', values: [], authenticatedData: null, aliasObserved: false, truncated: false, aliasChain: [] });
        continue;
      }
      const plan = planEncryptedDnsQuery(adapter, { name: request.hostname, type });
      const url = new URL(plan.adapter.endpoint);
      url.searchParams.set('name', plan.query.name);
      url.searchParams.set('type', plan.query.type);
      url.searchParams.set('cd', 'false');
      if (provider === 'google') url.searchParams.set('edns_client_subnet', '0.0.0.0/0');
      let responseReceived = false;
      try {
        const { response, body } = await requestJsonCapped(url.toString(), {
          signal, headers: { Accept: 'application/dns-json' },
        }, { fetchImpl: async (input, init) => {
          const response = await (dependencies.fetch ?? safeFetch)(String(input), init, 0);
          responseReceived = true;
          return response;
        },
          maximumBytes: adapter.maxResponseBytes, timeoutMs: adapter.timeoutMs,
          validateRawJson: raw => { parseBoundedJson(raw, { maximumBytes: adapter.maxResponseBytes,
            limits: { maximumDepth: 8, maximumKeys: 1800, maximumValues: 3000, maximumContainerItems: 100, maximumStringCodeUnits: RESOLVER_RESPONSE_BYTES } }); } });
        if (!response.ok) throw new TypeError('Resolver HTTP request failed.');
        queries.push({ provider, type, observedAt: now(), requestStarted: true, ...parseAnswer(body, request.hostname, type) });
      } catch (error) {
        options.signal?.throwIfAborted();
        const timeout = signal.aborted || error instanceof Error && 'code' in error && error.code === 'timeout';
        queries.push({ provider, type, observedAt: now(), requestStarted: true, outcome: timeout ? 'timeout' : responseReceived ? 'invalid_response' : 'error',
          comparisonState: 'unavailable', values: [], authenticatedData: null, aliasObserved: false, truncated: false, aliasChain: [] });
      }
    }
    return queries;
  }));
  options.signal?.throwIfAborted();
  const queries = groups.flat();
  const completedAt = now();
  const convergence = reviewDnsConvergence({ schema: DNS_CONVERGENCE_INPUT_SCHEMA, version: DNS_CONVERGENCE_INPUT_VERSION,
    domain: request.hostname, snapshots: request.resolvers.map(provider => {
      const own = queries.filter(query => query.provider === provider);
      const state = own.every(query => query.comparisonState === 'observed') ? 'observed'
        : own.every(query => query.comparisonState === 'unavailable') ? 'unavailable' : 'partial';
      return { observer: provider, source: adapters.find(item => item.id === provider)!.endpoint, observedAt: own.at(-1)!.observedAt, state,
        queries: own.map(query => ({ owner: request.hostname, type: query.type, state: query.comparisonState })),
        records: own.flatMap(query => query.values.map(value => ({ owner: request.hostname, type: query.type, value: value.value, ttl: value.ttl }))) };
    }) }, completedAt);
  return readResolverComparison({ schema: RESOLVER_COMPARISON_SCHEMA, version: RESOLVER_COMPARISON_VERSION,
    hostname: request.hostname, startedAt, completedAt, queries,
    rows: RESOLVER_RECORD_TYPES.map(type => ({ type, state: convergence.rows.find(row => row.type === type)!.state })) });
}

export function formatResolverComparison(report: Awaited<ReturnType<typeof collectResolverComparison>>) {
  return `${[`Resolver comparison · ${report.hostname}`, ...report.rows.map(row => `${row.type}: ${row.state}`),
    ...report.queries.map(query => `${RESOLVER_PROVIDERS.find(provider => provider.id === query.provider)!.label} ${query.type}: ${query.outcome}${query.values.length ? ` · ${query.values.map(value => value.value).join(', ')}` : ''}${query.aliasChain.length ? ` · via alias ${query.aliasChain.join(' → ')}` : ''}${query.aliasObserved ? ' · unfollowed alias or other-name answer' : ''}`),
    'Resolver agreement is not an authority, DNSSEC validation or safety verdict. Alias chains are followed only within each resolver\u2019s own answer. Negative answers and unavailable queries remain distinct.',
    'An empty answer without a negative SOA record stays partial. Different answers can reflect location-based or load-balanced responses rather than a change.'].join('\n')}\n`;
}
