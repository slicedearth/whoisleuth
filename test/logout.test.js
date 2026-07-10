// Covers netlify/functions/logout.js's two defenses: the HTTP-method gate
// (previously any method, including a plain cross-site GET from an <img>
// tag, cleared the session cookie) and the same-origin check (POST alone
// doesn't stop a hostile page from auto-submitting a cross-site
// <form method="POST"> here - SameSite=Lax stops that form from attaching
// the victim's session cookie, but the request still arrives, and logout
// doesn't need to read the existing cookie to unconditionally clear it).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/logout');

const SAME_ORIGIN_HEADERS = { origin: 'https://example.com', host: 'example.com' };

describe('logout handler', () => {
  test('rejects a GET request without clearing the session cookie', async () => {
    const res = await handler({ httpMethod: 'GET', headers: SAME_ORIGIN_HEADERS });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers['Set-Cookie'], undefined);
  });

  test('clears the session cookie on a same-origin POST', async () => {
    const res = await handler({ httpMethod: 'POST', headers: SAME_ORIGIN_HEADERS });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Set-Cookie'], /wrt_session=;/);
  });

  test('rejects a cross-site POST (forged Origin) without clearing the cookie', async () => {
    const res = await handler({
      httpMethod: 'POST',
      headers: { origin: 'https://attacker.example', host: 'example.com' },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers['Set-Cookie'], undefined);
  });

  test('rejects a POST with no Origin header at all', async () => {
    const res = await handler({ httpMethod: 'POST', headers: { host: 'example.com' } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers['Set-Cookie'], undefined);
  });
});
