import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

import { verifyOfflineArtifact, MAX_OFFLINE_ARTIFACT_BYTES } from '../cli/artifact-verify.mts';
import { buildInterchangeFidelityReport } from '../cli/interchange-report.mts';
import { buildSharingReview } from '../cli/sharing-review.mts';
import { buildInvestigationManifest, MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES } from '../cli/investigation-manifest.mts';
import { signEvidencePackage, verifyEvidencePackageSignature } from '../cli/evidence-signing.mts';
import { buildDomainControlManifest, verifyDomainControlManifest } from '../lib/domain-control-manifest.mts';
import {
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
  MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
} from '../packages/contracts/domain-control-manifest.mts';

const NOW = '2026-09-01T00:00:00.000Z';

test('verifies and reviews a complete rich manifest above the former portable intake cap', async (context) => {
  const host = (index: number) => `${String(index).padStart(2, '0')}${'a'.repeat(61)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(50)}.test`;
  const records = {
    nameservers: Array.from({ length: 64 }, (_, index) => host(index)),
    ds: Array.from({ length: 64 }, (_, index) => `${index} 13 2 ${'ab'.repeat(512)}`),
    mx: Array.from({ length: 64 }, (_, index) => `${index} ${host(index)}`),
    caa: Array.from({ length: 64 }, (_, index) => `0 issue ca.example; account=${String(index).padStart(2, '0')}${'é'.repeat(460)}`),
  };
  const started = performance.now();
  const manifest = buildDomainControlManifest({
    schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA, version: DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
    expiresAt: '2026-10-01T00:00:00.000Z',
    entries: Array.from({ length: 100 }, (_, index) => ({ domain: `domain${index}.example.test`, ...records })),
  }, NOW);
  const raw = `${JSON.stringify(manifest, null, 2)}\n`;
  const bytes = Buffer.byteLength(raw);
  assert.ok(bytes > 15 * 1024 * 1024 && bytes <= MAX_DOMAIN_CONTROL_MANIFEST_BYTES);
  assert.equal(MAX_OFFLINE_ARTIFACT_BYTES, MAX_DOMAIN_CONTROL_MANIFEST_BYTES);
  assert.deepEqual(verifyDomainControlManifest(JSON.parse(raw)), manifest);
  for (const entry of manifest.entries) {
    for (const field of ['nameservers', 'ds', 'mx', 'caa'] as const) assert.equal(entry[field].length, 64);
  }
  const verification = await verifyOfflineArtifact(raw);
  assert.equal(verification.state, 'verified');
  assert.equal(verification.checks.contentIntegrityScope, 'whole_artifact');
  const interchange = await buildInterchangeFidelityReport(raw, { generatedAt: NOW });
  assert.equal(interchange.verification.state, 'verified');
  const sharing = await buildSharingReview(raw, {
    marking: 'amber', recipientScope: 'organization', purpose: 'Reviewed settings handoff',
    humanReviewed: true, personalDataReviewed: true, redactionsConfirmed: true,
  }, NOW);
  assert.equal(sharing.artifact.integrity, 'verified');
  assert.equal(sharing.summary.status, 'ready');
  assert.equal(sharing.privacy.contentValuesEmitted, 0);
  assert.doesNotMatch(JSON.stringify(sharing), /domain0\.example|account=/u);
  const custody = await buildInvestigationManifest({
    workflow: 'Reviewed domain settings', configurationDigestSha256: null, artifacts: [{ content: raw }],
  }, NOW, '2.3.1');
  assert.equal(custody.artifacts[0]?.byteLength, bytes);
  assert.equal((await verifyOfflineArtifact(JSON.stringify(custody))).state, 'verified');
  assert.doesNotMatch(JSON.stringify(custody), /domain0\.example|account=/u);
  await assert.rejects(() => buildInvestigationManifest({
    workflow: 'Reviewed domain settings', configurationDigestSha256: null,
    artifacts: [{ content: raw.padEnd(MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES + 1, ' ') }],
  }, NOW, '2.3.1'), /must be between 1 byte/u);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signed = await signEvidencePackage(raw, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), NOW);
  const signature = await verifyEvidencePackageSignature(JSON.stringify(signed, null, 2), publicKey.export({ type: 'spki', format: 'pem' }).toString());
  assert.equal(signature.state, 'signature_valid');
  assert.equal(signature.signature.signerTrust, 'trusted_key');
  assert.equal(signature.artifact.assurance.state, 'verified');
  context.diagnostic(`100 domains, 25,600 complete records, ${bytes} UTF-8 bytes; local build and portable checks ${(performance.now() - started).toFixed(1)} ms (observational).`);
});
