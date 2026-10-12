import { isValidAsciiHostname } from '../contracts/domain-name.mts';
import { normalizeExplicitIsoTimestamp } from './observation.mts';

export const MAX_DMARC_DISCOVERY_OWNERS = 8;
export type DmarcPolicy = 'none' | 'quarantine' | 'reject';
export type DmarcPolicyContext = Readonly<{
  version: 1;
  source: 'recursive_dns_txt';
  relation: 'exact' | 'inherited' | 'undetermined';
  complete: boolean;
  owner: string | null;
  observedAt: string | null;
  policy: DmarcPolicy | null;
  subdomainPolicy: DmarcPolicy | null;
  nonexistentPolicy: DmarcPolicy | null;
  psd: 'u' | 'n' | 'y' | null;
  testMode: boolean | null;
  discovery: readonly Readonly<{
    owner: string;
    state: 'observed' | 'not_found' | 'invalid' | 'unavailable';
    observedAt: string | null;
  }>[];
}>;

function closedRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length) throw new TypeError('DMARC policy context has an invalid structure.');
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError('DMARC policy context requires ordinary data fields.');
    result[key] = descriptor.value;
  }
  return result;
}

function owner(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 253
    && isValidAsciiHostname(value, { requireDot: false, requireLowercase: true });
}

function time(value: unknown): string | null {
  if (value === null) return null;
  const normalized = typeof value === 'string' && value.length <= 64 ? normalizeExplicitIsoTimestamp(value) : null;
  if (normalized === null) throw new TypeError('DMARC policy context has an invalid observation time.');
  return normalized;
}

/** Current opted-in review only; absent historical context is never reconstructed. */
export function normalizeDmarcPolicyContext(value: unknown, expectedDomain?: string): DmarcPolicyContext | undefined {
  if (value === undefined) return undefined;
  const input = closedRecord(value, ['version', 'source', 'relation', 'complete', 'owner', 'observedAt', 'policy', 'subdomainPolicy', 'nonexistentPolicy', 'psd', 'testMode', 'discovery']);
  if (input.version !== 1 || input.source !== 'recursive_dns_txt' || typeof input.complete !== 'boolean'
    || typeof input.relation !== 'string' || !['exact', 'inherited', 'undetermined'].includes(input.relation)
    || !Array.isArray(input.discovery) || input.discovery.length < 1 || input.discovery.length > MAX_DMARC_DISCOVERY_OWNERS) {
    throw new TypeError('DMARC policy context has an unsupported version or discovery state.');
  }
  const discovery: DmarcPolicyContext['discovery'][number][] = [];
  for (let index = 0; index < input.discovery.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(input.discovery, String(index));
    if (!entry?.enumerable || !('value' in entry)) throw new TypeError('DMARC discovery requires ordinary entries.');
    const row = closedRecord(entry.value, ['owner', 'state', 'observedAt']);
    if (!owner(row.owner) || typeof row.state !== 'string' || !['observed', 'not_found', 'invalid', 'unavailable'].includes(row.state)) {
      throw new TypeError('DMARC discovery has an invalid owner or state.');
    }
    discovery.push(Object.freeze({ owner: row.owner, state: row.state as DmarcPolicyContext['discovery'][number]['state'], observedAt: time(row.observedAt) }));
  }
  if (new Set(discovery.map(row => row.owner)).size !== discovery.length
    || (expectedDomain !== undefined && discovery[0]!.owner !== expectedDomain)
    || discovery.some((row, index) => index > 0 && !discovery[index - 1]!.owner.endsWith(`.${row.owner}`))
    || (input.complete && discovery.some(row => row.state === 'unavailable'))) {
    throw new TypeError('DMARC discovery does not match one bounded owner walk.');
  }
  const observedAt = time(input.observedAt);
  if (input.relation === 'undetermined') {
    if ([input.owner, observedAt, input.policy, input.subdomainPolicy, input.nonexistentPolicy, input.psd, input.testMode].some(field => field !== null)) {
      throw new TypeError('Undetermined DMARC policy must not declare a selected policy.');
    }
  } else {
    const selected = discovery.find(row => row.owner === input.owner);
    if (!input.complete || !owner(input.owner) || !selected || selected.state !== 'observed' || selected.observedAt !== observedAt
      || (input.relation === 'exact') !== (input.owner === discovery[0]!.owner)
      || [input.policy, input.subdomainPolicy, input.nonexistentPolicy].some(field => typeof field !== 'string' || !['none', 'quarantine', 'reject'].includes(field))
      || typeof input.psd !== 'string' || !['u', 'n', 'y'].includes(input.psd) || typeof input.testMode !== 'boolean') {
      throw new TypeError('DMARC policy does not match a complete selected observation.');
    }
  }
  return Object.freeze({
    version: 1, source: 'recursive_dns_txt', relation: input.relation as DmarcPolicyContext['relation'],
    complete: input.complete, owner: input.owner as string | null, observedAt,
    policy: input.policy as DmarcPolicy | null, subdomainPolicy: input.subdomainPolicy as DmarcPolicy | null,
    nonexistentPolicy: input.nonexistentPolicy as DmarcPolicy | null,
    psd: input.psd as DmarcPolicyContext['psd'], testMode: input.testMode as boolean | null,
    discovery: Object.freeze(discovery),
  });
}
