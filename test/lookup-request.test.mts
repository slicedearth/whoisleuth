import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOOKUP_CLIENT_TIMEOUT_MS,
  requestLookup,
} from '../frontend/src/lib/analysis/lookup-request.ts';
import type { LookupRequestOptions } from '../lib/lookup-request.mts';
import type { LookupHttpResponse } from '../lib/lookup-response-contract.mts';

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
  });
});
