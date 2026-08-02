import express from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyQuery } from './lib/classify.mts';
import { fetchRdapRecord } from './lib/rdap.mts';
import {
  RdapNameserverSearchInputError,
  searchRdapNameserver,
} from './lib/rdap-nameserver-search.mts';
import { buildWhoisChain, parseWhoisChain } from './lib/whois.mts';
import { checkDomainAvailability } from './lib/availability.mts';
import { runUnifiedLookup, LOOKUP_ERROR_CODES } from './lib/lookup.mts';
import { createLookupHttpResponse } from './lib/lookup-response-contract.mts';
import {
  CANONICAL_TRAILING_SLASH_REDIRECTS,
  PRERENDERED_HTML_FILE_OVERRIDES,
} from './lib/prerendered-routes.mts';
import { searchCertificateTransparency } from './lib/ct-search.mts';
import { isCtQueryError, normalizeCtQuery } from './lib/ct-query.mts';
import { checkDomainPosture, normalizeAuditDomain, normalizeDkimSelectors, normalizeMailProtectionProfile } from './lib/domain-posture.mts';
import { capabilityReport } from './lib/capabilities.mts';
import {
  COOKIE_NAME,
  checkPassword,
  createSessionToken,
  isValidSessionToken,
  sessionFingerprintFromCookieHeader,
  isTrustedOrigin,
  parseCookies,
  buildSessionCookie,
  buildClearCookie,
  isTrustedLoginOrigin,
} from './lib/auth.mts';
import {
  checkApiRateLimit,
  checkLoginRateLimit,
  checkPrerenderedHtmlRateLimit,
  getClientIp,
  getForwardedProtocol,
} from './lib/rate-limit.mts';
import type { RateLimitChecker } from './lib/rate-limit.mts';
import {
  defaultOperationBudget,
  operationBudgetError,
  operationBudgetHttpStatus,
  runWithOperationBudget,
  operationBudgetTargetFor,
} from './lib/operation-budget.mts';
import { featureDisabledError, networkFeaturePolicy } from './lib/feature-policy.mts';
import type { NetworkFeatureId, NetworkFeaturePolicy } from './lib/feature-policy.mts';
import { MAX_API_JSON_BODY_BYTES, apiErrorResponseFor, apiUnexpectedErrorResponse } from './lib/http.mts';
import { HTTP_BASELINE_CONTENT_SECURITY_POLICY } from './lib/security-headers.mts';

type RequestLike = {
  protocol: string;
  headers: IncomingHttpHeaders;
  socket?: { remoteAddress?: string | null | undefined } | undefined;
  body?: unknown;
  query: Record<string, unknown>;
  path: string;
  networkFeaturePolicy?: NetworkFeaturePolicy | undefined;
};

type ResponseLike = {
  headersSent?: boolean;
  setHeader: (name: string, value: string) => unknown;
  status: (statusCode: number) => ResponseLike;
  json: (body: unknown) => unknown;
  redirect: (statusCode: number, path: string) => unknown;
};

type StaticResponseLike = ResponseLike & {
  sendFile: (path: string) => unknown;
};

type Next = () => void;
type ErrorNext = (error?: unknown) => void;
type OperationTarget = ReturnType<typeof operationBudgetTargetFor>;

function recordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function queryText(value: unknown): string {
  return value ? String(value).trim() : '';
}

function errorMessage(value: unknown): unknown {
  return recordValue(value, 'message');
}

function sendUnexpectedApiError(
  res: ResponseLike,
  errorCode: unknown = 'INTERNAL_ERROR',
) {
  const response = apiUnexpectedErrorResponse(errorCode);
  return res.status(response.statusCode).json(response.body);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const prerenderedHtmlRateLimit = rateLimit(checkPrerenderedHtmlRateLimit);

app.disable('x-powered-by');

app.use((req: RequestLike, res: ResponseLike, next: Next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', HTTP_BASELINE_CONTENT_SECURITY_POLICY);
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});

app.use('/api', (_req: RequestLike, res: ResponseLike, next: Next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Serve the prerendered Svelte workspace. `npm start` builds it first;
// `extensions` lets routes such as /lookup resolve lookup.html without a
// catch-all SPA rewrite, so unknown paths still return a real 404.
const svelteBuildDir = path.join(__dirname, 'frontend', 'build');
app.use('/_app/immutable', express.static(path.join(svelteBuildDir, '_app', 'immutable'), {
  immutable: true,
  maxAge: '1y',
}));
for (const [sourcePath, canonicalPath] of CANONICAL_TRAILING_SLASH_REDIRECTS) {
  app.get(sourcePath, (req: RequestLike, res: ResponseLike, next: Next) => {
    if (req.path !== sourcePath) {
      next();
      return;
    }
    res.redirect(308, canonicalPath);
  });
}
// A prerendered route can also be the parent directory for other pages.
// Serve its exact HTML file before express.static sees the directory and
// redirects to a non-existent index file.
for (const [routePath, htmlFile] of PRERENDERED_HTML_FILE_OVERRIDES) {
  app.get(routePath, prerenderedHtmlRateLimit, (_req: RequestLike, res: StaticResponseLike) => {
    res.sendFile(path.join(svelteBuildDir, htmlFile));
  });
}
app.use(express.static(svelteBuildDir, { extensions: ['html'] }));

// True when the request actually arrived over HTTPS - directly, or via a
// reverse proxy that sets the standard forwarded-proto header - so the
// session cookie only gets the Secure attribute when it'll actually work.
// A plain `npm start` on localhost is http, so this must stay conditional
// rather than always true.
function isHttps(req: RequestLike): boolean {
  return req.protocol === 'https' || getForwardedProtocol(req.headers) === 'https';
}

// Preserve secure-cookie detection for existing reverse-proxy deployments
// that have not opted into trusting forwarded client identity. A forged
// value can only add Secure (fail closed); it cannot remove the attribute.
function usesSecureCookies(req: RequestLike): boolean {
  const forwarded = req.headers['x-forwarded-proto'];
  return isHttps(req) || (typeof forwarded === 'string' && forwarded.toLowerCase() === 'https');
}

function requireAuth(req: RequestLike, res: ResponseLike, next: Next) {
  const cookies = parseCookies(req.headers.cookie);
  if (!isValidSessionToken(cookies[COOKIE_NAME])) {
    return res.status(401).json({ error: 'Authentication required', errorCode: LOOKUP_ERROR_CODES.AUTH_REQUIRED });
  }
  next();
}

function rateLimit(check: RateLimitChecker) {
  return (req: RequestLike, res: ResponseLike, next: Next) => {
    const identity = getClientIp(req.headers, req.socket && req.socket.remoteAddress);
    const { allowed, retryAfterSeconds } = check(identity);
    if (!allowed) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: 'Too many requests. Please try again later.', errorCode: LOOKUP_ERROR_CODES.RATE_LIMITED });
    }
    next();
  };
}

const loginRateLimit = rateLimit(checkLoginRateLimit);
const apiRateLimit = rateLimit(checkApiRateLimit);
const parseApiJson = express.json({ limit: MAX_API_JSON_BODY_BYTES });

function requireFeature(feature: NetworkFeatureId) {
  return (req: RequestLike, res: ResponseLike, next: Next) => {
    const policy = networkFeaturePolicy();
    const disabled = featureDisabledError(feature, policy);
    if (disabled) return res.status(503).json(disabled);
    req.networkFeaturePolicy = policy;
    next();
  };
}

async function withExpressOperationBudget<T>(
  req: RequestLike,
  res: ResponseLike,
  operationTarget: OperationTarget,
  callback: () => Promise<T>,
) {
  const sessionKey = sessionFingerprintFromCookieHeader(req.headers.cookie);
  if (!sessionKey) {
    return res.status(401).json({ error: 'Authentication required', errorCode: LOOKUP_ERROR_CODES.AUTH_REQUIRED });
  }
  const outcome = await runWithOperationBudget(defaultOperationBudget, operationTarget, sessionKey, callback);
  if (!outcome.allowed) {
    res.setHeader('Retry-After', String(outcome.denial.retryAfterSeconds));
    return res.status(operationBudgetHttpStatus(outcome.denial)).json(operationBudgetError(outcome.denial));
  }
  return outcome.value;
}

app.post('/api/login', (req: RequestLike, res: ResponseLike, next: Next) => {
  if (!isTrustedLoginOrigin(req.headers)) return res.status(403).json({ error: 'Cross-site request blocked' });
  next();
}, loginRateLimit, parseApiJson, (req: RequestLike, res: ResponseLike) => {
  const password = recordValue(req.body, 'password') || '';
  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  res.setHeader('Set-Cookie', buildSessionCookie(createSessionToken(), { secure: usesSecureCookies(req) }));
  res.json({ ok: true });
});

app.post('/api/logout', requireAuth, (req: RequestLike, res: ResponseLike) => {
  if (!isTrustedOrigin(req.headers)) {
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  res.setHeader('Set-Cookie', buildClearCookie({ secure: isHttps(req) }));
  res.json({ ok: true });
});

app.get('/api/session', (req: RequestLike, res: ResponseLike) => {
  const cookies = parseCookies(req.headers.cookie);
  res.json({ authenticated: isValidSessionToken(cookies[COOKIE_NAME]) });
});

app.get('/api/capabilities', requireAuth, (req: RequestLike, res: ResponseLike) => {
  res.json(capabilityReport('express'));
});

app.get('/api/lookup', apiRateLimit, requireAuth, requireFeature('lookup'), async (req: RequestLike, res: ResponseLike) => {
  const q = queryText(req.query.q);
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"', errorCode: LOOKUP_ERROR_CODES.MISSING_QUERY });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return res.status(400).json({ error: errorMessage(err), errorCode: LOOKUP_ERROR_CODES.INVALID_QUERY });
  }

  const fast = req.query.fast === '1' || req.query.fast === 'true';
  const compact = req.query.compact === '1' || req.query.compact === 'true';
  const externalIntelligence = req.query.intelligence === '1' || req.query.intelligence === 'true';
  const malwareHostIntelligence = req.query.malware === '1' || req.query.malware === 'true';
  const malwareIocIntelligence = req.query.ioc === '1' || req.query.ioc === 'true';
  const securityTxt = req.query.security_txt === '1' || req.query.security_txt === 'true';
  return withExpressOperationBudget(req, res, operationBudgetTargetFor('lookup', { fast, compact }), async () => {
    try {
      const result = await runUnifiedLookup(classified, {
        fast,
        compact,
        externalIntelligence,
        malwareHostIntelligence,
        malwareIocIntelligence,
        securityTxt,
        ...(req.networkFeaturePolicy ? { featurePolicy: req.networkFeaturePolicy } : {}),
      });
      res.json(createLookupHttpResponse(q, classified, result));
    } catch (err) {
      sendUnexpectedApiError(res, LOOKUP_ERROR_CODES.LOOKUP_FAILED);
    }
  });
});

app.get('/api/rdap', apiRateLimit, requireAuth, requireFeature('rdap'), async (req: RequestLike, res: ResponseLike) => {
  const q = queryText(req.query.q);
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return res.status(400).json({ error: errorMessage(err) });
  }

  return withExpressOperationBudget(req, res, operationBudgetTargetFor('rdap'), async () => {
    try {
      const record = await fetchRdapRecord(classified.type, classified.value);
      if (!record) {
        return res.status(404).json({ error: `No RDAP registry found for "${q}" via IANA bootstrap` });
      }

      res.status(200).json({
        query: q,
        type: classified.type,
        inputHostname: classified.inputHostname,
        registrableDomain: classified.registrableDomain,
        ...record,
      });
    } catch (err) {
      sendUnexpectedApiError(res);
    }
  });
});

app.get('/api/rdap-nameserver-search', apiRateLimit, requireAuth, requireFeature('rdap_nameserver_search'), async (req: RequestLike, res: ResponseLike) => {
  return withExpressOperationBudget(req, res, operationBudgetTargetFor('rdap_nameserver_search'), async () => {
    try {
      const result = await searchRdapNameserver(
        queryText(req.query.nameserver),
        queryText(req.query.scope),
      );
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RdapNameserverSearchInputError) {
        return res.status(400).json({ error: error.message, errorCode: error.code });
      }
      return sendUnexpectedApiError(res);
    }
  });
});

app.get('/api/whois', apiRateLimit, requireAuth, requireFeature('whois'), async (req: RequestLike, res: ResponseLike) => {
  const q = queryText(req.query.q);
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return res.status(400).json({ error: errorMessage(err) });
  }

  return withExpressOperationBudget(req, res, operationBudgetTargetFor('whois'), async () => {
    try {
      const chain = await buildWhoisChain(classified.value);
      res.json({
        query: q,
        type: classified.type,
        inputHostname: classified.inputHostname,
        registrableDomain: classified.registrableDomain,
        chain,
        parsed: parseWhoisChain(chain),
      });
    } catch (err) {
      sendUnexpectedApiError(res);
    }
  });
});

app.get('/api/availability', apiRateLimit, requireAuth, requireFeature('availability'), async (req: RequestLike, res: ResponseLike) => {
  const q = queryText(req.query.q);
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return res.status(400).json({ error: errorMessage(err) });
  }
  if (classified.type !== 'domain') {
    return res.json({ applicable: false, type: classified.type });
  }

  const fast = req.query.fast === '1' || req.query.fast === 'true';
  return withExpressOperationBudget(req, res, operationBudgetTargetFor('availability', { fast }), async () => {
    try {
      const result = await checkDomainAvailability(classified.value, {
        fast,
        ...(req.networkFeaturePolicy ? { featurePolicy: req.networkFeaturePolicy } : {}),
      });
      // domain is the registrable domain actually looked up; inputHostname
      // preserves what the user typed so the UI can note when a subdomain query
      // was resolved to its registrable domain (and never call the subdomain
      // itself "available").
      res.json({
        applicable: true,
        domain: classified.value,
        inputHostname: classified.inputHostname,
        registrableDomain: classified.registrableDomain,
        isSubdomain: classified.isSubdomain,
        ...result,
      });
    } catch (err) {
      sendUnexpectedApiError(res);
    }
  });
});

app.get('/api/ct-search', apiRateLimit, requireAuth, requireFeature('certificate_transparency'), async (req: RequestLike, res: ResponseLike) => {
  let q: string;
  try {
    q = normalizeCtQuery(req.query.q);
  } catch (error) {
    if (isCtQueryError(error)) return res.status(400).json({ error: error.message, errorCode: error.code });
    throw error;
  }
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"', errorCode: 'MISSING_QUERY' });

  return withExpressOperationBudget(req, res, operationBudgetTargetFor('certificate_transparency'), async () => {
    try {
      const result = await searchCertificateTransparency(q);
      res.json({ keyword: q, ...result });
    } catch (err) {
      sendUnexpectedApiError(res);
    }
  });
});

app.get('/api/domain-posture', apiRateLimit, requireAuth, requireFeature('domain_posture'), async (req: RequestLike, res: ResponseLike) => {
  const q = queryText(req.query.q);
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

  let classified: ReturnType<typeof classifyQuery>;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return res.status(400).json({ error: errorMessage(err) });
  }
  if (classified.type !== 'domain') return res.status(400).json({ error: 'Domain posture audits only support domain names.' });
  const domain = normalizeAuditDomain(classified.value);
  if (!domain) return res.status(400).json({ error: 'Invalid domain name for posture audit.' });

  const selectors = normalizeDkimSelectors(queryText(req.query.selectors).split(','));
  const retiredSelectors = normalizeDkimSelectors(queryText(req.query.retiredSelectors).split(','))
    .filter((selector) => !selectors.includes(selector))
    .slice(0, Math.max(0, 10 - selectors.length));
  const mailProtectionProfile = normalizeMailProtectionProfile(queryText(req.query.mailProfile));
  return withExpressOperationBudget(req, res, operationBudgetTargetFor('domain_posture'), async () => {
    try {
      res.json(await checkDomainPosture(domain, {
        dkimSelectors: selectors,
        retiredDkimSelectors: retiredSelectors,
        mailProtectionProfile,
      }));
    } catch (err) {
      sendUnexpectedApiError(res);
    }
  });
});

// Keep API failures inside the same bounded JSON contract as ordinary route
// responses. Body-parser errors otherwise reach Express's HTML error page and
// may expose stack traces and filesystem paths outside production mode.
function apiErrorHandler(error: unknown, _req: RequestLike, res: ResponseLike, next: ErrorNext) {
  if (res.headersSent) return next(error);
  const response = apiErrorResponseFor(error);
  return res.status(response.statusCode).json(response.body);
}

app.use('/api', apiErrorHandler);

function startServer() {
  return app.listen(PORT, (error: Error | undefined) => {
    if (error) throw error;
    console.log(`WHOIS/RDAP tool listening on http://localhost:${PORT}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}

export { app, isHttps, usesSecureCookies, requireAuth, rateLimit, requireFeature, apiErrorHandler, sendUnexpectedApiError, startServer };
