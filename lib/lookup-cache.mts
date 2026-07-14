// Short-TTL in-memory cache for repeated RDAP/WHOIS lookups - the same
// domain looked up again shortly after (reviewing typosquat candidates,
// re-running a scan, a deep-check following a fast scan on the same
// domain) doesn't need a fresh registry round-trip every time. Same
// "public data, safe to share across all requests" reasoning as the IANA
// bootstrap cache in lib/rdap.js - RDAP/WHOIS results are public registry
// data, not anything specific to who's asking, so caching them briefly
// isn't a privacy concern the way per-user state would be.
//
// In-memory, so (like the bootstrap cache and the rate limiter) this
// applies globally on server.js's one long-lived process, but only within
// a single warm container on Netlify Functions.

type CacheEntry = {
  value: unknown;
  expiresAt: number;
  size: number;
};

type CacheFactory = () => unknown | Promise<unknown>;

const TTL_MS = 3 * 60 * 1000; // 3 minutes

// Bounds worst-case memory regardless of the TTL/sweep - without this, a
// single large fast scan (up to MAX_FAST_BULK_DOMAINS domains) landing
// within one TTL window adds that many entries, each holding a full raw
// RDAP/WHOIS response, before the next sweep has a chance to run; repeated
// or concurrent large scans compound that. `Map` preserves insertion
// order, so the oldest entry is always `store.keys().next().value` -
// simple FIFO eviction, not a full LRU (re-caching an existing key doesn't
// move it), which is a fine fit for a cache whose primary job is
// deduplicating near-simultaneous repeat lookups within a few minutes, not
// long-term hit-rate optimization.
const MAX_ENTRIES = 3000;

// MAX_ENTRIES alone bounds count, not size - it doesn't stop a hostile or
// compromised registry from serving a near-maximum-size response (RDAP:
// 2MB, lib/rdap.js; WHOIS: 200KB/hop, lib/whois.js) for many distinct
// domains. A full-size fast bulk scan (up to MAX_FAST_BULK_DOMAINS) hitting
// such a registry could otherwise retain gigabytes before entry count ever
// reaches MAX_ENTRIES. 100MB is generous for a normal Node process while
// still being a real ceiling.
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

const store = new Map<string, CacheEntry>();
let totalBytes = 0;

// Approximate, not exact (doesn't account for JS object/string overhead) -
// good enough for a soft memory ceiling, and cheap since it only runs once
// per cache write, not per read.
function approxByteSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function deleteEntry(key: string): void {
  const entry = store.get(key);
  if (!entry) return;
  store.delete(key);
  totalBytes -= entry.size;
}

function getCached(key: string): unknown | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    deleteEntry(key);
    return undefined;
  }
  return entry.value;
}

function setCached(key: string, value: unknown): void {
  deleteEntry(key); // avoid double-counting bytes if this key is already cached
  const size = approxByteSize(value);
  store.set(key, { value, expiresAt: Date.now() + TTL_MS, size });
  totalBytes += size;
  while (store.size > 0 && (store.size > MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES)) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    deleteEntry(oldestKey);
  }
}

// Concurrent callers for the same key (e.g. a bulk scan's concurrent
// workers, or a fast scan immediately followed by a deep-check, hitting the
// same domain before the first lookup has even finished) share one
// in-flight request instead of each starting their own.
const inFlight = new Map<string, Promise<unknown>>();

// `factory` may legitimately resolve to `null` (e.g. "no RDAP registry for
// this TLD") - that's cached as a real result, distinct from `undefined`
// meaning "not cached yet", so a `null` answer doesn't get re-fetched every
// time either.
// The cache intentionally holds heterogeneous public lookup results. Its
// CommonJS consumers remain JavaScript during migration, so the return stays
// dynamically typed at this compatibility boundary until those consumers
// receive explicit result contracts of their own.
async function cached(key: string, factory: CacheFactory): Promise<any> {
  const hit = getCached(key);
  if (hit !== undefined) return hit;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const value = await factory();
      setCached(key, value);
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

// Periodic sweep so a long-running process (server.js) doesn't accumulate
// one entry per distinct lookup forever - same pattern as the rate
// limiter's bucket cleanup.
const sweepInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) deleteEntry(key);
  }
}, 5 * 60 * 1000);
sweepInterval.unref();

function storeSize(): number {
  return store.size;
}

function storeBytes(): number {
  return totalBytes;
}

export {
  cached,
  MAX_ENTRIES,
  MAX_TOTAL_BYTES,
  storeSize as _storeSize,
  storeBytes as _storeBytes,
};
export type { CacheEntry, CacheFactory };
