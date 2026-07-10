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

const store = new Map(); // key -> { value, expiresAt }

function getCached(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCached(key, value) {
  store.set(key, { value, expiresAt: Date.now() + TTL_MS });
  while (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    store.delete(oldestKey);
  }
}

// Concurrent callers for the same key (e.g. a bulk scan's concurrent
// workers, or a fast scan immediately followed by a deep-check, hitting the
// same domain before the first lookup has even finished) share one
// in-flight request instead of each starting their own.
const inFlight = new Map();

// `factory` may legitimately resolve to `null` (e.g. "no RDAP registry for
// this TLD") - that's cached as a real result, distinct from `undefined`
// meaning "not cached yet", so a `null` answer doesn't get re-fetched every
// time either.
async function cached(key, factory) {
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
    if (now > entry.expiresAt) store.delete(key);
  }
}, 5 * 60 * 1000);
sweepInterval.unref();

module.exports = { cached, MAX_ENTRIES, _storeSize: () => store.size };
