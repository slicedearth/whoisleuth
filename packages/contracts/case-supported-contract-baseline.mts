import {
  CASE_DOMAIN_COMPATIBILITY_FACADES,
  CASE_DOMAIN_RUNTIME_ADAPTERS,
  CASE_PORTABILITY_IDENTITY_CONSTANTS,
  CASE_PORTABILITY_LIFECYCLE_FAMILY,
  CASE_PORTABILITY_VERIFIER_DISPATCH,
  CASE_RESPONSE_PACKET_VERSION,
  CASE_REPORT_SCHEMA_VERSION,
  CASE_SCHEMA_VERSION,
  CLI_CASE_PACK_VERSION,
  ENCRYPTED_WORKSPACE_ARCHIVE_VERSION,
  WORKSPACE_ARCHIVE_VERSION,
} from './case-portability.mts';

export const CASE_SUPPORTED_CONTRACT_BASELINE_SCHEMA = 'whoisleuth.case-supported-contract-baseline';
export const CASE_SUPPORTED_CONTRACT_BASELINE_VERSION = 1;
export const CASE_SUPPORTED_CONTRACT_BASELINE_STARTING_REVISION = '9cfba099b950162f3b4b3467a0d8338470bb9c70';

type RemovedContractRange = Readonly<{
  compatibilityId: string;
  versions: readonly number[];
}>;

type CompatibilityRemovalRecord = Readonly<{
  id: string;
  reviewedAt: string;
  reason: 'reviewed_support_window';
  contracts: readonly RemovedContractRange[];
  supportWindow: Readonly<{
    firstRelease: string;
    finalBroadReaderRelease: string;
    removalRelease: string;
  }>;
  safePath: string;
  evidence: Readonly<{
    fixturesUpdated: true;
    schemaInventoryUpdated: true;
    privacyDocumentationUpdated: true;
    cliGuidanceUpdated: true;
  }>;
}>;

export const CASE_COMPATIBILITY_REMOVALS: readonly CompatibilityRemovalRecord[] = Object.freeze([]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function contractKey(compatibilityId: string, version: number): string {
  return `${compatibilityId}@${version}`;
}

export function buildCaseSupportedContractBaseline() {
  const family = CASE_PORTABILITY_LIFECYCLE_FAMILY;
  const compatibilityIdByContract = new Map(family.contracts.map((contract) => [
    `${contract.schema}@${contract.version}`,
    contract.compatibilityId,
  ]));
  const compatibilityIdFor = (schema: string, version: number): string => {
    const compatibilityId = compatibilityIdByContract.get(`${schema}@${version}`);
    if (!compatibilityId) throw new TypeError(`Case lifecycle contract ${schema}@${version} has no compatibility owner.`);
    return compatibilityId;
  };
  const contracts = family.contracts
    .filter((contract) => contract.lifecycle !== 'retired')
    .map((contract) => Object.freeze({
      key: contractKey(contract.compatibilityId, contract.version),
      compatibilityId: contract.compatibilityId,
      version: contract.version,
      lifecycle: contract.lifecycle,
      readable: contract.readable,
      emitted: contract.emitted,
      exactKeys: contract.exactKeys,
      extensionPolicy: contract.extensionPolicy,
      futureVersionBehaviour: contract.futureVersionBehaviour,
      migrationTarget: contract.migrationTarget,
      canonicalisation: contract.canonicalisation,
      byteBudget: contract.byteBudget,
      fixtureIds: [...contract.fixtureIds].sort(compareText),
    }))
    .sort((left, right) => compareText(left.key, right.key));
  const compatibility = family.compatibility
    .map((descriptor) => Object.freeze({
      id: descriptor.id,
      kind: descriptor.kind,
      schema: descriptor.schema,
      currentVersion: descriptor.currentVersion,
      supportedVersions: [...descriptor.supportedVersions],
      acceptsUnversionedLegacy: descriptor.acceptsUnversionedLegacy,
      futureVersionBehavior: descriptor.futureVersionBehavior,
      migration: descriptor.migration,
      writeSemantics: descriptor.writeSemantics,
      byteBudget: descriptor.byteBudget,
      owner: descriptor.owner,
    }))
    .sort((left, right) => compareText(left.id, right.id));
  const metadata = family.metadata;
  return Object.freeze({
    schema: CASE_SUPPORTED_CONTRACT_BASELINE_SCHEMA,
    version: CASE_SUPPORTED_CONTRACT_BASELINE_VERSION,
    establishedAt: '2026-08-23',
    startingRevision: CASE_SUPPORTED_CONTRACT_BASELINE_STARTING_REVISION,
    decision: 'retain_atomic_record_storage' as const,
    source: Object.freeze({
      family: family.id,
      owner: family.owner,
      metadataVersion: metadata.metadataVersion,
    }),
    startingCurrentProtection: Object.freeze({
      browserCase: Object.freeze({ version: CASE_SCHEMA_VERSION, path: 'read-write-exact-current' }),
      portableCase: Object.freeze({ version: CASE_SCHEMA_VERSION, path: 'export-import-non-destructive-merge' }),
      caseReport: Object.freeze({ version: CASE_REPORT_SCHEMA_VERSION, path: 'current-writer' }),
      responsePacket: Object.freeze({ version: CASE_RESPONSE_PACKET_VERSION, path: 'current-writer-and-offline-verifier' }),
      cliCasePack: Object.freeze({ version: CLI_CASE_PACK_VERSION, caseVersion: CASE_SCHEMA_VERSION, path: 'current-writer-browser-import-and-offline-verifier' }),
      workspaceArchive: Object.freeze({ version: WORKSPACE_ARCHIVE_VERSION, path: 'current-writer-preview-and-non-destructive-merge' }),
      encryptedWorkspaceArchive: Object.freeze({ version: ENCRYPTED_WORKSPACE_ARCHIVE_VERSION, workspaceVersion: WORKSPACE_ARCHIVE_VERSION, path: 'current-encrypt-decrypt-and-verify' }),
    }),
    commitments: Object.freeze({
      compatibility,
      contracts,
      migrations: contracts.filter((contract) => contract.migrationTarget !== null).map((contract) => Object.freeze({
        key: contract.key,
        target: contract.migrationTarget,
      })),
      fixtures: family.fixtures
        .map((fixture) => Object.freeze({
          id: fixture.id,
          path: fixture.path,
          bytes: fixture.bytes,
          sha256: fixture.sha256,
          contentDigestSha256: fixture.contentDigestSha256,
          version: fixture.version,
          expectation: fixture.expectation,
          shapeId: fixture.shapeId,
        }))
        .sort((left, right) => compareText(left.id, right.id)),
      shapes: metadata.shapes.map((shape) => Object.freeze({
        id: shape.id,
        versions: [...shape.versions],
        normalisation: shape.normalisation,
        target: shape.target,
      })),
      bounds: metadata.boundProfiles.map((profile) => Object.freeze({
        id: profile.id,
        bounds: profile.bounds.map((bound) => Object.freeze({ ...bound })),
      })),
      privacyProjections: metadata.privacyProfiles.map((profile) => Object.freeze({ ...profile })),
      serialisation: metadata.serialisationProfiles.map((profile) => Object.freeze({
        id: profile.id,
        versions: [...profile.versions],
        mediaType: profile.mediaType,
        encoding: profile.encoding,
        bom: profile.bom,
        indentSpaces: profile.indentSpaces,
        terminalLf: profile.terminalLf,
        propertyOrder: profile.propertyOrder,
        canonicalisation: profile.canonicalisation,
        integrity: profile.integrity,
        serializerHookId: profile.serializerHookId,
        verifierHookIds: [...profile.verifierHookIds],
      })),
      consumers: metadata.consumerEdges.map((consumer) => Object.freeze({
        id: consumer.id,
        plane: consumer.plane,
        operation: consumer.operation,
        acceptedContracts: consumer.acceptedContracts.map((reference) => Object.freeze({
          compatibilityId: compatibilityIdFor(reference.schema, reference.versions[0]!),
          versions: [...reference.versions],
          mode: reference.mode,
          discriminator: reference.discriminator,
        })),
        emittedContract: consumer.emittedContract === null ? null : Object.freeze({
          compatibilityId: compatibilityIdFor(consumer.emittedContract.schema, consumer.emittedContract.version),
          version: consumer.emittedContract.version,
          discriminator: consumer.emittedContract.discriminator,
        }),
        shapeIds: consumer.shapeIds,
        boundProfileIds: consumer.boundProfileIds,
        hookIds: consumer.hookIds,
        serialisationProfileId: consumer.serialisationProfileId,
        privacyProfileId: consumer.privacyProfileId,
        retentionEffect: consumer.retentionEffect,
        requestMode: consumer.requestMode,
      })),
      publicContracts: Object.freeze({
        identityConstants: [...CASE_PORTABILITY_IDENTITY_CONSTANTS],
        compatibilityFacades: CASE_DOMAIN_COMPATIBILITY_FACADES.map(([facade, owner]) => Object.freeze({ facade, owner })),
        runtimeAdapters: [...CASE_DOMAIN_RUNTIME_ADAPTERS],
        verifierDispatch: CASE_PORTABILITY_VERIFIER_DISPATCH.map((entry) => Object.freeze({ ...entry })),
      }),
      rejectionBehaviour: Object.freeze({
        retired: 'reject_with_explicit_export_or_user_controlled_reset_guidance_without_mutation',
        future: 'reject_or_preserve_without_write_as_declared_by_the_owning_compatibility_descriptor',
        malformed: 'reject_without_mutation',
        oversized: 'reject_before_unbounded_copy_parse_or_accumulation',
        partial: 'report_blocked_or_partial_without_reinterpreting_missing_data_as_absence',
        integrityFailed: 'reject_without_import_or_merge',
      }),
    }),
    removalRecords: CASE_COMPATIBILITY_REMOVALS,
  });
}

export type CaseSupportedContractBaseline = ReturnType<typeof buildCaseSupportedContractBaseline>;
