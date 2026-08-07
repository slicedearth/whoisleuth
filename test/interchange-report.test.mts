import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildInterchangeFidelityReport,
  formatInterchangeFidelityReport,
} from '../cli/interchange-report.mts';
import { buildCliCasePack } from '../cli/case-pack.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { buildBrandProfileExport } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import { buildWorkspaceArchive } from '../frontend/src/lib/analysis/workspace-archive.ts';
import { encryptWorkspaceArchive } from '../frontend/src/lib/analysis/workspace-archive-crypto.ts';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model.ts';
import {
  buildDomainControlManifest,
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
} from '../lib/domain-control-manifest.mts';

const NOW = '2026-08-07T00:00:00.000Z';
const PASSPHRASE = 'fixture archive passphrase';

function passport() {
  return buildDomainControlManifest({
    schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
    version: 1,
    expiresAt: '2026-09-07T00:00:00.000Z',
    entries: [{
      domain: 'private-target.example',
      nameservers: ['ns1.private-target.example'],
      ds: [],
      mx: ['10 mail.private-target.example'],
      caa: [],
      tlsIssuer: null,
      tlsSpkiSha256: null,
      registrarLock: 'required',
      renewalReviewAt: null,
      note: null,
    }],
  }, NOW);
}

function casePack() {
  return buildCliCasePack(JSON.stringify({
    version: CASE_SCHEMA_VERSION,
    cases: [{
      id: 'portable-case',
      domain: 'private-case.example',
      status: 'new',
      disposition: 'unreviewed',
      tags: [],
      notes: ['private note'],
      source: 'lookup',
      evidenceHistory: [],
      createdAt: NOW,
      updatedAt: NOW,
    }],
  }), { audience: 'public', reviewed: true }, NOW);
}

describe('interchange fidelity report', () => {
  test('reports exact browser and CLI passport compatibility without values', async () => {
    const report = await buildInterchangeFidelityReport(JSON.stringify(passport()), { generatedAt: NOW });
    assert.equal(report.artifact.id, 'domain_control_passport');
    assert.equal(report.verification.state, 'verified');
    assert.equal(report.compatibility.fidelity, 'semantic_exact_after_normalisation');
    assert.equal(report.compatibility.browser?.import, 'supported');
    assert.equal(report.compatibility.cli?.write, 'supported');
    const output = JSON.stringify(report);
    assert.doesNotMatch(output, /private-target|mail\.private/iu);
  });

  test('distinguishes normalised profile and workspace merges from lossy case packs', async () => {
    const profileCurrent = await buildInterchangeFidelityReport(JSON.stringify(buildBrandProfileExport([], NOW)), { generatedAt: NOW });
    assert.equal(profileCurrent.artifact.id, 'brand_profiles');
    assert.equal(profileCurrent.verification.state, 'structure_valid');
    assert.equal(profileCurrent.compatibility.fidelity, 'normalised_merge');

    const profilePrior = await buildInterchangeFidelityReport(JSON.stringify({
      schema: 'whoisleuth.brand-profiles', version: 2, exportedAt: NOW, profiles: [],
    }), { generatedAt: NOW });
    assert.equal(profilePrior.artifact.versionSupported, true);
    assert.equal(profilePrior.compatibility.fidelity, 'normalised_merge');

    const workspace = await buildWorkspaceArchive({}, { generatedAt: NOW });
    const workspaceReport = await buildInterchangeFidelityReport(JSON.stringify(workspace), { generatedAt: NOW });
    assert.equal(workspaceReport.artifact.id, 'workspace');
    assert.equal(workspaceReport.verification.state, 'verified');
    assert.equal(workspaceReport.compatibility.fidelity, 'normalised_merge');

    const packReport = await buildInterchangeFidelityReport(JSON.stringify(casePack()), { generatedAt: NOW });
    assert.equal(packReport.artifact.id, 'case_pack');
    assert.equal(packReport.compatibility.fidelity, 'lossy_by_design');
    assert.ok(packReport.compatibility.excludedFieldGroups.includes('audience_excluded_case_fields'));
    assert.doesNotMatch(JSON.stringify(packReport), /private-case|private note/iu);
  });

  test('separates encrypted-envelope inspection from authenticated verification', async () => {
    const workspace = await buildWorkspaceArchive({}, { generatedAt: NOW });
    const encrypted = await encryptWorkspaceArchive(workspace, PASSPHRASE);
    const raw = JSON.stringify(encrypted);
    const envelope = await buildInterchangeFidelityReport(raw, { generatedAt: NOW });
    assert.equal(envelope.verification.state, 'envelope_valid');
    assert.equal(envelope.summary.encryptedContentVerified, false);
    const verified = await buildInterchangeFidelityReport(raw, { generatedAt: NOW, passphrase: PASSPHRASE });
    assert.equal(verified.verification.state, 'verified');
    assert.equal(verified.summary.encryptedContentVerified, true);
    assert.doesNotMatch(JSON.stringify(verified), new RegExp(PASSPHRASE, 'u'));
  });

  test('reports unsupported, tampered, legacy, and unknown files without echoing content', async () => {
    const future = await buildInterchangeFidelityReport(JSON.stringify({
      schema: 'whoisleuth.brand-profiles', version: 99, profiles: [], secret: 'private.example',
    }), { generatedAt: NOW });
    assert.equal(future.recognised, true);
    assert.equal(future.verification.state, 'unsupported_version');
    assert.equal(future.compatibility.fidelity, 'unsupported');
    assert.doesNotMatch(JSON.stringify(future), /private\.example/iu);

    const changed = { ...passport(), expiresAt: '2026-08-08T00:00:00.000Z' };
    const tampered = await buildInterchangeFidelityReport(JSON.stringify(changed), { generatedAt: NOW });
    assert.equal(tampered.verification.state, 'not_verified');
    assert.equal(tampered.compatibility.fidelity, 'not_verified');

    const legacy = await buildInterchangeFidelityReport(JSON.stringify({
      schema: 'whoisleuth.desired-posture-baseline', schemaVersion: 1, baseline: { note: 'private legacy note' },
    }), { generatedAt: NOW });
    assert.equal(legacy.artifact.id, 'legacy_desired_baseline');
    assert.equal(legacy.compatibility.fidelity, 'unsupported');
    assert.doesNotMatch(JSON.stringify(legacy), /private legacy/iu);

    const unknown = await buildInterchangeFidelityReport(JSON.stringify({
      schema: 'private.example/schema', version: 1, note: 'private evidence value',
    }), { generatedAt: NOW });
    assert.equal(unknown.recognised, false);
    assert.equal(unknown.artifact.schema, null);
    assert.doesNotMatch(JSON.stringify(unknown), /private\.example|private evidence/iu);
  });

  test('runs through the installed CLI contract with metadata-only output', async () => {
    let stdout = '';
    let stderr = '';
    const code = await runCli(['interchange-report', 'passport.json', '--json'], {
      stdout: { write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } },
      readArtifactInput: async () => JSON.stringify(passport()),
      now: () => NOW,
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(stderr, '');
    assert.equal(JSON.parse(stdout).artifact.id, 'domain_control_passport');
    assert.doesNotMatch(stdout, /private-target/iu);
    assert.match(formatInterchangeFidelityReport(JSON.parse(stdout)), /semantic_exact_after_normalisation/u);
  });
});
