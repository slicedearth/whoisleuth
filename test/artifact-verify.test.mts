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
import { buildInvestigationCapsule } from '../frontend/src/lib/analysis/investigation-capsule.ts';
import { buildCliCasePack } from '../cli/case-pack.mts';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model.ts';

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
    assert.equal(report.summary.unsupportedSectionCount, 0);
    const terminal = formatOfflineArtifactVerification(report);
    assert.doesNotMatch(terminal, /fixture archive passphrase/u);
    assert.doesNotMatch(terminal, /"cases"/u);
  });

  test('reports integrity-valid archive sections that this version cannot import', async () => {
    const archive = structuredClone(await buildWorkspaceArchive({}, {
      generatedAt: '2026-07-15T00:00:00.000Z',
    }));
    const cases = archive.manifest.sections.find((section) => section.id === 'cases');
    assert.ok(cases);
    Reflect.set(archive.sections.cases, 'version', 999);
    cases.version = 999;
    cases.bytes = new TextEncoder().encode(JSON.stringify(archive.sections.cases)).byteLength;
    cases.checksum = await sha256ArtifactDigest(archive.sections.cases);
    const report = await verifyOfflineArtifact(JSON.stringify(archive));
    assert.equal(report.state, 'verified');
    assert.equal(report.valid, true);
    assert.equal(report.summary.unsupportedSectionCount, 1);
    assert.match(report.limitations.join(' '), /cannot be imported/iu);
  });

  test('keeps integrity valid while reporting malformed ordinary and encrypted workspace records as partially importable', async () => {
    const archive = structuredClone(await buildWorkspaceArchive({}, {
      generatedAt: '2026-07-15T00:00:00.000Z',
    }));
    const profiles = archive.manifest.sections.find((section) => section.id === 'brandProfiles');
    assert.ok(profiles);
    Reflect.set(archive.sections.brandProfiles, 'profiles', [{ secret: 'must-not-appear' }]);
    profiles.recordCount = 1;
    archive.manifest.totalRecords += 1;
    profiles.bytes = new TextEncoder().encode(JSON.stringify(archive.sections.brandProfiles)).byteLength;
    profiles.checksum = await sha256ArtifactDigest(archive.sections.brandProfiles);

    const ordinary = await verifyOfflineArtifact(JSON.stringify(archive));
    assert.equal(ordinary.valid, true);
    assert.equal(ordinary.summary.fullyImportable, false);
    assert.equal(ordinary.summary.skippedRecordCount, 1);
    assert.equal(ordinary.summary.unsupportedSectionCount, 0);
    assert.doesNotMatch(JSON.stringify(ordinary), /must-not-appear/iu);

    const encrypted = await encryptWorkspaceArchive(archive, PASSPHRASE);
    const decrypted = await verifyOfflineArtifact(JSON.stringify(encrypted), { passphrase: PASSPHRASE });
    assert.equal(decrypted.valid, true);
    assert.equal(decrypted.summary.fullyImportable, false);
    assert.equal(decrypted.summary.skippedRecordCount, 1);
    assert.doesNotMatch(JSON.stringify(decrypted), /must-not-appear|fixture archive passphrase/iu);
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

  test('verifies a reviewed CLI case pack before browser import', async () => {
    const cases = {
      version: CASE_SCHEMA_VERSION,
      cases: [{
        id: 'portable-case', domain: 'portable.invalid', status: 'new', disposition: 'unreviewed',
        tags: [], notes: [], source: 'lookup', evidenceHistory: [],
        createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
      }],
    };
    const pack = buildCliCasePack(JSON.stringify(cases), {
      audience: 'trusted',
      reviewed: true,
    }, '2026-07-15T01:00:00.000Z');
    const report = await verifyOfflineArtifact(JSON.stringify(pack));
    assert.equal(report.artifact.kind, 'cli_case_pack');
    assert.equal(report.artifact.schema, 'whoisleuth.cli.case-pack');
    assert.equal(report.summary.recordCount, 1);
    assert.equal(report.checks.contentIntegrity, 'verified');

    const changed = structuredClone(pack);
    changed.cases[0]!.status = 'closed';
    await assert.rejects(verifyOfflineArtifact(JSON.stringify(changed)), /failed its SHA-256/iu);
  });

  test('validates saved Lookup structure without claiming content integrity', async () => {
    const lookup = {
      schema: 'whoisleuth.cli.lookup',
      version: 1,
      generatedAt: '2026-07-15T00:00:00.000Z',
      mode: 'fast',
      query: 'example.test',
      type: 'domain',
      registrableDomain: 'example.test',
      diagnostics: {
        rdap: { status: 'success' },
        whois: { status: 'skipped' },
      },
      rdap: { parsed: { domain: 'EXAMPLE.TEST' } },
    };
    const report = await verifyOfflineArtifact(JSON.stringify(lookup));
    assert.equal(report.artifact.kind, 'saved_lookup');
    assert.equal(report.state, 'structure_valid');
    assert.equal(report.checks.structure, 'verified');
    assert.equal(report.checks.contentIntegrity, 'not_checked');
    assert.match(report.limitations[0] || '', /no embedded checksum or signature/u);

    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify({ ...lookup, diagnostics: { rdap: { status: 'success' }, whois: { status: 'complete' } } })),
      /missing normalised parsed data/iu,
    );
  });

  test('verifies a whole investigation capsule and detects changed embedded projections', async () => {
    const graph = {
      version: 2 as const,
      targetId: 'target-example',
      nodes: [{ id: 'target-example', label: 'example.test', kind: 'target' as const, detail: 'Lookup target' }],
      edges: [], sources: [], truncated: false, limitations: [],
    };
    const brief = {
      schema: 'whoisleuth.investigation-brief' as const, schemaVersion: 1 as const,
      generatedAt: '2026-08-04T00:00:00.000Z', target: 'example.test', targetType: 'domain',
      task: 'general' as const, taskLabel: 'General review', question: 'What is known?', summary: 'Review evidence.',
      observation: { observedAt: '2026-08-04T00:00:00.000Z', evidenceAgeDays: 0, completeSources: 1, limitedSources: 0, freshnessPolicy: { version: 1 as const, id: 'task-default' as const, task: 'general' as const, thresholdsDays: { registration: 30, network: 7, web: 3 } } },
      verifiedFacts: [], contradictions: [], unknowns: [], nextActions: [],
      relationships: { nodes: 1, edges: 0, truncated: false, kinds: [] }, limitations: [],
    };
    const capsule = await buildInvestigationCapsule({
      applicationVersion: '1.36.1', lookupEvidence: { schema: 'whoisleuth.lookup-evidence', schemaVersion: 24 },
      brief, graph, generatedAt: '2026-08-04T01:00:00Z',
    });
    const report = await verifyOfflineArtifact(JSON.stringify(capsule));
    assert.equal(report.artifact.kind, 'investigation_capsule');
    assert.equal(report.checks.contentIntegrity, 'verified');
    await assert.rejects(verifyOfflineArtifact(JSON.stringify({
      ...capsule,
      graphSnapshot: { ...capsule.graphSnapshot, nodes: [{ ...capsule.graphSnapshot.nodes[0]!, label: 'changed.test' }] },
    })), /embedded projection integrity/u);
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
