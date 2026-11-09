import snapshot from './common-infrastructure-snapshot.json' with { type: 'json' };
import { parseCommonInfrastructureSnapshot } from './common-infrastructure.mts';
import { sha256IdentityHex } from '../evidence/record-identity.mts';

export const CLOUDFLARE_RANGE_URLS = Object.freeze([
  'https://www.cloudflare.com/ips-v4',
  'https://www.cloudflare.com/ips-v6',
]);
export const FRESHNESS_DAYS = 30;
const SHA256 = /^[a-f0-9]{64}$/u;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function commonInfrastructureHealth(now = new Date(), value: unknown = snapshot, admitted = parseCommonInfrastructureSnapshot(value)) {
  const rawSources = record(value)?.sources as unknown[];
  const generatedAt = Date.parse(admitted.generatedAt);
  const sourceAges = admitted.sources.flatMap((source, index) => {
    if (source.id === 'public-dns-core') return [];
    const rawProof = record(rawSources[index])?.verification;
    const proof = record(rawProof);
    let date = Date.parse(source.sourceDate);
    if (rawProof !== undefined) {
      const observedAt = typeof proof?.observedAt === 'string' ? Date.parse(proof.observedAt) : NaN;
      if (source.id !== 'cloudflare'
        || !Array.isArray(proof?.sources) || proof.sources.length !== CLOUDFLARE_RANGE_URLS.length
        || !proof.sources.every((item: unknown, index) => {
          const entry = record(item);
          return entry?.url === CLOUDFLARE_RANGE_URLS[index] && typeof entry?.sha256 === 'string' && SHA256.test(entry.sha256);
        })
        || proof.rangesSha256 !== sha256IdentityHex(new TextEncoder().encode(JSON.stringify(source.values)))
        || !Number.isFinite(observedAt) || new Date(observedAt).toISOString() !== proof.observedAt
        || observedAt > generatedAt || observedAt < date) {
        throw new TypeError('Retained range verification has invalid provenance.');
      }
      date = observedAt;
    }
    return [{ id: source.id, ageDays: Math.floor((now.getTime() - date) / 86_400_000) }];
  });
  const ageDays = sourceAges.length ? Math.max(...sourceAges.map(source => source.ageDays)) : null;
  const state = !Number.isFinite(now.getTime()) || !Number.isFinite(generatedAt) || generatedAt > now.getTime()
    || sourceAges.some(source => source.ageDays < 0) || ageDays === null
    ? 'unavailable' as const
    : admitted.excludedSources.length || ageDays > FRESHNESS_DAYS ? 'stale' as const : 'current' as const;
  return Object.freeze({ state, ageDays: state === 'unavailable' ? null : ageDays,
    observedAt: admitted.generatedAt, itemCount: admitted.entryCount, excludedCount: admitted.excludedSources.length,
    sourceAges: Object.freeze(sourceAges) });
}
