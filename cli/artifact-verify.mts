import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { OfflineInvestigationPackageDetails } from './investigation-package-review.mts';
import type { BagItReview } from '../packages/interchange/bagit.mts';
import { readEditableCaseExport } from '../packages/cases/case-export-input.mts';

import { boundedJsonLimitsForBytes, parseBoundedJsonObject } from './bounded-json.mts';
import {
  validateInvestigationCapsuleStructure,
  validateLookupEvidenceArtifactStructure,
  validateOfflineArtifactStructure,
  validateSignedDigestArtifactStructure,
} from './offline-artifact-validation.mts';

import {
  verifyCaseResponsePacketIntegrity,
  type CaseResponsePacket,
} from '../packages/cases/case-response-packet.mts';
import {
  CASE_PORTABILITY_VERIFIER_DISPATCH,
  CASE_RESPONSE_PACKET_VERSION,
  CASE_RESPONSE_PACKET_SCHEMA,
  CLI_CASE_PACK_VERSION,
  CLI_CASE_PACK_SCHEMA,
} from '../packages/contracts/case-portability.mts';
import {
  ACQUISITION_DECISION_PACKET_SCHEMA,
  BULK_DOMAIN_COMPARISON_SCHEMA,
  BULK_MAIL_EXPOSURE_SCHEMA,
  BULK_REVIEW_MANIFEST_SCHEMA,
  LOOKUP_CLAIM_PASSPORT_SCHEMA,
  LOOKUP_CLAIM_PASSPORT_VERSION,
  SUPPORTED_ACQUISITION_DECISION_PACKET_VERSIONS,
  SUPPORTED_BULK_DOMAIN_COMPARISON_EXPORT_VERSIONS,
  SUPPORTED_BULK_MAIL_EXPOSURE_EXPORT_VERSIONS,
  SUPPORTED_BULK_REVIEW_MANIFEST_VERSIONS,
} from '../packages/contracts/investigation-portability.mts';
import {
  decryptWorkspaceArchiveWithMetadata,
  inspectEncryptedWorkspaceArchive,
  isEncryptedWorkspaceArchive,
  MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES,
} from '../packages/workspace/workspace-archive-crypto.mts';
import {
  WORKSPACE_ARCHIVE_SCHEMA,
  prepareWorkspaceArchive,
  readWorkspaceArchive,
} from '../packages/workspace/workspace-archive.mts';
import {
  canonicalArtifactJsonFor,
  resolveArtifactCanonicalization,
  sha256ArtifactDigestFor,
  SORTED_JSON_V2,
  type ArtifactCanonicalizationRoute,
} from '../packages/evidence/artifact-integrity.mts';
import {
  SAVED_LOOKUP_SCHEMA,
  SUPPORTED_SAVED_LOOKUP_SCHEMA_VERSIONS,
  parseCliLookupDocument,
} from './saved-lookup.mts';
import {
  DOMAIN_CONTROL_MANIFEST_SCHEMA,
  verifyDomainControlManifest,
} from '../lib/domain-control-manifest.mts';
import {
  DOMAIN_CONTROL_MANIFEST_CANONICALIZATION_ROUTES,
  MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
} from '../packages/contracts/domain-control-manifest.mts';
import {
  DOMAIN_CHANGE_PACKET_SCHEMA,
  SUPPORTED_DOMAIN_CHANGE_PACKET_VERSIONS,
} from '../lib/domain-change-packet.mts';
import {
  INVESTIGATION_CAPSULE_SCHEMA,
  SUPPORTED_INVESTIGATION_CAPSULE_VERSIONS,
  verifyInvestigationCapsule,
  type SupportedInvestigationCapsule,
} from '../packages/investigation/investigation-capsule.mts';
import {
  INVESTIGATION_MANIFEST_SCHEMA,
  SUPPORTED_INVESTIGATION_MANIFEST_VERSIONS,
} from './investigation-manifest.mts';
import { verifyCliCasePack } from './case-pack.mts';
import {
  LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES,
  LOOKUP_EVIDENCE_SCHEMA,
  SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS,
} from '../lib/evidence-export.mts';

export const OFFLINE_ARTIFACT_VERIFICATION_SCHEMA = 'whoisleuth.offline-artifact-verification';
export const OFFLINE_ARTIFACT_VERIFICATION_VERSION = 4;
export const MAX_OFFLINE_ARTIFACT_BYTES = Math.max(MAX_DOMAIN_CONTROL_MANIFEST_BYTES, MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES);
export const MAX_OFFLINE_PASSPHRASE_FILE_BYTES = 1024;

export class UnsupportedOfflineArtifactError extends TypeError {
  readonly code = 'unsupported_artifact';

  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedOfflineArtifactError';
  }
}

type ArtifactKind =
  | 'case_export'
  | 'investigation_package'
  | 'bagit'
  | 'workspace_archive'
  | 'encrypted_workspace_archive'
  | 'case_response_packet'
  | 'investigation_capsule'
  | 'lookup_evidence'
  | 'saved_lookup'
  | 'cli_case_pack'
  | 'signed_review_artifact';
export type OfflineArtifactVerificationState = 'verified' | 'envelope_valid' | 'integrity_valid' | 'structure_valid' | 'partial';
export type OfflineArtifactVerificationCheck = 'not_applicable' | 'not_checked' | 'verified' | 'failed';
export type OfflineArtifactIntegrityScope = 'embedded_projections' | 'not_applicable' | 'not_checked' | 'whole_artifact' | 'manifest_and_files';
export type OfflineArtifactAssuranceRequirement = 'applicable_integrity' | 'structure' | 'whole_integrity';
export type ManifestArtifactIdentityState = 'canonical_match_only' | 'identity_verified' | 'mismatch';
export type ManifestArtifactIdentityCheck = 'mismatch' | 'verified';
type UnknownRecord = Record<string, unknown>;

export type OfflineArtifactVerificationReport = Readonly<{
  schema: typeof OFFLINE_ARTIFACT_VERIFICATION_SCHEMA;
  version: typeof OFFLINE_ARTIFACT_VERIFICATION_VERSION;
  artifact: Readonly<{
    kind: Exclude<ArtifactKind, 'case_export' | 'bagit'>;
    schema: string;
    version: number;
  } | {
    kind: 'case_export';
    schema: null;
    version: number;
  } | {
    kind: 'bagit';
    schema: null;
    version: '1.0';
  }>;
  state: OfflineArtifactVerificationState;
  checks: Readonly<{
    structure: OfflineArtifactVerificationCheck;
    contentIntegrity: OfflineArtifactVerificationCheck;
    contentIntegrityScope: OfflineArtifactIntegrityScope;
    authenticatedEncryption: OfflineArtifactVerificationCheck;
  }>;
  summary: Readonly<{
    inputBytes: number;
    sectionCount: number | null;
    recordCount: number | null;
    ciphertextBytes: number | null;
    readySectionCount?: number | null;
    unsupportedSectionCount?: number | null;
    blockedSectionCount?: number | null;
    skippedRecordCount?: number | null;
    prunedRecordCount?: number | null;
    fullyImportable?: boolean | null;
  }>;
  manifestIdentity: Readonly<{
    state: ManifestArtifactIdentityState;
    manifest: Readonly<{
      schema: typeof INVESTIGATION_MANIFEST_SCHEMA;
      version: number;
      entryId: string;
    }>;
    checks: Readonly<{
      manifestIntegrity: 'verified';
      byteLength: ManifestArtifactIdentityCheck;
      rawContentDigest: ManifestArtifactIdentityCheck;
      canonicalDigest: ManifestArtifactIdentityCheck;
      schema: ManifestArtifactIdentityCheck;
      version: ManifestArtifactIdentityCheck;
    }>;
    expectedByteLength: number;
    actualByteLength: number;
    limitations: readonly string[];
  }> | null;
  limitations: readonly string[];
  package?: OfflineInvestigationPackageDetails;
  bagit?: BagItReview;
}>;

type JsonOfflineArtifactVerificationReport = OfflineArtifactVerificationReport & Readonly<{
  artifact: Exclude<OfflineArtifactVerificationReport['artifact'], { kind: 'bagit' }>;
}>;
type OfflineArtifactVerificationCore = Omit<JsonOfflineArtifactVerificationReport, 'manifestIdentity'>;

function currentCanonicalizationRoutes(versions: readonly number[]): readonly ArtifactCanonicalizationRoute[] {
  return Object.freeze(versions.map((version) => Object.freeze({
    version,
    canonicalization: SORTED_JSON_V2,
    explicit: true,
  })));
}

const SIGNED_ARTIFACT_ROUTES: Readonly<Record<string, readonly ArtifactCanonicalizationRoute[]>> = Object.freeze({
  [ACQUISITION_DECISION_PACKET_SCHEMA]: currentCanonicalizationRoutes(SUPPORTED_ACQUISITION_DECISION_PACKET_VERSIONS),
  [LOOKUP_CLAIM_PASSPORT_SCHEMA]: currentCanonicalizationRoutes([LOOKUP_CLAIM_PASSPORT_VERSION]),
  [BULK_DOMAIN_COMPARISON_SCHEMA]: currentCanonicalizationRoutes(SUPPORTED_BULK_DOMAIN_COMPARISON_EXPORT_VERSIONS),
  [BULK_MAIL_EXPOSURE_SCHEMA]: currentCanonicalizationRoutes(SUPPORTED_BULK_MAIL_EXPOSURE_EXPORT_VERSIONS),
  [BULK_REVIEW_MANIFEST_SCHEMA]: currentCanonicalizationRoutes(SUPPORTED_BULK_REVIEW_MANIFEST_VERSIONS),
  [DOMAIN_CONTROL_MANIFEST_SCHEMA]: DOMAIN_CONTROL_MANIFEST_CANONICALIZATION_ROUTES,
  [DOMAIN_CHANGE_PACKET_SCHEMA]: currentCanonicalizationRoutes(SUPPORTED_DOMAIN_CHANGE_PACKET_VERSIONS),
  [INVESTIGATION_MANIFEST_SCHEMA]: currentCanonicalizationRoutes(SUPPORTED_INVESTIGATION_MANIFEST_VERSIONS),
});

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

type CasePortabilityVerifierDescriptor = typeof CASE_PORTABILITY_VERIFIER_DISPATCH[number];

function selectCasePortabilityVerifier(value: UnknownRecord): CasePortabilityVerifierDescriptor | null {
  const packet = record(value.packet);
  for (const descriptor of CASE_PORTABILITY_VERIFIER_DISPATCH) {
    if (descriptor.id === 'case-response-packet'
      && descriptor.discriminator === 'root_schema'
      && value.schema === CASE_RESPONSE_PACKET_SCHEMA) return descriptor;
    if (descriptor.id === 'cli-case-pack'
      && descriptor.discriminator === 'packet_schema'
      && packet?.schema === CLI_CASE_PACK_SCHEMA) return descriptor;
  }
  return null;
}

function casePortabilityVersion(
  descriptor: CasePortabilityVerifierDescriptor,
  value: UnknownRecord,
): number {
  if (descriptor.versionField === 'schemaVersion') return artifactVersion(value);
  const packet = record(value.packet);
  if (!packet) throw new TypeError('The Case portability verifier discriminator is missing.');
  return artifactVersion(packet);
}

function supportsCasePortabilityVersion(
  descriptor: CasePortabilityVerifierDescriptor,
  version: number,
): boolean {
  return descriptor.supportedVersions.some((candidate) => candidate === version);
}

function rejectUnsupportedCasePortabilityVersion(
  label: string,
  version: number,
  currentVersion: number,
): never {
  if (Number.isSafeInteger(version) && version >= 1 && version < currentVersion) {
    throw new UnsupportedOfflineArtifactError(
      `${label} version ${String(version)} is retired. Export it again as version ${String(currentVersion)} with the last broad-reader release; no data was changed.`,
    );
  }
  if (Number.isSafeInteger(version) && version > currentVersion) {
    throw new UnsupportedOfflineArtifactError(
      `${label} version ${String(version)} is newer than the supported version ${String(currentVersion)}; no data was changed.`,
    );
  }
  throw new UnsupportedOfflineArtifactError(`This ${label} version is malformed or unsupported; no data was changed.`);
}

export function parseOfflineArtifactJson(raw: string): UnknownRecord {
  const value = parseBoundedJsonObject(raw, {
    maximumBytes: MAX_OFFLINE_ARTIFACT_BYTES,
    limits: boundedJsonLimitsForBytes(MAX_OFFLINE_ARTIFACT_BYTES),
  });
  if (value.schema !== WORKSPACE_ARCHIVE_SCHEMA && !isEncryptedWorkspaceArchive(value)
    && Buffer.byteLength(raw, 'utf8') > MAX_DOMAIN_CONTROL_MANIFEST_BYTES) {
    throw new TypeError(`Non-workspace artefacts are limited to ${MAX_DOMAIN_CONTROL_MANIFEST_BYTES} bytes.`);
  }
  return value;
}

export function hasVerifiedArtifactStructure(report: OfflineArtifactVerificationReport): boolean {
  return report.checks.structure === 'verified';
}

export function hasVerifiedApplicableIntegrity(report: OfflineArtifactVerificationReport): boolean {
  return report.checks.contentIntegrity === 'verified'
    && (report.checks.contentIntegrityScope === 'whole_artifact'
      || report.checks.contentIntegrityScope === 'manifest_and_files'
      || report.checks.contentIntegrityScope === 'embedded_projections');
}

export function hasVerifiedWholeArtifactIntegrity(report: OfflineArtifactVerificationReport): boolean {
  return report.checks.contentIntegrity === 'verified'
    && report.checks.contentIntegrityScope === 'whole_artifact';
}

export function offlineArtifactSatisfiesAssurance(
  report: OfflineArtifactVerificationReport,
  requirement: OfflineArtifactAssuranceRequirement,
): boolean {
  if (!hasVerifiedArtifactStructure(report)) return false;
  if (requirement === 'structure') return true;
  if (requirement === 'applicable_integrity') return hasVerifiedApplicableIntegrity(report);
  return hasVerifiedWholeArtifactIntegrity(report);
}

export function isCompleteOfflineArtifactVerification(report: OfflineArtifactVerificationReport): boolean {
  if (report.artifact.kind === 'bagit') return report.state === 'integrity_valid' && report.bagit?.state === 'valid'
    && report.checks.structure === 'verified' && report.checks.contentIntegrity === 'verified';
  return (report.state === 'verified' || report.state === 'structure_valid')
    && (report.manifestIdentity === null || report.manifestIdentity.state === 'identity_verified');
}

function artifactVersion(value: UnknownRecord): number {
  const declared = value.version ?? value.schemaVersion;
  if (value.version !== undefined && value.schemaVersion !== undefined && value.version !== value.schemaVersion) {
    throw new TypeError('Artefact version declarations do not agree.');
  }
  if (!Number.isSafeInteger(declared) || Number(declared) < 1 || Number(declared) > 1000) {
    throw new TypeError('Artefact version is missing or invalid.');
  }
  return Number(declared);
}

function inputBytes(raw: string): number {
  return Buffer.byteLength(raw, 'utf8');
}

function archiveReport(
  raw: string,
  archive: Awaited<ReturnType<typeof readWorkspaceArchive>>,
  preview: ReturnType<Awaited<ReturnType<typeof prepareWorkspaceArchive>>['preview']>,
  encrypted: boolean,
  ciphertextBytes: number | null,
): OfflineArtifactVerificationCore {
  const readySectionCount = preview.sections.filter((section) => section.status === 'ready').length;
  const unsupportedSectionCount = preview.sections.filter((section) => section.status === 'unsupported').length;
  const blockedSectionCount = preview.sections.filter((section) => section.status === 'blocked').length;
  const skippedRecordCount = preview.sections.reduce((sum, section) => sum + section.skipped, 0);
  const prunedRecordCount = preview.sections.reduce((sum, section) => sum + (section.pruned ?? 0), 0);
  const fullyImportable = unsupportedSectionCount === 0
    && blockedSectionCount === 0
    && skippedRecordCount === 0
    && prunedRecordCount === 0;
  return Object.freeze({
    schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
    version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
    artifact: Object.freeze({
      kind: encrypted ? 'encrypted_workspace_archive' : 'workspace_archive',
      schema: WORKSPACE_ARCHIVE_SCHEMA,
      version: archive.sourceVersion,
    }),
    state: encrypted ? 'verified' : 'integrity_valid',
    checks: Object.freeze({
      structure: 'verified',
      contentIntegrity: 'verified',
      contentIntegrityScope: encrypted ? 'whole_artifact' : 'embedded_projections',
      authenticatedEncryption: encrypted ? 'verified' : 'not_applicable',
    }),
    summary: Object.freeze({
      inputBytes: inputBytes(raw),
      sectionCount: archive.sections.length,
      recordCount: archive.sections.reduce((sum, section) => sum + section.recordCount, 0),
      ciphertextBytes,
      readySectionCount,
      unsupportedSectionCount,
      blockedSectionCount,
      skippedRecordCount,
      prunedRecordCount,
      fullyImportable,
    }),
    limitations: Object.freeze([
      ...(encrypted
        ? ['Authenticated decryption and archive validation cover the complete encrypted workspace content; they do not establish that the original observations were accurate or remain current.']
        : ['Section digest verification covers the archive projections, not root metadata such as generation time or archive limitations. It does not establish that the original observations were accurate or remain current.']),
      ...(!fullyImportable
        ? ['One or more integrity-valid archive sections cannot be imported completely by this version. Inspect the archive before selecting data to restore.']
        : []),
    ]),
  });
}

async function verifyWorkspaceArchiveValue(
  raw: string,
  value: UnknownRecord,
  passphrase?: string | null,
) {
  const encrypted = isEncryptedWorkspaceArchive(value);
  if (encrypted && !passphrase) {
    throw new TypeError('Encrypted archive inspection requires a separate passphrase file.');
  }
  if (!encrypted) artifactVersion(value);
  const decrypted = encrypted ? await decryptWorkspaceArchiveWithMetadata(value, passphrase!) : null;
  const source = decrypted ? decrypted.archive : value;
  const prepared = await prepareWorkspaceArchive(source);
  const archive = prepared.read();
  const report = archiveReport(raw, archive, prepared.preview({}), encrypted, decrypted?.ciphertextBytes ?? null);
  return { archive, report, encrypted };
}

/** Verify an archive once and retain its sections for bounded offline inspection. */
export async function verifyOfflineWorkspaceArchive(raw: string, options: Readonly<{ passphrase?: string | null }> = {}) {
  return verifyWorkspaceArchiveValue(raw, parseOfflineArtifactJson(raw), options.passphrase);
}

async function verifySignedArtifact(
  raw: string,
  value: UnknownRecord,
  schema: string,
  version: number,
): Promise<OfflineArtifactVerificationCore> {
  const routes = SIGNED_ARTIFACT_ROUTES[schema] ?? [];
  if (!routes.some((route) => route.version === version)) {
    throw new UnsupportedOfflineArtifactError('This signed review-artifact schema or version is not supported.');
  }
  validateSignedDigestArtifactStructure(schema, value);
  const integrity = record(value.integrity);
  if (!integrity
    || integrity.algorithm !== 'SHA-256'
    || typeof integrity.digestSha256 !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(integrity.digestSha256)) {
    throw new TypeError('The signed review artefact has a missing or malformed integrity envelope.');
  }
  const canonicalization = resolveArtifactCanonicalization(
    version,
    integrity.canonicalization,
    routes,
    'Signed review artefact',
  );
  const { integrity: _integrity, ...unsigned } = value;
  if (await sha256ArtifactDigestFor(unsigned, canonicalization) !== integrity.digestSha256) {
    throw new TypeError('The signed review artefact failed its SHA-256 integrity check.');
  }
  if (schema === DOMAIN_CONTROL_MANIFEST_SCHEMA) verifyDomainControlManifest(value);
  return Object.freeze({
    schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
    version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
    artifact: Object.freeze({ kind: 'signed_review_artifact', schema, version }),
    state: 'verified',
    checks: Object.freeze({
      structure: 'verified',
      contentIntegrity: 'verified',
      contentIntegrityScope: 'whole_artifact',
      authenticatedEncryption: 'not_applicable',
    }),
    summary: Object.freeze({
      inputBytes: inputBytes(raw),
      sectionCount: null,
      recordCount: null,
      ciphertextBytes: null,
    }),
    limitations: Object.freeze([
      'Digest verification detects changes to this exported artefact; it does not authenticate the analyst, collection source, or truth of the retained statements.',
    ]),
  });
}

async function verifyOfflineArtifactCore(
  raw: string,
  options: Readonly<{ passphrase?: string | null }> = {},
): Promise<OfflineArtifactVerificationCore> {
  const value = parseOfflineArtifactJson(raw);
  const casePortabilityVerifier = selectCasePortabilityVerifier(value);

  if (casePortabilityVerifier?.id === 'cli-case-pack') {
    const casePackVersion = casePortabilityVersion(casePortabilityVerifier, value);
    if (!supportsCasePortabilityVersion(casePortabilityVerifier, casePackVersion)) {
      rejectUnsupportedCasePortabilityVersion('CLI Case-pack', casePackVersion, CLI_CASE_PACK_VERSION);
    }
    const verified = verifyCliCasePack(value);
    return Object.freeze({
      schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
      version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
      artifact: Object.freeze({
        kind: 'cli_case_pack',
        schema: CLI_CASE_PACK_SCHEMA,
        version: casePackVersion,
      }),
      state: 'verified',
      checks: Object.freeze({
        structure: 'verified',
        contentIntegrity: 'verified',
        contentIntegrityScope: 'whole_artifact',
        authenticatedEncryption: 'not_applicable',
      }),
      summary: Object.freeze({
        inputBytes: inputBytes(raw),
        sectionCount: null,
        recordCount: verified.caseCount,
        ciphertextBytes: null,
      }),
      limitations: Object.freeze([
        'Case-pack verification detects changes after export and checks the bounded case collection; it does not authenticate the analyst, review decision, source observations, or recipient authorisation.',
      ]),
    });
  }

  if (value.schema === undefined && Array.isArray(value.cases)) {
    const cases = readEditableCaseExport(raw);
    return Object.freeze({
      schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA, version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
      artifact: Object.freeze({ kind: 'case_export', schema: null, version: artifactVersion(value) }),
      state: 'structure_valid',
      checks: Object.freeze({ structure: 'verified', contentIntegrity: 'not_checked', contentIntegrityScope: 'not_applicable', authenticatedEncryption: 'not_applicable' }),
      summary: Object.freeze({ inputBytes: inputBytes(raw), sectionCount: 1, recordCount: cases.length, ciphertextBytes: null }),
      limitations: Object.freeze([
        'The ordinary Case export matches its exact supported structure without repairing or removing retained records. It has no embedded checksum or signature.',
        'Original-file references do not include original bytes. Verify a selected evidence package to check which references have matching bytes.',
        'The Case includes private analyst content. Structural validity does not authenticate its author or establish factual accuracy, currentness or response authority.',
      ]),
    });
  }

  if (isEncryptedWorkspaceArchive(value)) {
    if (!options.passphrase) {
      const inspected = inspectEncryptedWorkspaceArchive(value);
      return Object.freeze({
        schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
        version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
        artifact: Object.freeze({
          kind: 'encrypted_workspace_archive',
          schema: String(value.schema),
          version: artifactVersion(value),
        }),
        state: 'envelope_valid',
        checks: Object.freeze({
          structure: 'verified',
          contentIntegrity: 'not_checked',
          contentIntegrityScope: 'not_checked',
          authenticatedEncryption: 'not_checked',
        }),
        summary: Object.freeze({
          inputBytes: inputBytes(raw),
          sectionCount: null,
          recordCount: null,
          ciphertextBytes: inspected.ciphertextBytes,
        }),
        limitations: Object.freeze([
          'The encrypted envelope is structurally valid, but its authenticated ciphertext and inner workspace checksums were not verified because no passphrase was supplied.',
          'Pass a separate bounded passphrase file to perform authenticated decryption without placing the passphrase in command history.',
        ]),
      });
    }
    return (await verifyWorkspaceArchiveValue(raw, value, options.passphrase)).report;
  }

  const schema = typeof value.schema === 'string' ? value.schema : '';
  const version = artifactVersion(value);
  if (schema === WORKSPACE_ARCHIVE_SCHEMA) {
    return (await verifyWorkspaceArchiveValue(raw, value)).report;
  }

  if (casePortabilityVerifier?.id === 'case-response-packet') {
    if (!supportsCasePortabilityVersion(casePortabilityVerifier, version)) {
      rejectUnsupportedCasePortabilityVersion('case-response packet', version, CASE_RESPONSE_PACKET_VERSION);
    }
    validateOfflineArtifactStructure(CASE_RESPONSE_PACKET_SCHEMA, value);
    const integrity = record(value.integrity);
    if (!integrity || !await verifyCaseResponsePacketIntegrity(value as CaseResponsePacket)) {
      throw new TypeError('The case-response packet failed its manifest integrity check.');
    }
    return Object.freeze({
      schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
      version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
      artifact: Object.freeze({ kind: 'case_response_packet', schema: CASE_RESPONSE_PACKET_SCHEMA, version }),
      state: 'verified',
      checks: Object.freeze({
        structure: 'verified',
        contentIntegrity: 'verified',
        contentIntegrityScope: 'whole_artifact',
        authenticatedEncryption: 'not_applicable',
      }),
      summary: Object.freeze({
        inputBytes: inputBytes(raw),
        sectionCount: null,
        recordCount: null,
        ciphertextBytes: null,
      }),
      limitations: Object.freeze([
        'Packet digest verification detects changes after export; it does not authenticate the analyst, recipient, or truth of the retained observations.',
      ]),
    });
  }

  if (schema === INVESTIGATION_CAPSULE_SCHEMA) {
    if (!SUPPORTED_INVESTIGATION_CAPSULE_VERSIONS.some((candidate) => candidate === version)) {
      throw new UnsupportedOfflineArtifactError('This investigation-capsule version is not supported.');
    }
    validateInvestigationCapsuleStructure(value);
    const verification = await verifyInvestigationCapsule(value as SupportedInvestigationCapsule);
    if (!verification.valid) throw new TypeError('The investigation capsule failed its embedded projection integrity checks.');
    return Object.freeze({
      schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
      version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
      artifact: Object.freeze({ kind: 'investigation_capsule', schema, version }),
      state: 'verified',
      checks: Object.freeze({
        structure: 'verified',
        contentIntegrity: 'verified',
        contentIntegrityScope: 'whole_artifact',
        authenticatedEncryption: 'not_applicable',
      }),
      summary: Object.freeze({
        inputBytes: inputBytes(raw),
        sectionCount: null,
        recordCount: null,
        ciphertextBytes: null,
      }),
      limitations: Object.freeze([
        'The whole capsule matches its declared digest, including metadata and the linked source-contract projection digests. The non-embedded Lookup evidence remains linked by digest and must be retained separately.',
        'Digest verification detects changed content but does not authenticate the analyst, signer, collection source, or truth of retained observations and assertions.',
      ]),
    });
  }

  if (schema === LOOKUP_EVIDENCE_SCHEMA) {
    if (!SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS.some((candidate) => candidate === version)) {
      throw new UnsupportedOfflineArtifactError('This Lookup-evidence document version is not supported.');
    }
    if (inputBytes(raw) > LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES) {
      throw new TypeError('Lookup-evidence documents are limited to 5 MiB for browser-compatible verification.');
    }
    validateLookupEvidenceArtifactStructure(value);
    return Object.freeze({
      schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
      version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
      artifact: Object.freeze({ kind: 'lookup_evidence', schema, version }),
      state: 'structure_valid',
      checks: Object.freeze({
        structure: 'verified',
        contentIntegrity: 'not_checked',
        contentIntegrityScope: 'not_applicable',
        authenticatedEncryption: 'not_applicable',
      }),
      summary: Object.freeze({
        inputBytes: inputBytes(raw),
        sectionCount: null,
        recordCount: null,
        ciphertextBytes: null,
      }),
      limitations: Object.freeze([
        `Lookup-evidence schema ${version} matches its bounded browser-importable structural contract, but this export format has no embedded checksum or signature. Structural validity does not prove that its evidence is accurate, current, or unchanged since collection.`,
        'Use an integrity-verified investigation manifest and an exact manifest-entry identity check when retained-file byte identity must be established.',
        'The export may contain raw registry RDAP publication data, normalised WHOIS values, and bounded contact details; review it before sharing.',
      ]),
    });
  }

  if (schema === SAVED_LOOKUP_SCHEMA) {
    if (!SUPPORTED_SAVED_LOOKUP_SCHEMA_VERSIONS.some((supported) => supported === version)) {
      throw new UnsupportedOfflineArtifactError('This saved Lookup document version is not supported.');
    }
    parseCliLookupDocument(raw, { label: 'Saved Lookup artefact' });
    return Object.freeze({
      schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
      version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
      artifact: Object.freeze({ kind: 'saved_lookup', schema, version }),
      state: 'structure_valid',
      checks: Object.freeze({
        structure: 'verified',
        contentIntegrity: 'not_checked',
        contentIntegrityScope: 'not_applicable',
        authenticatedEncryption: 'not_applicable',
      }),
      summary: Object.freeze({
        inputBytes: inputBytes(raw),
        sectionCount: null,
        recordCount: null,
        ciphertextBytes: null,
      }),
      limitations: Object.freeze([
        'The saved Lookup matches its versioned structural contract, but this document format has no embedded checksum or signature. Structural validity does not prove that its evidence is accurate, current, or unchanged since collection.',
      ]),
    });
  }

  return verifySignedArtifact(raw, value, schema, version);
}

function rawContentDigest(raw: string): string {
  return `sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}`;
}

function artifactMetadata(value: UnknownRecord): Readonly<{ schema: string | null; version: number | null }> {
  const declaredVersion = value.version ?? value.schemaVersion;
  return Object.freeze({
    schema: typeof value.schema === 'string' ? value.schema : null,
    version: Number.isSafeInteger(declaredVersion) && Number(declaredVersion) >= 1 && Number(declaredVersion) <= 1_000
      ? Number(declaredVersion)
      : null,
  });
}

async function verifyManifestIdentity(
  artifactRaw: string,
  manifestRaw: string,
  entryId: string,
): Promise<NonNullable<OfflineArtifactVerificationReport['manifestIdentity']>> {
  const manifestReport = await verifyOfflineArtifactCore(manifestRaw);
  if (manifestReport.artifact.schema !== INVESTIGATION_MANIFEST_SCHEMA
    || manifestReport.artifact.kind !== 'signed_review_artifact'
    || manifestReport.state !== 'verified'
    || manifestReport.checks.contentIntegrity !== 'verified'
    || manifestReport.checks.contentIntegrityScope !== 'whole_artifact') {
    throw new TypeError('The selected manifest is not a fully integrity-verified investigation manifest.');
  }
  const manifest = parseOfflineArtifactJson(manifestRaw);
  const entries = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const entry = entries.find((candidate) => record(candidate)?.id === entryId);
  const item = record(entry);
  if (!item) throw new TypeError('The requested investigation manifest entry was not found.');

  const artifactValue = parseOfflineArtifactJson(artifactRaw);
  const metadata = artifactMetadata(artifactValue);
  const actualByteLength = inputBytes(artifactRaw);
  const expectedByteLength = Number(item.byteLength);
  const checks = Object.freeze({
    manifestIntegrity: 'verified' as const,
    byteLength: actualByteLength === expectedByteLength ? 'verified' as const : 'mismatch' as const,
    rawContentDigest: rawContentDigest(artifactRaw) === item.contentDigestSha256 ? 'verified' as const : 'mismatch' as const,
    canonicalDigest: rawContentDigest(canonicalArtifactJsonFor(artifactValue, SORTED_JSON_V2)) === item.canonicalDigestSha256 ? 'verified' as const : 'mismatch' as const,
    schema: metadata.schema === item.schema ? 'verified' as const : 'mismatch' as const,
    version: metadata.version === item.version ? 'verified' as const : 'mismatch' as const,
  });
  const exact = checks.byteLength === 'verified'
    && checks.rawContentDigest === 'verified'
    && checks.canonicalDigest === 'verified'
    && checks.schema === 'verified'
    && checks.version === 'verified';
  const canonicalOnly = !exact
    && checks.canonicalDigest === 'verified'
    && checks.schema === 'verified'
    && checks.version === 'verified';
  const state: ManifestArtifactIdentityState = exact
    ? 'identity_verified'
    : canonicalOnly
      ? 'canonical_match_only'
      : 'mismatch';
  return Object.freeze({
    state,
    manifest: Object.freeze({ schema: INVESTIGATION_MANIFEST_SCHEMA, version: manifestReport.artifact.version, entryId }),
    checks,
    expectedByteLength,
    actualByteLength,
    limitations: Object.freeze([
      ...(state === 'identity_verified'
        ? ['The selected artefact matches the manifest entry byte-for-byte and by canonical JSON, schema, and version.']
        : state === 'canonical_match_only'
          ? ['Canonical JSON, schema, and version match, but the retained UTF-8 bytes or byte length differ from the manifest entry. This is not exact retained-file identity.']
          : ['One or more manifest identity checks differ. This artefact is not the exact retained file identified by the selected manifest entry.']),
      'Manifest identity does not establish that the retained observations were accurate, complete, authorised, or remain current.',
    ]),
  });
}

export async function verifyOfflineArtifact(
  raw: string,
  options: Readonly<{
    passphrase?: string | null;
    manifest?: Readonly<{ raw: string; entryId: string }> | null;
  }> = {},
): Promise<JsonOfflineArtifactVerificationReport> {
  const report = await verifyOfflineArtifactCore(raw, options);
  const manifestIdentity = options.manifest
    ? await verifyManifestIdentity(raw, options.manifest.raw, options.manifest.entryId)
    : null;
  return Object.freeze({ ...report, manifestIdentity });
}

export function formatOfflineArtifactVerification(
  report: OfflineArtifactVerificationReport,
): string {
  const lines = [
    'WHOISleuth offline artefact verification',
    `Artifact: ${report.artifact.kind} · ${report.artifact.schema ?? 'no schema identifier'} v${report.artifact.version}`,
    `State: ${report.state}`,
    'Automation: use --strict-exit for exit 4 on incomplete verification; default exit 0 means the report was produced.',
    `Structure: ${report.checks.structure}`,
    `Content integrity: ${report.checks.contentIntegrity}`,
    `Content integrity scope: ${report.checks.contentIntegrityScope}`,
    `Authenticated encryption: ${report.checks.authenticatedEncryption}`,
    `Input bytes: ${report.summary.inputBytes}`,
  ];
  if (report.summary.sectionCount !== null) lines.push(`Sections: ${report.summary.sectionCount}`);
  if (report.summary.recordCount !== null) lines.push(`Records: ${report.summary.recordCount}`);
  if (report.summary.ciphertextBytes !== null) lines.push(`Ciphertext bytes: ${report.summary.ciphertextBytes}`);
  if (report.summary.readySectionCount !== undefined && report.summary.readySectionCount !== null) {
    lines.push(`Import-ready sections: ${report.summary.readySectionCount}`);
  }
  if (report.summary.unsupportedSectionCount !== undefined && report.summary.unsupportedSectionCount !== null) {
    lines.push(`Unsupported sections: ${report.summary.unsupportedSectionCount}`);
  }
  if (report.summary.blockedSectionCount !== undefined && report.summary.blockedSectionCount !== null) {
    lines.push(`Blocked sections: ${report.summary.blockedSectionCount}`);
  }
  if (report.summary.skippedRecordCount !== undefined && report.summary.skippedRecordCount !== null) {
    lines.push(`Skipped records: ${report.summary.skippedRecordCount}`);
  }
  if (report.summary.prunedRecordCount !== undefined && report.summary.prunedRecordCount !== null) {
    lines.push(`Pruned records: ${report.summary.prunedRecordCount}`);
  }
  if (report.summary.fullyImportable !== undefined && report.summary.fullyImportable !== null) {
    lines.push(`Importability: ${report.summary.fullyImportable ? 'complete' : 'partial'}`);
  }
  if (report.manifestIdentity) {
    lines.push(`Manifest identity: ${report.manifestIdentity.state}`);
    lines.push(`Manifest entry: ${report.manifestIdentity.manifest.entryId}`);
    lines.push(`Manifest integrity: ${report.manifestIdentity.checks.manifestIntegrity}`);
    lines.push(`Exact bytes: ${report.manifestIdentity.checks.rawContentDigest}`);
    lines.push(`Byte length: ${report.manifestIdentity.checks.byteLength}`);
    lines.push(`Canonical JSON: ${report.manifestIdentity.checks.canonicalDigest}`);
    lines.push(`Schema identity: ${report.manifestIdentity.checks.schema}`);
    lines.push(`Version identity: ${report.manifestIdentity.checks.version}`);
    for (const limitation of report.manifestIdentity.limitations) lines.push(`Manifest limitation: ${limitation}`);
  }
  if (report.bagit) {
    const bag = report.bagit;
    lines.push(`BagIt: ${bag.state}`, `Payload: ${bag.entries.length} files; ${bag.payloadBytes} present bytes`,
      `Tag checksums: ${bag.verifiedTagFiles} of ${bag.tagFiles} tag files checked`,
      `Fetch declarations: ${bag.fetchEntries}; ${bag.fetchMissing} files missing; no requests made`,
      `Unsupported manifests: ${bag.unsupportedManifests}`);
    for (const entry of bag.entries) lines.push(`${entry.id}: ${entry.state} · ${entry.byteLength ?? 'unknown'} bytes`);
    for (const issue of bag.issues) lines.push(`BagIt issue: ${issue}`);
  }
  if (report.package) {
    lines.push(`Package bytes: ${report.package.digestSha256}`, 'Storage: unchanged; inspection only',
      'Audience: private; review selected file contents before sharing',
      'Signature trust: not checked', 'Trusted timestamp: not checked', 'Factual accuracy: not established');
    for (const entry of report.package.entries) lines.push(`${entry.id}: ${entry.state} · ${entry.byteLength} bytes · ${entry.mediaType}${entry.issue ? ` · ${entry.issue}` : ''}`);
    for (const link of report.package.links) lines.push(`Source link ${link.capsuleEntryId}: ${link.state}${link.sourceEntryId ? ` (${link.sourceEntryId})` : ''}`);
    for (const capture of report.package.captureManifests) {
      lines.push(`Capture manifest ${capture.entryId}: ${capture.state}`);
      for (const artifact of capture.artifacts) lines.push(`Capture ${artifact.capture} ${artifact.kind}: ${artifact.state}${artifact.matchingIds.length ? ` (${artifact.matchingIds.join(', ')})` : ''}`);
    }
    for (const item of report.package.caseFiles) lines.push(`Case files ${item.entryId} (${item.caseCount} Case${item.caseCount === 1 ? '' : 's'}): ${item.matched} of ${item.references} references matched; ${item.missing} missing`);
  }
  for (const limitation of report.limitations) lines.push(`Limitation: ${limitation}`);
  return `${lines.join('\n')}\n`;
}
