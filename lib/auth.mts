// Shared-password gate: SITE_PASSWORD authenticates the user, while an
// optional independent SESSION_SECRET signs the expiring session cookie.
// Keeping those secrets separate means a captured token is not an offline
// password verifier. Existing one-variable deployments remain compatible by
// deriving a deliberately expensive signing key from SITE_PASSWORD.

import * as crypto from 'node:crypto';

type HeaderInput = Readonly<Record<string, string | readonly string[] | undefined>>;
type CookieOptions = { secure?: boolean };
type SigningSecret = string | Buffer;
type SessionConfigurationEnvironment = Readonly<Record<string, string | undefined>>;
type RequestOriginContext = Readonly<{
  protocol: string;
  trustForwardedProtocol?: boolean;
}>;

const COOKIE_NAME = 'wrt_session';
const SESSION_MAX_AGE_ENV = 'SESSION_MAX_AGE_DAYS';
const DEFAULT_SESSION_MAX_AGE_DAYS = 7;
const MIN_SESSION_MAX_AGE_DAYS = 1;
const MAX_SESSION_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MISSING_SESSION_SECRET_WARNING = 'WHOISleuth configuration warning: SESSION_SECRET is not set in production. Session signing is being derived from SITE_PASSWORD for compatibility; configure a separate random SESSION_SECRET.';

function productionSessionSecretWarning(
  env: SessionConfigurationEnvironment = process.env,
): string | null {
  const production = env.NODE_ENV === 'production' || env.CONTEXT === 'production';
  return production && Boolean(env.SITE_PASSWORD) && !env.SESSION_SECRET
    ? MISSING_SESSION_SECRET_WARNING
    : null;
}

let sessionSecretWarningReported = false;

function reportSessionSecretConfigurationWarning(): void {
  const warning = productionSessionSecretWarning();
  if (!warning || sessionSecretWarningReported) return;
  sessionSecretWarningReported = true;
  console.warn(warning);
}

function configuredSessionTtlMs(): number | null {
  const raw = process.env[SESSION_MAX_AGE_ENV];
  if (raw === undefined) return DEFAULT_SESSION_MAX_AGE_DAYS * DAY_MS;
  if (raw.length > 2) return null;
  if (!/^[1-9][0-9]*$/u.test(raw)) return null;
  const days = Number(raw);
  if (!Number.isSafeInteger(days)
    || days < MIN_SESSION_MAX_AGE_DAYS
    || days > MAX_SESSION_MAX_AGE_DAYS) return null;
  return days * DAY_MS;
}

function requiredSessionTtlMs(): number {
  const ttlMs = configuredSessionTtlMs();
  if (ttlMs === null) {
    throw new Error(
      `${SESSION_MAX_AGE_ENV} must be a whole number from ${MIN_SESSION_MAX_AGE_DAYS} to ${MAX_SESSION_MAX_AGE_DAYS}.`,
    );
  }
  return ttlMs;
}

function getSecret(): string | null {
  return process.env.SITE_PASSWORD || null;
}

let cachedPassword: string | null = null;
let cachedDerivedSigningKey: Buffer | null = null;

function getSigningSecret(): SigningSecret | null {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const password = getSecret();
  if (!password) return null;
  reportSessionSecretConfigurationWarning();
  if (password !== cachedPassword) {
    cachedPassword = password;
    cachedDerivedSigningKey = crypto.scryptSync(password, 'whoisleuth-session-signing-v1', 32);
  }
  return cachedDerivedSigningKey;
}

function sign(payload: string, secret: SigningSecret): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function timingSafeStringsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Fails closed (returns false) whenever SITE_PASSWORD isn't configured,
// rather than throwing - a misconfigured deployment should deny access,
// not accidentally let everyone in or crash the request handler.
function checkPassword(candidate: unknown): boolean {
  const secret = getSecret();
  if (!secret || typeof candidate !== 'string' || !candidate) return false;
  return timingSafeStringsEqual(candidate, secret);
}

function createSessionToken(): string {
  const secret = getSigningSecret();
  if (!secret) throw new Error('SITE_PASSWORD is not configured');
  const payload = String(Date.now() + requiredSessionTtlMs());
  return `${payload}.${sign(payload, secret)}`;
}

function isValidSessionToken(token: unknown): boolean {
  const secret = getSigningSecret();
  const ttlMs = configuredSessionTtlMs();
  if (!secret || ttlMs === null || !token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!timingSafeStringsEqual(sig, sign(payload, secret))) return false;
  const expires = Number(payload);
  const now = Date.now();
  return Number.isSafeInteger(expires)
    && now < expires
    && expires <= now + ttlMs;
}

// Convenience for callers that just have a raw Cookie header (e.g. a
// Netlify Function's event.headers.cookie) and want a single yes/no check.
function isAuthenticatedFromCookieHeader(cookieHeader: string | null | undefined): boolean {
  return isValidSessionToken(parseCookies(cookieHeader)[COOKIE_NAME]);
}

// Concurrency budgets need a stable per-session key, but retaining the signed
// cookie itself in a long-lived Map would unnecessarily keep a bearer token in
// memory. Authentication is checked separately; this irreversible fingerprint
// is only an opaque bucket key and reveals neither the password nor the token.
function sessionFingerprintFromCookieHeader(cookieHeader: string | null | undefined): string | null {
  const token = parseCookies(cookieHeader)[COOKIE_NAME];
  if (!token || typeof token !== 'string') return null;
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
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

function buildSessionCookie(token: string, { secure = true }: CookieOptions = {}): string {
  const ttlMs = requiredSessionTtlMs();
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(ttlMs / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

function buildClearCookie({ secure = true }: CookieOptions = {}): string {
  const attrs = [`${COOKIE_NAME}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

type StrictHeader = Readonly<{
  state: 'missing' | 'invalid' | 'valid';
  value?: string;
}>;

const NETLIFY_REQUEST_ORIGIN_CONTEXT: RequestOriginContext = Object.freeze({
  protocol: 'https',
});

function strictHeader(headers: HeaderInput | null | undefined, name: string): StrictHeader {
  if (!headers) return { state: 'missing' };
  const matches = Object.entries(headers).filter(([key, value]) => (
    key.toLowerCase() === name && value !== undefined
  ));
  if (matches.length === 0) return { state: 'missing' };
  if (matches.length !== 1) return { state: 'invalid' };
  const value = matches[0]?.[1];
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > 2_048
    || value !== value.trim()
    || /[\u0000-\u001f\u007f,]/u.test(value)) return { state: 'invalid' };
  return { state: 'valid', value };
}

function normalProtocol(value: string): 'http' | 'https' | null {
  const normalized = value.toLowerCase().replace(/:$/u, '');
  return normalized === 'http' || normalized === 'https' ? normalized : null;
}

function requestProtocol(
  headers: HeaderInput | null | undefined,
  context: RequestOriginContext,
): 'http' | 'https' | null {
  const direct = normalProtocol(context.protocol);
  if (!direct) return null;
  const forwarded = strictHeader(headers, 'x-forwarded-proto');
  if (forwarded.state === 'invalid') return null;
  if (forwarded.state === 'missing') return direct;
  const forwardedProtocol = normalProtocol(forwarded.value ?? '');
  if (!forwardedProtocol) return null;
  return context.trustForwardedProtocol ? forwardedProtocol : direct;
}

function canonicalRequestOrigin(
  headers: HeaderInput | null | undefined,
  context: RequestOriginContext,
): string | null {
  const protocol = requestProtocol(headers, context);
  const host = strictHeader(headers, 'host');
  if (!protocol || host.state !== 'valid' || !host.value
    || /[\s\\/@?#]/u.test(host.value)) return null;
  try {
    const parsed = new URL(`${protocol}://${host.value}`);
    const suppliedHost = host.value.toLowerCase();
    const parsedHost = parsed.host.toLowerCase();
    const defaultPortHost = `${parsedHost}:${protocol === 'https' ? '443' : '80'}`;
    return parsed.username
      || parsed.password
      || !parsed.hostname
      || (suppliedHost !== parsedHost && suppliedHost !== defaultPortHost)
      ? null
      : parsed.origin;
  } catch {
    return null;
  }
}

function canonicalOriginHeader(headers: HeaderInput | null | undefined): StrictHeader {
  const origin = strictHeader(headers, 'origin');
  if (origin.state !== 'valid' || !origin.value) return origin;
  if (!/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+$/iu.test(origin.value)) return { state: 'invalid' };
  try {
    const parsed = new URL(origin.value);
    if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash) return { state: 'invalid' };
    return { state: 'valid', value: parsed.origin };
  } catch {
    return { state: 'invalid' };
  }
}

// Same origin is the canonical scheme, host, and port derived from the
// request transport (or an explicitly trusted proxy protocol) plus Host.
function isTrustedOrigin(
  headers: HeaderInput | null | undefined,
  context: RequestOriginContext,
): boolean {
  const requestOrigin = canonicalRequestOrigin(headers, context);
  const origin = canonicalOriginHeader(headers);
  return Boolean(requestOrigin && origin.state === 'valid' && origin.value === requestOrigin);
}

// Login remains available to non-browser clients, but even an originless
// request must carry an unambiguous Host and deployment protocol.
function isTrustedLoginOrigin(
  headers: HeaderInput | null | undefined,
  context: RequestOriginContext,
): boolean {
  if (!canonicalRequestOrigin(headers, context)) return false;
  const origin = canonicalOriginHeader(headers);
  return origin.state === 'missing' || isTrustedOrigin(headers, context);
}

// Authenticated collection is a browser-owned website contract. A matching
// Origin or acceptable Fetch Metadata is required; metadata-free requests are
// not silently treated as a supported non-browser API.
function isPermittedAuthenticatedNetworkRequest(
  headers: HeaderInput | null | undefined,
  context: RequestOriginContext,
): boolean {
  if (!canonicalRequestOrigin(headers, context)) return false;
  const fetchSite = strictHeader(headers, 'sec-fetch-site');
  const origin = canonicalOriginHeader(headers);
  if (fetchSite.state === 'invalid' || origin.state === 'invalid') return false;
  if (fetchSite.state === 'missing' && origin.state === 'missing') return false;
  if (fetchSite.state === 'valid'
    && fetchSite.value !== 'same-origin'
    && fetchSite.value !== 'none') return false;
  return origin.state === 'missing' || isTrustedOrigin(headers, context);
}

export {
  COOKIE_NAME,
  NETLIFY_REQUEST_ORIGIN_CONTEXT,
  checkPassword,
  createSessionToken,
  isValidSessionToken,
  isAuthenticatedFromCookieHeader,
  sessionFingerprintFromCookieHeader,
  isTrustedOrigin,
  isTrustedLoginOrigin,
  isPermittedAuthenticatedNetworkRequest,
  parseCookies,
  buildSessionCookie,
  buildClearCookie,
  productionSessionSecretWarning,
  reportSessionSecretConfigurationWarning,
};

export type { CookieOptions, HeaderInput, RequestOriginContext, SessionConfigurationEnvironment, SigningSecret };
