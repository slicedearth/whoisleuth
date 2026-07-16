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

const { createSessionToken, buildSessionCookie } = require('../lib/auth.mts');

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
  test('unified lookup', async () => {
    const { handler } = require('../netlify/functions/lookup.mts');
    const res = await handler(authedEvent(INVALID_QUERY));
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.match(body.error, /not a valid domain, IP, or ASN/);
    assert.equal(body.errorCode, 'INVALID_QUERY');
  });

  test('rdap', async () => {
    const { handler } = require('../netlify/functions/rdap.mts');
    const res = await handler(authedEvent(INVALID_QUERY));
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /not a valid domain, IP, or ASN/);
  });

  test('whois', async () => {
    const { handler } = require('../netlify/functions/whois.mts');
    const res = await handler(authedEvent(INVALID_QUERY));
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /not a valid domain, IP, or ASN/);
  });

  test('availability', async () => {
    const { handler } = require('../netlify/functions/availability.mts');
    const res = await handler(authedEvent(INVALID_QUERY));
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /not a valid domain, IP, or ASN/);
  });

  test('domain-posture', async () => {
    const { handler } = require('../netlify/functions/domain-posture.mts');
    const res = await handler(authedEvent(INVALID_QUERY));
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /not a valid domain, IP, or ASN/);
  });
});

describe('unified lookup error codes', () => {
  test('reports missing authentication with a stable code', async () => {
    const { handler } = require('../netlify/functions/lookup.mts');
    const res = await handler({ headers: {}, queryStringParameters: { q: 'example.com' } });
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).errorCode, 'AUTH_REQUIRED');
  });

  test('reports a missing query with a stable code', async () => {
    const { handler } = require('../netlify/functions/lookup.mts');
    const res = await handler({ headers: { cookie: cookieHeader }, queryStringParameters: {} });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).errorCode, 'MISSING_QUERY');
  });
});

describe('Certificate Transparency query errors', () => {
  test('reports a missing query with a stable code', async () => {
    const { handler } = require('../netlify/functions/ct-search.mts');
    const res = await handler({ headers: { cookie: cookieHeader }, queryStringParameters: {} });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).errorCode, 'MISSING_QUERY');
  });

  test('rejects control characters and overlong input before network work', async () => {
    const { handler } = require('../netlify/functions/ct-search.mts');
    for (const q of ['brand\nname', 'x'.repeat(201)]) {
      const res = await handler(authedEvent(q));
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.equal(body.errorCode, 'INVALID_CT_QUERY');
      assert.match(body.error, /at most 200 characters/);
    }
  });
});
