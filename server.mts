import express from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyQuery } from './lib/classify.mts';
import { fetchRdapRecord, rdapUnavailableResponse } from './lib/rdap.mts';
import {
  RdapNameserverSearchInputError,
  searchRdapNameserver,
} from './lib/rdap-nameserver-search.mts';
import { buildWhoisChain, parseWhoisChain } from './lib/whois.mts';
import { checkDomainAvailability } from './lib/availability.mts';
import { runUnifiedLookup, LOOKUP_ERROR_CODES } from './lib/lookup.mts';
import { createLookupHttpResponse } from './lib/lookup-response-contract.mts';
import { MAX_LOOKUP_SELECTION_BODY_BYTES } from './lib/lookup-selected-request.mts';
import { prepareLookupHttpOperation } from './lib/lookup-http-operation.mts';
import { createLookupProgressBody, LOOKUP_PROGRESS_CONTENT_TYPE } from './lib/lookup-progress-http.mts';
import {
  CANONICAL_TRAILING_SLASH_REDIRECTS,
  PERMANENT_ROUTE_REDIRECTS,
  PRERENDERED_HTML_FILE_OVERRIDES,
} from './lib/prerendered-routes.mts';
import { searchCertificateTransparency } from './lib/ct-search.mts';
import { isCtQueryError, normalizeCtQuery } from './lib/ct-query.mts';
import { checkDomainPosture, normalizeAuditDomain, normalizeDkimSelectors, normalizeMailProtectionProfile } from './lib/domain-posture.mts';
import { parseInheritedDnsSelection } from './lib/dns-inheritance-review.mts';
import { capabilityReport } from './lib/capabilities.mts';
import {
  COOKIE_NAME,
  type RequestOriginContext,
  checkPassword,
  createSessionToken,
  isPermittedAuthenticatedNetworkRequest,
  isValidSessionToken,
  sessionFingerprintFromCookieHeader,
  isTrustedOrigin,
  parseCookies,
  buildSessionCookie,
  buildClearCookie,
  isTrustedLoginOrigin,
  reportSessionSecretConfigurationWarning,
} from './lib/auth.mts';
import {
  checkApiRateLimit,
  checkContactRouteRateLimit,
  checkLoginRateLimit,
  checkPrerenderedHtmlRateLimit,
  getClientIp,
  getForwardedProtocol,
  trustsForwardedHeaders,
} from './lib/rate-limit.mts';
import type { RateLimitChecker } from './lib/rate-limit.mts';
import { strictHeader } from './lib/request-header-facts.mts';
import {
  defaultOperationBudget,
  operationBudgetError,
  operationBudgetHttpStatus,
  runWithOperationBudget,
  operationBudgetTargetFor,
} from './lib/operation-budget.mts';
import { featureDisabledError, networkFeaturePolicy } from './lib/feature-policy.mts';
import type { NetworkFeatureId, NetworkFeaturePolicy } from './lib/feature-policy.mts';
import { MAX_API_JSON_BODY_BYTES, apiErrorResponseFor, apiUnexpectedErrorResponse, readRequestTextCapped } from './lib/http.mts';
import { HTTP_BASELINE_CONTENT_SECURITY_POLICY } from './lib/security-headers.mts';
import {
  MAX_CONTACT_ROUTE_BODY_BYTES,
  contactRoutePublicConfig,
  parseContactRouteBody,
  verifyContactRoute,
} from './lib/contact-route.mts';

type RequestLike = {
  method?: string;
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
  destroyed?: boolean;
  setHeader: (name: string, value: string) => unknown;
  status: (statusCode: number) => ResponseLike;
  json: (body: unknown) => unknown;
  redirect: (statusCode: number, path: string) => unknown;
};

type StaticResponseLike = ResponseLike & {
  sendFile: (path: string, callback: (error?: unknown) => void) => unknown;
};

type Next = () => void;
type ErrorNext = (error?: unknown) => void;
type OperationTarget = ReturnType<typeof operationBudgetTargetFor>;
type ExpressApplication = ReturnType<typeof express>;
type NetworkRouteServices = Readonly<{
  runUnifiedLookup: typeof runUnifiedLookup;
  createLookupHttpResponse: typeof createLookupHttpResponse;
  fetchRdapRecord: typeof fetchRdapRecord;
  searchRdapNameserver: typeof searchRdapNameserver;
  buildWhoisChain: typeof buildWhoisChain;
  parseWhoisChain: typeof parseWhoisChain;
  checkDomainAvailability: typeof checkDomainAvailability;
  searchCertificateTransparency: typeof searchCertificateTransparency;
  checkDomainPosture: typeof checkDomainPosture;
}>;

function sendPrerenderedHtmlFile(
  filename: string,
  res: StaticResponseLike,
  next: Next,
) {
  return res.sendFile(filename, (error) => {
    if (error) next();
  });
}

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
  if (res.destroyed || res.headersSent) return;
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
for (const [sourcePath, canonicalPath] of PERMANENT_ROUTE_REDIRECTS) {
  app.get(sourcePath, (req: RequestLike, res: ResponseLike, next: Next) => {
    if (req.path !== sourcePath) {
      next();
      return;
    }
    res.redirect(308, canonicalPath);
  });
}
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
  app.get(routePath, prerenderedHtmlRateLimit, (_req: RequestLike, res: StaticResponseLike, next: Next) => {
    sendPrerenderedHtmlFile(path.join(svelteBuildDir, htmlFile), res, next);
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
  const forwarded = strictHeader(req.headers, 'x-forwarded-proto');
  return isHttps(req) || (forwarded.state === 'valid' && forwarded.value?.toLowerCase() === 'https');
}

function requestOriginContext(req: RequestLike): RequestOriginContext {
  return trustsForwardedHeaders()
    ? { protocol: req.protocol, trustForwardedProtocol: true }
    : { protocol: req.protocol };
}

function requireAuth(req: RequestLike, res: ResponseLike, next: Next) {
  const cookies = parseCookies(req.headers.cookie);
  if (!isValidSessionToken(cookies[COOKIE_NAME])) {
    return res.status(401).json({ error: 'Authentication required', errorCode: LOOKUP_ERROR_CODES.AUTH_REQUIRED });
  }
  next();
}

function requireNetworkRequestAdmission(req: RequestLike, res: ResponseLike, next: Next) {
  if (!isPermittedAuthenticatedNetworkRequest(req.headers, requestOriginContext(req))) {
    return res.status(403).json({ error: 'Cross-site network request blocked', errorCode: 'CROSS_SITE_REQUEST_BLOCKED' });
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
const contactRouteRateLimit = rateLimit(checkContactRouteRateLimit);
const parseApiJson = express.json({ limit: MAX_API_JSON_BODY_BYTES });
const parseContactRouteJson = express.json({ limit: MAX_CONTACT_ROUTE_BODY_BYTES });

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
  res: Response,
  operationTarget: OperationTarget,
  callback: (signal: AbortSignal) => Promise<T>,
) {
  if (res.destroyed) return;
  const sessionKey = sessionFingerprintFromCookieHeader(req.headers.cookie);
  if (!sessionKey) {
    return res.status(401).json({ error: 'Authentication required', errorCode: LOOKUP_ERROR_CODES.AUTH_REQUIRED });
  }
  const controller = new AbortController();
  const closed = () => controller.abort();
  res.once('close', closed);
  if (res.destroyed) closed();
  try {
    const outcome = await runWithOperationBudget(defaultOperationBudget, operationTarget, sessionKey, () =>
      controller.signal.aborted ? undefined : callback(controller.signal));
    if (res.destroyed) return;
    if (!outcome.allowed) {
      res.setHeader('Retry-After', String(outcome.denial.retryAfterSeconds));
      return res.status(operationBudgetHttpStatus(outcome.denial)).json(operationBudgetError(outcome.denial));
    }
    return outcome.value;
  } finally {
    res.off('close', closed);
  }
}

app.post('/api/login', (req: RequestLike, res: ResponseLike, next: Next) => {
  if (!isTrustedLoginOrigin(req.headers, requestOriginContext(req))) return res.status(403).json({ error: 'Cross-site request blocked' });
  next();
}, loginRateLimit, parseApiJson, (req: RequestLike, res: ResponseLike) => {
  const password = recordValue(req.body, 'password') || '';
  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  res.setHeader('Set-Cookie', buildSessionCookie(createSessionToken(), { secure: usesSecureCookies(req) }));
  res.json({ ok: true });
});

app.get('/api/contact-route', (_req: RequestLike, res: ResponseLike) => {
  res.json(contactRoutePublicConfig());
});

app.post('/api/contact-route', contactRouteRateLimit, (req: RequestLike, res: ResponseLike, next: Next) => {
  if (!isTrustedOrigin(req.headers, requestOriginContext(req))) {
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  next();
}, parseContactRouteJson, async (req: RequestLike, res: ResponseLike) => {
  const parsed = parseContactRouteBody(req.body);
  if (!parsed) return res.status(400).json({ error: 'Invalid request body' });
  const result = await verifyContactRoute(parsed.category, parsed.token);
  if (result.status === 'ok') {
    return res.status(200).json({ category: result.category, route: result.route });
  }
  if (result.status === 'unavailable') {
    return res.status(503).json({ error: 'Contact route is not configured' });
  }
  return res.status(result.status === 'invalid_request' ? 400 : 403).json({
    error: result.status === 'invalid_request'
      ? 'Invalid request body'
      : 'Contact verification failed',
  });
});

app.post('/api/logout', requireAuth, (req: RequestLike, res: ResponseLike) => {
  if (!isTrustedOrigin(req.headers, requestOriginContext(req))) {
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  res.setHeader('Set-Cookie', buildClearCookie({ secure: isHttps(req) }));
  res.json({ ok: true });
});

app.get('/api/session', (req: RequestLike, res: ResponseLike) => {
  const cookies = parseCookies(req.headers.cookie);
  res.json({ authenticated: isValidSessionToken(cookies[COOKIE_NAME]) });
});

app.get('/api/capabilities', requireAuth, (_req: RequestLike, res: ResponseLike) => {
  res.json(capabilityReport('express'));
});

const DEFAULT_NETWORK_ROUTE_SERVICES: NetworkRouteServices = Object.freeze({
  runUnifiedLookup,
  createLookupHttpResponse,
  fetchRdapRecord,
  searchRdapNameserver,
  buildWhoisChain,
  parseWhoisChain,
  checkDomainAvailability,
  searchCertificateTransparency,
  checkDomainPosture,
});

function registerNetworkApiRoutes(
  target: ExpressApplication,
  services: NetworkRouteServices = DEFAULT_NETWORK_ROUTE_SERVICES,
): void {
  const handleLookup = async (req: Request & { networkFeaturePolicy?: NetworkFeaturePolicy }, res: Response) => {
    const operation = prepareLookupHttpOperation({ params: req.query, method: req.method,
      contentType: req.headers['content-type'], accept: req.headers.accept, body: req.body,
      featurePolicy: req.networkFeaturePolicy ?? networkFeaturePolicy() });
    if (!operation.ok) return res.status(operation.status).json(operation.body);
    return withExpressOperationBudget(req, res, operationBudgetTargetFor('lookup', operation.options), async (signal) => {
      try {
        if (operation.streaming) {
          const controller = new AbortController();
          const stream = createLookupProgressBody({ sources: operation.sources, signal: AbortSignal.any([signal, controller.signal]),
            run: (settled, signal) => operation.run(services, signal, settled) });
          res.setHeader('Content-Type', `${LOOKUP_PROGRESS_CONTENT_TYPE}; charset=utf-8`);
          res.setHeader('Cache-Control', 'no-store');
          res.flushHeaders();
          try { await pipeline(Readable.fromWeb(stream.body as import('node:stream/web').ReadableStream<Uint8Array>), res); }
          finally { controller.abort(); await stream.completion; }
        } else {
          const result = await operation.run(services, signal);
          if (!signal.aborted) res.json(result);
        }
      } catch {
        if (!res.headersSent && !res.destroyed) sendUnexpectedApiError(res, LOOKUP_ERROR_CODES.LOOKUP_FAILED);
      }
    });
  };
  const lookupGuards = [apiRateLimit, requireAuth, requireNetworkRequestAdmission, requireFeature('lookup')];
  target.get('/api/lookup', ...lookupGuards, handleLookup);
  target.post('/api/lookup', ...lookupGuards, async (req, res, next) => {
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') {
      res.status(415).json({ error: 'Selected URL requests must use uncompressed JSON.' }); return;
    }
    const controller = new AbortController();
    const aborted = () => controller.abort();
    req.once('aborted', aborted);
    try {
      const body = await readRequestTextCapped({
        body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
        headers: new Headers(req.headers['content-length'] ? { 'content-length': req.headers['content-length'] } : {}),
        signal: controller.signal,
      }, MAX_LOOKUP_SELECTION_BODY_BYTES);
      if (body.status !== 'ok') {
        if (res.destroyed) return;
        res.setHeader('Connection', 'close');
        res.once('finish', () => req.destroy());
        res.status(body.status === 'too_large' ? 413 : body.status === 'invalid_encoding' ? 400 : 408)
          .json({ error: body.status === 'too_large' ? 'Selected URL request is too large.' : body.status === 'invalid_encoding' ? 'Invalid request encoding.' : 'Request body read timed out.' });
        return;
      }
      req.body = body.body;
      next();
    } catch (error) { next(error); }
    finally { req.off('aborted', aborted); }
  }, handleLookup);

  target.get('/api/rdap', apiRateLimit, requireAuth, requireNetworkRequestAdmission, requireFeature('rdap'), async (req: RequestLike, res: Response) => {
    const q = queryText(req.query.q);
    if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

    let classified;
    try {
      classified = classifyQuery(q);
    } catch {
      return res.status(400).json({ error: 'Invalid query' });
    }

    return withExpressOperationBudget(req, res, operationBudgetTargetFor('rdap'), async (signal) => {
      try {
        const record = await services.fetchRdapRecord(classified.type, classified.value, { signal });
        if (signal.aborted) return;
        if (!record) {
          return res.status(404).json(rdapUnavailableResponse(classified.type, classified.value));
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

  target.get('/api/rdap-nameserver-search', apiRateLimit, requireAuth, requireNetworkRequestAdmission, requireFeature('rdap_nameserver_search'), async (req: RequestLike, res: Response) => {
    return withExpressOperationBudget(req, res, operationBudgetTargetFor('rdap_nameserver_search'), async (signal) => {
      try {
        const result = await services.searchRdapNameserver(
          queryText(req.query.nameserver),
          queryText(req.query.scope),
          { signal },
        );
        if (signal.aborted) return;
        return res.status(200).json(result);
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof RdapNameserverSearchInputError) {
          return res.status(400).json({ error: error.message, errorCode: error.code });
        }
        return sendUnexpectedApiError(res);
      }
    });
  });

  target.get('/api/whois', apiRateLimit, requireAuth, requireNetworkRequestAdmission, requireFeature('whois'), async (req: RequestLike, res: Response) => {
    const q = queryText(req.query.q);
    if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

    let classified;
    try {
      classified = classifyQuery(q);
    } catch {
      return res.status(400).json({ error: 'Invalid query' });
    }

    return withExpressOperationBudget(req, res, operationBudgetTargetFor('whois'), async (signal) => {
      try {
        const chain = await services.buildWhoisChain(classified.value, { signal });
        if (signal.aborted) return;
        res.json({
          query: q,
          type: classified.type,
          inputHostname: classified.inputHostname,
          registrableDomain: classified.registrableDomain,
          chain,
          parsed: services.parseWhoisChain(chain),
        });
      } catch (err) {
        sendUnexpectedApiError(res);
      }
    });
  });

  target.get('/api/availability', apiRateLimit, requireAuth, requireNetworkRequestAdmission, requireFeature('availability'), async (req: RequestLike, res: Response) => {
    const q = queryText(req.query.q);
    if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

    let classified;
    try {
      classified = classifyQuery(q);
    } catch {
      return res.status(400).json({ error: 'Invalid query' });
    }
    if (classified.type !== 'domain') {
      return res.json({ applicable: false, type: classified.type });
    }

    const fast = req.query.fast === '1' || req.query.fast === 'true';
    return withExpressOperationBudget(req, res, operationBudgetTargetFor('availability', { fast }), async (signal) => {
      try {
        const result = await services.checkDomainAvailability(classified.value, {
          fast,
          signal,
          ...(!fast ? { observationHostname: classified.inputHostname } : {}),
          ...(req.networkFeaturePolicy ? { featurePolicy: req.networkFeaturePolicy } : {}),
        });
        if (signal.aborted) return;
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

  target.get('/api/ct-search', apiRateLimit, requireAuth, requireNetworkRequestAdmission, requireFeature('certificate_transparency'), async (req: RequestLike, res: Response) => {
    let q: string;
    try {
      q = normalizeCtQuery(req.query.q);
    } catch (error) {
      if (isCtQueryError(error)) return res.status(400).json({ error: error.message, errorCode: error.code });
      throw error;
    }
    if (!q) return res.status(400).json({ error: 'Missing query parameter "q"', errorCode: 'MISSING_QUERY' });

    return withExpressOperationBudget(req, res, operationBudgetTargetFor('certificate_transparency'), async (signal) => {
      try {
        const result = await services.searchCertificateTransparency(q, { signal });
        if (signal.aborted) return;
        res.json({ keyword: q, ...result });
      } catch (err) {
        sendUnexpectedApiError(res);
      }
    });
  });

  target.get('/api/domain-posture', apiRateLimit, requireAuth, requireNetworkRequestAdmission, requireFeature('domain_posture'), async (req: RequestLike, res: Response) => {
    const q = queryText(req.query.q);
    if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

    let classified: ReturnType<typeof classifyQuery>;
    try {
      classified = classifyQuery(q);
    } catch {
      return res.status(400).json({ error: 'Invalid query' });
    }
    if (classified.type !== 'domain') return res.status(400).json({ error: 'Domain posture audits only support domain names.' });
    const domain = normalizeAuditDomain(classified.value);
    if (!domain) return res.status(400).json({ error: 'Invalid domain name for posture audit.' });

    const selectors = normalizeDkimSelectors(queryText(req.query.selectors).split(','));
    const retiredSelectors = normalizeDkimSelectors(queryText(req.query.retiredSelectors).split(','))
      .filter((selector) => !selectors.includes(selector))
      .slice(0, Math.max(0, 10 - selectors.length));
    const mailProtectionProfile = normalizeMailProtectionProfile(queryText(req.query.mailProfile));
    let includeInheritedDns: true | undefined;
    try { includeInheritedDns = parseInheritedDnsSelection(req.query.includeInheritedDns); }
    catch { return res.status(400).json({ error: 'includeInheritedDns must be 1 when requested.' }); }
    return withExpressOperationBudget(req, res, operationBudgetTargetFor('domain_posture'), async (signal) => {
      try {
        const result = await services.checkDomainPosture(domain, {
          dkimSelectors: selectors,
          retiredDkimSelectors: retiredSelectors,
          mailProtectionProfile,
          ...(includeInheritedDns ? { includeInheritedDns } : {}),
          signal,
        });
        if (!signal.aborted) res.json(result);
      } catch (err) {
        sendUnexpectedApiError(res);
      }
    });
  });
}

registerNetworkApiRoutes(app);

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
  reportSessionSecretConfigurationWarning();
  return app.listen(PORT, (error: Error | undefined) => {
    if (error) throw error;
    console.log(`WHOIS/RDAP tool listening on http://localhost:${PORT}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}

export { app, isHttps, usesSecureCookies, requestOriginContext, requireAuth, requireNetworkRequestAdmission, rateLimit, requireFeature, apiErrorHandler, registerNetworkApiRoutes, sendPrerenderedHtmlFile, sendUnexpectedApiError, startServer };
export type { NetworkRouteServices };
