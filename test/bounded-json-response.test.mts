import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BoundedJsonResponseError,
  LARGE_JSON_RESPONSE_BYTES,
  STANDARD_JSON_RESPONSE_BYTES,
  readJsonResponseCapped,
  requestJsonCapped,
} from '../lib/bounded-json-response.mts';

describe('bounded JSON response reader', () => {
  test('parses a response within the declared and streamed byte ceiling', async () => {
    const response = new Response(JSON.stringify({ state: 'ok' }), {
      headers: { 'content-type': 'application/json' },
    });
    assert.deepEqual(await readJsonResponseCapped(response, 64), { state: 'ok' });

    const exact = JSON.stringify('x'.repeat(30));
    assert.equal(new TextEncoder().encode(exact).byteLength, 32);
    assert.equal(await readJsonResponseCapped(new Response(exact), 32), 'x'.repeat(30));
  });

  test('normalises caller ceilings and rejects unsafe declared lengths', async () => {
    await assert.rejects(
      readJsonResponseCapped(new Response('{}', {
        headers: { 'content-length': String(STANDARD_JSON_RESPONSE_BYTES + 1) },
      }), 0),
      (cause) => cause instanceof BoundedJsonResponseError && cause.code === 'response_too_large',
    );
    await assert.rejects(
      readJsonResponseCapped(new Response('{}', {
        headers: { 'content-length': String(LARGE_JSON_RESPONSE_BYTES + 1) },
      }), Number.MAX_SAFE_INTEGER),
      (cause) => cause instanceof BoundedJsonResponseError && cause.code === 'response_too_large',
    );
    await assert.rejects(
      readJsonResponseCapped(new Response('{}', {
        headers: { 'content-length': '9007199254740992' },
      }), 64),
      (cause) => cause instanceof BoundedJsonResponseError && cause.code === 'response_too_large',
    );
    assert.equal(await readJsonResponseCapped(new Response(null), 64), null);
  });

  test('rejects oversized declared and chunked responses before parsing', async () => {
    let cancelled = false;
    const declaredStream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    await assert.rejects(
      readJsonResponseCapped(new Response(declaredStream, { headers: { 'content-length': '1000' } }), 32),
      (cause) => cause instanceof BoundedJsonResponseError && cause.code === 'response_too_large',
    );
    assert.equal(cancelled, true);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new TextEncoder().encode('x'.repeat(80)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });
    await assert.rejects(
      readJsonResponseCapped(new Response(stream), 32),
      (cause) => cause instanceof BoundedJsonResponseError && cause.code === 'response_too_large',
    );
  });

  test('preserves non-success HTTP status when a proxy returns bounded non-JSON', async () => {
    let cancelled = false;
    const errorBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<h1>Too many requests</h1>'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const result = await requestJsonCapped('/api/example', {}, {
      fetchImpl: async () => new Response(errorBody, {
        status: 429,
        headers: { 'content-type': 'text/html', 'retry-after': '1' },
      }),
    });

    assert.equal(result.response.status, 429);
    assert.equal(result.body, null);
    assert.equal(cancelled, true);
    await assert.rejects(
      requestJsonCapped('/api/example', {}, {
        allowNonJsonErrorResponse: false,
        fetchImpl: async () => new Response('upstream unavailable', { status: 502 }),
      }),
      (cause) => cause instanceof BoundedJsonResponseError && cause.code === 'invalid_json',
    );
  });

  test('continues to reject malformed successful responses', async () => {
    await assert.rejects(
      requestJsonCapped('/api/example', {}, {
        fetchImpl: async () => new Response('<html>unexpected</html>', { status: 200 }),
      }),
      (cause) => cause instanceof BoundedJsonResponseError && cause.code === 'invalid_json',
    );

    const invalidUtf8 = new Uint8Array([0x22, 0xc3, 0x28, 0x22]);
    await assert.rejects(
      readJsonResponseCapped(new Response(invalidUtf8), 64),
      (cause) => cause instanceof BoundedJsonResponseError && cause.code === 'invalid_json',
    );
  });

  test('rejects malformed JSON and never-settling requests with stable states', async () => {
    await assert.rejects(
      readJsonResponseCapped(new Response('{broken'), 64),
      (cause) => cause instanceof BoundedJsonResponseError && cause.code === 'invalid_json',
    );
    await assert.rejects(
      requestJsonCapped('/api/example', {}, {
        timeoutMs: 5,
        fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        }),
      }),
      (cause) => cause instanceof BoundedJsonResponseError && cause.code === 'timeout',
    );

    await assert.rejects(
      requestJsonCapped('/api/example', {}, {
        timeoutMs: 5,
        fetchImpl: async () => new Promise(() => {}),
      }),
      (cause) => cause instanceof BoundedJsonResponseError && cause.code === 'timeout',
    );

    let resolveLateFetch: ((response: Response) => void) | undefined;
    let lateBodyCancelled = false;
    const lateRequest = requestJsonCapped('/api/example', {}, {
      timeoutMs: 5,
      fetchImpl: async () => new Promise<Response>((resolve) => { resolveLateFetch = resolve; }),
    });
    await assert.rejects(
      lateRequest,
      (cause) => cause instanceof BoundedJsonResponseError && cause.code === 'timeout',
    );
    resolveLateFetch?.(new Response(new ReadableStream<Uint8Array>({
      cancel() {
        lateBodyCancelled = true;
      },
    })));
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    assert.equal(lateBodyCancelled, true);

    let bodyCancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull: async () => new Promise(() => {}),
      cancel() {
        bodyCancelled = true;
      },
    });
    await assert.rejects(
      requestJsonCapped('/api/example', {}, {
        timeoutMs: 5,
        fetchImpl: async () => new Response(body),
      }),
      (cause) => cause instanceof BoundedJsonResponseError && cause.code === 'timeout',
    );
    assert.equal(bodyCancelled, true);
  });

  test('forwards caller cancellation independently from the deadline', async () => {
    const controller = new AbortController();
    const request = requestJsonCapped('/api/example', { signal: controller.signal }, {
      timeoutMs: 1_000,
      fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
    });
    controller.abort('cancelled');
    await assert.rejects(
      request,
      (cause) => cause instanceof BoundedJsonResponseError && cause.code === 'aborted',
    );

    let fetchCalled = false;
    const alreadyAborted = new AbortController();
    alreadyAborted.abort('cancelled-before-request');
    await assert.rejects(
      requestJsonCapped('/api/example', { signal: alreadyAborted.signal }, {
        fetchImpl: async () => {
          fetchCalled = true;
          return Response.json({ state: 'unexpected' });
        },
      }),
      (cause) => cause instanceof BoundedJsonResponseError && cause.code === 'aborted',
    );
    assert.equal(fetchCalled, false);
  });
});
