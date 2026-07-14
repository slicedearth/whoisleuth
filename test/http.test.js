const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { json } = require('../lib/http.mts');

describe('Netlify JSON responses', () => {
  test('include the API security headers emitted by the Express server', () => {
    const response = json(200, { ok: true });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, '{"ok":true}');
    assert.equal(response.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(response.headers['X-Frame-Options'], 'DENY');
    assert.equal(response.headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
    assert.equal(response.headers['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()');
    assert.equal(response.headers['Strict-Transport-Security'], 'max-age=31536000');
  });

  test('preserve additional headers and deliberate overrides', () => {
    const response = json(429, { error: 'Slow down' }, {
      'Retry-After': '30',
      'X-Frame-Options': 'SAMEORIGIN',
    });

    assert.equal(response.headers['Retry-After'], '30');
    assert.equal(response.headers['X-Frame-Options'], 'SAMEORIGIN');
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
  });
});
