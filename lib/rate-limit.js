// Fixed-window, per-IP rate limiting. Shared by server.js and the Netlify
// Functions so both deployment modes get the same protection: strict limits
// on /api/login (the shared password is the tool's only access control, so
// brute-forcing it is the main risk) and a generous ceiling on the lookup
// endpoints (rdap/whois/availability/ct-search) to stop a scripted flood
// from hammering upstream registries, without breaking the documented
// worst-case bulk scan (up to MAX_FAST_BULK_DOMAINS domains, client-driven
// at FAST_BULK_CONCURRENCY in-flight requests - see public/js/bulk.js).
//
// This is in-memory, so on server.js (one long-lived process) it limits
// globally; on Netlify Functions each container has its own memory, so it
// only limits bursts within a single warm container rather than across the
// whole deployment. Still worth having as a cheap first line of defense -
// just not a substitute for a shared store (e.g. Redis) under serious
// distributed abuse.

const buckets = new Map(); // key -> { count, resetAt }

function checkRateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  bucket.count += 1;
  return { allowed: true };
}

// Periodic sweep so a long-running process (server.js) doesn't accumulate
// one entry per distinct IP forever.
const sweepInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}, 5 * 60 * 1000);
sweepInterval.unref();

// Best-effort client IP for keying buckets. Checked in the same spirit as
// server.js's isHttps() - read the standard forwarded headers rather than
// trusting a framework's proxy setting, since this runs both behind
// arbitrary reverse proxies (self-hosted) and behind Netlify's edge.
function getClientIp(headers, fallback) {
  const h = headers || {};
  const forwardedFor = h['x-forwarded-for'] || h['X-Forwarded-For'];
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  const nfIp = h['x-nf-client-connection-ip'] || h['client-ip'];
  if (nfIp) return nfIp;
  return fallback || 'unknown';
}

// Login attempts: brute-forcing the shared password is the main threat
// model for this gate, so this stays tight regardless of deployment mode.
const LOGIN_RATE_LIMIT = { limit: 10, windowMs: 5 * 60 * 1000 };

// Lookup endpoints (rdap/whois/availability/ct-search): generous enough to
// clear a full 2000-domain fast bulk scan (see MAX_FAST_BULK_DOMAINS in
// public/js/bulk.js) without breaking normal use, while still capping an
// unbounded scripted flood well below what upstream registries would treat
// as abuse.
const API_RATE_LIMIT = { limit: 1000, windowMs: 60 * 1000 };

module.exports = {
  checkRateLimit,
  getClientIp,
  LOGIN_RATE_LIMIT,
  API_RATE_LIMIT,
};
