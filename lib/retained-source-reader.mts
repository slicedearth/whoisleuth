import { abortable } from './abort.mts';
import { parseEditionState } from './retained-source-channel.mts';
import { admitRetainedSourceData, type LookupSourceEditions } from './retained-source-data.mts';
import type { VersionedTextStore } from './netlify-versioned-text-store.mts';
import { HOSTED_SOURCE_IDS, type HostedSourceId } from '../packages/contracts/retained-source-edition.mts';

type ReadResult = { [Source in HostedSourceId]: { source: Source; data: NonNullable<LookupSourceEditions[Source]> } }[HostedSourceId];
const STORE_TIMEOUT_MS = 1_200;
const CACHE_TTL_MS = 10 * 60_000;
const ERROR_BACKOFF_MS = 60_000;
const TRANSPORT_FALLBACK_MS = 60 * 60_000;

/** Each worker caches only fixed public projections. No target reaches storage. */
export function createRetainedLookupSourceReader(openStore: (signal: AbortSignal) => VersionedTextStore, now = Date.now) {
  type Entry = { cached?: ReadResult | undefined; expires: number; readAt: number; pending?: Promise<ReadResult | undefined> | undefined };
  const cache = new Map<HostedSourceId, Entry>();
  function read(source: HostedSourceId): Promise<ReadResult | undefined> {
    const entry = cache.get(source) ?? { expires: 0, readAt: 0 };
    cache.set(source, entry);
    const time = now();
    if (entry.pending) return entry.pending;
    if (entry.expires > time) return Promise.resolve(entry.cached);
    entry.pending = (async () => {
      let stored;
      try {
        const signal = AbortSignal.timeout(STORE_TIMEOUT_MS);
        stored = await openStore(signal).read(`state/${source}`, { signal });
      } catch {
        // Brief provider outages can use a previously verified edition.
        // A successful read of missing/invalid state is not an outage.
        entry.expires = time + ERROR_BACKOFF_MS;
        if (time - entry.readAt > TRANSPORT_FALLBACK_MS) entry.cached = undefined;
        return entry.cached;
      }
      entry.expires = time + CACHE_TTL_MS;
      entry.readAt = time;
      entry.cached = undefined;
      try {
        const active = parseEditionState(stored.value).current;
        if (active) {
          const admitted = await admitRetainedSourceData(active, source, new Date(time));
          entry.cached = admitted;
        }
      } catch { /* Fall back to bundled data, not to corrupt or unverified data. */ }
      return entry.cached;
    })().finally(() => { entry.pending = undefined; });
    return entry.pending;
  }
  return async (signal?: AbortSignal): Promise<LookupSourceEditions> => {
    const editions = await abortable(() => Promise.all(HOSTED_SOURCE_IDS.map(read)), signal);
    const sslbl = editions.find(edition => edition?.source === 'sslbl');
    const kev = editions.find(edition => edition?.source === 'kev');
    const registrar = editions.find(edition => edition?.source === 'registrar');
    return {
      ...(sslbl?.source === 'sslbl' ? { sslbl: sslbl.data } : {}),
      ...(kev?.source === 'kev' ? { kev: kev.data } : {}),
      ...(registrar?.source === 'registrar' ? { registrar: registrar.data } : {}),
    };
  };
}
