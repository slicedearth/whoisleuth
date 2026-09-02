import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import { validateOfflineArtifactStructure } from '../cli/offline-artifact-validation.mts';
import * as casePack from '../cli/case-pack.mts';
import * as caseModel from '../frontend/src/lib/analysis/case-model.ts';
import * as caseReport from '../frontend/src/lib/analysis/case-report.ts';
import * as responsePacket from '../frontend/src/lib/analysis/case-response-packet.ts';
import * as encryptedWorkspace from '../frontend/src/lib/analysis/workspace-archive-crypto.ts';
import * as workspace from '../frontend/src/lib/analysis/workspace-archive.ts';
import * as contracts from '../packages/contracts/case-portability.mts';
import { buildCaseSupportedContractBaseline } from '../packages/contracts/case-supported-contract-baseline.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import { buildSchemaCompatibilityInventory } from '../tools/schema-compatibility.mts';

const NOW = '2026-08-22T00:00:00.000Z';
const PASSPHRASE = 'reserved fixture passphrase';
const FIXTURE_ROOT = new URL('./fixtures/case-lifecycle/', import.meta.url);
const REJECTION_FIXTURE = new URL('./fixtures/case-consolidation/unsupported-contracts-v1.json', import.meta.url);
const PUBLIC_CASE_EXPORT_FIXTURE = new URL('./fixtures/case-v12-response-lifecycle.json', import.meta.url);

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
    analystReviewState: { schema: 'whoisleuth.analyst-review-state', version: 1, records: [] },
    settings: { activeProfileId: '', theme: 'system' },
  };
}

function packetInput(actionId: string) {
  return {
    profile: 'registrar',
    category: 'Reserved fixture review',
    affectedParty: 'Example service',
    abusiveUrls: ['https://history.example.test/review'],
    observedHarm: 'A reserved fixture condition was retained for review.',
    observedAt: NOW,
    actionId,
    readiness: {
      infrastructureResponsibility: { state: 'complete', detail: 'Reserved fixture responsibility was reviewed.', limitations: [] },
      authorityReview: { state: 'complete', detail: 'Reserved fixture authority was reviewed.', limitations: [] },
      contradictionsReview: { state: 'complete', detail: 'Reserved fixture contradictions were reviewed.', limitations: [] },
      sourceLimitations: { state: 'complete', detail: 'Reserved fixture source limits were reviewed.', limitations: [] },
    },
  };
}

describe('canonical Case portability lifecycle', () => {
  test('owns current facade identities and one durable contract per compatibility family', () => {
    assert.equal(caseModel.CASE_SCHEMA_VERSION, contracts.CASE_SCHEMA_VERSION);
    assert.equal(caseModel.CASE_IMPORT_VERSIONS, contracts.CASE_IMPORT_VERSIONS);
    assert.equal(caseReport.CASE_REPORT_SCHEMA_VERSION, contracts.CASE_REPORT_SCHEMA_VERSION);
    assert.equal(responsePacket.SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS, contracts.SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS);
    assert.equal(casePack.CLI_CASE_PACK_VERSION, contracts.CLI_CASE_PACK_VERSION);
    assert.equal(workspace.SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS, contracts.SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS);
    assert.equal(encryptedWorkspace.ENCRYPTED_WORKSPACE_ARCHIVE_VERSION, contracts.ENCRYPTED_WORKSPACE_ARCHIVE_VERSION);

    assert.deepEqual([...contracts.CASE_BROWSER_SUPPORTED_VERSIONS], [12, 13, 14]);
    assert.deepEqual([...contracts.CASE_IMPORT_VERSIONS], [12, 13, 14]);
    assert.deepEqual([...contracts.CASE_REPORT_OUTPUT_VERSIONS], [9, 10]);
    assert.deepEqual([...contracts.SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS], [6, 7, 8]);
    assert.deepEqual([...contracts.SUPPORTED_CLI_CASE_PACK_VERSIONS], [2]);
    assert.deepEqual([...contracts.SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS], [5, 6, 7]);

    const family = contracts.CASE_PORTABILITY_LIFECYCLE_FAMILY;
    assert.ok(family.compatibility.length > 0);
    assert.ok(family.contracts.length > 0);
    assert.ok(family.fixtures.length > 0);
    assert.deepEqual(
      family.contracts.find((contract) => contract.schema === contracts.WORKSPACE_ARCHIVE_SCHEMA && contract.version === contracts.PUBLIC_WORKSPACE_ARCHIVE_VERSION)?.migrationTarget,
      { schema: contracts.WORKSPACE_ARCHIVE_SCHEMA, version: contracts.WORKSPACE_ARCHIVE_VERSION },
    );
    for (const descriptor of family.compatibility) {
      const owned = family.contracts.filter((contract) => contract.compatibilityId === descriptor.id);
      assert.deepEqual(owned.map((contract) => contract.version), [...descriptor.supportedVersions]);
      assert.equal(owned.at(-1)?.version, descriptor.currentVersion);
    }

    const baseline = buildCaseSupportedContractBaseline();
    assert.equal(new Set(baseline.commitments.contracts.map((contract) => contract.key)).size, baseline.commitments.contracts.length);
    assert.equal(new Set(baseline.commitments.fixtures.map((fixture) => fixture.id)).size, baseline.commitments.fixtures.length);

    const inventory = buildSchemaCompatibilityInventory();
    for (const descriptor of family.compatibility) {
      assert.deepEqual(inventory.entries.find((entry) => entry.id === descriptor.id), descriptor);
    }
  });

  test('verifies every durable current reader fixture and exact starting-checkout path', async () => {
    const browserStore = await fixture('browser-case-v14');
    assert.deepEqual(caseModel.normalizeCaseStore(browserStore), browserStore);
    assert.deepEqual(
      JSON.parse(caseModel.serializeCaseStore(caseModel.normalizeCaseStore(browserStore).cases)),
      browserStore,
    );

    for (const name of ['browser-case-v12', 'browser-case-v13']) {
      assert.deepEqual(caseModel.normalizeCaseStore(await fixture(name)), browserStore);
    }

    const currentExport = await fixture('case-export-v14');
    assert.equal(caseModel.mergeCases([], currentExport).added, 1);
    const publicExport = JSON.parse(await readFile(PUBLIC_CASE_EXPORT_FIXTURE, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(caseModel.buildCaseExport(caseModel.mergeCases([], publicExport).cases, NOW), currentExport);
    assert.deepEqual(
      caseModel.buildCaseExport(caseModel.mergeCases([], await fixture('case-export-v13')).cases, NOW),
      currentExport,
    );

    for (const name of ['case-response-packet-v6', 'case-response-packet-v7', 'case-response-packet-v8']) {
      const packet = await fixture<Record<string, unknown>>(name);
      validateOfflineArtifactStructure(contracts.CASE_RESPONSE_PACKET_SCHEMA, packet);
      assert.equal(await responsePacket.verifyCaseResponsePacketIntegrity(packet), true);
    }

    for (const name of ['cli-case-pack-v2-case-v12-public', 'cli-case-pack-v2-case-v13', 'cli-case-pack-v2-case-v14']) {
      const pack = await fixture(name);
      assert.ok(casePack.verifyCliCasePack(pack).caseCount > 0);
      assert.ok(caseModel.mergeCases([], pack).added > 0);
    }

    const archive = await fixture('workspace-archive-v5-public');
    const parsed = await workspace.readWorkspaceArchive(archive);
    assert.equal(parsed.sourceVersion, 5);
    assert.equal(parsed.version, contracts.WORKSPACE_ARCHIVE_VERSION);
    assert.ok(parsed.sections.find((section) => section.id === contracts.WORKSPACE_ARCHIVE_CASE_SECTION.id));
    const publishedV2Archive = await fixture('workspace-archive-v6-empty-current');
    const migratedPublishedV2 = await workspace.readWorkspaceArchive(publishedV2Archive);
    assert.equal(migratedPublishedV2.sourceVersion, 6);
    assert.equal(migratedPublishedV2.version, contracts.WORKSPACE_ARCHIVE_VERSION);

    const encrypted = await fixture('encrypted-workspace-archive-v1');
    const decrypted = await encryptedWorkspace.decryptWorkspaceArchive(encrypted, PASSPHRASE) as Record<string, unknown>;
    assert.equal(decrypted.schema, contracts.WORKSPACE_ARCHIVE_SCHEMA);
    assert.equal(decrypted.version, 5);
  });

  test('keeps current writer shapes byte-for-byte aligned with frozen outputs', async () => {
    const frozenExport = await fixture('case-export-v14');
    const cases = caseModel.mergeCases([], frozenExport).cases;
    const currentExport = caseModel.buildCaseExport(cases, NOW);
    assert.equal(contracts.serialiseCasePortableJson(currentExport), await fixtureText('case-export-v14'));

    const currentCase = cases[0];
    assert.ok(currentCase);
    const actionId = currentCase.actions[0]?.id;
    assert.ok(actionId);
    assert.deepEqual(caseReport.buildCaseReport(currentCase, { generatedAt: NOW }).json, await fixture('case-report-v10'));
    assert.deepEqual((await responsePacket.buildCaseResponsePacket(currentCase, packetInput(actionId), NOW)).json, await fixture('case-response-packet-v8'));
    assert.deepEqual(responsePacket.buildCaseResponseReviewInputs(currentCase, packetInput(actionId), NOW), await fixture('case-response-review-inputs-v2'));
    assert.deepEqual(
      casePack.buildCliCasePack(contracts.serialiseCasePortableJson(currentExport), { audience: 'internal', reviewed: true }, NOW),
      await fixture('cli-case-pack-v2-case-v14'),
    );
    assert.deepEqual(
      await workspace.buildWorkspaceArchive(emptyWorkspaceInput(), { generatedAt: (await fixture<Record<string, unknown>>('workspace-archive-v7-empty-current')).generatedAt }),
      await fixture('workspace-archive-v7-empty-current'),
    );
  });

  test('rejects retired, future, and malformed roots without reinterpreting or mutating them', async () => {
    const rejectionCorpus = JSON.parse(await readFile(REJECTION_FIXTURE, 'utf8')) as Record<string, unknown>;
    const retired = rejectionCorpus.retired as Record<string, unknown>;
    const future = rejectionCorpus.future as Record<string, unknown>;
    const retiredCase = retired.browserCase;
    const retiredCaseBefore = structuredClone(retiredCase);
    assert.throws(() => caseModel.mergeCases([], retiredCase), /schema 11 is not part of the supported compatibility boundary.*no data was changed/iu);
    assert.deepEqual(retiredCase, retiredCaseBefore);
    assert.throws(() => caseModel.mergeCases([], retired.portableCase), /schema 11 is not part of the supported compatibility boundary/iu);
    assert.throws(() => caseModel.mergeCases([], future.browserCase), /newer than the supported schema 14/iu);
    assert.throws(() => caseModel.mergeCases([], future.portableCase), /newer than the supported schema 14/iu);
    assert.throws(() => caseModel.mergeCases([], { version: 14, cases: 'invalid' }), /well-formed.*schema 14/iu);

    const malformedCurrent = await fixture<Record<string, unknown>>('case-export-v14');
    delete (((malformedCurrent.cases as Array<Record<string, unknown>>)[0]!.actions as Array<Record<string, unknown>>)[0]!).routeObservedAt;
    const malformedCurrentBefore = structuredClone(malformedCurrent);
    assert.throws(
      () => caseModel.mergeCases([], malformedCurrent),
      /schema 14 response actions must declare their route observation time.*no data was changed/iu,
    );
    assert.deepEqual(malformedCurrent, malformedCurrentBefore);

    assert.throws(
      () => validateOfflineArtifactStructure(
        contracts.CASE_RESPONSE_PACKET_SCHEMA,
        retired.responsePacket as Record<string, unknown>,
      ),
      /version 5 is not part of the public compatibility boundary.*no data was changed/iu,
    );
    assert.equal(await responsePacket.verifyCaseResponsePacketIntegrity(retired.responsePacket), false);
    assert.throws(
      () => validateOfflineArtifactStructure(
        contracts.CASE_RESPONSE_PACKET_SCHEMA,
        future.responsePacket as Record<string, unknown>,
      ),
      /version 9 is newer than the supported version 8.*no data was changed/iu,
    );

    assert.throws(
      () => casePack.verifyCliCasePack(retired.cliCasePack),
      /case-pack version 1 is retired.*no data was changed/iu,
    );
    assert.throws(
      () => casePack.verifyCliCasePack(future.cliCasePack),
      /case-pack version 3 is newer than the supported version 2.*no data was changed/iu,
    );
    await assert.rejects(
      workspace.readWorkspaceArchive(retired.workspaceArchive),
      /schema 4 is retired.*no data was changed/iu,
    );
    await assert.rejects(
      workspace.readWorkspaceArchive(future.workspaceArchive),
      /newer than the supported schema 7.*no data was changed/iu,
    );

    const currentExport = await fixture<Record<string, unknown>>('case-export-v14');
    assert.throws(() => caseModel.mergeCases([], { ...currentExport, undeclared: true }), /undeclared envelope fields/iu);
    const currentPack = await fixture<Record<string, unknown>>('cli-case-pack-v2-case-v14');
    assert.throws(() => casePack.verifyCliCasePack({ ...currentPack, undeclared: true }), /unexpected root envelope field/iu);
  });

  test('keeps exact bounded review-input validation for malformed, sparse, and future values', async () => {
    const publishedV2ReviewInputs = await fixture<Record<string, unknown>>('case-response-review-inputs-v1');
    const reviewInputs = await fixture<Record<string, unknown>>('case-response-review-inputs-v2');
    assert.throws(() => responsePacket.validateCaseResponseReviewInputs({ ...reviewInputs, version: 3 }), /unsupported version/iu);
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
    const validated = responsePacket.validateCaseResponseReviewInputs(reviewInputs);
    const validatedPublishedV2 = responsePacket.validateCaseResponseReviewInputs(publishedV2ReviewInputs);
    assert.equal(Object.isFrozen(validated), true);
    assert.equal(Object.isFrozen(validated.profile), true);
    assert.equal(Object.isFrozen(validated.contacts), true);
    assert.equal(Object.isFrozen(validatedPublishedV2), true);
  });
});
