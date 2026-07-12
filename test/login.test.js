const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'test-only-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-signing-secret';

const { handler } = require('../netlify/functions/login');

function request(headers, password = process.env.SITE_PASSWORD) {
  return handler({ httpMethod: 'POST', headers, body: JSON.stringify({ password }) });
}

describe('login handler origin enforcement', () => {
  test('accepts a same-origin login and returns transport security headers', async () => {
    const response = await request({ origin: 'https://example.com', host: 'example.com' });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['Set-Cookie'], /wrt_session=/);
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(response.headers['X-Frame-Options'], 'DENY');
    assert.equal(response.headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
    assert.equal(response.headers['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()');
    assert.equal(response.headers['Strict-Transport-Security'], 'max-age=31536000');
  });

  test('rejects cross-site login even when the password is correct', async () => {
    const response = await request({ origin: 'https://attacker.example', host: 'example.com' });
    assert.equal(response.statusCode, 403);
    assert.equal(response.headers['Set-Cookie'], undefined);
  });

  test('allows non-browser login clients without an Origin header', async () => {
    const response = await request({ host: 'example.com' });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['Set-Cookie'], /wrt_session=/);
  });
});
