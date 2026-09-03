// Covers the rdap/whois/availability/domain-posture Netlify functions'
// status-code split: a query that fails classifyQuery() (bad client input,
// e.g. embedded control characters) previously fell through to the same
// generic catch as an actual upstream/network failure and came back as a
// 500, when it should be a 400 - it's entirely determined by what the
// client sent, not a server-side failure. Deliberately picks an input that
// classifyQuery() rejects synchronously (before any network call), so these
// tests need no network access and can't be flaky.

import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { requiredValue } from './value-assertions.mts';

process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'test-only-secret';

const { buildSessionCookie, createSessionToken } = await import('../lib/auth.mts');
const [
  { handler: lookupHandler },
  { handler: rdapHandler },
  { handler: whoisHandler },
  { handler: availabilityHandler },
  { handler: domainPostureHandler },
  { handler: ctSearchHandler },
] = await Promise.all([
  import('../netlify/functions/lookup.mts'),
  import('../netlify/functions/rdap.mts'),
  import('../netlify/functions/whois.mts'),
  import('../netlify/functions/availability.mts'),
  import('../netlify/functions/domain-posture.mts'),
  import('../netlify/functions/ct-search.mts'),
]);

const INVALID_QUERY = 'private analyst note not a valid domain'; // embedded spaces fail before network work

let cookieHeader = '';
before(() => {
  cookieHeader = requiredValue(buildSessionCookie(createSessionToken(), { secure: true }).split(';')[0]);
});

function authedEvent(query: string) {
  return {
    headers: { cookie: cookieHeader, host: 'console.example', 'sec-fetch-site': 'same-origin' },
    queryStringParameters: { q: query },
  };
}

describe('invalid query returns 400, not 500', () => {
  function assertPrivateQueryOmitted(body: unknown): void {
    assert.equal(JSON.stringify(body).includes(INVALID_QUERY), false);
  }

  test('unified lookup', async () => {
    const res = await lookupHandler(authedEvent(INVALID_QUERY));
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(requiredValue(res.body));
    assert.equal(body.error, 'Invalid query');
    assert.equal(body.errorCode, 'INVALID_QUERY');
    assertPrivateQueryOmitted(body);
  });

  test('rdap', async () => {
    const res = await rdapHandler(authedEvent(INVALID_QUERY));
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(requiredValue(res.body));
    assert.equal(body.error, 'Invalid query');
    assertPrivateQueryOmitted(body);
  });

  test('whois', async () => {
    const res = await whoisHandler(authedEvent(INVALID_QUERY));
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(requiredValue(res.body));
    assert.equal(body.error, 'Invalid query');
    assertPrivateQueryOmitted(body);
  });

  test('availability', async () => {
    const res = await availabilityHandler(authedEvent(INVALID_QUERY));
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(requiredValue(res.body));
    assert.equal(body.error, 'Invalid query');
    assertPrivateQueryOmitted(body);
  });

  test('domain-posture', async () => {
    const res = await domainPostureHandler(authedEvent(INVALID_QUERY));
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(requiredValue(res.body));
    assert.equal(body.error, 'Invalid query');
    assertPrivateQueryOmitted(body);
  });
});

describe('unified lookup error codes', () => {
  test('reports missing authentication with a stable code', async () => {
    const res = await lookupHandler({ headers: {}, queryStringParameters: { q: 'example.com' } });
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(requiredValue(res.body)).errorCode, 'AUTH_REQUIRED');
  });

  test('reports a missing query with a stable code', async () => {
    const res = await lookupHandler({ headers: { cookie: cookieHeader, host: 'console.example', 'sec-fetch-site': 'same-origin' }, queryStringParameters: {} });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(requiredValue(res.body)).errorCode, 'MISSING_QUERY');
  });
});

describe('Certificate Transparency query errors', () => {
  test('reports a missing query with a stable code', async () => {
    const res = await ctSearchHandler({ headers: { cookie: cookieHeader, host: 'console.example', 'sec-fetch-site': 'same-origin' }, queryStringParameters: {} });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(requiredValue(res.body)).errorCode, 'MISSING_QUERY');
  });

  test('rejects control characters and overlong input before network work', async () => {
    for (const q of ['brand\nname', 'x'.repeat(201)]) {
      const res = await ctSearchHandler(authedEvent(q));
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(requiredValue(res.body));
      assert.equal(body.errorCode, 'INVALID_CT_QUERY');
      assert.match(body.error, /at most 200 characters/);
    }
  });
});
