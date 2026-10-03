import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { runCli } from '../cli/runner.mts';
import { parseCliArguments } from '../cli/arguments.mts';
import { commandDefinition } from '../cli/command-reference.mts';
import { reviewMessageInput } from '../packages/investigation/message-intake.mts';
import { messageCaseEvidence } from '../packages/investigation/message-case-evidence.mts';
import { runMessageIntakeOperation } from '../frontend/src/lib/message-intake-worker-model.ts';

const now = '2026-09-22T00:00:00.000Z';
function capture() { let result = ''; return { stream: { write(chunk: string) { result += chunk; } }, read: () => result }; }

test('intake grammar and help expose offline kinds and explicit reported actions', () => {
  const args = parseCliArguments(['intake', 'email', 'selected.eml', '--reported-action', 'granted_consent', '--reported-action', 'entered_device_code', '--json']);
  assert.equal(args.action, 'intake');
  if (args.action !== 'intake') throw new Error('Wrong action');
  assert.deepEqual(args.reportedActions, ['granted_consent', 'entered_device_code']);
  assert.equal(commandDefinition('intake').execution.networkEffect, 'offline');
  assert.throws(() => parseCliArguments(['intake', 'unsupported']), /kind/u);
  assert.throws(() => parseCliArguments(['intake', 'text', '--reported-action', 'assumed_compromise']), /reported-action/u);
});

test('CLI intake reads stdin without collection and excludes credentials from output', async () => {
  const stdout = capture(), stderr = capture(); let requests = 0;
  const code = await runCli(['intake', 'text', '--json', '--reported-action', 'granted_consent'], {
    stdin: Readable.from(['https://identity.example/authorize?client_id=abc&scope=mail.read&token=secret']), stdout: stdout.stream, stderr: stderr.stream, now: () => now,
    runUnifiedLookup: async () => { requests++; throw new Error('No collection is allowed'); },
  });
  assert.equal(code, 0); assert.equal(requests, 0); assert.equal(stderr.read(), '');
  const report = JSON.parse(stdout.read());
  assert.equal(report.schema, 'whoisleuth.message-intake');
  assert.deepEqual(report.identityRecovery.reportedActions, ['granted_consent']);
  assert.ok(report.identityRecovery.nextSteps.some((step: { id: string }) => step.id === 'grants'));
  assert.equal(stdout.read().includes('secret'), false);
});

test('CLI partial review uses explicit exit policy and QR refuses binary stdin', async () => {
  const stdout = capture(), stderr = capture();
  const source = 'Content-Type: application/octet-stream\r\n\r\nopaque';
  assert.equal(await runCli(['intake', 'email', '--json', '--strict-exit'], { stdin: Readable.from([source]), stdout: stdout.stream, stderr: stderr.stream, now: () => now }), 4);
  assert.equal(JSON.parse(stdout.read()).coverage.state, 'partial');
  assert.equal(await runCli(['intake', 'qr', '--json'], { stdout: capture().stream, stderr: capture().stream }), 2);
});

test('excluded destinations affect strict exit without exposing private text or authorising requests', async () => {
  const stdout = capture(), stderr = capture();
  const code = await runCli(['intake', 'text', '--strict-exit'], {
    stdin: Readable.from(['https://user:secret@example.test/private https://admitted.example/']),
    stdout: stdout.stream, stderr: stderr.stream, now: () => now,
    runUnifiedLookup: async () => { throw new Error('Collection is forbidden'); },
  });
  assert.equal(code, 4);
  assert.match(stdout.read(), /Links containing credentials were not reviewed \(1\)/u);
  assert.doesNotMatch(stdout.read() + stderr.read(), /secret|\/private/u);
  assert.equal(stderr.read(), '');
});

test('browser worker, Case projection and CLI use the same source and privacy contract', async () => {
  const file = new Blob(['https://selected.example/private?token=secret']);
  const reply = await runMessageIntakeOperation({ kind: 'text', file, reviewedAt: now });
  assert.equal(reply.kind, 'review'); if (reply.kind !== 'review') throw new Error('No review');
  const direct = await reviewMessageInput(new Uint8Array(await file.arrayBuffer()), 'text', now);
  assert.deepEqual(reply.result, direct);
  const findings = messageCaseEvidence(reply.result.report, `sha256:${'a'.repeat(64)}`);
  assert.equal(findings.completeness, 'inconclusive');
  assert.equal(findings.title, 'Analyst-selected message review');
  assert.equal(JSON.stringify(findings).includes('secret'), false);
  assert.deepEqual(await runMessageIntakeOperation({ kind: 'qr', file, reviewedAt: now }), { kind: 'error' });
});
