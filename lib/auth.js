// Shared-password gate: SITE_PASSWORD authenticates the user, while an
// optional independent SESSION_SECRET signs the expiring session cookie.
// Keeping those secrets separate means a captured token is not an offline
// password verifier. Existing one-variable deployments remain compatible by
// deriving a deliberately expensive signing key from SITE_PASSWORD.

const crypto = require('crypto');

const COOKIE_NAME = 'wrt_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSecret() {
  return process.env.SITE_PASSWORD || null;
}

let cachedPassword = null;
let cachedDerivedSigningKey = null;

function getSigningSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const password = getSecret();
  if (!password) return null;
  if (password !== cachedPassword) {
    cachedPassword = password;
    cachedDerivedSigningKey = crypto.scryptSync(password, 'whoisleuth-session-signing-v1', 32);
  }
  return cachedDerivedSigningKey;
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function timingSafeStringsEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Fails closed (returns false) whenever SITE_PASSWORD isn't configured,
// rather than throwing - a misconfigured deployment should deny access,
// not accidentally let everyone in or crash the request handler.
function checkPassword(candidate) {
  const secret = getSecret();
  if (!secret || typeof candidate !== 'string' || !candidate) return false;
  return timingSafeStringsEqual(candidate, secret);
}

function createSessionToken() {
  const secret = getSigningSecret();
  if (!secret) throw new Error('SITE_PASSWORD is not configured');
  const payload = String(Date.now() + SESSION_TTL_MS);
  return `${payload}.${sign(payload, secret)}`;
}

function isValidSessionToken(token) {
  const secret = getSigningSecret();
  if (!secret || !token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!timingSafeStringsEqual(sig, sign(payload, secret))) return false;
  const expires = Number(payload);
  return Number.isFinite(expires) && Date.now() < expires;
}

// Convenience for callers that just have a raw Cookie header (e.g. a
// Netlify Function's event.headers.cookie) and want a single yes/no check.
function isAuthenticatedFromCookieHeader(cookieHeader) {
  return isValidSessionToken(parseCookies(cookieHeader)[COOKIE_NAME]);
}

// Concurrency budgets need a stable per-session key, but retaining the signed
// cookie itself in a long-lived Map would unnecessarily keep a bearer token in
// memory. Authentication is checked separately; this irreversible fingerprint
// is only an opaque bucket key and reveals neither the password nor the token.
function sessionFingerprintFromCookieHeader(cookieHeader) {
  const token = parseCookies(cookieHeader)[COOKIE_NAME];
  if (!token || typeof token !== 'string') return null;
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    try {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      // A malformed percent escape is an invalid cookie value, not a server
      // error. Ignore that pair so authentication continues to fail closed.
    }
  }
  return out;
}

function buildSessionCookie(token, { secure = true } = {}) {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

function buildClearCookie({ secure = true } = {}) {
  const attrs = [`${COOKIE_NAME}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

// Logout doesn't need to read the existing session cookie to clear it - it
// just unconditionally emits a clearing Set-Cookie. Restricting the request
// to POST closes the plain cross-site-GET path (e.g. an <img> tag), but a
// hostile page can still auto-submit a cross-site <form method="POST"> to
// this endpoint; SameSite=Lax stops that form from attaching the victim's
// session cookie, but the request still arrives, and the browser will honor
// the Set-Cookie in the response regardless of what the request sent. This
// compares the Origin header (sent by every modern browser on same-origin
// POST/PUT/DELETE/PATCH requests, not just cross-origin ones) against the
// request's own Host header - no hardcoded domain needed, so it works the
// same on any deployment (custom domain, Netlify preview URL, localhost).
function isTrustedOrigin(headers) {
  if (!headers) return false;
  const origin = headers.origin || headers.Origin;
  const host = headers.host || headers.Host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === String(host).toLowerCase();
  } catch {
    return false;
  }
}

// Browser form/fetch POSTs include Origin, so a present mismatch is enough
// to block login CSRF. Non-browser clients often omit Origin entirely; login
// keeps supporting those clients while logout remains deliberately fail-closed
// through isTrustedOrigin().
function isTrustedLoginOrigin(headers) {
  if (!headers) return true;
  const origin = headers.origin || headers.Origin;
  if (!origin) return true;
  return isTrustedOrigin({
    origin,
    host: headers.host || headers.Host,
  });
}

module.exports = {
  COOKIE_NAME,
  checkPassword,
  createSessionToken,
  isValidSessionToken,
  isAuthenticatedFromCookieHeader,
  sessionFingerprintFromCookieHeader,
  isTrustedOrigin,
  isTrustedLoginOrigin,
  parseCookies,
  buildSessionCookie,
  buildClearCookie,
};
