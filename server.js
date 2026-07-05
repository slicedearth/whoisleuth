const express = require('express');
const path = require('path');

const { classifyQuery } = require('./lib/classify');
const { findRdapBase, rdapPathFor, parseRdap } = require('./lib/rdap');
const { buildWhoisChain, parseWhoisChain } = require('./lib/whois');
const { checkDomainAvailability } = require('./lib/availability');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '1mb' }));

app.get('/api/rdap', async (req, res) => {
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

app.get('/api/whois', async (req, res) => {
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

app.get('/api/availability', async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`WHOIS/RDAP tool listening on http://localhost:${PORT}`);
});
