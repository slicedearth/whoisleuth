import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BULK_LOOKUP_DEFAULT_RETRY_DELAY_MS,
  BULK_LOOKUP_MAX_RETRY_DELAY_MS,
  bulkLookupRetryDelayMs,
  fetchCompactBulkLookup,
} from '../frontend/src/lib/analysis/bulk-lookup-controller.ts';

function compactResponse(domain = 'example.test') {
  return {
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

function response(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('Bulk lookup request controller', () => {
  it('builds the compact request and validates the response contract', async () => {
    const calls: string[] = [];
    const result = await fetchCompactBulkLookup(
      'portal.example.test',
      'deep',
      new AbortController().signal,
      {
        fetch: async (url) => {
          calls.push(url);
          return response(compactResponse());
        },
      },
    );

    assert.deepEqual(calls, [
      '/api/lookup?q=portal.example.test&fast=0&compact=1',
    ]);
    assert.equal(result.availability.domain, 'example.test');
  });

  it('retries bounded rate limits and accepts an eventual result', async () => {
    const queue = [
      response({ error: 'Slow down' }, 429, { 'Retry-After': '4' }),
      response({ error: 'Still busy' }, 429, { 'Retry-After': '60' }),
      response(compactResponse()),
    ];
    const waits: number[] = [];
    const result = await fetchCompactBulkLookup(
      'example.test',
      'fast',
      new AbortController().signal,
      {
        fetch: async () => queue.shift() ?? response(compactResponse()),
        wait: async (delayMs) => { waits.push(delayMs); },
      },
    );

    assert.equal(result.availability.state, 'registered');
    assert.deepEqual(waits, [4_000, BULK_LOOKUP_MAX_RETRY_DELAY_MS]);
  });

  it('surfaces bounded HTTP and contract errors', async () => {
    await assert.rejects(
      fetchCompactBulkLookup(
        'example.test',
        'fast',
        new AbortController().signal,
        { fetch: async () => response({ error: 'Unavailable' }, 503) },
      ),
      /Unavailable/u,
    );
    await assert.rejects(
      fetchCompactBulkLookup(
        'example.test',
        'fast',
        new AbortController().signal,
        { fetch: async () => response({ availability: {} }) },
      ),
      /invalid response/u,
    );
  });

  it('normalizes numeric, date, absent, and excessive retry hints', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    assert.equal(bulkLookupRetryDelayMs('1.25', now), 1_250);
    assert.equal(bulkLookupRetryDelayMs('Thu, 01 Jan 2026 00:00:03 GMT', now), 3_000);
    assert.equal(bulkLookupRetryDelayMs(null, now), BULK_LOOKUP_DEFAULT_RETRY_DELAY_MS);
    assert.equal(bulkLookupRetryDelayMs('999999', now), BULK_LOOKUP_MAX_RETRY_DELAY_MS);
    assert.equal(bulkLookupRetryDelayMs('invalid', now), BULK_LOOKUP_DEFAULT_RETRY_DELAY_MS);
  });
});
