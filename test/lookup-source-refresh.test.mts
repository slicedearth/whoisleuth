import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEvidenceCoverageLedger } from '../frontend/src/lib/analysis/evidence-coverage-ledger.ts';
import {
  buildLookupSourceRefreshPlan,
  requestLookupSourceRefresh,
} from '../frontend/src/lib/analysis/lookup-source-refresh.ts';

const NOW = '2026-07-30T00:00:00.000Z';

test('offers only limited source families for a current Lookup envelope', () => {
  const ledger = buildEvidenceCoverageLedger([
    { id: 'rdap', label: 'RDAP', category: 'registry', status: 'complete' },
    { id: 'whois', label: 'WHOIS', category: 'registry', status: 'partial' },
    { id: 'dns', label: 'DNS', category: 'network', status: 'complete' },
  ]);
  const plan = buildLookupSourceRefreshPlan(ledger, '2026-07-29T00:00:00.000Z', NOW);
  assert.equal(plan.stale, false);
  assert.deepEqual(plan.items.map((item) => item.id), ['whois']);
  assert.equal(plan.items[0]?.reason, 'limited');
});

test('offers existing source groups when the unified envelope is stale', () => {
  const ledger = buildEvidenceCoverageLedger([
    { id: 'rdap', label: 'RDAP', category: 'registry', status: 'complete' },
    { id: 'whois', label: 'WHOIS', category: 'registry', status: 'complete' },
    { id: 'http', label: 'HTTP', category: 'web', status: 'complete' },
  ]);
  const plan = buildLookupSourceRefreshPlan(ledger, '2026-07-20T00:00:00.000Z', NOW);
  assert.equal(plan.stale, true);
  assert.equal(plan.ageDays, 10);
  assert.deepEqual(plan.items.map((item) => item.id), ['rdap', 'whois', 'availability']);
  assert.ok(plan.items.every((item) => item.reason === 'stale'));
});

test('summarizes a separate WHOIS refresh without retaining its raw response', async () => {
  const plan = buildLookupSourceRefreshPlan(buildEvidenceCoverageLedger([
    { id: 'whois', label: 'WHOIS', category: 'registry', status: 'partial' },
  ]), NOW, NOW).items[0];
  assert.ok(plan);
  const outcome = await requestLookupSourceRefresh(plan, 'example.test', 'deep', {
    now: () => NOW,
    fetchImpl: async (input) => {
      assert.equal(String(input), '/api/whois?q=example.test');
      return new Response(JSON.stringify({
        chain: [{ server: 'whois.example.test' }, { server: 'registrar.example.test' }],
        parsed: { chainStatus: 'complete' },
        raw: 'not projected',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.deepEqual(outcome, {
    ok: true,
    value: {
      id: 'whois',
      state: 'complete',
      detail: 'WHOIS returned a complete 2-hop referral chain.',
      observedAt: NOW,
    },
  });
});

test('recognizes complete deep and fast domain-evidence refresh contracts', async () => {
  const plan = {
    id: 'availability',
    label: 'Domain evidence',
    endpoint: '/api/availability',
    evidenceIds: ['dns', 'http', 'tls'],
    reason: 'limited',
    requestDisclosure: 'Repeats bounded domain evidence.',
  } as const;
  const deep = await requestLookupSourceRefresh(plan, 'example.test', 'deep', {
    now: () => NOW,
    fetchImpl: async () => new Response(JSON.stringify({
      state: 'registered',
      deepScanComplete: true,
      dns: { status: 'success' },
      http: { status: 'success' },
      tls: { status: 'success' },
    }), { status: 200 }),
  });
  assert.equal(deep.ok && deep.value.state, 'complete');

  const fast = await requestLookupSourceRefresh(plan, 'example.test', 'fast', {
    now: () => NOW,
    fetchImpl: async (input) => {
      assert.match(String(input), /fast=true/);
      return new Response(JSON.stringify({ state: 'registered' }), { status: 200 });
    },
  });
  assert.equal(fast.ok && fast.value.state, 'complete');
});

test('keeps inconclusive fast domain evidence limited', async () => {
  const plan = {
    id: 'availability',
    label: 'Domain evidence',
    endpoint: '/api/availability',
    evidenceIds: ['dns'],
    reason: 'limited',
    requestDisclosure: 'Repeats bounded domain evidence.',
  } as const;
  const outcome = await requestLookupSourceRefresh(plan, 'example.test', 'fast', {
    now: () => NOW,
    fetchImpl: async () => new Response(JSON.stringify({ state: 'unknown' }), { status: 200 }),
  });
  assert.equal(outcome.ok && outcome.value.state, 'limited');
});

test('keeps failed source refreshes explicit and bounded', async () => {
  const plan = buildLookupSourceRefreshPlan(buildEvidenceCoverageLedger([
    { id: 'rdap', label: 'RDAP', category: 'registry', status: 'unavailable' },
  ]), NOW, NOW).items[0];
  assert.ok(plan);
  const outcome = await requestLookupSourceRefresh(plan, 'example.test', 'deep', {
    fetchImpl: async () => new Response(JSON.stringify({ error: 'Registry source unavailable' }), { status: 503 }),
  });
  assert.deepEqual(outcome, { ok: false, message: 'Registry source unavailable' });
});

test('rejects oversized source refresh bodies before retaining raw content', async () => {
  const plan = buildLookupSourceRefreshPlan(buildEvidenceCoverageLedger([
    { id: 'rdap', label: 'RDAP', category: 'registry', status: 'unavailable' },
  ]), NOW, NOW).items[0];
  assert.ok(plan);
  const outcome = await requestLookupSourceRefresh(plan, 'example.test', 'deep', {
    fetchImpl: async () => new Response('oversized', {
      status: 200,
      headers: { 'content-length': String(2 * 1024 * 1024 + 1) },
    }),
  });
  assert.deepEqual(outcome, { ok: false, message: 'Source refresh returned an oversized response.' });
});
