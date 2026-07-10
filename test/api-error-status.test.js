// Covers the rdap/whois/availability/domain-posture Netlify functions'
// status-code split: a query that fails classifyQuery() (bad client input,
// e.g. embedded control characters) previously fell through to the same
// generic catch as an actual upstream/network failure and came back as a
// 500, when it should be a 400 - it's entirely determined by what the
// client sent, not a server-side failure. Deliberately picks an input that
// classifyQuery() rejects synchronously (before any network call), so these
// tests need no network access and can't be flaky.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'test-only-secret';

const { createSessionToken, buildSessionCookie } = require('../lib/auth');

const INVALID_QUERY = 'not a valid domain'; // embedded spaces - fails classifyQuery's URL-hostname check

let cookieHeader;
before(() => {
  cookieHeader = buildSessionCookie(createSessionToken(), { secure: true }).split(';')[0];
});

function authedEvent(query) {
  return {
    headers: { cookie: cookieHeader },
    queryStringParameters: { q: query },
  };
}

describe('invalid query returns 400, not 500', () => {
  test('rdap', async () => {
    const { handler } = require('../netlify/functions/rdap');
    const res = await handler(authedEvent(INVALID_QUERY));
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /not a valid domain, IP, or ASN/);
  });

  test('whois', async () => {
    const { handler } = require('../netlify/functions/whois');
    const res = await handler(authedEvent(INVALID_QUERY));
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /not a valid domain, IP, or ASN/);
  });

  test('availability', async () => {
    const { handler } = require('../netlify/functions/availability');
    const res = await handler(authedEvent(INVALID_QUERY));
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /not a valid domain, IP, or ASN/);
  });

  test('domain-posture', async () => {
    const { handler } = require('../netlify/functions/domain-posture');
    const res = await handler(authedEvent(INVALID_QUERY));
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /not a valid domain, IP, or ASN/);
  });
});
