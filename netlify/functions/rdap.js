const { classifyQuery } = require('../../lib/classify');
const { findRdapBase, rdapPathFor, parseRdap } = require('../../lib/rdap');
const { isAuthenticatedFromCookieHeader } = require('../../lib/auth');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (!isAuthenticatedFromCookieHeader(event.headers && event.headers.cookie)) {
    return json(401, { error: 'Authentication required' });
  }

  const q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"' });

  try {
    const { type, value } = classifyQuery(q);
    const base = await findRdapBase(type, value);
    if (!base) {
      return json(404, { error: `No RDAP registry found for "${q}" via IANA bootstrap` });
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

    return json(200, {
      query: q,
      type,
      rdapServer: url,
      upstreamStatus: upstream.status,
      data,
      parsed: upstream.ok ? parseRdap(type, data) : null,
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
