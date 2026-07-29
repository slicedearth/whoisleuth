import {
  generateKeyPairSync,
} from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  signEvidencePackage,
  verifyEvidencePackageSignature,
} from '../cli/evidence-signing.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { runCli } from '../cli/runner.mts';
import { sha256ArtifactDigest } from '../frontend/src/lib/analysis/artifact-integrity.ts';

const NOW = '2026-07-29T10:00:00.000Z';

async function manifest() {
  const unsigned = {
    schema: 'whoisleuth.bulk-review-manifest',
    version: 1,
    generatedAt: NOW,
    selection: { count: 0, domains: [] },
  };
  return {
    ...unsigned,
    integrity: {
      algorithm: 'SHA-256',
      digestSha256: await sha256ArtifactDigest(unsigned),
    },
  };
}

function keys() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privatePem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

describe('optional local Ed25519 evidence-package signing', () => {
  test('signs only an integrity-verified review artifact and verifies it with a trusted key', async () => {
    const pair = keys();
    const signed = await signEvidencePackage(
      JSON.stringify(await manifest()),
      pair.privatePem,
      NOW,
    );
    assert.equal(signed.schema, 'whoisleuth.signed-evidence-package');
    assert.equal(signed.signature.algorithm, 'Ed25519');
    const report = await verifyEvidencePackageSignature(
      JSON.stringify(signed),
      pair.publicPem,
    );
    assert.equal(report.valid, true);
    assert.equal(report.state, 'signature_valid');
    assert.equal(report.signerTrust, 'trusted_key');
    assert.equal(report.publicKeyMatched, true);
    assert.equal(report.artifact.kind, 'signed_review_artifact');
  });

  test('rejects tampering, untrusted keys, unsupported artifacts, and non-Ed25519 keys', async () => {
    const pair = keys();
    const signed = await signEvidencePackage(JSON.stringify(await manifest()), pair.privatePem, NOW);
    const tampered = structuredClone(signed);
    (tampered.artifact.selection as { count: number }).count = 1;
    await assert.rejects(
      verifyEvidencePackageSignature(JSON.stringify(tampered), pair.publicPem),
      /failed Ed25519/iu,
    );
    await assert.rejects(
      verifyEvidencePackageSignature(JSON.stringify({ ...signed, unsignedComment: 'not covered' })),
      /malformed envelope/iu,
    );
    await assert.rejects(
      verifyEvidencePackageSignature(JSON.stringify({
        ...signed,
        signature: { ...signed.signature, unsignedComment: 'not covered' },
      })),
      /malformed envelope/iu,
    );
    const other = keys();
    await assert.rejects(
      verifyEvidencePackageSignature(JSON.stringify(signed), other.publicPem),
      /does not match/iu,
    );
    await assert.rejects(
      signEvidencePackage(JSON.stringify({ schema: 'whoisleuth.unknown', version: 1 }), pair.privatePem, NOW),
      /not supported/iu,
    );
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    await assert.rejects(
      signEvidencePackage(JSON.stringify(await manifest()), rsa, NOW),
      /requires an Ed25519/iu,
    );
    const embeddedOnly = await verifyEvidencePackageSignature(JSON.stringify(signed));
    assert.equal(embeddedOnly.signerTrust, 'embedded_key_only');
    assert.equal(embeddedOnly.publicKeyMatched, null);
  });

  test('runs signing and verification through the CLI without printing private-key material', async () => {
    const pair = keys();
    let signedOutput = '';
    let stderr = '';
    const signCode = await runCli([
      'sign-artifact',
      'review.json',
      '--private-key-file',
      'private.pem',
    ], {
      stdout: { write(value) { signedOutput += value; } },
      stderr: { write(value) { stderr += value; } },
      readArtifactInput: async () => JSON.stringify(await manifest()),
      readPrivateKeyFile: async () => pair.privatePem,
      now: () => NOW,
    });
    assert.equal(signCode, EXIT_CODES.SUCCESS);
    assert.equal(stderr, '');
    assert.doesNotMatch(signedOutput, /PRIVATE KEY/u);

    let verificationOutput = '';
    const verifyCode = await runCli([
      'verify-signature',
      'signed.json',
      '--public-key-file',
      'public.pem',
      '--json',
    ], {
      stdout: { write(value) { verificationOutput += value; } },
      stderr: { write(value) { stderr += value; } },
      readArtifactInput: async () => signedOutput,
      readPublicKeyFile: async () => pair.publicPem,
    });
    assert.equal(verifyCode, EXIT_CODES.SUCCESS);
    assert.equal(JSON.parse(verificationOutput).publicKeyMatched, true);
    assert.equal(stderr, '');
  });
});
