import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ctInclusionFixture, PROOF_REVIEW_TIME } from '../fixtures/cryptographic-proofs.mts';
import { reviewCtInclusionProof } from '../packages/evidence/ct-inclusion-proof.mts';
import { runCli } from '../cli/runner.mts';

test('verifies signed independent trees, including unequal branches and the empty single-leaf path', async () => {
  for (const options of [{ index: 0 }, { index: 1 }, { index: 2 }, { size: 1, index: 0 }, { rsa: true }, { size: 7, index: 5, precertificate: true }]) {
    const input = await ctInclusionFixture(options), before = structuredClone(input);
    const report = await reviewCtInclusionProof(input, PROOF_REVIEW_TIME);
    assert.equal(report.state, 'checks_passed');
    assert.equal(report.tree.leafIndex, String(input.leafIndex));
    assert.equal(report.leaf.kind, options.precertificate ? 'precertificate' : 'x509');
    assert.equal(report.networkRequestsMade, false);
    assert.ok(report.checks.every(check => check.state === 'matched'));
    assert.equal(JSON.stringify(report).includes(input.leafInputBase64), false);
    assert.equal(JSON.stringify(report).includes(input.logKeySpkiBase64), false);
    assert.deepEqual(input, before);
  }
});

test('keeps leaf inclusion, key identity, signature and chronology independent', async () => {
  const input = await ctInclusionFixture();
  const wrongLeaf = Buffer.from(input.leafInputBase64, 'base64'); wrongLeaf[9] = wrongLeaf[9]! ^ 1;
  const altered = await reviewCtInclusionProof({ ...input, leafInputBase64: wrongLeaf.toString('base64') }, PROOF_REVIEW_TIME);
  assert.equal(altered.checks.find(check => check.id === 'inclusion')?.state, 'mismatch');
  assert.equal(altered.checks.find(check => check.id === 'tree_signature')?.state, 'matched');
  const wrongId = await reviewCtInclusionProof({ ...input, logIdBase64: Buffer.alloc(32, 1).toString('base64') }, PROOF_REVIEW_TIME);
  assert.equal(wrongId.state, 'review_required');
  assert.equal(wrongId.checks.find(check => check.id === 'log_key')?.state, 'mismatch');
  const signature = Buffer.from(input.signedTreeHead.tree_head_signature, 'base64'); signature[signature.length - 1] = signature.at(-1)! ^ 1;
  const wrongSignature = await reviewCtInclusionProof({ ...input, signedTreeHead: { ...input.signedTreeHead, tree_head_signature: signature.toString('base64') } }, PROOF_REVIEW_TIME);
  assert.equal(wrongSignature.checks.find(check => check.id === 'tree_signature')?.state, 'mismatch');
  assert.equal(wrongSignature.checks.find(check => check.id === 'inclusion')?.state, 'matched');
  const future = await reviewCtInclusionProof(await ctInclusionFixture({ headAt: '2026-11-02T00:00:00.000Z' }), PROOF_REVIEW_TIME);
  assert.equal(future.checks.find(check => check.id === 'tree_signature')?.state, 'matched');
  assert.equal(future.checks.find(check => check.id === 'chronology')?.state, 'mismatch');
});

test('rejects ambiguous encodings and invalid bounds, and never accepts a missing or extra proof node', async () => {
  const input = await ctInclusionFixture();
  for (const patch of [{ protocol: 'rfc9162-v2' }, { leafIndex: -1 }, { leafIndex: 3 }, { auditPath: Array(65).fill('') }, { logKeySpkiBase64: input.logKeySpkiBase64 + '\n' },
    { signedTreeHead: { ...input.signedTreeHead, tree_size: '18446744073709551616' } }]) await assert.rejects(reviewCtInclusionProof({ ...input, ...patch }, PROOF_REVIEW_TIME), TypeError);
  assert.equal((await reviewCtInclusionProof({ ...input, auditPath: [] }, PROOF_REVIEW_TIME)).state, 'review_required');
  assert.equal((await reviewCtInclusionProof({ ...input, auditPath: [...input.auditPath, Buffer.alloc(32).toString('base64')] }, PROOF_REVIEW_TIME)).state, 'review_required');
});

test('the production offline CLI preserves separate checks and strict exit without collecting', async () => {
  const input = await ctInclusionFixture();
  let output = '', calls = 0;
  const dependencies = { readArtifactInput: () => JSON.stringify(input), now: () => PROOF_REVIEW_TIME,
    stdout: { write(value: string) { output += value; } }, stderr: { write() {} },
    runUnifiedLookup: async () => { calls++; throw new Error('No collection permitted'); } };
  assert.equal(await runCli(['review-evidence', 'proof.json', '--json', '--strict-exit'], dependencies), 0);
  assert.equal(JSON.parse(output).result.state, 'checks_passed');
  input.auditPath = [];
  assert.equal(await runCli(['review-evidence', 'proof.json', '--quiet', '--strict-exit'], dependencies), 4);
  assert.equal(calls, 0);
});
