import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_OFFLINE_ARTIFACT_BYTES,
  formatOfflineArtifactVerification,
  verifyOfflineArtifact,
} from '../cli/artifact-verify.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { runCli } from '../cli/runner.mts';
import {
  buildWorkspaceArchive,
} from '../frontend/src/lib/analysis/workspace-archive.ts';
import {
  encryptWorkspaceArchive,
} from '../frontend/src/lib/analysis/workspace-archive-crypto.ts';
import { sha256ArtifactDigest } from '../frontend/src/lib/analysis/artifact-integrity.ts';

const PASSPHRASE = 'fixture archive passphrase';

describe('offline artifact verifier', () => {
  test('validates workspace manifests and section checksums without printing contents', async () => {
    const archive = await buildWorkspaceArchive({
      cases: {
        version: 1,
        cases: [],
      },
    }, {
      generatedAt: '2026-07-15T00:00:00.000Z',
    });
    const report = await verifyOfflineArtifact(JSON.stringify(archive));
    assert.equal(report.artifact.kind, 'workspace_archive');
    assert.equal(report.state, 'verified');
    assert.equal(report.checks.contentIntegrity, 'verified');
    assert.ok((report.summary.sectionCount ?? 0) > 0);
    const terminal = formatOfflineArtifactVerification(report);
    assert.doesNotMatch(terminal, /fixture archive passphrase/u);
    assert.doesNotMatch(terminal, /"cases"/u);
  });

  test('distinguishes structural envelope inspection from authenticated decryption', async () => {
    const archive = await buildWorkspaceArchive({}, {
      generatedAt: '2026-07-15T00:00:00.000Z',
    });
    const encrypted = await encryptWorkspaceArchive(archive, PASSPHRASE);
    const raw = JSON.stringify(encrypted);

    const inspected = await verifyOfflineArtifact(raw);
    assert.equal(inspected.state, 'envelope_valid');
    assert.equal(inspected.checks.contentIntegrity, 'not_checked');
    assert.equal(inspected.checks.authenticatedEncryption, 'not_checked');

    const verified = await verifyOfflineArtifact(raw, { passphrase: PASSPHRASE });
    assert.equal(verified.state, 'verified');
    assert.equal(verified.checks.contentIntegrity, 'verified');
    assert.equal(verified.checks.authenticatedEncryption, 'verified');
    await assert.rejects(
      verifyOfflineArtifact(raw, { passphrase: 'incorrect fixture passphrase' }),
      /incorrect or .* corrupted/iu,
    );
  });

  test('validates known signed review manifests and rejects changes', async () => {
    const unsigned = {
      schema: 'whoisleuth.bulk-review-manifest',
      version: 1,
      generatedAt: '2026-07-15T00:00:00.000Z',
      selection: { count: 0, domains: [] },
    };
    const artifact = {
      ...unsigned,
      integrity: {
        algorithm: 'SHA-256',
        digestSha256: await sha256ArtifactDigest(unsigned),
      },
    };
    const report = await verifyOfflineArtifact(JSON.stringify(artifact));
    assert.equal(report.artifact.kind, 'signed_review_artifact');
    assert.equal(report.checks.contentIntegrity, 'verified');

    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify({ ...artifact, generatedAt: '2026-07-16T00:00:00.000Z' })),
      /failed its SHA-256/iu,
    );
  });

  test('rejects unsupported, malformed, and oversized input', async () => {
    await assert.rejects(verifyOfflineArtifact('{'), /not valid JSON/iu);
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify({ schema: 'whoisleuth.unknown', version: 1 })),
      /not supported/iu,
    );
    await assert.rejects(
      verifyOfflineArtifact('x'.repeat(MAX_OFFLINE_ARTIFACT_BYTES + 1)),
      /between 1 byte/iu,
    );
  });

  test('runs through the CLI without exposing the passphrase or artifact contents', async () => {
    const archive = await buildWorkspaceArchive({}, {
      generatedAt: '2026-07-15T00:00:00.000Z',
    });
    const encrypted = await encryptWorkspaceArchive(archive, PASSPHRASE);
    let stdout = '';
    let stderr = '';
    const code = await runCli([
      'verify-artifact',
      'fixture.workspace.json',
      '--passphrase-file',
      'fixture.passphrase',
      '--json',
    ], {
      stdout: { write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } },
      readArtifactInput: async () => JSON.stringify(encrypted),
      readPassphraseFile: async () => `${PASSPHRASE}\n`,
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(stderr, '');
    const report = JSON.parse(stdout);
    assert.equal(report.state, 'verified');
    assert.equal(report.checks.authenticatedEncryption, 'verified');
    assert.doesNotMatch(stdout, new RegExp(PASSPHRASE, 'u'));
    assert.equal(stdout.includes(encrypted.ciphertext.slice(0, 32)), false);
  });
});
