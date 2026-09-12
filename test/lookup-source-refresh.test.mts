import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEvidenceCoverageLedger } from '../frontend/src/lib/analysis/evidence-coverage-ledger.ts';
import {
  buildLookupSourceRefreshPlan,
  buildLookupFreshnessPolicy,
  mergeLookupSourceRefreshLedger,
  requestLookupSourceRefresh,
  MAX_LOOKUP_SOURCE_REFRESH_HISTORY,
  type LookupSourceRefreshId,
  type LookupSourceRefreshPlanItem,
  type LookupSourceRefreshLedger,
} from '../frontend/src/lib/analysis/lookup-source-refresh.ts';
import { originalSourceRefreshFacts } from '../frontend/src/lib/analysis/lookup-source-observation.ts';
import { compareCheckpointFacts } from '../frontend/src/lib/analysis/case-evidence-checkpoint.ts';
import type { LookupHttpResponse } from '../lib/lookup-response-contract.mts';

const NOW = '2026-07-30T00:00:00.000Z';

test('offers only limited source families for a current Lookup envelope', () => {
  const ledger = buildEvidenceCoverageLedger([
    { id: 'rdap', label: 'RDAP', category: 'registry', status: 'complete' },
    { id: 'whois', label: 'WHOIS', category: 'registry', status: 'partial' },
    { id: 'dns', label: 'DNS', category: 'network', status: 'complete' },
  ]);
  const plan = buildLookupSourceRefreshPlan(ledger, '2026-07-29T00:00:00.000Z', NOW, {
    observedAtByEvidence: { rdap: NOW, whois: NOW, dns: NOW },
  });
  assert.equal(plan.stale, false);
  assert.deepEqual(plan.items.map((item) => item.id), ['whois']);
  assert.equal(plan.items[0]?.reason, 'limited');
});

test('offers stale source observations independently of the envelope time', () => {
  const ledger = buildEvidenceCoverageLedger([
    { id: 'rdap', label: 'RDAP', category: 'registry', status: 'complete' },
    { id: 'whois', label: 'WHOIS', category: 'registry', status: 'complete' },
    { id: 'http', label: 'HTTP', category: 'web', status: 'complete' },
  ]);
  const plan = buildLookupSourceRefreshPlan(ledger, NOW, NOW, {
    task: 'general',
    observedAtByEvidence: {
      rdap: '2026-06-20T00:00:00.000Z',
      whois: '2026-06-20T00:00:00.000Z',
      http: '2026-06-20T00:00:00.000Z',
    },
  });
  assert.equal(plan.stale, true);
  assert.equal(plan.ageDays, 0);
  assert.ok(plan.items.every((item) => item.ageDays === 40 && item.supersedesObservedAt === '2026-06-20T00:00:00.000Z'));
  assert.deepEqual(plan.items.map((item) => item.id), ['rdap', 'whois', 'availability']);
  assert.ok(plan.items.every((item) => item.reason === 'stale'));
});

test('uses bounded task-specific and analyst-defined freshness thresholds', () => {
  assert.deepEqual(buildLookupFreshnessPolicy('incident').thresholdsDays, { registration: 14, network: 1, web: 1 });
  const custom = buildLookupFreshnessPolicy('incident', {
    id: 'analyst-custom',
    thresholdsDays: { registration: 0, network: 400, web: 5.4 },
  });
  assert.deepEqual(custom.thresholdsDays, { registration: 1, network: 365, web: 5 });

  const ledger = buildEvidenceCoverageLedger([
    { id: 'rdap', label: 'RDAP', category: 'registry', status: 'complete' },
    { id: 'http', label: 'HTTP', category: 'web', status: 'complete' },
  ]);
  const plan = buildLookupSourceRefreshPlan(ledger, '2026-07-29T00:00:00.000Z', NOW, {
    task: 'incident',
    observedAtByEvidence: { rdap: '2026-07-29T00:00:00.000Z', http: '2026-07-29T00:00:00.000Z' },
  });
  assert.deepEqual(plan.items.map((item) => item.id), ['availability']);
  assert.equal(plan.items[0]?.staleAfterDays, 1);
  assert.equal(plan.freshnessPolicy.version, 1);
});

const EARLIER = '2026-07-29T00:00:00.000Z';
function original(): LookupHttpResponse {
  return {
    query: 'portal.example.test', type: 'domain', inputHostname: 'portal.example.test', registrableDomain: 'example.test',
    rdap: { fetchedAt: EARLIER, upstreamStatus: 200, parsed: { domain: 'example.test', registrar: { name: 'Earlier registrar' }, nameservers: ['ns1.example.test'] } },
    whois: { parsed: { registrar: 'Earlier WHOIS registrar', domainName: 'example.test' } },
    availability: { applicable: true, domain: 'example.test', observationHostname: 'portal.example.test' },
    diagnostics: { rdap: { status: 'success' }, whois: { status: 'complete', queriedAt: EARLIER } },
  };
}
function plan(id: LookupSourceRefreshId): LookupSourceRefreshPlanItem {
  return { id, label: id, endpoint: `/api/${id}`, evidenceIds: [id], reason: 'limited',
    requestDisclosure: 'One bounded operation.', supersedesObservedAt: EARLIER };
}
function rdap() {
  return { query: 'example.test', type: 'domain', fetchedAt: NOW, upstreamStatus: 200,
    parsed: { domain: 'example.test', registrar: { name: 'Updated registrar' }, nameservers: ['ns2.example.test'] },
    data: { rawContacts: 'private-example-contact' } };
}
async function refresh(id: LookupSourceRefreshId, body: unknown, input = original()) {
  return requestLookupSourceRefresh(plan(id), input, 'deep', {
    now: () => NOW, fetchImpl: async () => Response.json(body),
  });
}

test('retains validated registration facts and their actual clock without mutating the original or retaining contacts', async () => {
  const input = original(), before = structuredClone(input);
  const outcome = await refresh('rdap', rdap(), input);
  assert.ok(outcome.ok);
  assert.equal(outcome.value.state, 'complete');
  assert.equal(outcome.value.observedAt, NOW);
  assert.equal(outcome.value.attemptedAt, NOW);
  assert.ok(outcome.value.facts.some(fact => fact.field === 'registration.registrar' && fact.value === 'Updated registrar'));
  assert.ok(outcome.value.facts.every(fact => fact.source === 'Registry RDAP' && fact.observationHostname === 'example.test'));
  assert.doesNotMatch(JSON.stringify(outcome), /rawContacts|private-example-contact/);
  assert.deepEqual(input, before);
  const comparisons = compareCheckpointFacts(originalSourceRefreshFacts('rdap', input, 'deep', NOW), outcome.value.facts);
  assert.equal(comparisons.find(row => row.field === 'registration.registrar')?.state, 'changed');
});

test('WHOIS refresh uses source-hop clocks and compares only WHOIS fields', async () => {
  const outcome = await refresh('whois', {
    query: 'example.test', type: 'domain',
    chain: [{ server: 'registry.example.test', queriedAt: EARLIER, response: 'private-example-raw' }],
    parsed: { domainName: 'example.test', registrar: 'New WHOIS registrar', chainStatus: 'complete', registrationStatus: 'registered', fieldsTruncated: [] },
  });
  assert.ok(outcome.ok);
  assert.equal(outcome.value.state, 'complete');
  assert.equal(outcome.value.observedAt, EARLIER);
  const facts = outcome.value.facts.filter(fact => fact.value !== null);
  assert.ok(facts.length > 0);
  assert.ok(facts.every(fact => fact.source === 'WHOIS' && fact.observedAt === EARLIER));
  assert.doesNotMatch(JSON.stringify(outcome.value), /private-example-raw|Earlier registrar/);
  const previous = originalSourceRefreshFacts('whois', original(), 'deep', NOW);
  assert.equal(previous.find(fact => fact.field === 'registration.registrar')?.value, 'Earlier WHOIS registrar');
  assert.equal(compareCheckpointFacts(previous, facts).find(row => row.field === 'registration.registrar')?.state, 'incomparable');
});

test('source incompleteness, truncation and unknown clocks cannot become complete because HTTP succeeded', async () => {
  for (const body of [
    { ...rdap(), fetchedAt: null },
    { ...rdap(), fetchedAt: '2027-01-01T00:00:00.000Z' },
    { ...rdap(), complete: false },
    { ...rdap(), parsed: { ...rdap().parsed, serverTruncated: true } },
  ]) {
    const outcome = await refresh('rdap', body);
    assert.ok(outcome.ok);
    assert.equal(outcome.value.state, 'limited');
    assert.ok(outcome.value.facts.every(fact => fact.completeness !== 'complete'));
  }
  for (const flags of [{ complete: false }, { truncated: true }]) {
    const outcome = await refresh('whois', {
      query: 'example.test', type: 'domain', ...flags,
      chain: [{ server: 'registry.example.test', queriedAt: EARLIER, response: 'Example registration' }],
      parsed: { domainName: 'example.test', registrar: 'Example registrar', chainStatus: 'complete', registrationStatus: 'registered', fieldsTruncated: [] },
    });
    assert.ok(outcome.ok);
    assert.equal(outcome.value.state, 'limited');
    assert.ok(outcome.value.facts.every(fact => fact.completeness !== 'complete'));
  }
});

test('domain refresh uses actual child states and clocks, not the enabled Deep flag', async () => {
  const body = {
    applicable: true, domain: 'example.test', observationHostname: 'portal.example.test', deepScanComplete: true,
    dns: { status: 'success', observedAt: NOW, complete: true, records: { a: ['192.0.2.10'] } },
    http: { status: 'error', observedAt: NOW, complete: false },
    tls: { status: 'unavailable', observedAt: NOW, complete: false },
  };
  const limited = await refresh('availability', body);
  assert.ok(limited.ok);
  assert.equal(limited.value.state, 'limited');
  assert.ok(limited.value.facts.some(fact => fact.field === 'dns.addresses' && fact.value === '192.0.2.10'));
  const incompleteDns = await refresh('availability', { ...body, dns: { ...body.dns, complete: false } });
  assert.ok(incompleteDns.ok);
  assert.equal(incompleteDns.value.facts.find(fact => fact.field === 'dns.addresses')?.completeness, 'partial');
  const complete = await refresh('availability', { ...body,
    http: { status: 'success', observedAt: NOW, complete: true, response: { status: 200 } },
    tls: { status: 'success', observedAt: NOW, complete: true, protocol: 'TLSv1.3' },
  });
  assert.equal(complete.ok && complete.value.state, 'complete');
  const truncatedPage = await refresh('availability', { ...body,
    http: { status: 'success', observedAt: NOW, complete: true, response: { status: 200, bodyTruncated: true } },
    tls: { status: 'success', observedAt: NOW, complete: true, protocol: 'TLSv1.3' },
  });
  assert.equal(truncatedPage.ok && truncatedPage.value.state, 'limited');
  const incompletePage = await refresh('availability', { ...body, pageTitle: 'Partial page',
    http: { status: 'success', observedAt: NOW, complete: true, response: { status: 200, bodyTruncated: true } },
  });
  assert.ok(incompletePage.ok);
  assert.equal(incompletePage.value.facts.find(fact => fact.field === 'page.title')?.completeness, 'partial');
});

test('response identity and nested shapes are admitted before retaining any source facts', async () => {
  for (const body of [
    { ...rdap(), query: 'another.test' },
    { ...rdap(), type: 'asn' },
    { ...rdap(), parsed: {} },
    { ...rdap(), parsed: { ...rdap().parsed, domain: 'another.test' } },
    { ...rdap(), parsed: { ...rdap().parsed, statuses: ['valid', { invalid: true }] } },
    { ...rdap(), complete: 'false' },
    { ...rdap(), parsed: { ...rdap().parsed, serverTruncated: 'true' } },
    { ...rdap(), parsed: { ...rdap().parsed, objectClassName: 'autnum' } },
    { ...rdap(), upstreamStatus: 404 },
    [],
  ]) {
    const outcome = await refresh('rdap', body);
    assert.ok(outcome.ok);
    assert.equal(outcome.value.state, 'unavailable');
    assert.deepEqual(outcome.value.facts, []);
  }
  const wrongHost = await refresh('availability', { applicable: true, domain: 'example.test', observationHostname: 'example.test' });
  assert.equal(wrongHost.ok && wrongHost.value.state, 'unavailable');
});

test('selected-page evidence is not refreshed at a homepage and registry refresh sends only the registration domain', async () => {
  const base = original();
  const input = { ...base, availability: { ...base.availability, webObservationMode: 'selected_url' } };
  const requests: string[] = [];
  const options = { now: () => NOW, fetchImpl: async (url: RequestInfo | URL) => { requests.push(String(url)); return Response.json(rdap()); } };
  const blocked = await requestLookupSourceRefresh(plan('availability'), input, 'deep', options);
  assert.equal(blocked.ok, false);
  assert.deepEqual(requests, []);
  assert.equal((await requestLookupSourceRefresh(plan('rdap'), input, 'deep', options)).ok, true);
  assert.deepEqual(requests, ['/api/rdap?q=example.test']);
});

test('domain refresh retains the earlier observation hostname, including an older root-scoped result', async () => {
  for (const host of ['portal.example.test', 'example.test']) {
    const base = original();
    const input = { ...base, availability: { ...base.availability, observationHostname: host } };
    let request = '';
    await requestLookupSourceRefresh(plan('availability'), input, 'deep', {
      fetchImpl: async url => { request = String(url); return Response.json({ applicable: true, domain: 'example.test', observationHostname: host }); },
    });
    assert.equal(request, '/api/availability?q=' + host);
    const admitted = await refresh('availability', { applicable: true, domain: 'example.test', observationHostname: host }, input);
    assert.equal(admitted.ok && admitted.value.state, 'limited');
  }
});

test('cancellation, timeout and HTTP failures keep raw errors out of the review', async () => {
  const controller = new AbortController();
  const cancelled = requestLookupSourceRefresh(plan('rdap'), original(), 'deep', {
    signal: controller.signal, fetchImpl: () => new Promise(() => {}),
  });
  controller.abort();
  assert.deepEqual(await cancelled, { ok: false, message: 'Source refresh cancelled. No new observation was retained.' });
  const timedOut = await requestLookupSourceRefresh(plan('rdap'), original(), 'deep', {
    timeoutMs: 1, now: () => NOW, fetchImpl: () => new Promise(() => {}),
  });
  assert.equal(timedOut.ok && timedOut.value.observedAt, null);
  assert.match(timedOut.ok ? timedOut.value.detail : '', /timed out/);
  const failed = await requestLookupSourceRefresh(plan('rdap'), original(), 'deep', {
    now: () => NOW, fetchImpl: async () => Response.json({ error: 'https://private.example/path?token=private-example' }, { status: 503 }),
  });
  assert.ok(failed.ok);
  assert.equal(failed.value.state, 'unavailable');
  assert.doesNotMatch(JSON.stringify(failed), /private-example|private.example/);
});

test('oversized, structurally deep and duplicate-key responses cannot enter refresh history', async () => {
  const bodies = [
    new Response('oversized', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } }),
    new Response('{"query":"example.test","query":"another.test"}'),
    new Response('['.repeat(200) + '0' + ']'.repeat(200)),
  ];
  for (const body of bodies) {
    const result = await requestLookupSourceRefresh(plan('rdap'), original(), 'deep', { fetchImpl: async () => body });
    assert.ok(result.ok);
    assert.equal(result.value.state, 'unavailable');
    assert.deepEqual(result.value.facts, []);
  }
});

test('history does not evict or coalesce earlier valid observations, even with equal request times', async () => {
  const outcome = await refresh('rdap', rdap());
  assert.ok(outcome.ok);
  let ledger: LookupSourceRefreshLedger | null = null;
  for (let index = 0; index < MAX_LOOKUP_SOURCE_REFRESH_HISTORY; index++) {
    ledger = mergeLookupSourceRefreshLedger(ledger, outcome.value);
  }
  assert.equal(ledger?.entries.length, MAX_LOOKUP_SOURCE_REFRESH_HISTORY);
  const before = structuredClone(ledger);
  assert.throws(() => mergeLookupSourceRefreshLedger(ledger, outcome.value), /Existing observations were kept/);
  assert.deepEqual(ledger, before);
});

test('IP and ASN refreshes bind a returned registry range and retain only normalised identifiers', async () => {
  for (const [type, query, parsed] of [
    ['ipv4', '192.0.2.10', { startAddress: '192.0.2.0', endAddress: '192.0.2.255', name: 'Example network' }],
    ['ipv6', '2001:db8::10', { startAddress: '2001:db8::', endAddress: '2001:db8::ffff', name: 'Example network' }],
    ['asn', 'AS64512', { startAutnum: 64512, endAutnum: 64513, name: 'Example network' }],
  ] as const) {
    const input: LookupHttpResponse = { query, type, rdap: {}, whois: {}, availability: {}, diagnostics: {} };
    const body = { query, type, fetchedAt: NOW, upstreamStatus: 200, parsed };
    const accepted = await refresh('rdap', body, input);
    assert.ok(accepted.ok);
    assert.equal(accepted.value.state, 'complete');
    assert.ok(accepted.value.facts.some(fact => fact.value === 'Example network'));
    const mismatched = await refresh('rdap', { ...body, parsed: { ...parsed,
      startAddress: '198.51.100.0', endAddress: '198.51.100.255', startAutnum: 64520, endAutnum: 64521,
    } }, input);
    assert.equal(mismatched.ok && mismatched.value.state, 'unavailable');
  }
});
