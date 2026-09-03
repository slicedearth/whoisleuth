import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  executeBulkScan,
  type BulkScanProfileSnapshot,
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
