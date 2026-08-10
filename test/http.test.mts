import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_API_JSON_BODY_BYTES,
  MAX_API_REQUEST_BODY_READ_MS,
  apiErrorResponseFor,
  apiRequestErrorResponse,
  apiUnexpectedErrorResponse,
  json,
  readRequestTextCapped,
  withNetlifyApiErrorBoundary,
} from '../lib/http.mts';
import { requiredValue } from './value-assertions.mts';
import { HTTP_BASELINE_CONTENT_SECURITY_POLICY } from '../lib/security-headers.mts';

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
    assert.equal(response.headers['Content-Security-Policy'], HTTP_BASELINE_CONTENT_SECURITY_POLICY);
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
    assert.equal(MAX_API_REQUEST_BODY_READ_MS, 10_000);
  });

  test('bounds stalled and aborted streamed request bodies and cancels the reader', async () => {
    let timeoutCancelled = false;
    const stalled = new Request('https://console.example/api/input', {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>(() => {}),
        cancel: () => { timeoutCancelled = true; },
      }),
      // @ts-expect-error Node's streamed Request body requires its runtime-specific duplex option.
      duplex: 'half',
    });
    assert.deepEqual(await readRequestTextCapped(stalled, 1024, 5), { status: 'timed_out' });
    assert.equal(timeoutCancelled, true);
    assert.equal(stalled.body?.locked, false);

    let abortCancelled = false;
    const controller = new AbortController();
    const aborted = new Request('https://console.example/api/input', {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>(() => {}),
        cancel: () => { abortCancelled = true; },
      }),
      signal: controller.signal,
      // @ts-expect-error Node's streamed Request body requires its runtime-specific duplex option.
      duplex: 'half',
    });
    const pending = readRequestTextCapped(aborted, 1024, 100);
    controller.abort();
    assert.deepEqual(await pending, { status: 'aborted' });
    assert.equal(abortCancelled, true);
    assert.equal(aborted.body?.locked, false);
    await assert.rejects(readRequestTextCapped(stalled, 1024, 0), /deadline/iu);
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
    assert.deepEqual(apiRequestErrorResponse('REQUEST_TIMEOUT'), {
      statusCode: 408,
      body: { error: 'Request body read timed out', errorCode: 'REQUEST_TIMEOUT' },
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
    assert.deepEqual(JSON.parse(requiredValue((await success({})).body)), { ok: true });

    const expectedError = withNetlifyApiErrorBoundary(async () => json(400, {
      error: 'Expected validation detail',
      errorCode: 'INVALID_QUERY',
    }));
    assert.deepEqual(JSON.parse(requiredValue((await expectedError({})).body)), {
      error: 'Expected validation detail',
      errorCode: 'INVALID_QUERY',
    });

    const unexpectedError = withNetlifyApiErrorBoundary(async () => {
      throw new Error('/private/path secret upstream detail');
    }, 'LOOKUP_FAILED');
    const response = await unexpectedError({});
    assert.equal(response.statusCode, 500);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.deepEqual(JSON.parse(requiredValue(response.body)), {
      error: 'Internal server error',
      errorCode: 'LOOKUP_FAILED',
    });
    assert.doesNotMatch(requiredValue(response.body), /private|secret|upstream|path/i);
  });
});
