// Covers netlify/functions/logout.mts's three defenses: the HTTP-method gate
// (previously any method, including a plain cross-site GET from an <img>
// tag, cleared the session cookie), the same-origin check (a hostile page
// can auto-submit a cross-site <form method="POST"> here - SameSite=Lax
// stops that form from attaching the victim's session cookie, but the
// request still arrives), and requiring an existing valid session.
//
// The session requirement is defense in depth alongside the exact
// scheme/host/port Origin comparison; neither cookie policy nor transport
// headers substitute for request admission.

import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { requiredValue } from './value-assertions.mts';

process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'test-only-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-signing-secret';

const { buildSessionCookie, createSessionToken } = await import('../lib/auth.mts');
const { handler } = await import('../netlify/functions/logout.mts');

let cookie = '';
before(() => {
  cookie = requiredValue(buildSessionCookie(createSessionToken(), { secure: true }).split(';')[0]);
});

const SAME_ORIGIN_HEADERS = () => ({ origin: 'https://example.com', host: 'example.com', cookie });

describe('logout handler', () => {
  test('rejects a GET request without clearing the session cookie', async () => {
    const res = await handler({ httpMethod: 'GET', headers: SAME_ORIGIN_HEADERS() });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers['Set-Cookie'], undefined);
  });

  test('clears the session cookie on an authenticated, same-origin POST', async () => {
    const res = await handler({ httpMethod: 'POST', headers: SAME_ORIGIN_HEADERS() });
    assert.equal(res.statusCode, 200);
    assert.match(requiredValue(res.headers['Set-Cookie']), /wrt_session=;/);
  });

  test('rejects a POST with no session cookie, even from a same-origin request', async () => {
    const res = await handler({
      httpMethod: 'POST',
      headers: { origin: 'https://example.com', host: 'example.com' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['Set-Cookie'], undefined);
  });

  test('rejects a POST with an expired session cookie', async () => {
    const actualNow = Date.now;
    let expiredToken = '';
    try {
      Date.now = () => actualNow() - (31 * 24 * 60 * 60 * 1000);
      expiredToken = createSessionToken();
    } finally {
      Date.now = actualNow;
    }
    const res = await handler({
      httpMethod: 'POST',
      headers: { origin: 'https://example.com', host: 'example.com', cookie: `wrt_session=${expiredToken}` },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['Set-Cookie'], undefined);
  });

  test('rejects a POST with a forged/invalid session cookie', async () => {
    const res = await handler({
      httpMethod: 'POST',
      headers: { origin: 'https://example.com', host: 'example.com', cookie: 'wrt_session=not-a-real-token' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['Set-Cookie'], undefined);
  });

  test('rejects a cross-site POST (forged Origin) even with a valid session, without clearing the cookie', async () => {
    const res = await handler({
      httpMethod: 'POST',
      headers: { origin: 'https://attacker.example', host: 'example.com', cookie },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers['Set-Cookie'], undefined);
  });

  test('rejects an HTTP Origin for the same HTTPS deployment host', async () => {
    const res = await handler({
      httpMethod: 'POST',
      headers: { origin: 'http://example.com', host: 'example.com', cookie },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers['Set-Cookie'], undefined);
  });

  test('rejects a POST with no Origin header at all', async () => {
    const res = await handler({ httpMethod: 'POST', headers: { host: 'example.com', cookie } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers['Set-Cookie'], undefined);
  });
});
