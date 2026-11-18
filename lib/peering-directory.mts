import { classifyQuery } from './classify.mts';
import { safeFetch } from './safe-fetch.mts';
import { requestJsonCapped } from './bounded-json-response.mts';
import { parseBoundedJson } from './bounded-json.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';

const ENDPOINT = 'https://www.peeringdb.com/api/net';
const FIELDS = 'id,asn,name,info_scope,policy_general,updated,status';
const MAX_RESPONSE_BYTES = 32 * 1024;
type DirectoryContext = Readonly<{
  source: 'PeeringDB'; asn: string; observedAt: string;
  state: 'listed' | 'not_listed' | 'unavailable';
  network: Readonly<{ id: number; name: string; scope: string | null; peeringPolicy: string | null; updatedAt: string | null }> | null;
  failure: 'timeout' | 'http_error' | 'invalid_response' | 'transport_error' | null;
}>;

export function normaliseDirectoryAsn(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:AS)?\d{1,10}$/iu.test(value)) throw new TypeError('Select one ASN, not a domain or address.');
  const classified = classifyQuery(value);
  if (classified.type !== 'asn') throw new TypeError('Select one valid ASN.');
  return classified.value;
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid directory response.');
  return value as Record<string, unknown>;
};
function text(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError('Invalid directory field.');
  return value.trim() || null;
}

/** One explicit local query. No contact expansion, persistence, bulk use or hosted redistribution. */
export async function collectPeeringDirectory(value: unknown, options: Readonly<{ permittedUse: boolean; signal?: AbortSignal }>,
  dependencies: Readonly<{ fetch?: typeof safeFetch; now?: () => string }> = {}): Promise<DirectoryContext> {
  if (options.permittedUse !== true) throw new TypeError('Acknowledge permitted operational use or existing provider permission before requesting directory data.');
  const asn = normaliseDirectoryAsn(value);
  options.signal?.throwIfAborted();
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({ asn: asn.slice(2), depth: '0', limit: '2', fields: FIELDS }).toString();
  const base = { source: 'PeeringDB' as const, asn, observedAt: (dependencies.now ?? (() => new Date().toISOString()))() };
  let received = false;
  let httpError = false;
  try {
    const { response, body } = await requestJsonCapped(url.toString(), { signal: options.signal ?? null,
      headers: { Accept: 'application/json' } }, {
      timeoutMs: 8_000, maximumBytes: MAX_RESPONSE_BYTES,
      fetchImpl: async (input, init) => {
        const result = await (dependencies.fetch ?? safeFetch)(String(input), init, 0);
        received = true; httpError = !result.ok;
        return result;
      },
      validateRawJson: raw => { parseBoundedJson(raw, { maximumBytes: MAX_RESPONSE_BYTES,
        limits: { maximumDepth: 6, maximumKeys: 100, maximumValues: 200, maximumContainerItems: 16, maximumStringCodeUnits: MAX_RESPONSE_BYTES } }); },
    });
    if (!response.ok) throw new TypeError('Directory HTTP request failed.');
    const root = object(body);
    if (!Array.isArray(root.data) || root.data.length > 1) throw new TypeError('Directory result is invalid or ambiguous.');
    if (!root.data.length) return { ...base, state: 'not_listed', network: null, failure: null };
    const row = object(root.data[0]);
    if (row.asn !== Number(asn.slice(2)) || !Number.isSafeInteger(row.id) || Number(row.id) < 1 || row.status !== 'ok') throw new TypeError('Directory identity is invalid.');
    const name = text(row.name, 300);
    if (!name) throw new TypeError('Directory name is missing.');
    const updatedAt = row.updated == null || row.updated === '' ? null : normalizeExplicitIsoTimestamp(row.updated);
    if (row.updated != null && row.updated !== '' && !updatedAt) throw new TypeError('Directory update time is invalid.');
    return { ...base, state: 'listed', failure: null, network: {
      id: Number(row.id), name, scope: text(row.info_scope, 80), peeringPolicy: text(row.policy_general, 80), updatedAt,
    } };
  } catch (error) {
    options.signal?.throwIfAborted();
    const timeout = error instanceof Error && 'code' in error && error.code === 'timeout';
    return { ...base, state: 'unavailable', network: null,
      failure: timeout ? 'timeout' : httpError ? 'http_error' : received ? 'invalid_response' : 'transport_error' };
  }
}

export function formatPeeringDirectory(context: DirectoryContext): string {
  return [`${context.source} context · ${context.asn}`, `Collected: ${context.observedAt}`,
    ...(context.network ? [`Network: ${context.network.name}`, `Directory record: ${context.network.id}`,
      `Reported scope: ${context.network.scope ?? 'Not supplied'}`, `Reported peering policy: ${context.network.peeringPolicy ?? 'Not supplied'}`,
      `Source updated: ${context.network.updatedAt ?? 'Unknown'}`]
      : [context.state === 'not_listed' ? 'No matching directory entry was returned.' : `Directory unavailable (${context.failure}).`]),
    'Community-maintained operational context, not registration authority, verified reachability, ownership or reputation.',
    'Use only within the provider’s permitted purpose or existing permission. No cache or export file is created; redistribution is not authorised by this command.',
  ].join('\n');
}
