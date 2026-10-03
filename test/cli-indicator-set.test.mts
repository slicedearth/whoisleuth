import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { runCli } from '../cli/runner.mts';
import { cliInvocationNetworkEffect } from '../cli/command-reference.mts';
import { parseCliArguments } from '../cli/arguments.mts';
import { readManagedIndicatorSet } from '../packages/interchange/managed-indicator-set.mts';
import { buildInterchangeFidelityReport } from '../cli/interchange-report.mts';

const NOW = '2026-09-23T00:00:00.000Z';
async function invoke(args: string[], input?: string, now = NOW) {
  let stdout = '', stderr = '', requests = 0, reads = 0;
  const denied = () => { requests++; throw new Error('Offline command attempted collection'); };
  const code = await runCli(args, { stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } }, now: () => now,
    ...(input === undefined ? {} : { readArtifactInput: async () => { reads++; return input; } }), runUnifiedLookup: denied, safeFetch: denied, resolvePublicAddresses: denied,
    whoisQuery: denied, fetchHomepage: denied, collectTlsIntelligence: denied });
  assert.equal(requests, 0); return { code, stdout, stderr, reads };
}

test('indicator grammar and installed-style offline operations retain native revisions', async context => {
  for (const operation of ['revise', 'inspect', 'stix', 'misp']) {
    assert.equal(cliInvocationNetworkEffect('indicator-set', [operation, 'selected.json']), 'offline');
    assert.equal(parseCliArguments(['indicator-set', operation, 'selected.json']).action, 'indicator-set');
  }
  assert.throws(() => parseCliArguments(['indicator-set', 'publish', 'selected.json']));
  const root = await mkdtemp(join(tmpdir(), 'whoisleuth-indicator-test-')); context.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'plan.json'), output = join(root, 'revision.json');
  await writeFile(input, JSON.stringify({ name: 'Selected candidates', basis: 'Reviewed locally', expiresAt: '2026-10-23T00:00:00.000Z', selectedDomains: ['candidate.example.test'],
    rows: [{ domain: 'candidate.example.test', availability: 'registered', risk: 80, analystDisposition: 'suspicious', profileContext: { sourceState: 'ready' }, raw: 'PRIVATE-RAW-CANARY' }] }));
  const before = await readFile(input, 'utf8');
  const result = await invoke(['indicator-set', 'revise', input, '--json', '--output', output]);
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, '');
  const raw = await readFile(output, 'utf8'), manifest = await readManagedIndicatorSet(JSON.parse(raw));
  assert.doesNotMatch(raw, /PRIVATE-RAW-CANARY/); assert.equal(await readFile(input, 'utf8'), before);
  const show = await invoke(['indicator-set', 'inspect', output]); assert.equal(show.code, 0, show.stderr); assert.match(show.stdout, /revision 1/);
  for (const operation of ['stix', 'misp']) {
    const exported = await invoke(['indicator-set', operation, output]); assert.equal(exported.code, 0, exported.stderr);
    const document = JSON.parse(exported.stdout);
    if (operation === 'stix') assert.ok(document.objects.some((item: { id: string }) => item.id === `indicator--${manifest.entries[0]!.id}`));
    else assert.equal(document.Event.Attribute[0].uuid, manifest.entries[0]!.id);
  }
  assert.equal((await invoke(['verify-artifact', output, '--json', '--strict-exit'])).code, 0);
  const fidelity = await buildInterchangeFidelityReport(raw); assert.equal(fidelity.recognised, true); assert.equal(fidelity.verification.assuranceSatisfied, true);
  const overwrite = await invoke(['indicator-set', 'inspect', output, '--json', '--output', output, '--force']);
  assert.notEqual(overwrite.code, 0); assert.match(overwrite.stderr, /different path/); assert.equal(await readFile(output, 'utf8'), raw);
  assert.ok((await readdir(root)).every(name => !name.endsWith('.workflow.lock') && !name.endsWith('.tmp')));
});

test('malformed and future indicator files fail without success output or collection', async () => {
  const fixture = await readFile(new URL('./fixtures/extracted-domain-lifecycle/managed-indicator-set-v1.json', import.meta.url), 'utf8');
  for (const raw of ['{}', '{"schema":1,"schema":2}', JSON.stringify({ ...JSON.parse(fixture), version: 999 }), fixture.replace('Synthetic reviewed indicators', 'Changed without a digest')]) {
    const result = await invoke(['indicator-set', 'inspect', '--json'], raw);
    assert.equal(result.reads, 1); assert.notEqual(result.code, 0); assert.equal(result.stdout, ''); assert.ok(result.stderr.length > 0);
  }
});

test('the documented indicator plan is executable offline rather than a guessed input shape', async () => {
  const documentation = await readFile(new URL('../docs/cli.md', import.meta.url), 'utf8');
  const section = documentation.split('### Managed indicator revisions')[1]!.split('### Formats and exit behaviour')[0]!;
  const example = section.match(/```json\n([\s\S]+?)\n```/u)?.[1];
  assert.ok(example);
  const result = await invoke(['indicator-set', 'revise', '--json'], example);
  assert.equal(result.reads, 1);
  assert.equal(result.code, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.entries[0].domain, 'candidate.example.test');
  assert.equal(manifest.entries[0].observation.observedAt, null);
});
