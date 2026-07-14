// Covers netlify/functions/logout.mts's three defenses: the HTTP-method gate
// (previously any method, including a plain cross-site GET from an <img>
// tag, cleared the session cookie), the same-origin check (a hostile page
// can auto-submit a cross-site <form method="POST"> here - SameSite=Lax
// stops that form from attaching the victim's session cookie, but the
// request still arrives), and requiring an existing valid session.
//
// The session requirement is kept as defense in depth alongside the origin
// check, not a replacement for it - each closes a gap the other doesn't:
// - The origin check alone has a scheme blind spot: it compares host, not
//   scheme, so in isolation it would treat a request that genuinely
//   originated from a plain-HTTP version of the site as trustworthy. What
//   actually stops that in a modern browser is schemeful SameSite: an
//   HTTP-origin document and its HTTPS-origin cookie are treated as
//   different "sites", so a Lax cookie set on HTTPS isn't sent on a
//   cross-scheme POST from the HTTP page - not the cookie's Secure
//   attribute, which governs the *destination* request's scheme, not the
//   initiating page's.
// - The session check alone doesn't stop a same-origin, differently-scoped
//   forged request (e.g. a valid session token an attacker obtained some
//   other way, replayed from a page that isn't this site at all) - the
//   origin check still blocks that.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'test-only-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-signing-secret';

const { createSessionToken, buildSessionCookie } = require('../lib/auth');
const { handler } = require('../netlify/functions/logout.mts');

let cookie;
before(() => {
  cookie = buildSessionCookie(createSessionToken(), { secure: true }).split(';')[0];
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
    assert.match(res.headers['Set-Cookie'], /wrt_session=;/);
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
    let expiredToken;
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

  test('rejects a POST with no Origin header at all', async () => {
    const res = await handler({ httpMethod: 'POST', headers: { host: 'example.com', cookie } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers['Set-Cookie'], undefined);
  });
});
