const express = require('express');
const path = require('path');

const { classifyQuery } = require('./lib/classify');
const { fetchRdapRecord } = require('./lib/rdap');
const { buildWhoisChain, parseWhoisChain } = require('./lib/whois');
const { checkDomainAvailability } = require('./lib/availability');
const { searchCertificateTransparency } = require('./lib/ct-search');
const {
  COOKIE_NAME,
  checkPassword,
  createSessionToken,
  isValidSessionToken,
  parseCookies,
  buildSessionCookie,
  buildClearCookie,
} = require('./lib/auth');
const { checkRateLimit, getClientIp, LOGIN_RATE_LIMIT, API_RATE_LIMIT } = require('./lib/rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', buildClearCookie({ secure: isHttps(req) }));
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  res.json({ authenticated: isValidSessionToken(cookies[COOKIE_NAME]) });
});

app.get('/api/rdap', apiRateLimit, requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

    const { type, value } = classifyQuery(q);
    const record = await fetchRdapRecord(type, value);
    if (!record) {
      return res.status(404).json({ error: `No RDAP registry found for "${q}" via IANA bootstrap` });
    }

    res.status(200).json({ query: q, type, ...record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/whois', apiRateLimit, requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

    const { type, value } = classifyQuery(q);
    const chain = await buildWhoisChain(value);

    res.json({ query: q, type, chain, parsed: parseWhoisChain(chain) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/availability', apiRateLimit, requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

    const { type, value } = classifyQuery(q);
    if (type !== 'domain') {
      return res.json({ applicable: false, type });
    }

    const fast = req.query.fast === '1' || req.query.fast === 'true';
    const result = await checkDomainAvailability(value, { fast });
    res.json({ applicable: true, domain: value, ...result });
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

app.listen(PORT, () => {
  console.log(`WHOIS/RDAP tool listening on http://localhost:${PORT}`);
});
