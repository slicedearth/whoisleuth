import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSelectedLookupUrl, validLookupObservationScope } from '../packages/evidence/lookup-target.mts';
import { MAX_OUTBOUND_HTTP_URL_CHARACTERS } from '../packages/contracts/http-url.mts';
import { checkDomainAvailability, fetchHomepage } from '../lib/availability.mts';
import { skippedDnsIntelligence } from '../lib/dns-intelligence.mts';
import { skippedTlsObservation } from '../lib/tls-intelligence.mts';
import { networkFeaturePolicy } from '../lib/feature-policy.mts';
import { MAX_LOOKUP_SELECTION_BODY_BYTES, parseLookupWebSelection } from '../lib/lookup-selected-request.mts';
import { classifyQuery } from '../lib/classify.mts';
import { runUnifiedLookup } from '../lib/lookup.mts';
import { requestLookup } from '../lib/lookup-request.mts';
import { compareCaseEvidence, normalizeSnapshot } from '../packages/cases/case-evidence-model.mts';

const HOST = 'portal.example.test';
const URL_INPUT = `https://${HOST}/selected/path?a=private-example#local-fragment`;

test('selected URL admission is explicit, bounded and never expands to a different host or port', () => {
  assert.equal(prepareSelectedLookupUrl(URL_INPUT, HOST), `https://${HOST}/selected/path?a=private-example`);
  for (const input of ['example.test/path', `https://${HOST}:8443/path`, `https://name:secret@${HOST}/path`,
    'https://other.test/path', 'https://127.1/', 'https://[::1]/', `https://${HOST}\\path`, `https://${HOST}/\npath`,
    `https://${HOST}/${'a'.repeat(MAX_OUTBOUND_HTTP_URL_CHARACTERS)}`]) {
    assert.throws(() => prepareSelectedLookupUrl(input, HOST));
  }
});

test('a selected URL has one bounded attempt and cannot fall back to HTTP or the homepage', async () => {
  const calls: string[] = [];
  const result = await fetchHomepage(HOST, { selectedUrl: URL_INPUT, fetcher: async (url) => {
    calls.push(url); throw new Error(`Synthetic request failure at ${url}`);
  } });
  assert.deepEqual(calls, [`https://${HOST}/selected/path?a=private-example`]);
  assert.equal(result.status, 'inconclusive');
  assert.equal(result.http.requestUrl, `https://${HOST}/selected/path`);
  assert.doesNotMatch(JSON.stringify(result), /private-example|local-fragment/);
});

test('explicit page collection does not disappear behind early registration outcomes or change their authority', async () => {
  for (const [rdapRecord, expected] of [
    [{ upstreamStatus: 404 }, 'available'],
    [null, 'unknown'],
    [{ upstreamStatus: 200, parsed: { statuses: ['redemption period'], nameservers: [] } }, 'expiring'],
    [{ upstreamStatus: 200, parsed: { statuses: ['active'], nameservers: [] } }, 'registered'],
  ] as const) {
    const calls: string[] = [];
    const result = await checkDomainAvailability('example.test', {
      observationHostname: HOST, selectedUrl: URL_INPUT, rdapRecord, whoisChain: [], dnsDelegation: null,
      featurePolicy: networkFeaturePolicy({}),
      collectDnsIntelligence: async () => skippedDnsIntelligence('Synthetic fixture'),
      collectTlsIntelligence: async () => skippedTlsObservation(),
      fetchFaviconHash: async () => null,
      fetchHomepage: async (host, options) => fetchHomepage(host, { ...options, fetcher: async (url) => {
        calls.push(url); return new Response('<title>Example selected page</title><p>This domain is for sale</p>', { headers: { 'Content-Type': 'text/html' } });
      } }),
    });
    assert.equal(result.state, expected);
    assert.deepEqual(calls, [`https://${HOST}/selected/path?a=private-example`]);
    assert.ok('webObservationMode' in result);
    assert.equal(result.webObservationMode, 'selected_url');
    assert.ok(result.http && typeof result.http === 'object');
    assert.equal(Reflect.get(result.http, 'requestUrl'), `https://${HOST}/selected/path`);
    assert.doesNotMatch(JSON.stringify(result), /private-example|local-fragment/);
    assert.ok(validLookupObservationScope(result, { inputHostname: HOST, registrableDomain: 'example.test' }));
  }
});

test('incompatible exact URL requests fail before any registration work', async () => {
  let calls = 0;
  for (const options of [{ fast: true }, { compact: true }, { featurePolicy: networkFeaturePolicy({ WHOISLEUTH_DISABLE_WEBSITE_PROBE: '1' }) }]) {
    await assert.rejects(() => runUnifiedLookup(classifyQuery(HOST), {
      ...options, selectedUrl: URL_INPUT, fetchRdapRecord: async () => { calls += 1; return null; },
    }), /full Deep/);
  }
  assert.equal(calls, 0);
});

test('both HTTP runtimes share bounded POST admission without promoting GET bodies to URL authorisation', () => {
  const request = { method: 'POST', contentType: 'application/json', body: JSON.stringify({ url: URL_INPUT }),
    classified: classifyQuery(HOST), fast: false, compact: false, featurePolicy: networkFeaturePolicy({}) };
  assert.deepEqual(parseLookupWebSelection(request), { ok: true, selectedUrl: `https://${HOST}/selected/path?a=private-example` });
  assert.deepEqual(parseLookupWebSelection({ ...request, method: 'GET' }), { ok: true });
  assert.deepEqual(parseLookupWebSelection({ ...request, body: Buffer.from(request.body).toString('base64'), base64: true }), parseLookupWebSelection(request));
  for (const change of [{ method: 'PUT' }, { fast: true }, { compact: true }, { body: '{}' }, { body: '"x"' },
    { body: JSON.stringify({ url: URL_INPUT, extra: true }) }, { body: '[' }, { contentType: 'text/plain' },
    { body: 'a'.repeat(MAX_LOOKUP_SELECTION_BODY_BYTES + 1) }, { body: '====', base64: true },
    { body: JSON.stringify({ url: 'https://other.test/' }) },
    { body: `{"url":"https://${HOST}/one","url":"https://${HOST}/two"}` },
    { body: JSON.stringify({ url: { url: URL_INPUT } }) }]) {
    assert.equal(parseLookupWebSelection({ ...request, ...change }).ok, false);
  }
});

test('the browser sends a deliberate URL in the body only and never repeats the request on failure', async () => {
  let calls = 0;
  const outcome = await requestLookup('/api/lookup?q=portal.example.test', {
    selectedUrl: URL_INPUT, fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(url, '/api/lookup?q=portal.example.test');
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), { url: `https://${HOST}/selected/path?a=private-example` });
      assert.doesNotMatch(String(init?.body), /local-fragment/);
      return new Response('{}', { status: 503 });
    },
  });
  assert.equal(outcome.ok, false);
  assert.equal(calls, 1);
});

test('compact Case comparisons keep registration and DNS separate from an unknown selected page identity', () => {
  const make = (extra: Record<string, unknown>) => normalizeSnapshot({ inputHostname: HOST, observationHostname: HOST,
    scanDepth: 'deep', capturedAt: '2026-09-01T00:00:00.000Z', registrar: 'Earlier registrar', hasMx: false,
    pageTitle: 'Earlier page', ...extra }, { caseDomain: 'example.test' });
  const before = make({});
  const after = make({ webObservationMode: 'selected_url', pageTitle: 'Different page', hasMx: true, registrar: 'Later registrar' });
  assert.ok(before && after);
  assert.equal(after.webObservationMode, 'selected_url');
  const changed = compareCaseEvidence(before, after).map((item) => item.field);
  assert.ok(changed.includes('hasMx') && changed.includes('registrar'));
  assert.ok(!changed.includes('pageTitle'));
  assert.equal(make({ webObservationMode: 'invalid' }), null);
});
