import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseCliArguments } from '../cli/arguments.mts';
import { formatOfflineArtifactVerification, verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { cliInvocationNetworkEffect, isCliCommand } from '../cli/command-reference.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { buildWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { encryptWorkspaceArchive } from '../packages/workspace/workspace-archive-crypto.mts';

const NOW = '2026-09-23T00:00:00.000Z';
const PASSPHRASE = 'synthetic archive passphrase';
const PRIVATE_FILENAME = './private directory/$(untrusted-name).json';

async function invoke(argv: string[], raw: string, passphrase = PASSPHRASE) {
  let stdout = '', stderr = '', requests = 0, inputReads = 0, passphraseReads = 0;
  const denied = () => { requests += 1; throw new Error('Offline follow-up attempted collection.'); };
  const read = async () => { inputReads += 1; return raw; };
  const code = await runCli(argv, {
    stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
    now: () => NOW, readArtifactInput: read, readSourceReliabilityInput: read, caseFileInput: raw,
    readPassphraseFile: async () => { passphraseReads += 1; return passphrase; },
    runUnifiedLookup: denied, safeFetch: denied, resolvePublicAddresses: denied,
    whoisQuery: denied, fetchHomepage: denied, collectTlsIntelligence: denied,
  });
  assert.equal(requests, 0);
  return { code, stdout, stderr, inputReads, passphraseReads };
}

function suggestions(output: string): string[][] {
  return output.split('\n').filter(line => line.startsWith('  whoisleuth '))
    .map(line => line.trim().split(' ').slice(1));
}

const fixtures = [
  ['cli-lookup-v1.json', 'source-report'],
  ['cli-lookup-v2.json', 'source-report'],
  ['cli-lookup-asn-v1.json', 'source-report'],
  ['cli-lookup-asn-v2.json', 'source-report'],
  ['case-lifecycle/case-export-v15.json', 'case'],
  ['case-lifecycle/case-export-v19.json', 'case'],
  ['case-lifecycle/workspace-archive-v5-public.json', 'inspect-archive'],
  ['case-lifecycle/workspace-archive-v10-empty-current.json', 'inspect-archive'],
  ['lookup-evidence-v26.json', 'interchange-report'],
  ['lookup-evidence-v27.json', 'interchange-report'],
  ['case-lifecycle/cli-case-pack-v2-case-v12-public.json', 'interchange-report'],
  ['case-lifecycle/cli-case-pack-v2-case-v19-current.json', 'interchange-report'],
  ['extracted-domain-lifecycle/managed-indicator-set-v1.json', 'indicator-set'],
] as const;

for (const [fixture, expectedCommand] of fixtures) {
  test(`offline follow-up accepts the retained ${fixture} input without collection`, async () => {
    const raw = await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), 'utf8');
    const report = await verifyOfflineArtifact(raw);
    const before = JSON.stringify(report);
    const terminal = await invoke(['verify-artifact', '--no-color', '--', PRIVATE_FILENAME], raw);
    assert.equal(terminal.code, EXIT_CODES.SUCCESS, terminal.stderr);
    assert.equal(terminal.stderr, '');
    assert.equal(terminal.inputReads, 1, 'Printing a suggestion must not execute it or read another file');
    assert.equal(terminal.passphraseReads, 0);
    assert.match(terminal.stdout, /examples; replace filenames; nothing runs automatically/);
    assert.doesNotMatch(terminal.stdout, /private directory|untrusted-name/);
    assert.equal(terminal.stdout, formatOfflineArtifactVerification(report));
    assert.equal(JSON.stringify(report), before, 'Text suggestions do not mutate the machine report');
    const next = suggestions(terminal.stdout);
    assert.equal(next.length, 1);
    const argv = next[0]!;
    assert.equal(argv[0], expectedCommand);
    const parsed = parseCliArguments(argv);
    assert.ok(isCliCommand(parsed.action));
    assert.equal(cliInvocationNetworkEffect(parsed.action, argv.slice(1)), 'offline');
    const followUp = await invoke(argv, raw);
    assert.equal(followUp.code, EXIT_CODES.SUCCESS, followUp.stderr);
    assert.equal(followUp.stderr, '');
    assert.ok(followUp.stdout.trim(), 'The actual follow-up must produce a report');
    if (expectedCommand === 'interchange-report') {
      const json = await invoke([argv[0]!, '--json', ...argv.slice(1)], raw);
      assert.equal(JSON.parse(json.stdout).recognised, true, 'A generic unrecognised-format report is not a valid follow-up');
    }
    const json = await invoke(['verify-artifact', '--json', '--', PRIVATE_FILENAME], raw);
    assert.equal(json.code, terminal.code);
    assert.deepEqual(JSON.parse(json.stdout), report);
    const quiet = await invoke(['verify-artifact', '--quiet', '--', PRIVATE_FILENAME], raw);
    assert.equal(quiet.code, terminal.code);
    assert.equal(quiet.stdout, '');
    assert.equal(quiet.stderr, '');
  });
}

test('encrypted guidance separates envelope inspection from authenticated content verification', async () => {
  const archive = await buildWorkspaceArchive({}, { generatedAt: NOW });
  const raw = JSON.stringify(await encryptWorkspaceArchive(archive, PASSPHRASE));
  const envelope = await invoke(['verify-artifact', '--strict-exit', '--no-color', '--', PRIVATE_FILENAME], raw);
  assert.equal(envelope.code, EXIT_CODES.PARTIAL_FAILURE);
  assert.equal(envelope.passphraseReads, 0);
  assert.match(envelope.stdout, /Authenticated encryption: not_checked/);
  const [unlock] = suggestions(envelope.stdout);
  assert.deepEqual(unlock, ['verify-artifact', '--passphrase-file', './passphrase.txt', '--', './workspace.encrypted.json']);
  const verified = await invoke(unlock!, raw);
  assert.equal(verified.code, EXIT_CODES.SUCCESS, verified.stderr);
  assert.equal(verified.inputReads, 1);
  assert.equal(verified.passphraseReads, 1);
  assert.match(verified.stdout, /Authenticated encryption: verified/);
  const [inspect] = suggestions(verified.stdout);
  assert.deepEqual(inspect, ['inspect-archive', '--passphrase-file', './passphrase.txt', '--', './workspace.encrypted.json']);
  const inspected = await invoke(inspect!, raw);
  assert.equal(inspected.code, EXIT_CODES.SUCCESS, inspected.stderr);
  assert.doesNotMatch(envelope.stdout + verified.stdout + inspected.stdout, /synthetic archive passphrase|private directory|untrusted-name/);
  const incorrect = await invoke(unlock!, raw, 'incorrect fixture passphrase');
  assert.notEqual(incorrect.code, EXIT_CODES.SUCCESS);
  assert.deepEqual(suggestions(incorrect.stdout), []);
});

test('partial archives remain incomplete and unsupported follow-up families get no guessed command', async () => {
  const raw = JSON.stringify(await buildWorkspaceArchive({}, { generatedAt: NOW }));
  const terminal = await invoke(['verify-artifact', '--strict-exit', '--no-color'], raw);
  assert.equal(terminal.code, EXIT_CODES.PARTIAL_FAILURE);
  assert.match(terminal.stdout, /Content integrity scope: embedded_projections/);
  assert.equal(suggestions(terminal.stdout)[0]?.[0], 'inspect-archive');
  const json = await invoke(['verify-artifact', '--strict-exit', '--json'], raw);
  assert.equal(json.code, terminal.code);
  assert.deepEqual(JSON.parse(json.stdout), await verifyOfflineArtifact(raw));
  const quiet = await invoke(['verify-artifact', '--strict-exit', '--quiet'], raw);
  assert.equal(quiet.code, terminal.code);
  assert.equal(quiet.stdout, '');

  const packet = await readFile(new URL('./fixtures/case-lifecycle/case-response-packet-v13.json', import.meta.url), 'utf8');
  const valid = await invoke(['verify-artifact', '--no-color'], packet);
  assert.equal(valid.code, EXIT_CODES.SUCCESS, valid.stderr);
  assert.deepEqual(suggestions(valid.stdout), []);
  const unsupportedCase = await readFile(new URL('./fixtures/case-lifecycle/case-export-v13.json', import.meta.url), 'utf8');
  for (const invalid of ['{', '{"schema":"whoisleuth.unknown","version":999}', unsupportedCase]) {
    const rejected = await invoke(['verify-artifact', '--no-color'], invalid);
    assert.notEqual(rejected.code, EXIT_CODES.SUCCESS);
    assert.equal(rejected.stdout, '');
    assert.deepEqual(suggestions(rejected.stdout), []);
  }
});
