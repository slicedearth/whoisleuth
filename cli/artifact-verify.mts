import { Buffer } from 'node:buffer';

import { parseBoundedJsonObject } from './bounded-json.mts';
import {
  validateInvestigationCapsuleStructure,
  validateOfflineArtifactStructure,
  validateSignedDigestArtifactStructure,
} from './artifact-structure.mts';

import {
  CASE_RESPONSE_PACKET_SCHEMA,
  CASE_RESPONSE_PACKET_VERSION,
  verifyCaseResponsePacketIntegrity,
  type CaseResponsePacket,
} from '../frontend/src/lib/analysis/case-response-packet.ts';
import {
  ACQUISITION_DECISION_PACKET_SCHEMA,
  ACQUISITION_DECISION_PACKET_VERSION,
} from '../frontend/src/lib/analysis/acquisition-decision-packet.ts';
import {
  BULK_DOMAIN_COMPARISON_SCHEMA,
  BULK_DOMAIN_COMPARISON_VERSION,
} from '../frontend/src/lib/analysis/bulk-domain-comparison.ts';
import {
  BULK_MAIL_EXPOSURE_SCHEMA,
  BULK_MAIL_EXPOSURE_VERSION,
} from '../frontend/src/lib/analysis/bulk-mail-exposure.ts';
import {
  BULK_REVIEW_MANIFEST_SCHEMA,
  BULK_REVIEW_MANIFEST_VERSION,
} from '../frontend/src/lib/analysis/bulk-review-export.ts';
import {
  decryptWorkspaceArchive,
  inspectEncryptedWorkspaceArchive,
  isEncryptedWorkspaceArchive,
} from '../frontend/src/lib/analysis/workspace-archive-crypto.ts';
import {
  WORKSPACE_ARCHIVE_SCHEMA,
  previewWorkspaceArchive,
  readWorkspaceArchive,
} from '../frontend/src/lib/analysis/workspace-archive.ts';
import { sha256ArtifactDigest } from '../frontend/src/lib/analysis/artifact-integrity.ts';
import {
  SAVED_LOOKUP_SCHEMA,
  SAVED_LOOKUP_SCHEMA_VERSION,
  parseSavedLookupDocument,
} from './saved-lookup.mts';
import {
  DOMAIN_CONTROL_MANIFEST_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_VERSION,
  verifyDomainControlManifest,
} from '../lib/domain-control-manifest.mts';
import {
  DOMAIN_CHANGE_PACKET_SCHEMA,
  DOMAIN_CHANGE_PACKET_VERSION,
} from '../lib/domain-change-packet.mts';
import {
  INVESTIGATION_CAPSULE_SCHEMA,
  INVESTIGATION_CAPSULE_VERSION,
  verifyInvestigationCapsule,
  type InvestigationCapsule,
} from '../frontend/src/lib/analysis/investigation-capsule.ts';
import {
  INVESTIGATION_MANIFEST_SCHEMA,
  INVESTIGATION_MANIFEST_VERSION,
} from './investigation-manifest.mts';
import {
  CLI_CASE_PACK_SCHEMA,
  CLI_CASE_PACK_VERSION,
  verifyCliCasePack,
} from './case-pack.mts';

export const OFFLINE_ARTIFACT_VERIFICATION_SCHEMA = 'whoisleuth.offline-artifact-verification';
export const OFFLINE_ARTIFACT_VERIFICATION_VERSION = 2;
export const MAX_OFFLINE_ARTIFACT_BYTES = 15 * 1024 * 1024;
export const MAX_OFFLINE_PASSPHRASE_FILE_BYTES = 1024;

export class UnsupportedOfflineArtifactError extends TypeError {
  readonly code = 'unsupported_artifact';

  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedOfflineArtifactError';
  }
}

type ArtifactKind =
  | 'workspace_archive'
  | 'encrypted_workspace_archive'
  | 'case_response_packet'
  | 'investigation_capsule'
  | 'saved_lookup'
  | 'cli_case_pack'
  | 'signed_review_artifact';
export type OfflineArtifactVerificationState = 'verified' | 'envelope_valid' | 'integrity_valid' | 'structure_valid';
export type OfflineArtifactVerificationCheck = 'not_applicable' | 'not_checked' | 'verified';
export type OfflineArtifactIntegrityScope = 'embedded_projections' | 'not_applicable' | 'not_checked' | 'whole_artifact';
export type OfflineArtifactAssuranceRequirement = 'applicable_integrity' | 'structure' | 'whole_integrity';
type UnknownRecord = Record<string, unknown>;

export type OfflineArtifactVerificationReport = Readonly<{
  schema: typeof OFFLINE_ARTIFACT_VERIFICATION_SCHEMA;
  version: typeof OFFLINE_ARTIFACT_VERIFICATION_VERSION;
  artifact: Readonly<{
    kind: ArtifactKind;
    schema: string;
    version: number;
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
  limitations: readonly string[];
}>;

const SIGNED_ARTIFACT_VERSIONS: Readonly<Record<string, ReadonlySet<number>>> = Object.freeze({
  [ACQUISITION_DECISION_PACKET_SCHEMA]: new Set([ACQUISITION_DECISION_PACKET_VERSION]),
  [BULK_DOMAIN_COMPARISON_SCHEMA]: new Set([BULK_DOMAIN_COMPARISON_VERSION]),
  [BULK_MAIL_EXPOSURE_SCHEMA]: new Set([BULK_MAIL_EXPOSURE_VERSION]),
  [BULK_REVIEW_MANIFEST_SCHEMA]: new Set([BULK_REVIEW_MANIFEST_VERSION]),
  [DOMAIN_CONTROL_MANIFEST_SCHEMA]: new Set([DOMAIN_CONTROL_MANIFEST_VERSION]),
  [DOMAIN_CHANGE_PACKET_SCHEMA]: new Set([DOMAIN_CHANGE_PACKET_VERSION]),
  [INVESTIGATION_MANIFEST_SCHEMA]: new Set([INVESTIGATION_MANIFEST_VERSION]),
});

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function parseJson(raw: string): UnknownRecord {
  return parseBoundedJsonObject(raw, { maximumBytes: MAX_OFFLINE_ARTIFACT_BYTES });
}

export function hasVerifiedArtifactStructure(report: OfflineArtifactVerificationReport): boolean {
  return report.checks.structure === 'verified';
}

export function hasVerifiedApplicableIntegrity(report: OfflineArtifactVerificationReport): boolean {
  return report.checks.contentIntegrity === 'verified'
    && (report.checks.contentIntegrityScope === 'whole_artifact'
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
  return report.state === 'verified' || report.state === 'structure_valid';
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

async function archiveReport(
  raw: string,
  source: unknown,
  archive: Awaited<ReturnType<typeof readWorkspaceArchive>>,
  encrypted: boolean,
  ciphertextBytes: number | null,
): Promise<OfflineArtifactVerificationReport> {
  const preview = await previewWorkspaceArchive(source, {});
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
    state: 'verified',
    checks: Object.freeze({
      structure: 'verified',
      contentIntegrity: 'verified',
      contentIntegrityScope: 'whole_artifact',
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
      'Verification checks the retained file against its declared versioned integrity contract; it does not establish that the original observations were accurate or remain current.',
      ...(!fullyImportable
        ? ['One or more integrity-valid archive sections cannot be imported completely by this version. Inspect the archive before selecting data to restore.']
        : []),
    ]),
  });
}

async function verifySignedArtifact(
  raw: string,
  value: UnknownRecord,
  schema: string,
  version: number,
): Promise<OfflineArtifactVerificationReport> {
  const supported = SIGNED_ARTIFACT_VERSIONS[schema];
  if (!supported?.has(version)) {
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
  const { integrity: _integrity, ...unsigned } = value;
  if (await sha256ArtifactDigest(unsigned) !== integrity.digestSha256) {
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

export async function verifyOfflineArtifact(
  raw: string,
  options: Readonly<{ passphrase?: string | null }> = {},
): Promise<OfflineArtifactVerificationReport> {
  const value = parseJson(raw);

  const casePackPacket = record(value.packet);
  if (casePackPacket?.schema === CLI_CASE_PACK_SCHEMA) {
    const verified = verifyCliCasePack(value);
    return Object.freeze({
      schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
      version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
      artifact: Object.freeze({
        kind: 'cli_case_pack',
        schema: CLI_CASE_PACK_SCHEMA,
        version: CLI_CASE_PACK_VERSION,
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

  if (isEncryptedWorkspaceArchive(value)) {
    const inspected = inspectEncryptedWorkspaceArchive(value);
    if (!options.passphrase) {
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
    const decrypted = await decryptWorkspaceArchive(value, options.passphrase);
    const archive = await readWorkspaceArchive(decrypted);
    return archiveReport(raw, decrypted, archive, true, inspected.ciphertextBytes);
  }

  const schema = typeof value.schema === 'string' ? value.schema : '';
  const version = artifactVersion(value);
  if (schema === WORKSPACE_ARCHIVE_SCHEMA) {
    return archiveReport(raw, value, await readWorkspaceArchive(value), false, null);
  }

  if (schema === CASE_RESPONSE_PACKET_SCHEMA) {
    if (version !== CASE_RESPONSE_PACKET_VERSION) {
      throw new UnsupportedOfflineArtifactError('This case-response packet version is not supported.');
    }
    validateOfflineArtifactStructure(schema, value);
    const integrity = record(value.integrity);
    if (!integrity || !await verifyCaseResponsePacketIntegrity(value as CaseResponsePacket)) {
      throw new TypeError('The case-response packet failed its manifest integrity check.');
    }
    return Object.freeze({
      schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
      version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
      artifact: Object.freeze({ kind: 'case_response_packet', schema, version }),
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
    if (version !== INVESTIGATION_CAPSULE_VERSION) {
      throw new UnsupportedOfflineArtifactError('This investigation-capsule version is not supported.');
    }
    validateInvestigationCapsuleStructure(value);
    const verification = await verifyInvestigationCapsule(value as InvestigationCapsule);
    if (!verification.valid) throw new TypeError('The investigation capsule failed its embedded projection integrity checks.');
    return Object.freeze({
      schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
      version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
      artifact: Object.freeze({ kind: 'investigation_capsule', schema, version }),
      state: 'integrity_valid',
      checks: Object.freeze({
        structure: 'verified',
        contentIntegrity: 'verified',
        contentIntegrityScope: 'embedded_projections',
        authenticatedEncryption: 'not_applicable',
      }),
      summary: Object.freeze({
        inputBytes: inputBytes(raw),
        sectionCount: null,
        recordCount: null,
        ciphertextBytes: null,
      }),
      limitations: Object.freeze([
        'The embedded brief, graph, and optional analyst-record projections match their declared digests. Capsule metadata and the linked Lookup evidence are outside those projection digests and must not be treated as whole-file integrity verified.',
        'Digest verification detects changed content but does not authenticate the analyst, signer, collection source, or truth of retained observations and assertions.',
      ]),
    });
  }

  if (schema === SAVED_LOOKUP_SCHEMA) {
    if (version !== SAVED_LOOKUP_SCHEMA_VERSION) {
      throw new UnsupportedOfflineArtifactError('This saved Lookup document version is not supported.');
    }
    const document = parseSavedLookupDocument(raw, { label: 'Saved Lookup artefact' });
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
        `The saved ${document.mode} Lookup matches its versioned structural contract, but this document format has no embedded checksum or signature. Structural validity does not prove that its evidence is accurate, current, or unchanged since collection.`,
      ]),
    });
  }

  return verifySignedArtifact(raw, value, schema, version);
}

export function formatOfflineArtifactVerification(
  report: OfflineArtifactVerificationReport,
): string {
  const lines = [
    'WHOISleuth offline artefact verification',
    `Artifact: ${report.artifact.kind} · ${report.artifact.schema} v${report.artifact.version}`,
    `State: ${report.state}`,
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
  for (const limitation of report.limitations) lines.push(`Limitation: ${limitation}`);
  return `${lines.join('\n')}\n`;
}
