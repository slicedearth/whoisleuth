import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assertNoBrowserServerEgress from '../tools/browser-server-egress-report.mts';
import { resolvePlaywrightExecutionContract } from '../tools/playwright-execution-contract.mts';
import { playwrightRunArtifacts } from '../tools/playwright-run-artifacts.mts';

const guard = new URL('../tools/browser-server-egress-guard.mts', import.meta.url).href;
// Independent denial below the guard ensures even a regressed guard cannot
// cause this test to contact an external service. Its distinct exit is failure.
const fallback = `
  import dns from 'node:dns';
  import dnsPromises from 'node:dns/promises';
  import dgram from 'node:dgram';
  import net from 'node:net';
  import { syncBuiltinESMExports } from 'node:module';
  const unexpected = () => process.exit(87);
  globalThis.fetch = unexpected;
  net.Socket.prototype.connect = unexpected;
  dgram.Socket.prototype.connect = unexpected;
  dgram.Socket.prototype.send = unexpected;
  for (const owner of [dns, dnsPromises, dns.Resolver.prototype, dnsPromises.Resolver.prototype]) {
    for (const key of Object.getOwnPropertyNames(owner)) {
      if (/^(lookup|resolve|reverse)/u.test(key)) Reflect.set(owner, key, unexpected);
    }
  }
  syncBuiltinESMExports();
`;

test('every browser-server transport fails closed and leaves a named target-free diagnostic', async (context) => {
  const probes = [
    ['fetch', `fetch('https://127.0.0.1/private-fixture?hidden=value')`],
    ['http.get', `(await import('node:http')).get('http://127.0.0.1/private-fixture')`],
    ['https.request', `(await import('node:https')).request('https://127.0.0.1/')`],
    ['net.connect', `(await import('node:net')).connect({host:'127.0.0.1',port:9})`],
    ['net.createConnection', `(await import('node:net')).createConnection({host:'127.0.0.1',port:9})`],
    ['net.Socket.connect', `new (await import('node:net')).Socket().connect({host:'127.0.0.1',port:9})`],
    ['tls.connect', `(await import('node:tls')).connect({host:'127.0.0.1',port:9})`],
    ['dns.lookup', `(await import('node:dns')).lookup('localhost',()=>{})`],
    ['dns.promises.resolve4', `(await import('node:dns/promises')).resolve4('localhost')`],
    ['dns.Resolver.resolveTxt', `new (await import('node:dns')).Resolver().resolveTxt('localhost',()=>{})`],
    ['dns.promises.Resolver.resolveMx', `new (await import('node:dns/promises')).Resolver().resolveMx('localhost')`],
    ['dgram.Socket.connect', `(await import('node:dgram')).createSocket('udp4').connect(9,'127.0.0.1')`],
    ['dgram.Socket.send', `(await import('node:dgram')).createSocket('udp4').send('fixture',9,'127.0.0.1')`],
  ] as const;
  for (const [expected, operation] of probes) {
    const root = mkdtempSync(path.join(tmpdir(), 'whoisleuth-test-egress-'));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      `${fallback}\nawait import(${JSON.stringify(guard)});\n${operation};`], {
      cwd: root, env: process.env, encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 86, `${expected}: ${child.stderr}`);
    assert.match(child.stderr, /Unexpected collector request/u);
    assert.equal(readFileSync(path.join(root, playwrightRunArtifacts().testResults, 'server-egress.txt'), 'utf8'), `${expected}\n`);
    assert.doesNotMatch(child.stderr, /private-fixture|hidden=value|127\.0\.0\.1/u);
    await assert.rejects(assertNoBrowserServerEgress({ configFile: path.join(root, 'playwright.config.ts') }), /Unexpected collector request/u);
  }
});

test('worker processes inherit server denial and cannot hide violations from final teardown', async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'whoisleuth-worker-egress-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const source = `
    import http from 'node:http';
    import { Worker } from 'node:worker_threads';
    let requests = 0;
    const server = http.createServer((request, response) => { requests += 1; response.end('local fixture'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const target = 'http://127.0.0.1:' + server.address().port + '/';
    const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent('await fetch(' + JSON.stringify(target) + ');')));
    const exit = await new Promise((resolve, reject) => { worker.once('exit', resolve); worker.once('error', reject); });
    await new Promise(resolve => server.close(resolve));
    console.log(JSON.stringify({exit, requests}));
  `;
  const child = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e', source], {
    cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { exit: 86, requests: 0 });
  await assert.rejects(assertNoBrowserServerEgress({ configFile: path.join(root, 'playwright.config.ts') }), /Unexpected collector request/u);
});

test('all browser launch modes retain the independent server guard and teardown', () => {
  for (const environment of [{}, { CI: '1' }, { WHOISLEUTH_E2E_USE_BUILD: '1' }]) {
    const contract = resolvePlaywrightExecutionContract(environment);
    assert.match(contract.serverCommand, /node --import \.\/tools\/browser-server-egress-guard\.mts server\.mts$/u);
    assert.equal(path.basename(contract.serverEgressTeardown), 'browser-server-egress-teardown.cts');
    assert.equal(path.resolve(contract.serverWorkingDirectory, 'tools', 'browser-server-egress-teardown.cts'), contract.serverEgressTeardown);
    assert.equal(contract.serverCommand.startsWith('npm run build && '), !contract.useExistingBuild);
  }
});

test('an unwritable diagnostic fails the owned server closed, including violations in a worker', async (context) => {
  for (const worker of [false, true]) {
    const root = mkdtempSync(path.join(tmpdir(), 'whoisleuth-egress-record-failure-'));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    const report = path.join(root, playwrightRunArtifacts().testResults, 'server-egress.txt');
    mkdirSync(path.dirname(report), { recursive: true });
    mkdirSync(report);
    // A directory where a regular marker belongs reproduces a write failure
    // without depending on the platform's privilege or permission semantics.
    writeFileSync(path.join(report, 'fixture'), 'not a report');
    const operation = `await fetch('http://127.0.0.1:9/');`;
    const source = worker ? `
      import { Worker } from 'node:worker_threads';
      const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(${JSON.stringify(operation)})));
      worker.on('error', () => {});
      await new Promise(resolve => worker.once('exit', resolve));
      process.exit(0);
    ` : operation;
    const child = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e', source], {
      cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024,
    });
    assert.ifError(child.error);
    if (worker) assert.equal(child.signal, 'SIGTERM', child.stderr);
    else assert.equal(child.status, 86, child.stderr);
    assert.match(child.stderr, /diagnostic could not be retained/u);
  }
});
