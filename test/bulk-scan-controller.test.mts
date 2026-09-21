import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  executeBulkScan,
  BulkScanController,
  type BulkScanProfileSnapshot,
  type BulkScanRunOptions,
} from '../frontend/src/lib/controllers/bulk-scan-controller.ts';
import type { ScanResult } from '../frontend/src/lib/analysis/bulk-result-model.ts';
import type { CompactLookupHttpResponse } from '../frontend/src/lib/analysis/lookup-response.ts';

const PROFILE = {
  mode: 'fast',
  sourceState: 'unavailable',
  profile: null,
  provenance: {
    sourceState: 'unavailable',
    activeProfileId: null,
    profileUpdatedAt: null,
    limitation: 'Profile context unavailable.',
  },
} satisfies BulkScanProfileSnapshot;

function compactResponse(domain: string): CompactLookupHttpResponse {
  return {
    query: domain,
    type: 'domain',
    inputHostname: domain,
    registrableDomain: domain,
    isSubdomain: false,
    availability: {
      applicable: true,
      domain,
      state: 'registered',
      confidence: 'high',
    },
    diagnostics: {
      version: 7,
      rdap: { status: 'success' },
      whois: { status: 'skipped' },
      availability: { status: 'complete' },
    },
  };
}

function scanResult(domain: string): ScanResult {
  return {
    domain,
    saved: { scanDepth: 'fast' },
  } as ScanResult;
}

describe('Bulk scan controller', () => {
  it('publishes concurrent results in input order with bounded progress', async () => {
    const controller = new AbortController();
    const published: ScanResult[][] = [];
    const progress: number[] = [];
    let clock = 0;
    const result = await executeBulkScan({
      domains: ['one.example', 'two.example', 'three.example'],
      currentResults: [],
      replace: true,
      preservePrior: false,
      profile: PROFILE,
      controller,
      concurrency: 3,
      ownsScan: () => true,
      waitWhilePaused: async () => {},
      fetchLookup: async (domain) => {
        await new Promise((resolve) => setTimeout(resolve, domain === 'one.example' ? 4 : 0));
        return compactResponse(domain);
      },
      normalizeResult: (domain) => scanResult(domain),
      failedResult: (domain) => scanResult(domain),
      onSnapshot: () => {},
      onPublish: (rows) => published.push(rows),
      onProgress: (completed) => progress.push(completed),
      now: () => {
        clock += 5;
        return clock;
      },
      publishIntervalMs: 1_000,
    });

    assert.deepEqual(result, {
      preservedReasons: [],
      completed: 3,
      owned: true,
      aborted: false,
    });
    assert.deepEqual(progress, [1, 2, 3]);
    assert.deepEqual(
      published.at(-1)?.map((row) => row.domain),
      ['one.example', 'two.example', 'three.example'],
    );
  });

  it('stops admitting work after cancellation and publishes settled rows', async () => {
    const controller = new AbortController();
    let published: ScanResult[] = [];
    const result = await executeBulkScan({
      domains: ['one.example', 'two.example', 'three.example'],
      currentResults: [],
      replace: true,
      preservePrior: false,
      profile: PROFILE,
      controller,
      concurrency: 1,
      ownsScan: () => true,
      waitWhilePaused: async () => {},
      fetchLookup: async (domain) => compactResponse(domain),
      normalizeResult: (domain) => scanResult(domain),
      failedResult: (domain) => scanResult(domain),
      onSnapshot: () => {},
      onPublish: (rows) => {
        published = rows;
      },
      onProgress: () => controller.abort(),
      publishIntervalMs: 1_000,
    });

    assert.equal(result.completed, 1);
    assert.equal(result.aborted, true);
    assert.deepEqual(published.map((row) => row.domain), ['one.example']);
  });

  it('retains a stronger prior result through an injected reviewed decision', async () => {
    const prior = scanResult('one.example');
    const resultRows: ScanResult[][] = [];
    const result = await executeBulkScan({
      domains: ['one.example'],
      currentResults: [prior],
      replace: false,
      preservePrior: true,
      profile: PROFILE,
      controller: new AbortController(),
      concurrency: 1,
      ownsScan: () => true,
      waitWhilePaused: async () => {},
      fetchLookup: async (domain) => compactResponse(domain),
      normalizeResult: (domain) => scanResult(domain),
      failedResult: (domain) => scanResult(domain),
      onSnapshot: () => {},
      onPublish: (rows) => resultRows.push(rows),
      onProgress: () => {},
      reconcilePrior: (row) => row,
      chooseResult: () => ({ preserve: true, reason: 'Prior evidence is stronger.' }),
      publishIntervalMs: 1_000,
    });

    assert.deepEqual(result.preservedReasons, [
      'one.example: Prior evidence is stronger.',
    ]);
    assert.equal(resultRows.at(-1)?.[0], prior);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
}

function runOptions(overrides: Partial<BulkScanRunOptions> = {}): BulkScanRunOptions {
  return {
    domains: ['one.example', 'two.example'], replace: true, preservePrior: false,
    profile: PROFILE, concurrency: 1,
    fetchLookup: async domain => compactResponse(domain),
    normalizeResult: domain => scanResult(domain), failedResult: domain => scanResult(domain),
    reconcilePrior: row => row, publishIntervalMs: 1_000,
    ...overrides,
  };
}

describe('Bulk scan lifetime', () => {
  it('owns initialisation, restoration and successful completion together', async () => {
    const controller = new BulkScanController(() => {});
    const empty = structuredClone(controller.state);
    controller.restore([scanResult('retained.example')], 3, 2);
    assert.equal(controller.state.completed, 1);
    assert.equal(controller.state.total, 3);
    assert.equal(controller.state.revision, 1);
    const result = await controller.run(runOptions());
    assert.equal(result.owned, true);
    assert.equal(result.aborted, false);
    assert.equal(controller.state.running, false);
    assert.equal(controller.state.paused, false);
    assert.equal(controller.state.completed, 2);
    assert.deepEqual(controller.results.map(row => row.domain), ['one.example', 'two.example']);
    controller.restore([], 0);
    assert.deepEqual(controller.state, { ...empty, revision: 3 });
  });

  it('pause blocks admission and cancellation wakes paused workers without another request', async () => {
    const first = deferred<CompactLookupHttpResponse>();
    const started = deferred<void>();
    const calls: string[] = [];
    const controller = new BulkScanController(() => {});
    controller.togglePause();
    assert.equal(controller.state.paused, false);
    const running = controller.run(runOptions({ fetchLookup: async domain => {
      calls.push(domain);
      started.resolve();
      return first.promise;
    } }));
    await started.promise;
    controller.togglePause();
    first.resolve(compactResponse('one.example'));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(controller.state.completed, 1);
    assert.equal(controller.state.paused, true);
    assert.deepEqual(calls, ['one.example']);
    controller.cancel();
    const result = await running;
    assert.equal(result.aborted, true);
    assert.equal(controller.state.running, false);
    assert.equal(controller.state.paused, false);
    assert.deepEqual(calls, ['one.example']);
    assert.deepEqual(controller.results.map(row => row.domain), ['one.example']);
  });

  it('resume admits the remaining queue exactly once', async () => {
    const first = deferred<CompactLookupHttpResponse>();
    const started = deferred<void>();
    const calls: string[] = [];
    const controller = new BulkScanController(() => {});
    const running = controller.run(runOptions({ fetchLookup: async domain => {
      calls.push(domain);
      if (domain === 'one.example') { started.resolve(); return first.promise; }
      return compactResponse(domain);
    } }));
    await started.promise;
    controller.togglePause();
    first.resolve(compactResponse('one.example'));
    await new Promise<void>(resolve => setImmediate(resolve));
    controller.togglePause();
    const result = await running;
    assert.equal(result.aborted, false);
    assert.deepEqual(calls, ['one.example', 'two.example']);
  });

  it('replacement aborts the earlier run and withholds its late response', async () => {
    const held = deferred<CompactLookupHttpResponse>();
    const started = deferred<void>();
    let oldSignal: AbortSignal | undefined;
    const controller = new BulkScanController(() => {});
    const old = controller.run(runOptions({ fetchLookup: async (_domain, signal) => {
      oldSignal = signal; started.resolve(); return held.promise;
    } }));
    await started.promise;
    controller.togglePause();
    const replacement = await controller.run(runOptions({ domains: ['new.example'] }));
    assert.equal(oldSignal?.aborted, true);
    held.resolve(compactResponse('one.example'));
    assert.equal((await old).owned, false);
    assert.equal(replacement.owned, true);
    assert.deepEqual(controller.results.map(row => row.domain), ['new.example']);
    assert.equal(controller.state.completed, 1);
    assert.equal(controller.state.total, 1);
  });

  it('restoration invalidates a held run without leaking its state into the saved session', async () => {
    const held = deferred<CompactLookupHttpResponse>(), started = deferred<void>();
    const controller = new BulkScanController(() => {});
    const old = controller.run(runOptions({ fetchLookup: async () => { started.resolve(); return held.promise; } }));
    await started.promise;
    controller.restore([scanResult('saved.example')], 4);
    held.resolve(compactResponse('one.example'));
    assert.equal((await old).owned, false);
    assert.deepEqual(controller.results.map(row => row.domain), ['saved.example']);
    assert.equal(controller.state.running, false);
    assert.equal(controller.state.total, 4);
  });

  it('disposal retains settled rows before their timer publishes and blocks all late work', async () => {
    const second = deferred<CompactLookupHttpResponse>(), started = deferred<void>();
    let publications = 0;
    const controller = new BulkScanController(() => { publications++; });
    const running = controller.run(runOptions({ fetchLookup: async domain => {
      if (domain === 'two.example') { started.resolve(); return second.promise; }
      return compactResponse(domain);
    } }));
    await started.promise;
    assert.equal(controller.state.results.length, 0);
    controller.dispose();
    const count = publications;
    assert.deepEqual(controller.results.map(row => row.domain), ['one.example']);
    second.resolve(compactResponse('two.example'));
    assert.equal((await running).owned, false);
    controller.dispose();
    controller.restore([], 0);
    controller.togglePause();
    controller.cancel();
    const refused = await controller.run(runOptions({ fetchLookup: async () => { throw new Error('Must not collect'); } }));
    assert.equal(refused.owned, false);
    assert.equal(publications, count);
    assert.deepEqual(controller.results.map(row => row.domain), ['one.example']);
  });

  it('unexpected processing failure settles sibling work, retains completed rows and clears timers', async context => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const second = deferred<CompactLookupHttpResponse>(), started = deferred<void>();
    let publications = 0;
    const controller = new BulkScanController(() => { publications++; });
    const running = controller.run(runOptions({
      domains: ['one.example', 'two.example', 'three.example'], concurrency: 2,
      fetchLookup: async (domain, signal) => {
        if (domain === 'two.example') return second.promise;
        if (domain === 'three.example') {
          started.resolve();
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
          });
        }
        return compactResponse(domain);
      },
      normalizeResult: domain => {
        if (domain === 'two.example') throw new Error('Synthetic projection failure');
        return scanResult(domain);
      },
      failedResult: () => { throw new Error('Synthetic fallback failure'); },
    }));
    const rejected = assert.rejects(running, /Synthetic fallback failure/u);
    await started.promise;
    second.resolve(compactResponse('two.example'));
    await rejected;
    assert.equal(controller.state.running, false);
    assert.equal(controller.state.paused, false);
    assert.deepEqual(controller.results.map(row => row.domain), ['one.example']);
    const count = publications;
    context.mock.timers.tick(2_000);
    assert.equal(publications, count);
    assert.equal((await controller.run(runOptions())).completed, 2);
  });
});
