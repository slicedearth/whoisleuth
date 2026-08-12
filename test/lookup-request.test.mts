import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOOKUP_CLIENT_TIMEOUT_MS,
  requestLookup,
} from '../frontend/src/lib/analysis/lookup-request.ts';
import type { LookupRequestOptions } from '../lib/lookup-request.mts';
import {
  MAX_LOOKUP_RESPONSE_CONTAINER_ITEMS,
  type JsonValue,
  type LookupHttpResponse,
} from '../lib/lookup-response-contract.mts';
import { LARGE_JSON_RESPONSE_BYTES } from '../lib/bounded-json-response.mts';
import {
  MAX_HTTP_ATTEMPTS,
  MAX_HTTP_EVIDENCE_REDIRECTS,
} from '../lib/http-evidence-bounds.mts';
import { MAX_BOUNDED_JSON_DEPTH } from '../lib/bounded-json.mts';

type FetchImplementation = NonNullable<LookupRequestOptions['fetchImpl']>;

function response(overrides: Partial<LookupHttpResponse> = {}): LookupHttpResponse {
  return {
    query: 'example.test',
    type: 'domain',
    registrableDomain: 'example.test',
    rdap: {},
    whois: {},
    availability: { applicable: true, state: 'unknown' },
    diagnostics: {
      version: 8,
      rdap: { status: 'unsupported' },
      whois: { status: 'partial' },
      availability: { status: 'complete' },
    },
    ...overrides,
  };
}

function boundedHttpEvidence(redirectCount = MAX_HTTP_EVIDENCE_REDIRECTS) {
  return {
    status: 'success',
    complete: true,
    requestUrl: 'https://example.test/',
    finalUrl: 'https://final.example.test/',
    redirectCount,
    redirects: Array.from({ length: redirectCount }, (_, index) => ({
      from: `https://hop-${index}.example.test/`,
      to: `https://hop-${index + 1}.example.test/`,
      status: 302,
      queryOmitted: false,
    })),
    attempts: Array.from({ length: MAX_HTTP_ATTEMPTS }, (_, index) => ({
      url: `https://attempt-${index}.example.test/`,
      outcome: 'response',
      httpStatus: 200,
      error: null,
    })),
    limitations: [],
    response: { status: 200 },
  };
}

describe('Lookup browser request boundary', () => {
  test('accepts complete and partial authoritative response envelopes', async () => {
    for (const body of [
      response(),
      response({
        diagnostics: {
          version: 8,
          rdap: { status: 'error' },
          whois: { status: 'partial' },
          availability: { status: 'error' },
        },
      }),
    ]) {
      const result = await requestLookup('/api/lookup?q=example.test', {
        fetchImpl: async () => Response.json(body),
      });
      assert.equal(result.ok, true);
      assert.deepEqual(result.value, body);
    }
  });

  test('returns bounded HTTP and invalid-response failures', async () => {
    const upstream = await requestLookup('/api/lookup?q=example.test', {
      fetchImpl: async () => Response.json(
        { error: `Upstream\n${'x'.repeat(400)}` },
        { status: 503 },
      ),
    });
    assert.equal(upstream.ok, false);
    assert.equal(upstream.kind, 'http');
    assert.equal(upstream.message.includes('\n'), false);
    assert.equal(upstream.message.length, 240);

    const malformed = await requestLookup('/api/lookup?q=example.test', {
      fetchImpl: async () => Response.json({ query: 'example.test' }),
    });
    assert.deepEqual(malformed, {
      ok: false,
      kind: 'invalid_response',
      message: 'Lookup returned an invalid response.',
    });
  });

  test('accepts exact nested HTTP bounds and rejects a bounded over-limit success response', async () => {
    const exact = response({
      availability: { applicable: true, state: 'registered', http: boundedHttpEvidence() },
    });
    const accepted = await requestLookup('/api/lookup?q=example.test', {
      fetchImpl: async () => Response.json(exact),
    });
    assert.equal(accepted.ok, true);
    assert.deepEqual(accepted.value, exact);

    const overBound = response({
      availability: {
        applicable: true,
        state: 'registered',
        http: boundedHttpEvidence(MAX_HTTP_EVIDENCE_REDIRECTS + 1),
      },
    });
    assert.ok(JSON.stringify(overBound).length < LARGE_JSON_RESPONSE_BYTES);
    assert.deepEqual(await requestLookup('/api/lookup?q=example.test', {
      fetchImpl: async () => Response.json(overBound),
    }), {
      ok: false,
      kind: 'invalid_response',
      message: 'Lookup returned an invalid response.',
    });
  });

  test('rejects a byte-bounded but structurally over-nested success response', async () => {
    let nested: JsonValue = 'leaf';
    for (let index = 0; index <= MAX_BOUNDED_JSON_DEPTH; index += 1) nested = { value: nested };
    const overBound = response({ rdap: { nested } });
    assert.ok(JSON.stringify(overBound).length < LARGE_JSON_RESPONSE_BYTES);
    assert.deepEqual(await requestLookup('/api/lookup?q=example.test', {
      fetchImpl: async () => Response.json(overBound),
    }), {
      ok: false,
      kind: 'invalid_response',
      message: 'Lookup returned an invalid response.',
    });
  });

  test('rejects a byte-bounded oversized container before retaining a result', async () => {
    const overBound = response({
      additive: Array(MAX_LOOKUP_RESPONSE_CONTAINER_ITEMS + 1).fill(null),
    } as Partial<LookupHttpResponse>);
    assert.ok(JSON.stringify(overBound).length < LARGE_JSON_RESPONSE_BYTES);
    assert.deepEqual(await requestLookup('/api/lookup?q=example.test', {
      fetchImpl: async () => Response.json(overBound),
    }), {
      ok: false,
      kind: 'invalid_response',
      message: 'Lookup returned an invalid response.',
    });
  });

  test('rejects duplicate response keys before JSON parsing can collapse them', async () => {
    const raw = JSON.stringify(response()).replace(
      '"type":"domain"',
      '"type":"domain","type":"domain"',
    );
    assert.deepEqual(await requestLookup('/api/lookup?q=example.test', {
      fetchImpl: async () => new Response(raw, { headers: { 'content-type': 'application/json' } }),
    }), {
      ok: false,
      kind: 'invalid_response',
      message: 'Lookup returned an invalid response.',
    });
  });

  test('distinguishes a bounded client timeout from analyst cancellation', async () => {
    const pendingFetch: FetchImplementation = (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      assert.ok(signal);
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    const timedOut = await requestLookup('/api/lookup?q=example.test', {
      fetchImpl: pendingFetch,
      timeoutMs: 5,
    });
    assert.deepEqual(timedOut, {
      ok: false,
      kind: 'timeout',
      message: 'Lookup timed out after 1 second. No partial response was retained.',
    });

    const controller = new AbortController();
    const cancelledPromise = requestLookup('/api/lookup?q=example.test', {
      fetchImpl: pendingFetch,
      signal: controller.signal,
    });
    controller.abort('analyst_cancelled');
    assert.deepEqual(await cancelledPromise, {
      ok: false,
      kind: 'cancelled',
      message: 'Lookup cancelled. No partial response was retained.',
    });
  });

  test('applies timeout and analyst cancellation while reading a stalled response body', async () => {
    function stalledResponse(onCancel: () => void): Response {
      return new Response(new ReadableStream<Uint8Array>({
        pull: async () => new Promise(() => {}),
        cancel: onCancel,
      }));
    }

    let timedOutBodyCancelled = false;
    const timedOut = await requestLookup('/api/lookup?q=example.test', {
      timeoutMs: 5,
      fetchImpl: async () => stalledResponse(() => { timedOutBodyCancelled = true; }),
    });
    assert.deepEqual(timedOut, {
      ok: false,
      kind: 'timeout',
      message: 'Lookup timed out after 1 second. No partial response was retained.',
    });
    assert.equal(timedOutBodyCancelled, true);

    let cancelledBodyCancelled = false;
    const controller = new AbortController();
    const cancelledRequest = requestLookup('/api/lookup?q=example.test', {
      signal: controller.signal,
      timeoutMs: 1_000,
      fetchImpl: async () => stalledResponse(() => { cancelledBodyCancelled = true; }),
    });
    controller.abort('analyst_cancelled');
    assert.deepEqual(await cancelledRequest, {
      ok: false,
      kind: 'cancelled',
      message: 'Lookup cancelled. No partial response was retained.',
    });
    assert.equal(cancelledBodyCancelled, true);
  });

  test('caps injected deadlines and sanitizes generic network failures', async () => {
    let fetchCalled = false;
    const controller = new AbortController();
    controller.abort('already_cancelled');
    const cancelled = await requestLookup('/api/lookup?q=example.test', {
      signal: controller.signal,
      timeoutMs: LOOKUP_CLIENT_TIMEOUT_MS * 4,
      fetchImpl: async () => { fetchCalled = true; throw new Error('must not run'); },
    });
    assert.equal(fetchCalled, false);
    assert.equal(cancelled.ok, false);
    if (cancelled.ok) assert.fail('Expected a cancelled Lookup outcome.');
    assert.equal(cancelled.kind, 'cancelled');

    const failed = await requestLookup('/api/lookup?q=example.test', {
      fetchImpl: async () => { throw new Error('local path and upstream internals'); },
    });
    assert.deepEqual(failed, {
      ok: false,
      kind: 'network',
      message: 'Lookup request could not be completed.',
    });

    const oversized = await requestLookup('/api/lookup?q=example.test', {
      fetchImpl: async () => new Response('{}', {
        headers: { 'content-length': String(LARGE_JSON_RESPONSE_BYTES + 1) },
      }),
    });
    assert.deepEqual(oversized, {
      ok: false,
      kind: 'invalid_response',
      message: 'Lookup returned an invalid response.',
    });

    const invalidJson = await requestLookup('/api/lookup?q=example.test', {
      fetchImpl: async () => new Response('{', {
        headers: { 'content-type': 'application/json' },
      }),
    });
    assert.deepEqual(invalidJson, {
      ok: false,
      kind: 'invalid_response',
      message: 'Lookup returned an invalid response.',
    });
  });
});
