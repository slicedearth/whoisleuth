import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import { validateOfflineArtifactStructure } from '../cli/artifact-structure.mts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import * as casePack from '../cli/case-pack.mts';
import * as caseModel from '../frontend/src/lib/analysis/case-model.ts';
import * as caseReport from '../frontend/src/lib/analysis/case-report.ts';
import * as responsePacket from '../frontend/src/lib/analysis/case-response-packet.ts';
import * as encryptedWorkspace from '../frontend/src/lib/analysis/workspace-archive-crypto.ts';
import * as workspace from '../frontend/src/lib/analysis/workspace-archive.ts';
import * as contracts from '../packages/contracts/case-portability.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import { buildSchemaCompatibilityInventory } from '../tools/schema-compatibility.mts';

const NOW = '2026-08-22T00:00:00.000Z';
const PASSPHRASE = 'reserved fixture passphrase';
const FIXTURE_ROOT = new URL('./fixtures/case-lifecycle/', import.meta.url);

async function fixtureText(name: string): Promise<string> {
  return readFile(new URL(`${name}.json`, FIXTURE_ROOT), 'utf8');
}

async function fixture<T = unknown>(name: string): Promise<T> {
  return JSON.parse(await fixtureText(name)) as T;
}

function emptyWorkspaceInput() {
  return {
    cases: [],
    campaigns: [],
    brandProfiles: [],
    watchlists: {},
    shortlist: [],
    detectionRules: [],
    relationshipObservations: [],
    bulkSessions: [],
    websiteSnapshots: [],
    investigationTemplates: [],
    bulkReview: { schema: 'whoisleuth.bulk-review', version: 1, presets: [], rows: [] },
    settings: { activeProfileId: '', theme: 'system' },
  };
}

const packetInput = Object.freeze({
  profile: 'registrar',
  category: 'Reserved fixture review',
  affectedParty: 'Example service',
  abusiveUrls: ['https://history.example.test/review'],
  observedHarm: 'A reserved fixture condition was retained for review.',
  observedAt: NOW,
  contacts: [{
    kind: 'registrar',
    contact: 'abuse@example.test',
    source: 'reserved fixture',
    observedAt: NOW,
    limitations: [],
  }],
  readiness: {
    infrastructureResponsibility: { state: 'complete', detail: 'Reserved fixture responsibility was reviewed.', limitations: [] },
    authorityReview: { state: 'complete', detail: 'Reserved fixture authority was reviewed.', limitations: [] },
    contradictionsReview: { state: 'complete', detail: 'Reserved fixture contradictions were reviewed.', limitations: [] },
    sourceLimitations: { state: 'complete', detail: 'Reserved fixture source limits were reviewed.', limitations: [] },
  },
});

describe('canonical Case portability lifecycle', () => {
  test('owns exact facade identities and generated inventory rows', () => {
    assert.equal(caseModel.CASE_SCHEMA_VERSION, contracts.CASE_SCHEMA_VERSION);
    assert.equal(caseModel.CASE_IMPORT_VERSIONS, contracts.CASE_IMPORT_VERSIONS);
    assert.equal(caseReport.CASE_REPORT_SCHEMA, contracts.CASE_REPORT_SCHEMA);
    assert.equal(caseReport.CASE_REPORT_SCHEMA_VERSION, contracts.CASE_REPORT_SCHEMA_VERSION);
    assert.equal(responsePacket.CASE_RESPONSE_PACKET_SCHEMA, contracts.CASE_RESPONSE_PACKET_SCHEMA);
    assert.equal(responsePacket.SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS, contracts.SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS);
    assert.equal(casePack.CLI_CASE_PACK_SCHEMA, contracts.CLI_CASE_PACK_SCHEMA);
    assert.equal(workspace.SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS, contracts.SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS);
    assert.equal(workspace.WORKSPACE_ARCHIVE_CASE_SECTION, contracts.WORKSPACE_ARCHIVE_CASE_SECTION);
    assert.equal(workspace.WORKSPACE_ARCHIVE_SECTION_IDS, contracts.WORKSPACE_ARCHIVE_SECTION_IDS);
    assert.equal(workspace.WORKSPACE_SETTINGS_SCHEMA, contracts.WORKSPACE_SETTINGS_SCHEMA);
    assert.equal(workspace.WORKSPACE_SETTINGS_VERSION, contracts.WORKSPACE_SETTINGS_VERSION);
    assert.equal(encryptedWorkspace.ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA, contracts.ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA);

    const family = contracts.CASE_PORTABILITY_LIFECYCLE_FAMILY;
    assert.equal(family.compatibility.length, 9);
    assert.equal(family.contracts.length, 53);
    assert.equal(family.fixtures.length, 87);
    assert.equal(SCHEMA_LIFECYCLE_REGISTRY.length, 16);
    assert.equal(SCHEMA_LIFECYCLE_REGISTRY.flatMap((item) => item.compatibility).length, 83);
    assert.equal(SCHEMA_LIFECYCLE_REGISTRY.flatMap((item) => item.contracts).length, 182);
    assert.equal(SCHEMA_LIFECYCLE_REGISTRY.flatMap((item) => item.fixtures).length, 232);

    const [packetDispatch, casePackDispatch] = contracts.CASE_PORTABILITY_VERIFIER_DISPATCH;
    assert.equal(packetDispatch.schema, contracts.CASE_RESPONSE_PACKET_SCHEMA);
    assert.equal(packetDispatch.supportedVersions, contracts.SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS);
    assert.equal(casePackDispatch.schema, contracts.CLI_CASE_PACK_SCHEMA);
    assert.equal(casePackDispatch.supportedVersions, contracts.SUPPORTED_CLI_CASE_PACK_VERSIONS);
    const hookIds = new Set(family.metadata.hooks.map((hook) => hook.id));
    for (const dispatch of contracts.CASE_PORTABILITY_VERIFIER_DISPATCH) {
      assert.equal(hookIds.has(dispatch.structureHookId), true);
      assert.equal(hookIds.has(dispatch.integrityHookId), true);
    }

    const inventory = buildSchemaCompatibilityInventory();
    assert.equal(inventory.entries.length, 209);
    for (const descriptor of family.compatibility) {
      const row = inventory.entries.find((entry) => entry.id === descriptor.id);
      assert.deepEqual(row, descriptor);
    }
  });

  test('distinguishes readable history from frozen output-only history', () => {
    const family = contracts.CASE_PORTABILITY_LIFECYCLE_FAMILY;
    const reports = family.contracts.filter((contract) => contract.schema === contracts.CASE_REPORT_SCHEMA);
    assert.deepEqual(reports.filter((contract) => contract.lifecycle === 'retired').map((contract) => contract.version), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(reports.every((contract) => contract.readable === false), true);
    assert.deepEqual(reports.filter((contract) => contract.emitted).map((contract) => contract.version), [9]);

    const packets = family.contracts.filter((contract) => contract.schema === contracts.CASE_RESPONSE_PACKET_SCHEMA);
    assert.deepEqual(packets.filter((contract) => contract.lifecycle === 'retired').map((contract) => contract.version), [1, 2, 3, 4]);
    assert.deepEqual(packets.filter((contract) => contract.readable).map((contract) => contract.version), [5, 6, 7]);
    assert.deepEqual(packets.filter((contract) => contract.emitted).map((contract) => contract.version), [7]);

    for (const compatibility of family.compatibility) {
      const writers = family.contracts.filter((contract) => contract.compatibilityId === compatibility.id && contract.emitted);
      assert.deepEqual(writers.map((contract) => contract.version), [compatibility.currentVersion]);
    }
  });

  test('normalises every browser and portable Case epoch to frozen version-14 output', async () => {
    for (let version = 1; version <= 13; version += 1) {
      const source = await fixture(`browser-case-v${version}`);
      const actual = `${caseModel.serializeCaseStore(caseModel.normalizeCaseStore(source).cases)}\n`;
      assert.equal(actual, await fixtureText(`browser-case-v${version}-to-v14`), `browser Case v${version}`);
    }
    const unversioned = await fixture('browser-case-unversioned');
    assert.equal(
      `${caseModel.serializeCaseStore(caseModel.normalizeCaseStore(unversioned).cases)}\n`,
      await fixtureText('browser-case-unversioned-to-v14'),
    );
    for (let version = 2; version <= 13; version += 1) {
      const source = await fixture(`case-export-v${version}`);
      const merged = caseModel.mergeCases([], source);
      const actual = contracts.serialiseCasePortableJson(caseModel.buildCaseExport(merged.cases, NOW));
      assert.equal(actual, await fixtureText(`case-export-v${version}-to-v14`), `portable Case v${version}`);
    }
    const v12 = await fixture<Record<string, unknown>>('browser-case-v12');
    const migrated = caseModel.normalizeCaseStore(v12).cases[0];
    assert.ok(migrated);
    assert.equal(migrated.observedEffects.preV13HistoryUnavailable, true);
    assert.equal(migrated.closures.preV13HistoryUnavailable, true);
    assert.equal(migrated.actions.every((action) => action.history.every((event) => event.sourceClass === 'migration')), true);
  });

  test('verifies exact packet, Case-pack, workspace, and encrypted-workspace history', async () => {
    for (const version of contracts.SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS) {
      const packet = await fixture<Record<string, unknown>>(`case-response-packet-v${version}`);
      validateOfflineArtifactStructure(contracts.CASE_RESPONSE_PACKET_SCHEMA, packet);
      assert.equal(await responsePacket.verifyCaseResponsePacketIntegrity(packet as never), true, `packet v${version}`);
    }
    for (const version of contracts.SUPPORTED_CLI_CASE_PACK_VERSIONS) {
      const pack = await fixture(`cli-case-pack-v${version}`);
      assert.ok(casePack.verifyCliCasePack(pack).caseCount > 0, `Case-pack v${version}`);
      assert.ok(caseModel.mergeCases([], pack).added > 0, `browser Case-pack import v${version}`);
    }
    for (const version of contracts.SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS) {
      const archive = await fixture(`workspace-archive-v${version}`);
      const parsed = await workspace.readWorkspaceArchive(archive);
      assert.equal(parsed.sourceVersion, version);
      assert.equal(parsed.version, contracts.WORKSPACE_ARCHIVE_VERSION);
      assert.ok(parsed.sections.find((section) => section.id === contracts.WORKSPACE_ARCHIVE_CASE_SECTION.id));
    }
    const encrypted = await fixture('encrypted-workspace-archive-v1');
    const decrypted = await encryptedWorkspace.decryptWorkspaceArchive(encrypted, PASSPHRASE) as Record<string, unknown>;
    assert.equal(decrypted.schema, contracts.WORKSPACE_ARCHIVE_SCHEMA);
    assert.equal(decrypted.version, contracts.WORKSPACE_ARCHIVE_VERSION);
  });

  test('keeps current writer shapes byte-for-byte aligned with frozen outputs', async () => {
    const frozenExport = await fixture('case-export-v14');
    const cases = caseModel.mergeCases([], frozenExport).cases;
    const currentExport = caseModel.buildCaseExport(cases, NOW);
    assert.equal(contracts.serialiseCasePortableJson(currentExport), await fixtureText('case-export-v14'));

    const frozenWorkspace = await fixture<Record<string, unknown>>('workspace-archive-v5-case-v14-current');
    const currentCase = caseModel.normalizeCaseStore(
      (frozenWorkspace.sections as Record<string, unknown>).cases,
    ).cases[0];
    assert.ok(currentCase);
    assert.deepEqual(caseReport.buildCaseReport(currentCase, { generatedAt: NOW }).json, await fixture('case-report-v9'));
    assert.deepEqual((await responsePacket.buildCaseResponsePacket(currentCase, packetInput, NOW)).json, await fixture('case-response-packet-v7'));
    assert.deepEqual(casePack.buildCliCasePack(contracts.serialiseCasePortableJson(currentExport), { audience: 'internal', reviewed: true }, NOW), await fixture('cli-case-pack-v2-case-v14'));
    assert.deepEqual(
      await workspace.buildWorkspaceArchive({ ...emptyWorkspaceInput(), cases: [currentCase] }, { generatedAt: NOW }),
      frozenWorkspace,
    );
  });

  test('fails closed for future versions and undeclared portable fields', async () => {
    const currentExport = await fixture<Record<string, unknown>>('case-export-v14');
    assert.throws(() => caseModel.mergeCases([], { ...currentExport, version: 15 }), /newer version/iu);
    assert.throws(() => caseModel.mergeCases([], { ...currentExport, undeclared: true }), /undeclared envelope fields/iu);
    assert.throws(() => caseModel.mergeCases([], { version: 14, cases: 'invalid' }), /expected a WHOISleuth case export/iu);

    const packet = await fixture<Record<string, unknown>>('case-response-packet-v7');
    assert.throws(
      () => validateOfflineArtifactStructure(contracts.CASE_RESPONSE_PACKET_SCHEMA, { ...packet, undeclared: true }),
      /structure/iu,
    );
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify({ ...packet, version: 6 })),
      /version declarations do not agree/iu,
    );
    const currentPack = await fixture<Record<string, unknown>>('cli-case-pack-v2');
    assert.throws(() => casePack.verifyCliCasePack({ ...currentPack, undeclared: true }), /invalid|unexpected/iu);
    assert.throws(() => caseModel.mergeCases([], { ...currentPack, undeclared: true }), /undeclared envelope fields/iu);
    await assert.rejects(
      workspace.readWorkspaceArchive({ ...(await fixture<Record<string, unknown>>('workspace-archive-v5-current')), version: 6 }),
      /newer schema 6/iu,
    );
    const reviewInputs = await fixture<Record<string, unknown>>('case-response-review-inputs-v1');
    assert.throws(() => responsePacket.validateCaseResponseReviewInputs({ ...reviewInputs, version: 2 }), /unsupported version/iu);
    assert.throws(() => responsePacket.validateCaseResponseReviewInputs({ ...reviewInputs, undeclared: true }), /undeclared/iu);
    const nestedUnknown = structuredClone(reviewInputs);
    (nestedUnknown.profile as Record<string, unknown>).undeclared = true;
    assert.throws(() => responsePacket.validateCaseResponseReviewInputs(nestedUnknown), /undeclared/iu);
    const oversized = structuredClone(reviewInputs);
    oversized.contacts = Array.from({ length: contracts.MAX_RESPONSE_CONTACTS + 1 }, () => null);
    assert.throws(() => responsePacket.validateCaseResponseReviewInputs(oversized), /array bound/iu);
    const sparse = structuredClone(reviewInputs);
    sparse.contacts = new Array(1);
    assert.throws(() => responsePacket.validateCaseResponseReviewInputs(sparse), /dense ordinary array/iu);
    let conversionCalls = 0;
    const coercive = structuredClone(reviewInputs);
    (coercive.profile as Record<string, unknown>).id = {
      toString() {
        conversionCalls += 1;
        return 'registrar';
      },
    };
    assert.throws(() => responsePacket.validateCaseResponseReviewInputs(coercive), /profile is unsupported/iu);
    assert.equal(conversionCalls, 0);
    const validatedReviewInputs = responsePacket.validateCaseResponseReviewInputs(reviewInputs);
    assert.equal(Object.isFrozen(validatedReviewInputs), true);
    assert.equal(Object.isFrozen(validatedReviewInputs.profile), true);
    assert.equal(Object.isFrozen(validatedReviewInputs.contacts), true);
  });
});
