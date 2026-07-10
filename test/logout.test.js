// Covers netlify/functions/logout.js's HTTP-method gate. Previously any
// method (including a plain cross-site GET, e.g. from an <img> tag) cleared
// the session cookie - restricting it to POST matches server.js's
// app.post('/api/logout', ...) equivalent.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/logout');

describe('logout handler', () => {
  test('rejects a GET request without clearing the session cookie', async () => {
    const res = await handler({ httpMethod: 'GET' });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers['Set-Cookie'], undefined);
  });

  test('clears the session cookie on POST', async () => {
    const res = await handler({ httpMethod: 'POST' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Set-Cookie'], /wrt_session=;/);
  });
});
