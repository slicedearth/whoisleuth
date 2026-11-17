import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough, Writable } from 'node:stream';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { runCli } from '../cli/runner.mts';
import { buildCliLookupDocument, serializeCliLookupDocument } from '../cli/saved-lookup.mts';
import { classifyQuery } from '../lib/classify.mts';
import { MAX_MCP_MESSAGE_BYTES } from '../packages/contracts/local-tool-adapter.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

const NOW = '2026-11-01T00:00:00.000Z';
function observation(address: string, at: string) {
  return serializeCliLookupDocument(buildCliLookupDocument('example.test', classifyQuery('example.test'), {
    rdap: { data: { publication: 'private-registry-payload' }, parsed: { registrar: { name: 'Example Registrar' },
      entitiesByRole: { registrant: [{ email: 'private-contact@example.test' }] } } },
    whois: { chain: [{ response: 'private-whois-publication' }] },
    availability: { domain: 'example.test', observationHostname: 'portal.example.test', state: 'registered',
      pageTitle: 'private-page-text', dns: { status: 'success', records: { a: [address] } } },
    diagnostics: { rdap: { status: 'success' }, whois: { status: 'success' } },
  }, at, 'deep'));
}

function session(inputs: Record<string, string>) {
  const input = new PassThrough();
  const waiting = new Map<number, (value: Record<string, any>) => void>();
  let stderr = '', protocolText = '', pending = '', sequence = 0;
  const output = new Writable({ write(chunk, _encoding, done) {
    protocolText += chunk; pending += chunk;
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const response = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
      const waiter = waiting.get(response.id); waiting.delete(response.id); waiter?.(response);
    }
    done();
  } });
  const running = runCli(['mcp', '--stdio', '--allow-model-disclosure', ...Object.keys(inputs)], {
    stdin: input, stdout: output, stderr: new Writable({ write(chunk, _encoding, done) { stderr += chunk; done(); } }),
    now: () => NOW, readDiffInput: source => inputs[source]!,
    runUnifiedLookup: () => assert.fail('MCP cannot collect'),
  });
  const request = (method: string, params: Record<string, unknown> = {}) => new Promise<Record<string, any>>(resolve => {
    const id = ++sequence; waiting.set(id, resolve);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return { input, running, request, stderr: () => stderr, protocolText: () => protocolText,
    initialise: () => request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'offline-test', version: '1' } }),
    call: async (name: string, args: Record<string, unknown> = {}) => (await request('tools/call', { name, arguments: args })).result,
  };
}

test('real CLI stdio inspects frozen selected evidence, compares and plans without networking, private fields or writes', { timeout: 20_000 }, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  t.mock.method(net.Socket.prototype, 'connect', () => assert.fail('Offline MCP attempted a connection'));
  t.mock.method(globalThis, 'fetch', () => assert.fail('Offline MCP attempted fetch'));
  const files = { 'left.json': observation('192.0.2.10', '2026-10-30T00:00:00.000Z'),
    'right.json': observation('192.0.2.20', '2026-10-31T00:00:00.000Z') };
  const original = files['left.json'];
  const server = session(files);
  t.after(() => server.input.end());
  assert.equal((await server.initialise()).result.serverInfo.name, 'whoisleuth-evidence');
  const listed = JSON.parse((await server.call('list_evidence')).content[0].text);
  assert.equal(listed.evidence.length, 2);
  assert.equal(listed.evidence[0].digestSha256, createHash('sha256').update(original).digest('hex'));
  files['left.json'] = 'changed after selection';
  const inspected = JSON.parse((await server.call('inspect_evidence', { id: 'evidence-1' })).content[0].text);
  assert.equal(inspected.observationHostname, 'portal.example.test');
  assert.equal(inspected.observedAt, '2026-10-30T00:00:00.000Z');
  const rows: Record<string, unknown>[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const result = await server.call('compare_observations', { leftId: 'evidence-1', rightId: 'evidence-2', offset });
    assert.notEqual(result.isError, true);
    const comparison = JSON.parse(result.content[0].text); rows.push(...comparison.rows); offset = comparison.projection.nextOffset;
  }
  assert.ok(rows.some(row => row.category === 'dns' && row.state === 'different'
    && String(row.left).includes('192.0.2.10') && String(row.right).includes('192.0.2.20')));
  const plan = JSON.parse((await server.call('plan_collection', { id: 'evidence-1', mode: 'deep' })).content[0].text);
  assert.equal(plan.planning.networkRequestsMade, false);
  assert.equal(plan.target.query, 'portal.example.test');
  const invalid = await server.call('inspect_evidence', { id: 'evidence-1', path: '/unselected.json' });
  assert.equal(invalid.isError, true);
  assert.equal((await server.call('inspect_evidence', { id: 'evidence-8' })).isError, true);
  assert.ok((await server.request('tools/call', { name: 'lookup', arguments: { target: 'example.test' } })).error);
  const verified = JSON.parse((await server.call('verify_evidence', { id: 'evidence-1' })).content[0].text);
  assert.equal(verified.artifact.kind, 'saved_lookup');
  assert.equal(verified.state, 'structure_valid');
  server.input.end();
  assert.equal(await server.running, EXIT_CODES.SUCCESS, server.stderr());
  assert.doesNotMatch(server.protocolText(), /private-registry-payload|private-contact|private-whois-publication|private-page-text|left\.json|right\.json/u);
});

test('MCP requires startup disclosure and rejects redirected or stdin selection before reading evidence', async () => {
  for (const argv of [ ['mcp', '--stdio', 'input.json'], ['mcp', '--stdio', '--allow-model-disclosure', '-'],
    ['mcp', '--stdio', '--allow-model-disclosure', 'input.json', '--output', 'result.json'] ]) {
    const code = await runCli(argv, { stdout: new PassThrough(), stderr: new PassThrough(),
      readDiffInput: () => assert.fail('Invalid MCP startup must not read files') });
    assert.equal(code, EXIT_CODES.USAGE);
  }
});

test('MCP closes on an oversized protocol frame without retaining or echoing it', { timeout: 20_000 }, async t => {
  const server = session({ 'selected.json': observation('192.0.2.10', NOW) });
  t.after(() => server.input.end());
  await server.initialise();
  server.input.write('x'.repeat(MAX_MCP_MESSAGE_BYTES + 1));
  assert.equal(await server.running, EXIT_CODES.LOOKUP_FAILED);
  assert.doesNotMatch(server.protocolText(), /xxxxx/u);
  assert.match(server.stderr(), /over-bound message/u);
});
