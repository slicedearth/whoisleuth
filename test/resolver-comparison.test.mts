import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Writable } from 'node:stream';
import { collectResolverComparison } from '../lib/resolver-comparison.mts';
import { normaliseResolverComparisonRequest, readResolverComparison } from '../packages/evidence/resolver-comparison.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import type { safeFetch } from '../lib/safe-fetch.mts';

const AT = '2026-10-01T00:00:00.000Z';
const HOST = 'child.example.test';
function response(url: string, overrides: Record<string, unknown> = {}) {
  const query = new URL(url);
  const type = query.searchParams.get('type') === 'A' ? 1 : 28;
  return { Status: 0, TC: false, RA: true, AD: false, CD: false,
    Question: [{ name: `${HOST}.`, type }],
    Answer: [{ name: `${HOST}.`, type, TTL: 300, data: type === 1 ? '192.0.2.1' : '2001:db8::1' }], ...overrides };
}
function fixture(change: (url: string, body: ReturnType<typeof response>) => unknown = (_url, body) => body) {
  const calls: Array<{ url: string; redirects: number | undefined }> = [];
  const fetch: typeof safeFetch = async (url, _options, redirects) => {
    calls.push({ url, redirects });
    return Response.json(change(url, response(url)));
  };
  return { calls, dependencies: { fetch, now: () => AT } };
}
const collect = (dependencies: ReturnType<typeof fixture>['dependencies']) => collectResolverComparison(HOST, 'cloudflare,google', {}, dependencies);
function capture() {
  let text = '';
  return { stream: new Writable({ write(value, _encoding, callback) { text += String(value); callback(); } }), value: () => text };
}

test('explicit resolver collection keeps exact-host IPv4 and IPv6 answers and bounded recipients', async () => {
  const { calls, dependencies } = fixture();
  const report = await collect(dependencies);
  assert.deepEqual(report.rows.map(row => [row.type, row.state]), [['A', 'converged'], ['AAAA', 'converged']]);
  assert.equal(report.queries.length, 4);
  assert.ok(report.queries.every(query => query.outcome === 'records' && query.comparisonState === 'observed'));
  assert.equal(calls.length, 4);
  assert.deepEqual(new Set(calls.map(call => new URL(call.url).hostname)), new Set(['cloudflare-dns.com', 'dns.google']));
  assert.ok(calls.every(call => call.redirects === 0 && new URL(call.url).searchParams.get('name') === HOST));
  assert.ok(calls.filter(call => new URL(call.url).hostname === 'dns.google')
    .every(call => new URL(call.url).searchParams.get('edns_client_subnet') === '0.0.0.0/0'));
  assert.deepEqual(readResolverComparison(JSON.parse(JSON.stringify(report)), HOST), report);
  assert.throws(() => readResolverComparison(report, 'example.test'));
});

test('negative, aliased, truncated, failed and malformed answers cannot become empty convergence', async () => {
  const soa = [{ name: 'example.test.', type: 6, TTL: 300, data: 'ns.example.test. hostmaster.example.test. 1 2 3 4 5' }];
  const cases = [
    { override: { Answer: [], Authority: soa }, outcome: 'no_data', state: 'converged' },
    { override: { Answer: [] }, outcome: 'empty_answer', state: 'incomplete' },
    { override: { Status: 3, Answer: [], Authority: soa }, outcome: 'name_not_found', state: 'incomplete' },
    { override: { Status: 2, Answer: [] }, outcome: 'server_failure', state: 'incomplete' },
    { override: { Status: 5, Answer: [] }, outcome: 'refused', state: 'incomplete' },
    { override: { TC: true }, outcome: 'records', state: 'incomplete' },
    { override: { Answer: [{ name: `${HOST}.`, type: 5, TTL: 300, data: 'sibling.example.test.' }], Authority: soa }, outcome: 'empty_answer', state: 'incomplete' },
    { override: { Question: [{ name: 'sibling.example.test.', type: 1 }] }, outcome: 'invalid_response', state: 'incomplete' },
  ];
  for (const item of cases) {
    const { dependencies } = fixture((_url, body) => ({ ...body, ...item.override }));
    const report = await collect(dependencies);
    assert.equal(report.queries[0]?.outcome, item.outcome);
    assert.ok(report.rows.every(row => row.state === item.state));
  }
  const divergent = await collect(fixture((url, body) => new URL(url).hostname === 'dns.google'
    ? { ...body, Answer: body.Answer.map(row => ({ ...row, data: row.type === 1 ? '192.0.2.2' : '2001:db8::2' })) } : body).dependencies);
  assert.ok(divergent.rows.every(row => row.state === 'divergent'));
});

test('IPv6 remains comparable when IPv4 fails; caps, cancellation and invalid selection do not expand collection', async () => {
  const partial = await collect(fixture((url, body) => new URL(url).searchParams.get('type') === 'A'
    ? { ...body, Status: 2, Answer: [] } : body).dependencies);
  assert.deepEqual(partial.rows.map(row => row.state), ['incomplete', 'converged']);
  let calls = 0;
  const bounded = await collectResolverComparison(HOST, 'cloudflare,google', {}, { now: () => AT,
    fetch: async () => { calls++; return new Response('{"padding":"' + 'x'.repeat(70_000) + '"}'); } });
  assert.equal(calls, 4);
  assert.ok(bounded.queries.every(query => query.outcome === 'invalid_response'));
  const failed = await collectResolverComparison(HOST, 'cloudflare,google', {}, { now: () => AT,
    fetch: async () => { throw new Error('private transport detail'); } });
  assert.ok(failed.queries.every(query => query.outcome === 'error'));
  assert.doesNotMatch(JSON.stringify(failed), /private transport detail/u);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(collectResolverComparison(HOST, 'cloudflare,google', { signal: abort.signal }, { fetch: async () => { calls++; throw new Error('must not request'); } }));
  assert.equal(calls, 4);
  for (const [hostname, ids] of [[HOST, 'google,google'], [HOST, 'google,https://resolver.example'], ['https://example.test/private', 'cloudflare,google']]) {
    assert.throws(() => normaliseResolverComparisonRequest(hostname, ids));
  }
});

test('production CLI command uses the collector, valid structured stdout and partial exit without replacing Lookup', async () => {
  for (const healthy of [true, false]) {
    const stdout = capture(); const stderr = capture();
    const { dependencies, calls } = fixture((_url, body) => healthy ? body : { ...body, Answer: [] });
    const code = await runCli(['resolver-compare', HOST, '--resolvers', 'cloudflare,google', '--json'], {
      stdout: stdout.stream, stderr: stderr.stream,
      collectResolverComparison: (hostname, providers, options) => collectResolverComparison(hostname, providers, options, dependencies),
    });
    assert.equal(code, healthy ? EXIT_CODES.SUCCESS : EXIT_CODES.PARTIAL_FAILURE);
    assert.equal(readResolverComparison(JSON.parse(stdout.value())).hostname, HOST);
    assert.equal(calls.length, 4);
    assert.equal(stderr.value(), '');
  }
  const out = capture(); let calls = 0;
  assert.equal(await runCli(['resolver-compare', HOST, '--resolvers', 'google,google', '--quiet'], {
    stdout: out.stream, stderr: capture().stream, collectResolverComparison: async () => { calls++; throw new Error('must not collect'); },
  }), EXIT_CODES.USAGE);
  assert.equal(calls, 0); assert.equal(out.value(), '');
  const quiet = capture();
  assert.equal(await runCli(['resolver-compare', HOST, '--resolvers', 'cloudflare,google', '--quiet'], {
    stdout: quiet.stream, stderr: capture().stream,
    collectResolverComparison: (host, providers, options) => collectResolverComparison(host, providers, options, fixture().dependencies),
  }), EXIT_CODES.SUCCESS);
  assert.equal(quiet.value(), '');
});

test('cancelling an in-flight comparison stops admission instead of emitting a partial success', async () => {
  const controller = new AbortController(); let calls = 0;
  const pending = collectResolverComparison(HOST, 'cloudflare,google', { signal: controller.signal }, {
    now: () => AT,
    fetch: async (_url, options) => {
      calls++;
      if (calls === 2) queueMicrotask(() => controller.abort());
      return new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }));
    },
  });
  await assert.rejects(pending);
  assert.equal(calls, 2);
});
