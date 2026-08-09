import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { fetchHomepage } from '../lib/availability.mts';
import { fetchFaviconHash } from '../lib/favicon.mts';

function stallingResponse(signal: AbortSignal | null | undefined, contentType: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4]));
      signal?.addEventListener('abort', () => {
        controller.error(new DOMException('fixture response aborted', 'AbortError'));
      }, { once: true });
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

describe('production body-read deadlines', () => {
  test('fetchHomepage keeps its deadline active through the real capped body reader', async () => {
    let calls = 0;
    const startedAt = Date.now();
    const result = await fetchHomepage('stall.example', {
      timeoutMs: 20,
      fetcher: async (_url, options) => {
        calls += 1;
        return stallingResponse(options.signal, 'text/html');
      },
    });
    assert.equal(result.status, 'inconclusive');
    assert.equal(calls, 2);
    assert.match(result.detail, /timed out after 20 milliseconds/u);
    assert.ok(Date.now() - startedAt < 1_000, 'production homepage deadline was not retained through body reading');
  });

  test('fetchFaviconHash keeps a per-candidate deadline active through the real capped body reader', async () => {
    let calls = 0;
    const startedAt = Date.now();
    const result = await fetchFaviconHash('stall.example', {
      timeoutMs: 20,
      fetcher: async (_url, options) => {
        calls += 1;
        return stallingResponse(options?.signal, 'image/png');
      },
    });
    assert.equal(result, null);
    assert.equal(calls, 4);
    assert.ok(Date.now() - startedAt < 1_000, 'production favicon deadline was not retained through body reading');
  });
});
