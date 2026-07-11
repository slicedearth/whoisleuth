const express = require('express');
const path = require('path');

const { classifyQuery } = require('./lib/classify');
const { fetchRdapRecord } = require('./lib/rdap');
const { buildWhoisChain, parseWhoisChain } = require('./lib/whois');
const { checkDomainAvailability } = require('./lib/availability');
const { searchCertificateTransparency } = require('./lib/ct-search');
const { checkDomainPosture, normalizeAuditDomain, normalizeDkimSelectors } = require('./lib/domain-posture');
const {
  COOKIE_NAME,
  checkPassword,
  createSessionToken,
  isValidSessionToken,
  isTrustedOrigin,
  parseCookies,
  buildSessionCookie,
  buildClearCookie,
} = require('./lib/auth');
const { checkRateLimit, getClientIp, LOGIN_RATE_LIMIT, API_RATE_LIMIT } = require('./lib/rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

// The frontend uses inline `style="..."` attributes throughout (no inline
// scripts or event handlers) - style-src needs 'unsafe-inline' for those to
// keep working, but script-src stays strict since nothing here needs it.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '1mb' }));

// True when the request actually arrived over HTTPS - directly, or via a
// reverse proxy that sets the standard forwarded-proto header - so the
// session cookie only gets the Secure attribute when it'll actually work.
// A plain `npm start` on localhost is http, so this must stay conditional
// rather than always true.
function isHttps(req) {
  return req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  if (!isValidSessionToken(cookies[COOKIE_NAME])) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

function rateLimit(scope, opts) {
  return (req, res, next) => {
    const key = `${scope}:${getClientIp(req.headers, req.socket && req.socket.remoteAddress)}`;
    const { allowed, retryAfterSeconds } = checkRateLimit(key, opts);
    if (!allowed) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}

const loginRateLimit = rateLimit('login', LOGIN_RATE_LIMIT);
const apiRateLimit = rateLimit('api', API_RATE_LIMIT);

app.post('/api/login', loginRateLimit, (req, res) => {
  const password = (req.body && req.body.password) || '';
  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  res.setHeader('Set-Cookie', buildSessionCookie(createSessionToken(), { secure: isHttps(req) }));
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

app.get('/api/rdap', apiRateLimit, requireAuth, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

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

app.get('/api/whois', apiRateLimit, requireAuth, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

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

app.get('/api/availability', apiRateLimit, requireAuth, async (req, res) => {
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

  try {
    const fast = req.query.fast === '1' || req.query.fast === 'true';
    const result = await checkDomainAvailability(classified.value, { fast });
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

app.get('/api/ct-search', apiRateLimit, requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

    const result = await searchCertificateTransparency(q);
    res.json({ keyword: q, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/domain-posture', apiRateLimit, requireAuth, async (req, res) => {
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

  try {
    const selectors = normalizeDkimSelectors((req.query.selectors || '').toString().split(','));
    res.json(await checkDomainPosture(domain, { dkimSelectors: selectors }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`WHOIS/RDAP tool listening on http://localhost:${PORT}`);
});
