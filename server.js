const express = require('express');
const path = require('path');

const { classifyQuery } = require('./lib/classify');
const { fetchRdapRecord } = require('./lib/rdap');
const { buildWhoisChain, parseWhoisChain } = require('./lib/whois');
const { checkDomainAvailability } = require('./lib/availability');
const { runUnifiedLookup, LOOKUP_ERROR_CODES } = require('./lib/lookup');
const { searchCertificateTransparency } = require('./lib/ct-search');
const { checkDomainPosture, normalizeAuditDomain, normalizeDkimSelectors } = require('./lib/domain-posture');
const { capabilityReport } = require('./lib/capabilities');
const {
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
} = require('./lib/auth');
const { checkRateLimit, getClientIp, getForwardedProtocol, LOGIN_RATE_LIMIT, API_RATE_LIMIT } = require('./lib/rate-limit');
const {
  defaultOperationBudget,
  operationBudgetError,
  runWithOperationBudget,
  operationClassFor,
} = require('./lib/operation-budget');
const { featureDisabledError, networkFeaturePolicy } = require('./lib/feature-policy');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
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
app.use(express.static(svelteBuildDir, { extensions: ['html'] }));
app.get(['/lookup/', '/discover/', '/bulk/', '/monitor/', '/brands/', '/privacy/'], (req, res) => {
  res.redirect(308, req.path.slice(0, -1));
});
app.use(express.json({ limit: '1mb' }));

// True when the request actually arrived over HTTPS - directly, or via a
// reverse proxy that sets the standard forwarded-proto header - so the
// session cookie only gets the Secure attribute when it'll actually work.
// A plain `npm start` on localhost is http, so this must stay conditional
// rather than always true.
function isHttps(req) {
  return req.protocol === 'https' || getForwardedProtocol(req.headers) === 'https';
}

// Preserve secure-cookie detection for existing reverse-proxy deployments
// that have not opted into trusting forwarded client identity. A forged
// value can only add Secure (fail closed); it cannot remove the attribute.
function usesSecureCookies(req) {
  const forwarded = req.headers['x-forwarded-proto'];
  return isHttps(req) || (typeof forwarded === 'string' && forwarded.toLowerCase() === 'https');
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  if (!isValidSessionToken(cookies[COOKIE_NAME])) {
    return res.status(401).json({ error: 'Authentication required', errorCode: LOOKUP_ERROR_CODES.AUTH_REQUIRED });
  }
  next();
}

function rateLimit(scope, opts) {
  return (req, res, next) => {
    const key = `${scope}:${getClientIp(req.headers, req.socket && req.socket.remoteAddress)}`;
    const { allowed, retryAfterSeconds } = checkRateLimit(key, opts);
    if (!allowed) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: 'Too many requests. Please try again later.', errorCode: LOOKUP_ERROR_CODES.RATE_LIMITED });
    }
    next();
  };
}

const loginRateLimit = rateLimit('login', LOGIN_RATE_LIMIT);
const apiRateLimit = rateLimit('api', API_RATE_LIMIT);

function requireFeature(feature) {
  return (req, res, next) => {
    const policy = networkFeaturePolicy();
    const disabled = featureDisabledError(feature, policy);
    if (disabled) return res.status(503).json(disabled);
    req.networkFeaturePolicy = policy;
    next();
  };
}

async function withExpressOperationBudget(req, res, operationClass, callback) {
  const sessionKey = sessionFingerprintFromCookieHeader(req.headers.cookie);
  if (!sessionKey) {
    return res.status(401).json({ error: 'Authentication required', errorCode: LOOKUP_ERROR_CODES.AUTH_REQUIRED });
  }
  const outcome = await runWithOperationBudget(defaultOperationBudget, operationClass, sessionKey, callback);
  if (!outcome.allowed) {
    res.setHeader('Retry-After', String(outcome.denial.retryAfterSeconds));
    return res.status(429).json(operationBudgetError(outcome.denial));
  }
  return outcome.value;
}

app.post('/api/login', (req, res, next) => {
  if (!isTrustedLoginOrigin(req.headers)) return res.status(403).json({ error: 'Cross-site request blocked' });
  next();
}, loginRateLimit, (req, res) => {
  const password = (req.body && req.body.password) || '';
  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  res.setHeader('Set-Cookie', buildSessionCookie(createSessionToken(), { secure: usesSecureCookies(req) }));
  res.json({ ok: true });
});

app.post('/api/logout', requireAuth, (req, res) => {
  if (!isTrustedOrigin(req.headers)) {
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  res.setHeader('Set-Cookie', buildClearCookie({ secure: isHttps(req) }));
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  res.json({ authenticated: isValidSessionToken(cookies[COOKIE_NAME]) });
});

app.get('/api/capabilities', requireAuth, (req, res) => {
  res.json(capabilityReport('express'));
});

app.get('/api/lookup', apiRateLimit, requireAuth, requireFeature('lookup'), async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"', errorCode: LOOKUP_ERROR_CODES.MISSING_QUERY });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return res.status(400).json({ error: err.message, errorCode: LOOKUP_ERROR_CODES.INVALID_QUERY });
  }

  const fast = req.query.fast === '1' || req.query.fast === 'true';
  return withExpressOperationBudget(req, res, operationClassFor('lookup', { fast }), async () => {
    try {
      const compact = req.query.compact === '1' || req.query.compact === 'true';
      const result = await runUnifiedLookup(classified, { fast, compact, featurePolicy: req.networkFeaturePolicy });
      res.json({
        query: q,
        type: classified.type,
        inputHostname: classified.inputHostname,
        registrableDomain: classified.registrableDomain,
        isSubdomain: classified.isSubdomain,
        ...result,
      });
    } catch (err) {
      res.status(500).json({ error: err.message, errorCode: LOOKUP_ERROR_CODES.LOOKUP_FAILED });
    }
  });
});

app.get('/api/rdap', apiRateLimit, requireAuth, requireFeature('rdap'), async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  return withExpressOperationBudget(req, res, operationClassFor('rdap'), async () => {
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
      res.status(500).json({ error: err.message });
    }
  });
});

app.get('/api/whois', apiRateLimit, requireAuth, requireFeature('whois'), async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  return withExpressOperationBudget(req, res, operationClassFor('whois'), async () => {
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
      res.status(500).json({ error: err.message });
    }
  });
});

app.get('/api/availability', apiRateLimit, requireAuth, requireFeature('availability'), async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (classified.type !== 'domain') {
    return res.json({ applicable: false, type: classified.type });
  }

  const fast = req.query.fast === '1' || req.query.fast === 'true';
  return withExpressOperationBudget(req, res, operationClassFor('availability', { fast }), async () => {
    try {
      const result = await checkDomainAvailability(classified.value, {
        fast,
        featurePolicy: req.networkFeaturePolicy,
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
      res.status(500).json({ error: err.message });
    }
  });
});

app.get('/api/ct-search', apiRateLimit, requireAuth, requireFeature('certificate_transparency'), async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

  return withExpressOperationBudget(req, res, operationClassFor('certificate_transparency'), async () => {
    try {
      const result = await searchCertificateTransparency(q);
      res.json({ keyword: q, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

app.get('/api/domain-posture', apiRateLimit, requireAuth, requireFeature('domain_posture'), async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

  let type, value;
  try {
    ({ type, value } = classifyQuery(q));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (type !== 'domain') return res.status(400).json({ error: 'Domain posture audits only support domain names.' });
  const domain = normalizeAuditDomain(value);
  if (!domain) return res.status(400).json({ error: 'Invalid domain name for posture audit.' });

  const selectors = normalizeDkimSelectors((req.query.selectors || '').toString().split(','));
  return withExpressOperationBudget(req, res, operationClassFor('domain_posture'), async () => {
    try {
      res.json(await checkDomainPosture(domain, { dkimSelectors: selectors }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

app.listen(PORT, () => {
  console.log(`WHOIS/RDAP tool listening on http://localhost:${PORT}`);
});
