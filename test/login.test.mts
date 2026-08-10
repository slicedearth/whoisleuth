import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { recordValue, requiredValue } from './value-assertions.mts';

process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'test-only-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-signing-secret';

const loginModule = await import('../netlify/functions/login.mts');
const {
  config,
  default: loginHandler,
  runLoginFunction,
} = loginModule;
const testDirectory = dirname(fileURLToPath(import.meta.url));

function request(headers: Record<string, string>, password = process.env.SITE_PASSWORD) {
  return runLoginFunction({ httpMethod: 'POST', headers, body: JSON.stringify({ password }) });
}

function rawRequest(body: string) {
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

    const netlifyConfig = readFileSync(join(testDirectory, '..', 'netlify.toml'), 'utf8');
    assert.doesNotMatch(netlifyConfig, /from = "\/api\/login"/u);
  });

  test('accepts a same-origin login and returns transport security headers', async () => {
    const response = await request({ origin: 'https://example.com', host: 'example.com' });
    assert.equal(response.statusCode, 200);
    assert.match(requiredValue(response.headers['Set-Cookie']), /wrt_session=/);
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
    assert.match(requiredValue(response.headers['Set-Cookie']), /wrt_session=/);
  });

  test('returns a stable JSON error for malformed request bodies', async () => {
    const response = await rawRequest('{bad');
    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(requiredValue(response.body)), {
      error: 'Invalid request body',
      errorCode: 'INVALID_REQUEST_BODY',
    });
  });

  test('rejects valid JSON values that do not match the login object contract', async () => {
    for (const body of ['null', '[]', '"password"']) {
      const response = await rawRequest(body);
      assert.equal(response.statusCode, 400);
      assert.equal(JSON.parse(requiredValue(response.body)).errorCode, 'INVALID_REQUEST_BODY');
    }
  });

  test('rejects request bodies over one MiB before parsing them', async () => {
    const response = await rawRequest(JSON.stringify({ password: 'x'.repeat(1024 * 1024) }));
    assert.equal(response.statusCode, 413);
    assert.deepEqual(JSON.parse(requiredValue(response.body)), {
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
    assert.match(requiredValue(response.headers.get('Set-Cookie')), /wrt_session=/);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  });

  test('fails closed with a sanitized response when the session lifetime is misconfigured', async () => {
    const previousMaxAge = process.env.SESSION_MAX_AGE_DAYS;
    try {
      process.env.SESSION_MAX_AGE_DAYS = '31';
      const response = await loginHandler(new Request('https://example.com/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          host: 'example.com',
          origin: 'https://example.com',
          'x-nf-client-connection-ip': '192.0.2.31',
        },
        body: JSON.stringify({ password: process.env.SITE_PASSWORD }),
      }));

      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: 'Internal server error',
        errorCode: 'INTERNAL_ERROR',
      });
      assert.equal(response.headers.get('Set-Cookie'), null);
    } finally {
      if (previousMaxAge === undefined) delete process.env.SESSION_MAX_AGE_DAYS;
      else process.env.SESSION_MAX_AGE_DAYS = previousMaxAge;
    }
  });

  test('rejects malformed UTF-8 at the modern Request boundary', async () => {
    const response = await loginHandler(new Request('https://example.com/api/login', {
      method: 'POST',
      headers: { host: 'example.com', origin: 'https://example.com' },
      body: new Uint8Array([0xc3, 0x28]),
    }));

    assert.equal(response.status, 400);
    assert.equal(recordValue(await response.json()).errorCode, 'INVALID_REQUEST_BODY');
  });

  test('maps a pre-aborted streamed body to a bounded timeout response without issuing a session', async () => {
    const previousNetlify = process.env.NETLIFY;
    process.env.NETLIFY = 'true';
    const controller = new AbortController();
    try {
      const responsePromise = loginHandler(new Request('https://example.com/api/login', {
        method: 'POST',
        headers: {
          host: 'example.com',
          origin: 'https://example.com',
          'x-nf-client-connection-ip': '192.0.2.208',
        },
        body: new ReadableStream<Uint8Array>({
          pull: () => new Promise<void>(() => {}),
        }),
        signal: controller.signal,
        // @ts-expect-error Node's streamed Request body requires its runtime-specific duplex option.
        duplex: 'half',
      }));
      controller.abort();

      const response = await responsePromise;
      assert.equal(response.status, 408);
      assert.deepEqual(await response.json(), {
        error: 'Request body read timed out',
        errorCode: 'REQUEST_TIMEOUT',
      });
      assert.equal(response.headers.get('Set-Cookie'), null);
    } finally {
      if (previousNetlify === undefined) delete process.env.NETLIFY;
      else process.env.NETLIFY = previousNetlify;
    }
  });
});
