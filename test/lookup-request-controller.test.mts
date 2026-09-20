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
  test('suppresses source updates after cancellation, input changes, supersession and disposal', async () => {
    for (const action of ['cancel', 'invalidate', 'replace', 'dispose'] as const) {
      const held = deferred<LookupRequestOutcome>();
      let deliver: Parameters<LookupRequest>[1]['onProgress'];
      const seen: unknown[] = [];
      const controller = new LookupRequestController({ request: async (url, options) => {
        if (url.includes('second')) return { ok: true, value: validResponse() };
        deliver = options.onProgress; return held.promise;
      } });
      const running = controller.run('/api/lookup?q=example.test', () => {}, async () => {}, { onProgress: update => { seen.push(update); } });
      await Promise.resolve();
      assert.ok(deliver); deliver({ transport: 'buffered', snapshot: null });
      assert.equal(seen.length, 1);
      if (action === 'replace') await controller.run('/api/lookup?q=second.test', () => {});
      else controller[action]();
      deliver({ transport: 'buffered', snapshot: null });
      assert.equal(seen.length, 1, action);
      held.resolve({ ok: false, kind: 'cancelled', message: 'Cancelled' });
      await running; controller.dispose();
    }
  });
  test('a completed request cannot deliver a later source update', async () => {
    let deliver: Parameters<LookupRequest>[1]['onProgress'];
    let updates = 0;
    const controller = new LookupRequestController({ request: async (_url, options) => {
      deliver = options.onProgress; return { ok: true, value: validResponse() };
    } });
    await controller.run('/api/lookup?q=example.test', () => {}, async () => {}, { onProgress: () => { updates++; } });
    assert.ok(deliver); deliver({ transport: 'buffered', snapshot: null });
    assert.equal(updates, 0); controller.dispose();
  });
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

  test('input invalidation aborts work and suppresses a late response without disposing the controller', async () => {
    const pending = deferred<LookupRequestOutcome>();
    let suppliedSignal: AbortSignal | undefined;
    const controller = new LookupRequestController({
      request: (url, options) => {
        suppliedSignal = options.signal;
        return url.includes('second.example.test')
          ? Promise.resolve({ ok: true, value: validResponse('second.example.test') })
          : pending.promise;
      },
    });

    const run = controller.run('/api/lookup?q=first.example.test&fast=1', () => {});
    await Promise.resolve();
    controller.invalidate();
    pending.resolve({ ok: true, value: validResponse('first.example.test') });

    assert.ok(suppliedSignal);
    assert.equal(suppliedSignal.aborted, true);
    assert.deepEqual(await run, { state: 'stale' });

    const next = await controller.run('/api/lookup?q=second.example.test&fast=1', () => {});
    assert.deepEqual(next, { state: 'complete', outcome: { ok: true, value: validResponse('second.example.test') } });
    controller.dispose();
  });
});
