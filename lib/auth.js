// Shared-password gate: a single password (set via the SITE_PASSWORD
// environment variable, never committed to the repo) grants a signed,
// expiring session cookie. There's no per-user identity here - this is
// meant to keep a small tool restricted to "people I've given the password
// to," not to manage individual accounts. Shared by the Express server and
// the Netlify Functions.

const crypto = require('crypto');

const COOKIE_NAME = 'wrt_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSecret() {
  return process.env.SITE_PASSWORD || null;
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
  const secret = getSecret();
  if (!secret) throw new Error('SITE_PASSWORD is not configured');
  const payload = String(Date.now() + SESSION_TTL_MS);
  return `${payload}.${sign(payload, secret)}`;
}

function isValidSessionToken(token) {
  const secret = getSecret();
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

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
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
  const origin = headers.origin;
  const host = headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === String(host).toLowerCase();
  } catch {
    return false;
  }
}

module.exports = {
  COOKIE_NAME,
  checkPassword,
  createSessionToken,
  isValidSessionToken,
  isAuthenticatedFromCookieHeader,
  isTrustedOrigin,
  parseCookies,
  buildSessionCookie,
  buildClearCookie,
  sign, // exported purely so tests can construct a validly-signed but expired token
};
