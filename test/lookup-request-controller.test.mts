import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  LookupRequestController,
  type LookupRequest,
} from '../frontend/src/lib/controllers/lookup-request-controller.ts';
import type {
  LookupRequestOutcome,
} from '../lib/lookup-request.mts';
import type { LookupHttpResponse } from '../lib/lookup-response-contract.mts';

function validResponse(query = 'example.test'): LookupHttpResponse {
  return {
    query,
    type: 'domain',
    registrableDomain: query,
    rdap: {},
    whois: {},
    availability: {},
    diagnostics: {},
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('Lookup request controller', () => {
  test('returns only the current typed request outcome', async () => {
    const first = deferred<LookupRequestOutcome>();
    const second = deferred<LookupRequestOutcome>();
    const controller = new LookupRequestController({
      request: (url) => url.includes('second.example.test') ? second.promise : first.promise,
    });

    const firstRun = controller.run('/api/lookup?q=first.example.test', () => {});
    const secondRun = controller.run('/api/lookup?q=second.example.test', () => {});
    second.resolve({ ok: true, value: validResponse('second.example.test') });
    first.resolve({ ok: true, value: validResponse('first.example.test') });

    assert.deepEqual(await secondRun, {
      state: 'complete',
      outcome: { ok: true, value: validResponse('second.example.test') },
    });
    assert.deepEqual(await firstRun, { state: 'stale' });
    controller.dispose();
  });

  test('forwards cancellation without retaining a stale result', async () => {
    let suppliedSignal: AbortSignal | undefined;
    const controller = new LookupRequestController({
      request: async (_url, options) => {
        suppliedSignal = options.signal;
        assert.ok(suppliedSignal);
        await new Promise((resolve) => suppliedSignal?.addEventListener('abort', resolve, { once: true }));
        return { ok: false, kind: 'cancelled', message: 'Lookup cancelled.' };
      },
    });

    const run = controller.run('/api/lookup?q=example.test', () => {});
    await Promise.resolve();
    controller.cancel();
    assert.ok(suppliedSignal);
    assert.equal(suppliedSignal.aborted, true);
    assert.deepEqual(await run, {
      state: 'complete',
      outcome: { ok: false, kind: 'cancelled', message: 'Lookup cancelled.' },
    });
    controller.dispose();
  });

  test('disposal aborts work and suppresses post-navigation completion', async () => {
    const pending = deferred<LookupRequestOutcome>();
    let suppliedSignal: AbortSignal | undefined;
    const request: LookupRequest = (_url, options) => {
      suppliedSignal = options.signal;
      return pending.promise;
    };
    const controller = new LookupRequestController({
      request,
    });

    const run = controller.run('/api/lookup?q=example.test', () => {});
    await Promise.resolve();
    controller.dispose();
    pending.resolve({ ok: true, value: validResponse() });

    assert.ok(suppliedSignal);
    assert.equal(suppliedSignal.aborted, true);
    assert.deepEqual(await run, { state: 'stale' });
    assert.deepEqual(
      await controller.run('/api/lookup?q=ignored.example.test', () => {}),
      { state: 'stale' },
    );
  });
});
