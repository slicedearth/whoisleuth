import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildInterchangeFidelityReport,
  formatInterchangeFidelityReport,
} from '../cli/interchange-report.mts';
import { buildCliCasePack, CLI_CASE_PACK_VERSION } from '../cli/case-pack.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { buildBrandProfileExport, SUPPORTED_BRAND_PROFILE_SCHEMA_VERSIONS } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import { buildWorkspaceArchive, SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS } from '../frontend/src/lib/analysis/workspace-archive.ts';
import { encryptWorkspaceArchive, ENCRYPTED_WORKSPACE_ARCHIVE_VERSION } from '../frontend/src/lib/analysis/workspace-archive-crypto.ts';
import { DOMAIN_CONTROL_PASSPORT_VERSION } from '../frontend/src/lib/analysis/domain-control-manifest-core.ts';
import { sha256ArtifactDigest } from '../frontend/src/lib/analysis/artifact-integrity.ts';
import { CASE_SCHEMA_VERSION, normalizeCaseStore } from '../frontend/src/lib/analysis/case-model.ts';
import {
  buildDomainControlManifest,
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
} from '../lib/domain-control-manifest.mts';
import { interchangeContractFor } from '../lib/interchange-fidelity-registry.mts';
import { historicalCasePackFixture } from './historical-case-pack-fixtures.mts';

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

function casePack(audience: 'internal' | 'public' | 'trusted' = 'public') {
  return buildCliCasePack(JSON.stringify(normalizeCaseStore({
    version: CASE_SCHEMA_VERSION,
    cases: [{
      id: 'portable-case',
      domain: 'private-case.example',
      status: 'new',
      disposition: 'unreviewed',
      brandProfileIds: ['Profile_A'],
      tags: [],
      notes: [{ id: 'private-note', body: 'private note', createdAt: NOW }],
      source: 'lookup',
      evidenceHistory: [],
      createdAt: NOW,
      updatedAt: NOW,
    }],
  })), { audience, reviewed: true }, NOW);
}

async function casePackWithNestedReference() {
  const pack = structuredClone(casePack()) as unknown as Record<string, unknown>;
  (pack.packet as Record<string, unknown>).unexpected = { brandProfileIds: ['hidden-reference'] };
  const { integrity: _integrity, ...unsigned } = pack;
  return {
    ...unsigned,
    integrity: {
      algorithm: 'SHA-256',
      canonicalization: 'sorted-json-v1',
      digestSha256: await sha256ArtifactDigest(unsigned),
    },
  };
}

async function historicalInternalCasePackWithScalarProjection() {
  const pack = structuredClone(historicalCasePackFixture(11, 'internal'));
  const packet = pack.packet as Record<string, unknown>;
  const report = (packet.reports as Array<Record<string, unknown>>)[0]!;
  report.currentAssessment = 'private material';
  const { integrity: _integrity, ...unsigned } = pack;
  return {
    ...unsigned,
    integrity: {
      algorithm: 'SHA-256',
      canonicalization: 'sorted-json-v1',
      digestSha256: await sha256ArtifactDigest(unsigned),
    },
  };
}

describe('interchange fidelity report', () => {
  test('keeps portable contract versions bound to their authoritative owners', () => {
    assert.deepEqual(interchangeContractFor('domain_control_passport').versions, [DOMAIN_CONTROL_PASSPORT_VERSION]);
    assert.deepEqual(interchangeContractFor('brand_profiles').versions, [...SUPPORTED_BRAND_PROFILE_SCHEMA_VERSIONS]);
    assert.deepEqual(interchangeContractFor('workspace').versions, [...SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS]);
    assert.deepEqual(interchangeContractFor('encrypted_workspace').versions, [ENCRYPTED_WORKSPACE_ARCHIVE_VERSION]);
    assert.deepEqual(interchangeContractFor('case_pack').versions, [CLI_CASE_PACK_VERSION]);
    assert.equal(interchangeContractFor('domain_control_passport').requiredAssurance, 'whole_integrity');
    assert.equal(interchangeContractFor('brand_profiles').requiredAssurance, 'structure');
    assert.equal(interchangeContractFor('workspace').requiredAssurance, 'whole_integrity');
    assert.equal(interchangeContractFor('encrypted_workspace').requiredAssurance, 'authenticated_whole_integrity');
    assert.equal(interchangeContractFor('case_pack').requiredAssurance, 'whole_integrity');
  });

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
    assert.ok(packReport.compatibility.excludedFieldGroups.includes('public_audience_case_brand_profile_references'));
    assert.ok(packReport.compatibility.preservedFieldGroups.includes('trusted_internal_case_brand_profile_references'));
    assert.doesNotMatch(JSON.stringify(packReport), /private-case|private note|Profile_A/iu);
  });

  test('inherits strict case-pack verification for recomputed nested reference leaks', async () => {
    const report = await buildInterchangeFidelityReport(JSON.stringify(await casePackWithNestedReference()), { generatedAt: NOW });
    assert.equal(report.artifact.id, 'case_pack');
    assert.equal(report.verification.assuranceSatisfied, false);
    assert.equal(report.verification.state, 'not_verified');
    assert.equal(report.compatibility.fidelity, 'not_verified');
    assert.doesNotMatch(JSON.stringify(report), /hidden-reference/iu);
  });

  test('inherits historical internal Case-pack scalar projection closure', async () => {
    const report = await buildInterchangeFidelityReport(
      JSON.stringify(await historicalInternalCasePackWithScalarProjection()),
      { generatedAt: NOW },
    );
    assert.equal(report.artifact.id, 'case_pack');
    assert.equal(report.verification.assuranceSatisfied, false);
    assert.equal(report.compatibility.fidelity, 'not_verified');
    assert.doesNotMatch(JSON.stringify(report), /private material/iu);
  });

  test('reports authentic historical Case packs as verified and rejects changed evidence identities without echoing them', async () => {
    for (const audience of ['public', 'trusted', 'internal'] as const) {
      const authentic = historicalCasePackFixture(11, audience);
      const verified = await buildInterchangeFidelityReport(JSON.stringify(authentic), { generatedAt: NOW });
      assert.equal(verified.artifact.id, 'case_pack', audience);
      assert.equal(verified.verification.state, 'verified', audience);
      assert.equal(verified.compatibility.fidelity, 'lossy_by_design', audience);

      for (const field of ['id', 'fingerprint'] as const) {
        const changed = structuredClone(authentic);
        const item = (changed.cases as Array<Record<string, unknown>>)[0]!;
        const snapshot = (item.evidenceHistory as Array<Record<string, unknown>>)[0]!;
        snapshot[field] = field === 'id' ? 'ev-forged-private' : 'forged-private';
        const { integrity: _integrity, ...unsigned } = changed;
        changed.integrity = {
          algorithm: 'SHA-256',
          canonicalization: 'sorted-json-v1',
          digestSha256: await sha256ArtifactDigest(unsigned),
        };
        const rejected = await buildInterchangeFidelityReport(JSON.stringify(changed), { generatedAt: NOW });
        assert.equal(rejected.verification.assuranceSatisfied, false, `${audience} ${field}`);
        assert.equal(rejected.compatibility.fidelity, 'not_verified', `${audience} ${field}`);
        assert.doesNotMatch(JSON.stringify(rejected), /forged-private/iu);
      }
    }
  });

  test('uses the Brand Profile importer to reject malformed or partially skipped rows', async () => {
    const malformed = await buildInterchangeFidelityReport(JSON.stringify({
      schema: 'whoisleuth.brand-profiles', version: 6, exportedAt: NOW,
      profiles: [{ secret: 'private-value' }],
    }), { generatedAt: NOW });
    assert.equal(malformed.verification.assuranceSatisfied, false);
    assert.equal(malformed.compatibility.fidelity, 'not_verified');
    assert.equal(malformed.summary.acceptedRecordCount, 0);
    assert.equal(malformed.summary.skippedRecordCount, 1);
    assert.doesNotMatch(JSON.stringify(malformed), /private-value/iu);

    const mixed = await buildInterchangeFidelityReport(JSON.stringify({
      ...buildBrandProfileExport([], NOW),
      profiles: [{
        id: 'valid-profile', name: 'Valid profile', officialDomains: [], productNames: [], tlds: [],
        approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [], dkimSelectors: [],
        trademarkOwner: '', trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '',
        pageBaseline: null, createdAt: NOW, updatedAt: NOW,
      }, { invalid: true }],
    }), { generatedAt: NOW });
    assert.equal(mixed.summary.acceptedRecordCount, 1);
    assert.equal(mixed.summary.skippedRecordCount, 1);
    assert.equal(mixed.verification.assuranceSatisfied, false);
  });

  test('separates archive checksum validity from section importability', async () => {
    const workspace = structuredClone(await buildWorkspaceArchive({}, { generatedAt: NOW }));
    const cases = workspace.manifest.sections.find((section) => section.id === 'cases');
    assert.ok(cases);
    Reflect.set(workspace.sections.cases, 'version', 999);
    cases.version = 999;
    cases.bytes = new TextEncoder().encode(JSON.stringify(workspace.sections.cases)).byteLength;
    cases.checksum = await sha256ArtifactDigest(workspace.sections.cases);
    const report = await buildInterchangeFidelityReport(JSON.stringify(workspace), { generatedAt: NOW });
    assert.equal(report.verification.state, 'verified');
    assert.equal(report.verification.assuranceSatisfied, true);
    assert.equal(report.compatibility.fullyImportable, false);
    assert.equal(report.summary.unsupportedSectionCount, 1);
    assert.equal(report.compatibility.fidelity, 'not_verified');
  });

  test('withholds workspace fidelity for undeclared envelope data', async () => {
    const workspace = await buildWorkspaceArchive({}, { generatedAt: NOW });
    Reflect.set(workspace, 'uncheckedPolicy', { credential: 'private workspace material' });
    const report = await buildInterchangeFidelityReport(JSON.stringify(workspace), { generatedAt: NOW });
    assert.equal(report.verification.assuranceSatisfied, false);
    assert.equal(report.compatibility.fidelity, 'not_verified');
    assert.doesNotMatch(JSON.stringify(report), /private workspace material/iu);
  });

  test('withholds workspace fidelity when a supported section would skip malformed records', async () => {
    const workspace = structuredClone(await buildWorkspaceArchive({}, { generatedAt: NOW }));
    const profiles = workspace.manifest.sections.find((section) => section.id === 'brandProfiles');
    assert.ok(profiles);
    Reflect.set(workspace.sections.brandProfiles, 'profiles', [{ secret: 'private-malformed-profile' }]);
    profiles.recordCount = 1;
    workspace.manifest.totalRecords += 1;
    profiles.bytes = new TextEncoder().encode(JSON.stringify(workspace.sections.brandProfiles)).byteLength;
    profiles.checksum = await sha256ArtifactDigest(workspace.sections.brandProfiles);

    const report = await buildInterchangeFidelityReport(JSON.stringify(workspace), { generatedAt: NOW });
    assert.equal(report.verification.assuranceSatisfied, true);
    assert.equal(report.compatibility.fullyImportable, false);
    assert.equal(report.compatibility.fidelity, 'not_verified');
    assert.equal(report.summary.skippedRecordCount, 1);
    assert.equal(report.summary.unsupportedSectionCount, 0);
    assert.doesNotMatch(JSON.stringify(report), /private-malformed-profile/iu);

    const encrypted = await encryptWorkspaceArchive(workspace, PASSPHRASE);
    const encryptedReport = await buildInterchangeFidelityReport(JSON.stringify(encrypted), {
      generatedAt: NOW,
      passphrase: PASSPHRASE,
    });
    assert.equal(encryptedReport.verification.assuranceSatisfied, true);
    assert.equal(encryptedReport.compatibility.fullyImportable, false);
    assert.equal(encryptedReport.summary.skippedRecordCount, 1);
    assert.equal(encryptedReport.compatibility.fidelity, 'not_verified');
  });

  test('separates encrypted-envelope inspection from authenticated verification', async () => {
    const workspace = await buildWorkspaceArchive({}, { generatedAt: NOW });
    const encrypted = await encryptWorkspaceArchive(workspace, PASSPHRASE);
    const raw = JSON.stringify(encrypted);
    const envelope = await buildInterchangeFidelityReport(raw, { generatedAt: NOW });
    assert.equal(envelope.verification.state, 'envelope_valid');
    assert.equal(envelope.verification.requiredAssurance, 'authenticated_whole_integrity');
    assert.equal(envelope.verification.assuranceSatisfied, false);
    assert.equal(envelope.compatibility.fidelity, 'not_verified');
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
