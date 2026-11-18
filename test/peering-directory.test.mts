import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Writable } from 'node:stream';
import { collectPeeringDirectory } from '../lib/peering-directory.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

const AT = '2026-10-01T00:00:00.000Z';
const NETWORK = { id: 123, asn: 64496, name: 'Example research network', info_scope: 'Regional', policy_general: 'Selective',
  status: 'ok', updated: '2026-09-01T00:00:00.000Z', poc_set: [{ email: 'private@example.test' }], notes: 'private note' };
const collect = (body: unknown) => collectPeeringDirectory('AS64496', { permittedUse: true }, {
  now: () => AT, fetch: async () => Response.json(body),
});
function capture() {
  let text = '';
  return { stream: new Writable({ write(value, _encoding, callback) { text += String(value); callback(); } }), value: () => text };
}

test('single-ASN directory context is source-qualified, minimal and request-bounded', async () => {
  const calls: string[] = [];
  const result = await collectPeeringDirectory('as064496', { permittedUse: true }, {
    now: () => AT, fetch: async (url, options, redirects) => {
      calls.push(url); assert.equal(redirects, 0);
      assert.equal(new Headers(options?.headers).has('authorization'), false);
      return Response.json({ data: [NETWORK] });
    },
  });
  assert.equal(result.state, 'listed'); assert.equal(result.asn, 'AS64496');
  assert.equal(result.network?.name, NETWORK.name); assert.equal(result.network?.updatedAt, NETWORK.updated);
  assert.equal(result.observedAt, AT); assert.equal(calls.length, 1);
  const request = new URL(calls[0]!);
  assert.equal(request.origin + request.pathname, 'https://www.peeringdb.com/api/net');
  assert.equal(request.searchParams.get('asn'), '64496');
  assert.equal(request.searchParams.get('depth'), '0'); assert.equal(request.searchParams.get('limit'), '2');
  assert.doesNotMatch(request.searchParams.get('fields')!, /poc|contact|notes|website/u);
  assert.doesNotMatch(JSON.stringify(result), /private|poc_set|notes/u);
  const unknown = await collect({ data: [{ id: 123, asn: 64496, name: 'Example network', status: 'ok' }] });
  assert.equal(unknown.state, 'listed'); assert.equal(unknown.network?.scope, null); assert.equal(unknown.network?.updatedAt, null);
});

test('missing directory entries remain distinct from failed, ambiguous and mismatched results', async () => {
  assert.equal((await collect({ data: [] })).state, 'not_listed');
  for (const body of [{ data: [NETWORK, NETWORK] }, { data: [{ ...NETWORK, asn: 64497 }] },
    { data: [{ ...NETWORK, status: 'deleted' }] }, { data: [{ ...NETWORK, updated: 'yesterday' }] },
    { data: [{ ...NETWORK, name: 'x'.repeat(301) }] }, { message: 'private error' }]) {
    const result = await collect(body);
    assert.equal(result.state, 'unavailable'); assert.equal(result.failure, 'invalid_response'); assert.equal(result.network, null);
  }
  for (const [response, expected] of [[new Response('private error', { status: 429 }), 'http_error'],
    [new Response('x'.repeat(33 * 1024)), 'invalid_response'], [new Response('{"data":[],"data":[]}'), 'invalid_response']] as const) {
    const result = await collectPeeringDirectory('AS64496', { permittedUse: true }, { now: () => AT, fetch: async () => response });
    assert.equal(result.failure, expected); assert.equal(result.state, 'unavailable');
    assert.doesNotMatch(JSON.stringify(result), /private error/u);
  }
});

test('permission, ASN admission and cancellation fail before any new request', async () => {
  let requests = 0;
  const dependencies = { fetch: async () => { requests++; throw new Error('private transport detail'); }, now: () => AT };
  await assert.rejects(collectPeeringDirectory('AS64496', { permittedUse: false }, dependencies));
  for (const value of ['example.test', 'AS4294967296', 'https://directory.example/AS64496', 'AS64496,AS64497']) {
    await assert.rejects(collectPeeringDirectory(value, { permittedUse: true }, dependencies));
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(collectPeeringDirectory('AS64496', { permittedUse: true, signal: controller.signal }, dependencies));
  assert.equal(requests, 0);
  const failed = await collectPeeringDirectory('AS64496', { permittedUse: true }, dependencies);
  assert.equal(failed.failure, 'transport_error'); assert.equal(requests, 1);
  assert.doesNotMatch(JSON.stringify(failed), /private transport detail/u);
});

test('real CLI command preserves the one-request opt-in and refuses persistence options', async () => {
  let requests = 0;
  const stdout = capture(); const stderr = capture();
  const dependencies = { stdout: stdout.stream, stderr: stderr.stream,
    collectPeeringDirectory: (asn: unknown, options: Parameters<typeof collectPeeringDirectory>[1]) => collectPeeringDirectory(asn, options, {
      now: () => AT, fetch: async () => { requests++; return Response.json({ data: [NETWORK] }); },
    }) };
  for (const args of [['peeringdb-context', 'AS64496'], ['peeringdb-context', 'AS64496', '--permitted-use', '--output', 'context.json'],
    ['peeringdb-context', 'AS64496', '--permitted-use', '--json']]) {
    assert.equal(await runCli(args, dependencies), EXIT_CODES.USAGE);
  }
  assert.equal(requests, 0); assert.equal(stdout.value(), '');
  assert.equal(await runCli(['peeringdb-context', 'AS64496', '--permitted-use'], dependencies), EXIT_CODES.SUCCESS);
  assert.equal(requests, 1); assert.match(stdout.value(), /Example research network/u);
  assert.doesNotMatch(stdout.value(), /private@example\.test|private note/u);
  const quiet = capture();
  assert.equal(await runCli(['peeringdb-context', 'AS64496', '--permitted-use', '--quiet'], {
    ...dependencies, stdout: quiet.stream,
    collectPeeringDirectory: (asn, options) => collectPeeringDirectory(asn, options, { now: () => AT,
      fetch: async () => { throw new Error('private transport detail'); } }),
  }), EXIT_CODES.PARTIAL_FAILURE);
  assert.equal(quiet.value(), '');
});
