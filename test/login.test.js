const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'test-only-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-signing-secret';

const loginModule = require('../netlify/functions/login.mts');
const {
  config,
  default: loginHandler,
  runLoginFunction,
} = loginModule;

function request(headers, password = process.env.SITE_PASSWORD) {
  return runLoginFunction({ httpMethod: 'POST', headers, body: JSON.stringify({ password }) });
}

function rawRequest(body) {
  return runLoginFunction({
    httpMethod: 'POST',
    headers: { origin: 'https://example.com', host: 'example.com' },
    body,
  });
}

describe('login handler origin enforcement', () => {
  test('exports only a rate-limited modern deployment boundary for the canonical path', () => {
    assert.equal(typeof loginHandler, 'function');
    assert.equal(Object.hasOwn(loginModule, 'handler'), false);
    assert.deepEqual(config, {
      path: '/api/login',
      rateLimit: {
        windowLimit: 10,
        windowSize: 180,
        aggregateBy: ['ip', 'domain'],
      },
    });

    const netlifyConfig = readFileSync(join(__dirname, '..', 'netlify.toml'), 'utf8');
    assert.doesNotMatch(netlifyConfig, /from = "\/api\/login"/u);
  });

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

  test('returns a stable JSON error for malformed request bodies', async () => {
    const response = await rawRequest('{bad');
    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'Invalid request body',
      errorCode: 'INVALID_REQUEST_BODY',
    });
  });

  test('rejects valid JSON values that do not match the login object contract', async () => {
    for (const body of ['null', '[]', '"password"']) {
      const response = await rawRequest(body);
      assert.equal(response.statusCode, 400);
      assert.equal(JSON.parse(response.body).errorCode, 'INVALID_REQUEST_BODY');
    }
  });

  test('rejects request bodies over one MiB before parsing them', async () => {
    const response = await rawRequest(JSON.stringify({ password: 'x'.repeat(1024 * 1024) }));
    assert.equal(response.statusCode, 413);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'Request bodies are limited to 1 MiB.',
      errorCode: 'REQUEST_TOO_LARGE',
    });
  });

  test('serves the canonical modern Request contract with the same secure cookie response', async () => {
    const response = await loginHandler(new Request('https://example.com/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        host: 'example.com',
        origin: 'https://example.com',
      },
      body: JSON.stringify({ password: process.env.SITE_PASSWORD }),
    }));

    assert.equal(response.status, 200);
    assert.match(response.headers.get('Set-Cookie'), /wrt_session=/);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  });

  test('rejects malformed UTF-8 at the modern Request boundary', async () => {
    const response = await loginHandler(new Request('https://example.com/api/login', {
      method: 'POST',
      headers: { host: 'example.com', origin: 'https://example.com' },
      body: new Uint8Array([0xc3, 0x28]),
    }));

    assert.equal(response.status, 400);
    assert.equal((await response.json()).errorCode, 'INVALID_REQUEST_BODY');
  });
});
