const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_API_JSON_BODY_BYTES,
  apiErrorResponseFor,
  apiUnexpectedErrorResponse,
  json,
  withNetlifyApiErrorBoundary,
} = require('../lib/http.mts');

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
    assert.equal(response.headers['Cache-Control'], 'no-store');
  });

  test('preserve additional headers and deliberate overrides', () => {
    const response = json(429, { error: 'Slow down' }, {
      'Retry-After': '30',
      'X-Frame-Options': 'SAMEORIGIN',
    });

    assert.equal(response.headers['Retry-After'], '30');
    assert.equal(response.headers['X-Frame-Options'], 'SAMEORIGIN');
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(response.headers['Cache-Control'], 'no-store');
  });

  test('defines a one MiB API request-body boundary', () => {
    assert.equal(MAX_API_JSON_BODY_BYTES, 1024 * 1024);
  });

  test('maps request-body failures without echoing exception details', () => {
    assert.deepEqual(apiErrorResponseFor({ type: 'entity.parse.failed', message: 'private parser detail' }), {
      statusCode: 400,
      body: { error: 'Invalid request body', errorCode: 'INVALID_REQUEST_BODY' },
    });
    assert.deepEqual(apiErrorResponseFor({ type: 'entity.too.large', stack: 'private stack' }), {
      statusCode: 413,
      body: { error: 'Request bodies are limited to 1 MiB.', errorCode: 'REQUEST_TOO_LARGE' },
    });
    assert.deepEqual(apiErrorResponseFor(new Error('private failure detail')), {
      statusCode: 500,
      body: { error: 'Internal server error', errorCode: 'INTERNAL_ERROR' },
    });
  });

  test('bounds unexpected public codes and preserves approved stable codes', () => {
    assert.deepEqual(apiUnexpectedErrorResponse('LOOKUP_FAILED'), {
      statusCode: 500,
      body: { error: 'Internal server error', errorCode: 'LOOKUP_FAILED' },
    });
    for (const invalidCode of ['', 'private detail', 'A'.repeat(65), null]) {
      assert.deepEqual(apiUnexpectedErrorResponse(invalidCode), {
        statusCode: 500,
        body: { error: 'Internal server error', errorCode: 'INTERNAL_ERROR' },
      });
    }
  });

  test('Netlify error boundaries preserve ordinary responses and sanitize thrown failures', async () => {
    const success = withNetlifyApiErrorBoundary(async () => json(200, { ok: true }));
    assert.deepEqual(JSON.parse((await success({})).body), { ok: true });

    const expectedError = withNetlifyApiErrorBoundary(async () => json(400, {
      error: 'Expected validation detail',
      errorCode: 'INVALID_QUERY',
    }));
    assert.deepEqual(JSON.parse((await expectedError({})).body), {
      error: 'Expected validation detail',
      errorCode: 'INVALID_QUERY',
    });

    const unexpectedError = withNetlifyApiErrorBoundary(async () => {
      throw new Error('/private/path secret upstream detail');
    }, 'LOOKUP_FAILED');
    const response = await unexpectedError({});
    assert.equal(response.statusCode, 500);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.deepEqual(JSON.parse(response.body), {
      error: 'Internal server error',
      errorCode: 'LOOKUP_FAILED',
    });
    assert.doesNotMatch(response.body, /private|secret|upstream|path/i);
  });
});
