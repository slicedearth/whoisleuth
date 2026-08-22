import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildCaseSupportedContractBaseline,
  type CaseSupportedContractBaseline,
} from '../packages/contracts/case-supported-contract-baseline.mts';
import {
  CASE_RESPONSE_PACKET_OUTPUT_VERSIONS,
  CASE_SCHEMA_VERSION,
  CASE_BROWSER_SUPPORTED_VERSIONS,
  CLI_CASE_PACK_VERSION,
  ENCRYPTED_WORKSPACE_ARCHIVE_VERSION,
  PUBLIC_WORKSPACE_ARCHIVE_VERSION,
  SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS,
  WORKSPACE_ARCHIVE_VERSION,
} from '../packages/contracts/case-portability.mts';
import {
  assertCaseSupportedContractTransition,
  checkCaseSupportedContractBaseline,
} from '../tools/case-supported-contract-baseline.mts';

type MutableBaseline = Record<string, unknown> & {
  commitments: Record<string, unknown> & { contracts: Array<Record<string, unknown>> };
  removalRecords: Array<Record<string, unknown>>;
};

function mutableBaseline(): MutableBaseline {
  return structuredClone(buildCaseSupportedContractBaseline()) as unknown as MutableBaseline;
}

function reviewedRemoval(reason = 'reviewed_support_window'): Record<string, unknown> {
  return {
    id: 'reviewed-fixture-removal',
    reviewedAt: '2027-08-22',
    reason,
    contracts: [{ compatibilityId: 'export.cases', versions: [15] }],
    supportWindow: {
      firstRelease: '1.48.0',
      finalBroadReaderRelease: '1.49.0',
      removalRelease: '2.0.0',
    },
    safePath: 'Export schema 15 with the final broad-reader release before importing its replacement.',
    evidence: {
      fixturesUpdated: true,
      schemaInventoryUpdated: true,
      privacyDocumentationUpdated: true,
      cliGuidanceUpdated: true,
    },
  };
}

describe('durable Case supported-contract baseline', () => {
  test('matches lifecycle-derived commitments and the retained file', () => {
    const baseline = checkCaseSupportedContractBaseline();
    assert.equal(baseline.decision, 'retain_atomic_record_storage');
    assert.equal(new Set(baseline.commitments.contracts.map((contract) => contract.key)).size, baseline.commitments.contracts.length);
    assert.equal(new Set(baseline.commitments.fixtures.map((fixture) => fixture.id)).size, baseline.commitments.fixtures.length);
    assert.deepEqual(baseline.commitments.migrations.map(({ key, target }) => ({ key, target })), [
      { key: `browser.cases@${CASE_BROWSER_SUPPORTED_VERSIONS[0]}`, target: { schema: 'whoisleuth.browser.case-store', version: CASE_SCHEMA_VERSION } },
      { key: `export.cases@${CASE_BROWSER_SUPPORTED_VERSIONS[0]}`, target: { schema: 'whoisleuth.case-export', version: CASE_SCHEMA_VERSION } },
      { key: `export.workspace-archive@${PUBLIC_WORKSPACE_ARCHIVE_VERSION}`, target: { schema: 'whoisleuth.workspace-archive', version: WORKSPACE_ARCHIVE_VERSION } },
    ]);
    const compatibility = new Map(baseline.commitments.compatibility.map((item) => [item.id, item.supportedVersions]));
    assert.deepEqual(compatibility.get('browser.cases'), CASE_BROWSER_SUPPORTED_VERSIONS);
    assert.deepEqual(compatibility.get('export.cases'), CASE_BROWSER_SUPPORTED_VERSIONS);
    assert.deepEqual(compatibility.get('export.case-response-packet'), CASE_RESPONSE_PACKET_OUTPUT_VERSIONS);
    assert.deepEqual(compatibility.get('export.workspace-archive'), SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS);
    assert.equal(baseline.startingRevision, '9cfba099b950162f3b4b3467a0d8338470bb9c70');
    assert.equal(baseline.startingCurrentProtection.browserCase.version, CASE_SCHEMA_VERSION);
    assert.equal(baseline.startingCurrentProtection.workspaceArchive.version, WORKSPACE_ARCHIVE_VERSION);
    assert.equal(baseline.startingCurrentProtection.encryptedWorkspaceArchive.version, ENCRYPTED_WORKSPACE_ARCHIVE_VERSION);
    assert.equal(baseline.startingCurrentProtection.encryptedWorkspaceArchive.workspaceVersion, WORKSPACE_ARCHIVE_VERSION);
    assert.equal(baseline.startingCurrentProtection.cliCasePack.version, CLI_CASE_PACK_VERSION);
    assert.equal(baseline.commitments.publicContracts.compatibilityFacades.length > 0, true);
    assert.equal(baseline.commitments.rejectionBehaviour.retired.includes('without_mutation'), true);
  });

  test('rejects disappearance that reuses an old removal record', () => {
    const previous = mutableBaseline();
    previous.commitments.contracts.push({
      key: 'export.cases@15',
      compatibilityId: 'export.cases',
      version: 15,
      lifecycle: 'current',
      readable: true,
      emitted: true,
      exactKeys: true,
      extensionPolicy: 'closed',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: 'sorted-json-v2',
      byteBudget: 1,
      fixtureIds: [],
    });
    const current = mutableBaseline();
    const removal = reviewedRemoval();
    previous.removalRecords.push(structuredClone(removal));
    current.removalRecords.push(structuredClone(removal));
    assert.throws(
      () => assertCaseSupportedContractTransition(
        previous as unknown as CaseSupportedContractBaseline,
        current as unknown as CaseSupportedContractBaseline,
      ),
      /disappeared without a fresh explicit reviewed removal record/iu,
    );
  });

  test('accepts a disappearance only with a fresh reviewed removal and complete evidence', () => {
    const previous = mutableBaseline();
    previous.commitments.contracts.push({
      key: 'export.cases@15',
      compatibilityId: 'export.cases',
      version: 15,
      lifecycle: 'current',
      readable: true,
      emitted: true,
      exactKeys: true,
      extensionPolicy: 'closed',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: 'sorted-json-v2',
      byteBudget: 1,
      fixtureIds: [],
    });
    const current = mutableBaseline();
    current.removalRecords.push(reviewedRemoval());
    assert.doesNotThrow(() => assertCaseSupportedContractTransition(
      previous as unknown as CaseSupportedContractBaseline,
      current as unknown as CaseSupportedContractBaseline,
    ));
  });

  test('rejects a future removal that is not a reviewed support-window decision', () => {
    const previous = mutableBaseline();
    previous.commitments.contracts.push({
      key: 'export.cases@15',
      compatibilityId: 'export.cases',
      version: 15,
    });
    const current = mutableBaseline();
    current.removalRecords.push(reviewedRemoval('one_time_single_operator_consolidation'));
    assert.throws(
      () => assertCaseSupportedContractTransition(
        previous as unknown as CaseSupportedContractBaseline,
        current as unknown as CaseSupportedContractBaseline,
      ),
      /disappeared without a fresh explicit reviewed removal record/iu,
    );
  });
});
