import type { Server } from 'node:http';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { recordValue, requiredValue, stringValue } from './value-assertions.mts';

process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'test-only-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-signing-secret';

const { app, apiErrorHandler } = await import('../server.mts');
const { buildSessionCookie, createSessionToken } = await import('../lib/auth.mts');

let server: Server | null = null;
let origin = '';

before(async () => {
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => error ? reject(error) : resolve());
  });
});

async function postLogin(body: string, requestOrigin = origin): Promise<Response> {
  return fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: requestOrigin,
    },
    body,
  });
}

async function expectSanitizedJson(response: Response, statusCode: number, expectedBody: unknown) {
  assert.equal(response.status, statusCode);
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/i);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), expectedBody);
  assert.doesNotMatch(text, /SyntaxError|PayloadTooLargeError|node_modules|whois-rdap-tool|at\s+\S+/i);
}

describe('Express API request-body errors', () => {
  test('reject cross-site requests before attempting to parse their bodies', async () => {
    const response = await postLogin('{bad', 'https://outside.example');
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Cross-site request blocked' });
  });

  test('return bounded JSON for malformed JSON without parser details', async () => {
    await expectSanitizedJson(await postLogin('{bad'), 400, {
      error: 'Invalid request body',
      errorCode: 'INVALID_REQUEST_BODY',
    });
  });

  test('return bounded JSON for request bodies over one MiB', async () => {
    const oversizedBody = JSON.stringify({ password: 'x'.repeat(1024 * 1024) });
    await expectSanitizedJson(await postLogin(oversizedBody), 413, {
      error: 'Request bodies are limited to 1 MiB.',
      errorCode: 'REQUEST_TOO_LARGE',
    });
  });
});

describe('Express API response parity', () => {
  test('preserves success and expected validation responses', async () => {
    const session = requiredValue(buildSessionCookie(createSessionToken(), { secure: false }).split(';')[0]);
    const success = await fetch(`${origin}/api/session`, {
      headers: { Cookie: session },
    });
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { authenticated: true });

    const expectedError = await fetch(`${origin}/api/lookup?q=${encodeURIComponent('not a valid domain')}`, {
      headers: { Cookie: session },
    });
    assert.equal(expectedError.status, 400);
    const expectedBody = recordValue(await expectedError.json());
    assert.equal(expectedBody.errorCode, 'INVALID_QUERY');
    assert.match(stringValue(expectedBody.error), /not a valid domain, IP, or ASN/i);
  });

  test('sanitizes unexpected errors without exposing internal details', () => {
    let statusCode: number | null = null;
    let body: unknown = null;
    const response = {
      headersSent: false,
      setHeader() {
        return response;
      },
      status(value: number) {
        statusCode = value;
        return response;
      },
      json(value: unknown) {
        body = value;
        return value;
      },
      redirect() {
        return response;
      },
    };
    apiErrorHandler(
      new Error('/private/path secret upstream detail'),
      { protocol: 'https', headers: {}, query: {}, path: '/api/test' },
      response,
      () => assert.fail('unexpected errors should be handled before next()'),
    );
    assert.equal(statusCode, 500);
    assert.deepEqual(body, {
      error: 'Internal server error',
      errorCode: 'INTERNAL_ERROR',
    });
    assert.doesNotMatch(JSON.stringify(body), /private|secret|upstream|path/i);
  });
});
