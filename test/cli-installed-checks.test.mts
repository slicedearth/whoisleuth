import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runCli } from '../cli/runner.mts';
import { createInstalledCliRunner, type RunInstalledCli } from '../tools/installed-cli-check.mts';
import { checkInstalledCliDiscovery } from '../tools/cli-discovery-package-check.mts';
import { checkInstalledCliEvidence } from '../tools/cli-evidence-package-check.mts';
import { checkInstalledCliWorkflows } from '../tools/cli-workflow-package-check.mts';
import { checkInstalledCliIncidents } from '../tools/cli-incident-package-check.mts';
import { boundedSafeRelativePath, boundedUnpaddedText } from '../tools/maintainer-tool-helpers.mts';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

test('installed check evidence records actual completed invocations, not declared coverage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'installed-check-runner-'));
  try {
    const executable = join(directory, 'fixture.mjs');
    await writeFile(executable, "process.stdout.write(process.argv[2]); process.stderr.write(process.argv[3]); process.exitCode = Number(process.argv[4]);");
    const runner = createInstalledCliRunner(executable);
    assert.deepEqual(runner.completed(), []);
    assert.equal(await runner.run(['value', '', '0'], 'ordinary output'), 'value');
    const snapshot = runner.completed();
    await assert.rejects(runner.run(['', '', '1'], 'unexpected exit'));
    await assert.rejects(runner.run(['', 'unexpected', '0'], 'unexpected diagnostics'));
    await assert.rejects(runner.run(['', '', '0'], 'missing refusal', 2));
    assert.deepEqual(runner.completed(), ['ordinary output']);
    assert.equal(await runner.run(['review', 'Expected refusal\n', '2'], 'deliberate refusal', 2, /^Expected refusal\n$/u), 'review');
    assert.deepEqual(runner.completed(), ['ordinary output', 'deliberate refusal']);
    assert.deepEqual(snapshot, ['ordinary output']);
    assert.ok(Object.isFrozen(snapshot));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('package paths are admitted independently of the host operating system', () => {
  assert.equal(boundedSafeRelativePath('packages/example/helper.mjs', 'Source'), 'packages/example/helper.mjs');
  for (const value of ['/absolute', '../escape', 'C:/absolute', 'C:\\absolute', '//server/share', 'part/../escape', 'a\u0000b']) {
    assert.throws(() => boundedSafeRelativePath(value, 'Source'), /safe relative path/u);
  }
  assert.equal(boundedUnpaddedText('value', 'Name', 5), 'value');
  for (const value of ['', ' value', 'value ', 'larger', null]) assert.throws(() => boundedUnpaddedText(value, 'Name', 5));
});

const packets = [
  { name: 'discovery', run: (directory: string, run: RunInstalledCli) => checkInstalledCliDiscovery(directory, version, run),
    label: 'doctor', corrupt: (value: any) => { value.networkRequested = true; }, expected: /Installed offline doctor/u },
  { name: 'evidence', run: (directory: string, run: RunInstalledCli) => checkInstalledCliEvidence(root, directory, run),
    label: 'evidence package verification', corrupt: (value: any) => { value.package.entries[1].byteLength = 9; }, expected: /Installed package round trip/u },
  { name: 'workflows', run: (directory: string, run: RunInstalledCli) => checkInstalledCliWorkflows(root, directory, run),
    label: 'offline handoff completion', corrupt: (value: any) => { value.networkApprovedForThisRun = true; }, expected: /Installed handoff did not finish offline/u },
  { name: 'incidents', run: (directory: string, run: RunInstalledCli) => checkInstalledCliIncidents(root, directory, version, run),
    label: 'incident pack internal', corrupt: (value: any) => { value.cases[1].id = value.cases[0].id; }, expected: /Installed incident pack lost Case identity/u },
];

for (const packet of packets) test(`installed ${packet.name} checks preserve independent expectations`, async context => {
  for (const corrupt of [false, true]) await context.test(corrupt ? 'rejects changed behaviour' : 'accepts the offline workflow', async () => {
    const directory = await mkdtemp(join(tmpdir(), `installed-${packet.name}-`));
    let corrupted = false;
    try {
      const deny = () => { throw new Error('Package check attempted a network operation.'); };
      const task = packet.run(directory, async (args, label, expected = 0, diagnostics) => {
        let stdout = '', stderr = '';
        const code = await runCli(args, {
          stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
          runUnifiedLookup: deny, safeFetch: deny, resolvePublicAddresses: deny,
          whoisQuery: deny, fetchHomepage: deny, collectTlsIntelligence: deny,
        });
        assert.equal(code, expected, stderr);
        if (diagnostics) assert.match(stderr, diagnostics); else assert.equal(stderr, '');
        if (corrupt && label === packet.label) {
          const value = JSON.parse(stdout);
          packet.corrupt(value); corrupted = true;
          return JSON.stringify(value);
        }
        return stdout;
      });
      if (corrupt) { await assert.rejects(task, packet.expected); assert.equal(corrupted, true); }
      else await task;
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
