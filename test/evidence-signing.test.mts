import {
  createPrivateKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  signEvidencePackage,
  verifyEvidencePackageSignature,
} from '../cli/evidence-signing.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { runCli } from '../cli/runner.mts';
import { buildBulkReviewManifest } from '../frontend/src/lib/analysis/bulk-review-export.ts';
import {
  canonicalArtifactJsonV2,
  sha256ArtifactDigest,
  sha256ArtifactDigestV2,
} from '../frontend/src/lib/analysis/artifact-integrity.ts';

const NOW = '2026-07-29T10:00:00.000Z';

async function manifest() {
  return (await buildBulkReviewManifest({
    rows: [], reviewStates: [], lookupProfile: 'fast', generatedAt: NOW, observedAt: NOW,
    view: {
      primaryFilter: 'all', mutationFilter: '', signalFilters: [], sourceFilter: '', lifecycleFilter: '',
      ageFilter: '', mailFilter: '', registrarFilter: '', caseDispositionFilter: '', reviewStateFilter: '',
      groupBy: '', sortKey: 'risk', sortDirection: -1,
    },
  })).document;
}

function keys() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privatePem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function resignPackage<T extends Record<string, unknown>>(value: T, privatePem: string): T {
  const { signature, ...payload } = value;
  return {
    ...payload,
    signature: {
      ...(signature as Record<string, unknown>),
      valueBase64: cryptoSign(
        null,
        Buffer.from(canonicalArtifactJsonV2(payload), 'utf8'),
        createPrivateKey(privatePem),
      ).toString('base64'),
    },
  } as unknown as T;
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
    assert.equal(signed.version, 2);
    assert.equal(signed.signature.algorithm, 'Ed25519');
    assert.equal(signed.signature.canonicalization, 'sorted-json-v2');
    const report = await verifyEvidencePackageSignature(
      JSON.stringify(signed),
      pair.publicPem,
    );
    assert.equal(report.version, 2);
    assert.equal(report.state, 'signature_valid');
    assert.equal(report.signature.signerTrust, 'trusted_key');
    assert.equal(report.signature.publicKeyMatched, true);
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
    await assert.rejects(
      verifyEvidencePackageSignature(JSON.stringify({
        ...signed,
        signature: { ...signed.signature, canonicalization: 'sorted-json-v1' },
      })),
      /malformed envelope/iu,
    );
    const missingCanonicalization = structuredClone(signed) as unknown as {
      signature: Record<string, unknown>;
    };
    delete missingCanonicalization.signature.canonicalization;
    await assert.rejects(
      verifyEvidencePackageSignature(JSON.stringify(missingCanonicalization)),
      /malformed envelope/iu,
    );
    const rawSigned = JSON.stringify(signed);
    const nestedSelection = '"selection":{"count":0';
    assert.ok(rawSigned.includes(nestedSelection));
    await assert.rejects(
      verifyEvidencePackageSignature(rawSigned.replace(nestedSelection, '"selection":{"count":0,"count":0')),
      /duplicate object key/iu,
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
    const currentManifest = await manifest();
    const contentFreeUnsigned = { schema: currentManifest.schema, version: currentManifest.version };
    await assert.rejects(
      signEvidencePackage(JSON.stringify({
        ...contentFreeUnsigned,
        integrity: { algorithm: 'SHA-256', digestSha256: await sha256ArtifactDigest(contentFreeUnsigned) },
      }), pair.privatePem, NOW),
      /malformed structure/iu,
    );
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    await assert.rejects(
      signEvidencePackage(JSON.stringify(await manifest()), rsa, NOW),
      /requires an Ed25519/iu,
    );
    await assert.rejects(
      signEvidencePackage(JSON.stringify(await manifest()), pair.privatePem, '2026-07-29T10:00:00'),
      /explicit timezone/iu,
    );
    const embeddedOnly = await verifyEvidencePackageSignature(JSON.stringify(signed));
    assert.equal(embeddedOnly.signature.signerTrust, 'embedded_key_only');
    assert.equal(embeddedOnly.signature.publicKeyMatched, null);
  });

  test('separates a valid signature from embedded-artifact assurance and requires canonical signedAt text', async () => {
    const pair = keys();
    const signed = structuredClone(await signEvidencePackage(JSON.stringify(await manifest()), pair.privatePem, NOW)) as unknown as Record<string, unknown>;
    const artifact = signed.artifact as Record<string, unknown>;
    (artifact.selection as Record<string, unknown>).count = 1;
    const { integrity: _integrity, ...unsignedArtifact } = artifact;
    artifact.integrity = {
      algorithm: 'SHA-256',
      canonicalization: 'sorted-json-v2',
      digestSha256: await sha256ArtifactDigestV2(unsignedArtifact),
    };
    const independentlySigned = resignPackage(signed, pair.privatePem);
    const report = await verifyEvidencePackageSignature(JSON.stringify(independentlySigned), pair.publicPem);
    assert.equal(report.state, 'signature_valid');
    assert.equal(report.signature.state, 'valid');
    assert.equal(report.artifact.assurance.state, 'not_verified');
    assert.equal(report.artifact.assurance.structure, 'not_checked');

    const nonCanonical = resignPackage({ ...signed, signedAt: '2026-07-29T10:00:00Z' }, pair.privatePem);
    await assert.rejects(
      verifyEvidencePackageSignature(JSON.stringify(nonCanonical), pair.publicPem),
      /canonical UTC timestamp text/iu,
    );
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
    assert.equal(JSON.parse(verificationOutput).signature.publicKeyMatched, true);
    assert.equal(stderr, '');
  });

  test('keeps empty inputs, reader failures, terminal output, and quiet output explicit', async () => {
    const pair = keys();
    for (const argv of [
      ['sign-artifact', 'empty.json', '--private-key-file', 'private.pem'],
      ['verify-signature', 'empty.json'],
    ]) {
      let stderr = '';
      const code = await runCli(argv, {
        stdout: { write() {} },
        stderr: { write(value) { stderr += value; } },
        readArtifactInput: async () => '',
        readPrivateKeyFile: async () => pair.privatePem,
      });
      assert.equal(code, EXIT_CODES.USAGE);
      assert.match(stderr, /requires one/u);
    }

    let keyError = '';
    assert.equal(await runCli([
      'sign-artifact', 'review.json', '--private-key-file', 'private.pem',
    ], {
      stdout: { write() {} },
      stderr: { write(value) { keyError += value; } },
      readArtifactInput: async () => JSON.stringify(await manifest()),
      readPrivateKeyFile: async () => { throw new Error('Key read failed'); },
    }), EXIT_CODES.USAGE);
    assert.match(keyError, /Could not read private key file: Key read failed/u);

    const signed = await signEvidencePackage(JSON.stringify(await manifest()), pair.privatePem, NOW);
    let terminal = '';
    assert.equal(await runCli(['verify-signature', 'signed.json'], {
      stdout: { write(value) { terminal += value; } },
      stderr: { write() {} },
      readArtifactInput: async () => JSON.stringify(signed),
    }), EXIT_CODES.SUCCESS);
    assert.match(terminal, /State: signature_valid/iu);

    let quiet = '';
    assert.equal(await runCli(['verify-signature', 'signed.json', '--quiet'], {
      stdout: { write(value) { quiet += value; } },
      stderr: { write() {} },
      readArtifactInput: async () => JSON.stringify(signed),
    }), EXIT_CODES.SUCCESS);
    assert.equal(quiet, '');
  });
});
