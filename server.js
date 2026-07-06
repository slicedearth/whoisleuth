const express = require('express');
const path = require('path');

const { classifyQuery } = require('./lib/classify');
const { findRdapBase, rdapPathFor, parseRdap } = require('./lib/rdap');
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

app.post('/api/login', (req, res) => {
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

app.get('/api/rdap', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).json({ error: 'Missing query parameter "q"' });

    const { type, value } = classifyQuery(q);
    const base = await findRdapBase(type, value);
    if (!base) {
      return res.status(404).json({ error: `No RDAP registry found for "${q}" via IANA bootstrap` });
    }

    const url = base.replace(/\/$/, '') + '/' + rdapPathFor(type, value);
    const upstream = await fetch(url, { headers: { Accept: 'application/rdap+json' } });
    const text = await upstream.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    res.status(200).json({
      query: q,
      type,
      rdapServer: url,
      upstreamStatus: upstream.status,
      data,
      parsed: upstream.ok ? parseRdap(type, data) : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/whois', requireAuth, async (req, res) => {
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

app.get('/api/availability', requireAuth, async (req, res) => {
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

app.get('/api/ct-search', requireAuth, async (req, res) => {
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
