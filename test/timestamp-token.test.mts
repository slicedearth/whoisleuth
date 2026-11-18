import assert from 'node:assert/strict';
import { test } from 'node:test';
import net from 'node:net';
import { reviewTimestampToken } from '../packages/evidence/timestamp-token.mts';
import { timestampTokenFixture, PROOF_REVIEW_TIME } from '../fixtures/cryptographic-proofs.mts';
import { runCli } from '../cli/runner.mts';

test('offline timestamp review checks actual CMS, imprint, signer binding, selected trust and CRLs separately', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Timestamp verification attempted fetch'));
  t.mock.method(net.Socket.prototype, 'connect', () => assert.fail('Timestamp verification attempted transport'));
  const input = await timestampTokenFixture({ accuracySeconds: 1, tsaHint: true });
  const original = structuredClone(input);
  const result = await reviewTimestampToken(input, PROOF_REVIEW_TIME);
  assert.equal(result.state, 'checks_passed', JSON.stringify(result.checks));
  assert.ok(result.checks.every(check => check.state === 'matched'));
  assert.equal(result.generatedAt, '2026-10-31T23:59:00.000Z');
  assert.equal(result.declaredAccuracyMicroseconds, '1000000');
  assert.equal(result.networkRequestsMade, false);
  assert.deepEqual(input, original);
  const output = JSON.stringify(result);
  assert.doesNotMatch(output, /BEGIN CERTIFICATE|Synthetic retained evidence|Example Timestamp Signer|artifactBase64|tokenDerBase64|expectedNonceHex/u);
  assert.equal(result.artifact.digestSha256.length, 64);
  const later = await reviewTimestampToken(input, '2040-01-01T00:00:00.000Z');
  assert.equal(later.state, 'checks_passed', 'The signer is evaluated at token generation, not at the current wall clock');
});

test('altered bytes, policy, nonce, signature and signer binding cannot inherit other passing checks', async () => {
  const input = await timestampTokenFixture();
  const changed = await reviewTimestampToken({ ...input, artifactBase64: Buffer.from('Other bytes').toString('base64'), expectedPolicyOid: '1.3.6.1.4.1.32473.2', expectedNonceHex: '18' }, PROOF_REVIEW_TIME);
  for (const id of ['message_imprint', 'policy', 'nonce']) assert.equal(changed.checks.find(check => check.id === id)?.state, 'mismatch');
  assert.equal(changed.checks.find(check => check.id === 'signature')?.state, 'not_checked');
  const corrupted = Buffer.from(input.tokenDerBase64, 'base64'); corrupted[corrupted.length - 1] = corrupted.at(-1)! ^ 1;
  const signature = await reviewTimestampToken({ ...input, tokenDerBase64: corrupted.toString('base64') }, PROOF_REVIEW_TIME);
  assert.equal(signature.checks.find(check => check.id === 'signature')?.state, 'mismatch');
  assert.equal(signature.checks.find(check => check.id === 'message_imprint')?.state, 'matched');
  const binding = await reviewTimestampToken(await timestampTokenFixture({ wrongBinding: true }), PROOF_REVIEW_TIME);
  assert.equal(binding.checks.find(check => check.id === 'signature')?.state, 'matched');
  assert.equal(binding.checks.find(check => check.id === 'signer_binding')?.state, 'mismatch');
});

test('missing, revoked, stale and future CRLs, inappropriate purpose and future time remain review outcomes', async () => {
  const input = await timestampTokenFixture();
  const missing = await reviewTimestampToken({ ...input, crlsDerBase64: [] }, PROOF_REVIEW_TIME);
  assert.equal(missing.checks.find(check => check.id === 'certification_path')?.state, 'matched');
  assert.equal(missing.checks.find(check => check.id === 'revocation')?.state, 'not_supplied');
  assert.equal(missing.state, 'review_required');
  for (const options of [{ revoked: true }, { staleCrl: true }, { futureCrl: true }]) {
    const result = await reviewTimestampToken(await timestampTokenFixture(options), PROOF_REVIEW_TIME);
    assert.equal(result.checks.find(check => check.id === 'revocation')?.state, 'mismatch', JSON.stringify(options));
    assert.equal(result.state, 'review_required');
  }
  const purpose = await reviewTimestampToken(await timestampTokenFixture({ purpose: '1.3.6.1.5.5.7.3.1' }), PROOF_REVIEW_TIME);
  assert.equal(purpose.checks.find(check => check.id === 'purpose')?.state, 'mismatch');
  const untrusted = await reviewTimestampToken({ ...input, trustAnchorsPem: (await timestampTokenFixture({ otherAuthority: true })).trustAnchorsPem }, PROOF_REVIEW_TIME);
  assert.equal(untrusted.checks.find(check => check.id === 'signature')?.state, 'matched');
  assert.equal(untrusted.checks.find(check => check.id === 'certification_path')?.state, 'mismatch');
  const future = await reviewTimestampToken(await timestampTokenFixture({ generatedAt: '2026-11-02T00:00:00.000Z' }), PROOF_REVIEW_TIME);
  assert.equal(future.checks.find(check => check.id === 'time')?.state, 'mismatch');
  const overlaps = await reviewTimestampToken(await timestampTokenFixture({ accuracySeconds: 120 }), PROOF_REVIEW_TIME);
  assert.equal(overlaps.checks.find(check => check.id === 'time')?.state, 'mismatch');
});

test('the real CLI is offline, keeps JSON valid and applies strict exits to incomplete revocation', async () => {
  const input = await timestampTokenFixture();
  let stdout = '', stderr = '';
  const dependencies = { readArtifactInput: () => JSON.stringify(input), now: () => PROOF_REVIEW_TIME,
    stdout: { write(value: string) { stdout += value; } }, stderr: { write(value: string) { stderr += value; } },
    runUnifiedLookup: () => assert.fail('Offline verification cannot collect') };
  assert.equal(await runCli(['review-evidence', 'timestamp.json', '--json', '--strict-exit'], dependencies), 0, stderr);
  assert.equal(JSON.parse(stdout).kind, 'timestamp_token');
  stdout = '';
  assert.equal(await runCli(['review-evidence', 'timestamp.json'], dependencies), 0, stderr);
  assert.match(stdout, /2026-10-31T23:59:00\.000Z/u);
  assert.doesNotMatch(stdout, /BEGIN CERTIFICATE|artifactBase64|tokenDerBase64/u);
  input.crlsDerBase64 = [];
  stdout = '';
  assert.equal(await runCli(['review-evidence', 'timestamp.json', '--quiet', '--strict-exit'], dependencies), 4, stderr);
  assert.equal(stdout, '');
  await assert.rejects(reviewTimestampToken({ ...input, tokenDerBase64: input.tokenDerBase64 + '\n' }, PROOF_REVIEW_TIME), TypeError);
  await assert.rejects(reviewTimestampToken({ ...input, artifactBase64: '' }, PROOF_REVIEW_TIME), TypeError);
});
