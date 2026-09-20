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
const CURRENT_BROWSER = `browser-case-v${contracts.CASE_SCHEMA_VERSION}`;
const CURRENT_EXPORT = `case-export-v${contracts.CASE_SCHEMA_VERSION}`;
const CURRENT_REPORT = `case-report-v${contracts.CASE_REPORT_SCHEMA_VERSION}`;
const CURRENT_PACKET = `case-response-packet-v${contracts.CASE_RESPONSE_PACKET_VERSION}`;
const CURRENT_REVIEW_INPUTS = `case-response-review-inputs-v${contracts.CASE_RESPONSE_REVIEW_INPUTS_VERSION}`;

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
  test('keeps latest public writer identities backed by the frozen published formats', async () => {
    assert.equal(contracts.LATEST_PUBLIC_APPLICATION_VERSION, '2.3.0');
    assert.equal(contracts.LATEST_PUBLIC_CASE_SCHEMA_VERSION, (await fixture<{ version: number }>('browser-case-v15')).version);
    assert.equal(contracts.LATEST_PUBLIC_CASE_REPORT_SCHEMA_VERSION, (await fixture<{ schemaVersion: number }>('case-report-v11')).schemaVersion);
    assert.equal(contracts.LATEST_PUBLIC_CASE_RESPONSE_PACKET_VERSION, (await fixture<{ schemaVersion: number }>('case-response-packet-v9')).schemaVersion);
    assert.equal(contracts.LATEST_PUBLIC_CASE_RESPONSE_REVIEW_INPUTS_VERSION, (await fixture<{ version: number }>('case-response-review-inputs-v3')).version);
    assert.equal(contracts.LATEST_PUBLIC_WORKSPACE_ARCHIVE_VERSION, (await fixture<{ version: number }>('workspace-archive-v8-empty-current')).version);
  });

  test('owns current facade identities and one durable contract per compatibility family', () => {
    assert.equal(caseModel.CASE_SCHEMA_VERSION, contracts.CASE_SCHEMA_VERSION);
    assert.equal(caseModel.CASE_IMPORT_VERSIONS, contracts.CASE_IMPORT_VERSIONS);
    assert.equal(caseReport.CASE_REPORT_SCHEMA_VERSION, contracts.CASE_REPORT_SCHEMA_VERSION);
    assert.equal(responsePacket.SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS, contracts.SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS);
    assert.equal(casePack.CLI_CASE_PACK_VERSION, contracts.CLI_CASE_PACK_VERSION);
    assert.equal(workspace.SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS, contracts.SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS);
    assert.equal(encryptedWorkspace.ENCRYPTED_WORKSPACE_ARCHIVE_VERSION, contracts.ENCRYPTED_WORKSPACE_ARCHIVE_VERSION);

    assert.deepEqual([...contracts.CASE_BROWSER_SUPPORTED_VERSIONS], [12, 13, 14, 15, contracts.CASE_SCHEMA_VERSION]);
    assert.deepEqual([...contracts.CASE_IMPORT_VERSIONS], [12, 13, 14, 15, contracts.CASE_SCHEMA_VERSION]);
    assert.deepEqual([...contracts.CASE_REPORT_OUTPUT_VERSIONS], [9, 10, 11, contracts.CASE_REPORT_SCHEMA_VERSION]);
    assert.deepEqual([...contracts.SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS], [6, 7, 8, 9, contracts.CASE_RESPONSE_PACKET_VERSION]);
    assert.deepEqual([...contracts.SUPPORTED_CLI_CASE_PACK_VERSIONS], [2]);
    assert.deepEqual([...contracts.SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS], [5, 6, 7, 8, 9]);

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

  test('describes the exact compact browser writer without adding a trailing newline', () => {
    const bytes = caseModel.serializeCaseStore([]);
    assert.equal(bytes, `{"version":${contracts.CASE_SCHEMA_VERSION},"cases":[]}`);
    const profile = contracts.CASE_PORTABILITY_LIFECYCLE_FAMILY.metadata.serialisationProfiles
      .find((item) => item.schema === contracts.CASE_BROWSER_STORE_LIFECYCLE_SCHEMA);
    assert.ok(profile);
    assert.equal(profile.indentSpaces, 0);
    assert.equal(profile.terminalLf, false);
  });

  test('retains unknown source times through migration, storage, export and reports', () => {
    for (const version of [15, contracts.CASE_SCHEMA_VERSION]) {
      const record = caseModel.createCase({ domain: 'undated.example.test',
        evidencePin: { label: 'Retained observation', value: 'Source fact', observedAt: null },
        sighting: { state: 'reported_by_provider', source: 'Fixture report', observedAt: null },
      }, NOW);
      assert.equal(record.evidencePins.length, 1);
      assert.equal(record.sightings.length, 1);
      const imported = caseModel.normalizeCaseStore({ version, cases: [record] });
      const restored = caseModel.normalizeCaseStore(JSON.parse(caseModel.serializeCaseStore(imported.cases)));
      const exported = caseModel.buildCaseExport(restored.cases, NOW);
      const merged = caseModel.mergeCases([], exported).cases[0]!;
      assert.equal(merged.evidencePins[0]!.observedAt, null);
      assert.equal(merged.sightings[0]!.observedAt, null);
      assert.equal(merged.evidencePins[0]!.createdAt, record.evidencePins[0]!.createdAt);
      const report = caseReport.buildCaseReport(merged, { generatedAt: NOW });
      assert.match(report.markdown, /Observation time unavailable/iu);
      assert.equal(JSON.stringify(report.json).includes('"observedAt":null'), true);
    }
  });

  test('published review inputs reject unknown pin times while the new writer retains them', async () => {
    for (const [name, accepted] of [['case-response-review-inputs-v3', false], [CURRENT_REVIEW_INPUTS, true]] as const) {
      const input = await fixture<Record<string, unknown>>(name);
      input.selectedEvidence = [{ id: 'undated-pin', label: 'Retained observation', source: 'Fixture',
        observedAt: null, completeness: 'complete', limitations: [],
      }];
      if (accepted) assert.doesNotThrow(() => responsePacket.validateCaseResponseReviewInputs(input));
      else assert.throws(() => responsePacket.validateCaseResponseReviewInputs(input), /observation time/iu);
    }
  });

  test('verifies every durable current reader fixture and exact starting-checkout path', async () => {
    const browserStore = await fixture(CURRENT_BROWSER);
    assert.deepEqual(caseModel.normalizeCaseStore(browserStore), browserStore);
    assert.deepEqual(
      JSON.parse(caseModel.serializeCaseStore(caseModel.normalizeCaseStore(browserStore).cases)),
      browserStore,
    );

    for (const name of ['browser-case-v12', 'browser-case-v13', 'browser-case-v14', 'browser-case-v15']) {
      assert.deepEqual(caseModel.normalizeCaseStore(await fixture(name)), browserStore);
    }

    const currentExport = await fixture(CURRENT_EXPORT);
    assert.equal(caseModel.mergeCases([], currentExport).added, 1);
    const publicExport = JSON.parse(await readFile(PUBLIC_CASE_EXPORT_FIXTURE, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(caseModel.buildCaseExport(caseModel.mergeCases([], publicExport).cases, NOW), currentExport);
    assert.deepEqual(
      caseModel.buildCaseExport(caseModel.mergeCases([], await fixture('case-export-v13')).cases, NOW),
      currentExport,
    );
    assert.deepEqual(
      caseModel.buildCaseExport(caseModel.mergeCases([], await fixture('case-export-v14')).cases, NOW),
      currentExport,
    );

    for (const name of ['case-response-packet-v6', 'case-response-packet-v7', 'case-response-packet-v8', 'case-response-packet-v9', CURRENT_PACKET]) {
      const packet = await fixture<Record<string, unknown>>(name);
      validateOfflineArtifactStructure(contracts.CASE_RESPONSE_PACKET_SCHEMA, packet);
      assert.equal(await responsePacket.verifyCaseResponsePacketIntegrity(packet), true);
    }

    for (const name of ['cli-case-pack-v2-case-v12-public', 'cli-case-pack-v2-case-v13', 'cli-case-pack-v2-case-v14', 'cli-case-pack-v2-case-v15', 'cli-case-pack-v2-case-v15-current', contracts.CLI_CASE_PACK_WRITER_FIXTURE_ID]) {
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
    const latestPublicArchive = await fixture('workspace-archive-v7-empty-current');
    const migratedLatestPublic = await workspace.readWorkspaceArchive(latestPublicArchive);
    assert.equal(migratedLatestPublic.sourceVersion, 7);
    assert.equal(migratedLatestPublic.version, contracts.WORKSPACE_ARCHIVE_VERSION);

    const encrypted = await fixture('encrypted-workspace-archive-v1');
    const decrypted = await encryptedWorkspace.decryptWorkspaceArchive(encrypted, PASSPHRASE) as Record<string, unknown>;
    assert.equal(decrypted.schema, contracts.WORKSPACE_ARCHIVE_SCHEMA);
    assert.equal(decrypted.version, 5);
  });

  test('keeps fixed writer shapes aligned without coupling independently versioned archive sections', async () => {
    const frozenExport = await fixture('case-export-v15');
    const cases = caseModel.mergeCases([], frozenExport).cases;
    const currentExport = caseModel.buildCaseExport(cases, NOW);
    assert.equal(contracts.serialiseCasePortableJson(currentExport), await fixtureText(CURRENT_EXPORT));

    const currentCase = cases[0];
    assert.ok(currentCase);
    const actionId = currentCase.actions[0]?.id;
    assert.ok(actionId);
    assert.deepEqual(caseReport.buildCaseReport(currentCase, { generatedAt: NOW }).json, await fixture(CURRENT_REPORT));
    assert.deepEqual((await responsePacket.buildCaseResponsePacket(currentCase, packetInput(actionId), NOW)).json, await fixture(CURRENT_PACKET));
    assert.deepEqual(responsePacket.buildCaseResponseReviewInputs(currentCase, packetInput(actionId), NOW), await fixture(CURRENT_REVIEW_INPUTS));
    assert.deepEqual(
      casePack.buildCliCasePack(contracts.serialiseCasePortableJson(currentExport), { audience: 'internal', reviewed: true }, NOW),
      await fixture(contracts.CLI_CASE_PACK_WRITER_FIXTURE_ID),
    );
    const frozenArchive = await fixture<workspace.WorkspaceArchiveDocument>(`workspace-archive-v${contracts.WORKSPACE_ARCHIVE_VERSION}-empty-current`);
    const archive = await workspace.buildWorkspaceArchive(emptyWorkspaceInput(), { generatedAt: frozenArchive.generatedAt });
    const { manifest: frozenManifest, sections: frozenSections, ...frozenEnvelope } = frozenArchive;
    const { manifest, sections, ...envelope } = archive;
    assert.deepEqual(envelope, frozenEnvelope);
    assert.deepEqual(Object.keys(sections), Object.keys(frozenSections));
    assert.deepEqual(Object.keys(manifest), Object.keys(frozenManifest));
    assert.equal(manifest.sectionCount, frozenManifest.sectionCount);
    assert.equal(manifest.totalRecords, frozenManifest.totalRecords);
    // Each section has its own immutable version fixtures. Updating one must
    // not rewrite a historical archive or advance the unchanged outer format.
    assert.deepEqual(manifest.sections.map(({ id, schema, recordCount }) => ({ id, schema, recordCount })),
      frozenManifest.sections.map(({ id, schema, recordCount }) => ({ id, schema, recordCount })));
    for (const candidate of [frozenArchive, archive]) {
      const read = await workspace.readWorkspaceArchive(candidate);
      assert.ok(read.sections.length > 0);
      assert.ok(read.sections.every((section) => section.status === 'ready'));
    }
  });

  test('rejects retired, future, and malformed roots without reinterpreting or mutating them', async () => {
    assert.equal(caseModel.parseStoreVersion({ version: 16 }), 16);
    const rejectionCorpus = JSON.parse(await readFile(REJECTION_FIXTURE, 'utf8')) as Record<string, unknown>;
    const retired = rejectionCorpus.retired as Record<string, unknown>;
    const future = rejectionCorpus.future as Record<string, unknown>;
    const retiredCase = retired.browserCase;
    const retiredCaseBefore = structuredClone(retiredCase);
    assert.throws(() => caseModel.mergeCases([], retiredCase), /schema 11 is not part of the supported compatibility boundary.*no data was changed/iu);
    assert.deepEqual(retiredCase, retiredCaseBefore);
    assert.throws(() => caseModel.mergeCases([], retired.portableCase), /schema 11 is not part of the supported compatibility boundary/iu);
    assert.throws(() => caseModel.mergeCases([], future.browserCase), /newer than the supported schema/iu);
    assert.throws(() => caseModel.mergeCases([], future.portableCase), /newer than the supported schema/iu);
    assert.throws(() => caseModel.mergeCases([], { version: contracts.CASE_SCHEMA_VERSION, cases: 'invalid' }), /well-formed.*schema/iu);

    const malformedCurrent = await fixture<Record<string, unknown>>(CURRENT_EXPORT);
    delete (((malformedCurrent.cases as Array<Record<string, unknown>>)[0]!.actions as Array<Record<string, unknown>>)[0]!).routeReviewAfter;
    const malformedCurrentBefore = structuredClone(malformedCurrent);
    assert.throws(
      () => caseModel.mergeCases([], malformedCurrent),
      /response actions must declare their route review deadline.*no data was changed/iu,
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
      /newer than the supported version.*no data was changed/iu,
    );

    assert.throws(
      () => casePack.verifyCliCasePack(retired.cliCasePack),
      /case-pack version 1 is retired.*no data was changed/iu,
    );
    assert.throws(
      () => casePack.verifyCliCasePack(future.cliCasePack),
      /case-pack version .* is newer than the supported version 2.*no data was changed/iu,
    );
    await assert.rejects(
      workspace.readWorkspaceArchive(retired.workspaceArchive),
      /schema 4 is retired.*no data was changed/iu,
    );
    await assert.rejects(
      workspace.readWorkspaceArchive({ ...(future.workspaceArchive as Record<string, unknown>), version: contracts.WORKSPACE_ARCHIVE_VERSION + 1 }),
      /newer than the supported schema.*no data was changed/iu,
    );

    const currentExport = await fixture<Record<string, unknown>>(CURRENT_EXPORT);
    assert.throws(() => caseModel.mergeCases([], { ...currentExport, undeclared: true }), /undeclared envelope fields/iu);
    const currentPack = await fixture<Record<string, unknown>>(contracts.CLI_CASE_PACK_WRITER_FIXTURE_ID);
    assert.throws(() => casePack.verifyCliCasePack({ ...currentPack, undeclared: true }), /unexpected root envelope field/iu);
  });

  test('keeps exact bounded review-input validation for malformed, sparse, and future values', async () => {
    const publishedV2ReviewInputs = await fixture<Record<string, unknown>>('case-response-review-inputs-v1');
    const latestPublicReviewInputs = await fixture<Record<string, unknown>>('case-response-review-inputs-v2');
    const reviewInputs = await fixture<Record<string, unknown>>(CURRENT_REVIEW_INPUTS);
    assert.throws(() => responsePacket.validateCaseResponseReviewInputs({ ...reviewInputs, version: Number.MAX_SAFE_INTEGER }), /unsupported version/iu);
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
    const validatedLatestPublic = responsePacket.validateCaseResponseReviewInputs(latestPublicReviewInputs);
    const validatedPublishedV2 = responsePacket.validateCaseResponseReviewInputs(publishedV2ReviewInputs);
    assert.equal(Object.isFrozen(validated), true);
    assert.equal(Object.isFrozen(validated.profile), true);
    assert.equal(Object.isFrozen(validated.contacts), true);
    assert.equal(Object.isFrozen(validatedLatestPublic), true);
    assert.equal(Object.isFrozen(validatedPublishedV2), true);
  });
});
