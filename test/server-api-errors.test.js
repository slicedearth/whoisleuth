const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'test-only-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-signing-secret';

const { app, apiErrorHandler } = require('../server.mts');
const { buildSessionCookie, createSessionToken } = require('../lib/auth.mts');

let server;
let origin;

before(async () => {
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function postLogin(body, requestOrigin = origin) {
  return fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: requestOrigin,
    },
    body,
  });
}

async function expectSanitizedJson(response, statusCode, expectedBody) {
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
    const session = buildSessionCookie(createSessionToken(), { secure: false }).split(';')[0];
    const success = await fetch(`${origin}/api/session`, {
      headers: { Cookie: session },
    });
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { authenticated: true });

    const expectedError = await fetch(`${origin}/api/lookup?q=${encodeURIComponent('not a valid domain')}`, {
      headers: { Cookie: session },
    });
    assert.equal(expectedError.status, 400);
    const expectedBody = await expectedError.json();
    assert.equal(expectedBody.errorCode, 'INVALID_QUERY');
    assert.match(expectedBody.error, /not a valid domain, IP, or ASN/i);
  });

  test('sanitizes unexpected errors without exposing internal details', () => {
    let statusCode = null;
    let body = null;
    const response = {
      headersSent: false,
      status(value) {
        statusCode = value;
        return this;
      },
      json(value) {
        body = value;
        return value;
      },
    };
    apiErrorHandler(
      new Error('/private/path secret upstream detail'),
      {},
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
