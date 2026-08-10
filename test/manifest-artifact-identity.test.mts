import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  OFFLINE_ARTIFACT_VERIFICATION_VERSION,
  formatOfflineArtifactVerification,
  isCompleteOfflineArtifactVerification,
  verifyOfflineArtifact,
} from '../cli/artifact-verify.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { buildInvestigationManifest } from '../cli/investigation-manifest.mts';
import { runCli } from '../cli/runner.mts';
import {
  canonicalArtifactJson,
  sha256ArtifactDigest,
} from '../frontend/src/lib/analysis/artifact-integrity.ts';

const NOW = '2026-08-09T02:00:00.000Z';

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function savedLookup() {
  return {
    schema: 'whoisleuth.cli.lookup',
    version: 1,
    generatedAt: NOW,
    mode: 'fast',
    query: 'identity.example',
    type: 'domain',
    registrableDomain: 'identity.example',
    diagnostics: {
      rdap: { status: 'success' },
      whois: { status: 'skipped' },
    },
    rdap: { parsed: { domain: 'IDENTITY.EXAMPLE' } },
  };
}

async function legacyManifest(raw: string) {
  const current = await buildInvestigationManifest({
    workflow: 'identity review',
    configurationDigestSha256: null,
    artifacts: [{ content: raw }],
  }, NOW, '1.47.1');
  const value = JSON.parse(raw) as Record<string, unknown>;
  const unsigned = {
    ...current,
    version: 1,
    artifacts: current.artifacts.map((entry) => ({
      ...entry,
      canonicalDigestSha256: digest(canonicalArtifactJson(value)),
    })),
    integrity: undefined,
  };
  const { integrity: _integrity, ...withoutIntegrity } = unsigned;
  return {
    ...withoutIntegrity,
    integrity: {
      algorithm: 'SHA-256',
      digestSha256: await sha256ArtifactDigest(withoutIntegrity),
    },
  };
}

describe('investigation manifest artifact identity', () => {
  test('separates exact-byte identity, canonical equivalence, and mismatch from artifact assurance', async () => {
    const raw = JSON.stringify(savedLookup());
    const manifest = await buildInvestigationManifest({
      workflow: 'identity review',
      configurationDigestSha256: null,
      artifacts: [{ content: raw }],
    }, NOW, '1.47.1');

    const exact = await verifyOfflineArtifact(raw, {
      manifest: { raw: JSON.stringify(manifest), entryId: 'artifact-1' },
    });
    assert.equal(exact.version, OFFLINE_ARTIFACT_VERIFICATION_VERSION);
    assert.equal(exact.state, 'structure_valid');
    assert.equal(exact.manifestIdentity?.state, 'identity_verified');
    assert.deepEqual(exact.manifestIdentity?.checks, {
      manifestIntegrity: 'verified',
      byteLength: 'verified',
      rawContentDigest: 'verified',
      canonicalDigest: 'verified',
      schema: 'verified',
      version: 'verified',
    });
    assert.equal(isCompleteOfflineArtifactVerification(exact), true);

    const reformatted = `${JSON.stringify(savedLookup(), null, 2)}\n`;
    const canonicalOnly = await verifyOfflineArtifact(reformatted, {
      manifest: { raw: JSON.stringify(manifest), entryId: 'artifact-1' },
    });
    assert.equal(canonicalOnly.manifestIdentity?.state, 'canonical_match_only');
    assert.equal(canonicalOnly.manifestIdentity?.checks.rawContentDigest, 'mismatch');
    assert.equal(canonicalOnly.manifestIdentity?.checks.canonicalDigest, 'verified');
    assert.equal(isCompleteOfflineArtifactVerification(canonicalOnly), false);

    const changed = JSON.stringify({ ...savedLookup(), generatedAt: '2026-08-09T03:00:00.000Z' });
    const mismatch = await verifyOfflineArtifact(changed, {
      manifest: { raw: JSON.stringify(manifest), entryId: 'artifact-1' },
    });
    assert.equal(mismatch.manifestIdentity?.state, 'mismatch');
    assert.equal(mismatch.manifestIdentity?.checks.canonicalDigest, 'mismatch');
    assert.equal(mismatch.checks.structure, 'verified');
    assert.match(formatOfflineArtifactVerification(mismatch), /Manifest identity: mismatch/u);
  });

  test('supports integrity-valid legacy manifests without changing their canonicalization contract', async () => {
    const raw = JSON.stringify(savedLookup());
    const manifest = await legacyManifest(raw);
    const report = await verifyOfflineArtifact(raw, {
      manifest: { raw: JSON.stringify(manifest), entryId: 'artifact-1' },
    });
    assert.equal(report.manifestIdentity?.manifest.version, 1);
    assert.equal(report.manifestIdentity?.state, 'identity_verified');
  });

  test('rejects absent entries and tampered manifests before reporting identity', async () => {
    const raw = JSON.stringify(savedLookup());
    const manifest = await buildInvestigationManifest({
      workflow: 'identity review', configurationDigestSha256: null, artifacts: [{ content: raw }],
    }, NOW, '1.47.1');
    await assert.rejects(
      verifyOfflineArtifact(raw, { manifest: { raw: JSON.stringify(manifest), entryId: 'artifact-2' } }),
      /entry was not found/iu,
    );
    await assert.rejects(
      verifyOfflineArtifact(raw, {
        manifest: { raw: JSON.stringify({ ...manifest, workflow: 'changed' }), entryId: 'artifact-1' },
      }),
      /integrity check/iu,
    );
  });

  test('uses partial-failure strict exit for canonical-only and mismatched identities without exposing paths', async () => {
    const raw = JSON.stringify(savedLookup());
    const reformatted = JSON.stringify(savedLookup(), null, 2);
    const manifest = await buildInvestigationManifest({
      workflow: 'identity review', configurationDigestSha256: null, artifacts: [{ content: raw }],
    }, NOW, '1.47.1');
    let output = '';
    const code = await runCli([
      'verify-artifact', 'artifact.json', '--manifest', 'manifest.json', '--manifest-entry', 'artifact-1', '--json', '--strict-exit',
    ], {
      stdout: { write(value) { output += value; } },
      stderr: { write() {} },
      readArtifactInput: async (source) => source === 'manifest.json' ? JSON.stringify(manifest) : reformatted,
    });
    assert.equal(code, EXIT_CODES.PARTIAL_FAILURE);
    assert.equal(JSON.parse(output).manifestIdentity.state, 'canonical_match_only');
    assert.doesNotMatch(output, /artifact\.json|manifest\.json/u);
  });
});
