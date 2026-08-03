import { Buffer } from 'node:buffer';

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

export const OFFLINE_ARTIFACT_VERIFICATION_SCHEMA = 'whoisleuth.offline-artifact-verification';
export const OFFLINE_ARTIFACT_VERIFICATION_VERSION = 1;
export const MAX_OFFLINE_ARTIFACT_BYTES = 15 * 1024 * 1024;
export const MAX_OFFLINE_PASSPHRASE_FILE_BYTES = 1024;

type ArtifactKind =
  | 'workspace_archive'
  | 'encrypted_workspace_archive'
  | 'case_response_packet'
  | 'saved_lookup'
  | 'signed_review_artifact';
type VerificationState = 'verified' | 'envelope_valid' | 'structure_valid';
type UnknownRecord = Record<string, unknown>;

export type OfflineArtifactVerificationReport = Readonly<{
  schema: typeof OFFLINE_ARTIFACT_VERIFICATION_SCHEMA;
  version: typeof OFFLINE_ARTIFACT_VERIFICATION_VERSION;
  artifact: Readonly<{
    kind: ArtifactKind;
    schema: string;
    version: number;
  }>;
  state: VerificationState;
  valid: true;
  checks: Readonly<{
    structure: 'verified';
    contentIntegrity: 'verified' | 'not_checked';
    authenticatedEncryption: 'verified' | 'not_applicable' | 'not_checked';
  }>;
  summary: Readonly<{
    inputBytes: number;
    sectionCount: number | null;
    recordCount: number | null;
    ciphertextBytes: number | null;
  }>;
  limitations: readonly string[];
}>;

const SIGNED_ARTIFACT_VERSIONS: Readonly<Record<string, ReadonlySet<number>>> = Object.freeze({
  [ACQUISITION_DECISION_PACKET_SCHEMA]: new Set([ACQUISITION_DECISION_PACKET_VERSION]),
  [BULK_DOMAIN_COMPARISON_SCHEMA]: new Set([BULK_DOMAIN_COMPARISON_VERSION]),
  [BULK_MAIL_EXPOSURE_SCHEMA]: new Set([BULK_MAIL_EXPOSURE_VERSION]),
  [BULK_REVIEW_MANIFEST_SCHEMA]: new Set([BULK_REVIEW_MANIFEST_VERSION]),
  [DOMAIN_CONTROL_MANIFEST_SCHEMA]: new Set([DOMAIN_CONTROL_MANIFEST_VERSION]),
});

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function parseJson(raw: string): UnknownRecord {
  if (typeof raw !== 'string') throw new TypeError('Artifact input must be UTF-8 JSON text.');
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes === 0 || bytes > MAX_OFFLINE_ARTIFACT_BYTES) {
    throw new TypeError(`Artifact input must be between 1 byte and ${MAX_OFFLINE_ARTIFACT_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError('Artifact input is not valid JSON.');
  }
  const value = record(parsed);
  if (!value) throw new TypeError('Artifact input must contain one JSON object.');
  return value;
}

function artifactVersion(value: UnknownRecord): number {
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 1 || Number(value.version) > 1000) {
    throw new TypeError('Artifact version is missing or invalid.');
  }
  return Number(value.version);
}

function inputBytes(raw: string): number {
  return Buffer.byteLength(raw, 'utf8');
}

function archiveReport(
  raw: string,
  archive: Awaited<ReturnType<typeof readWorkspaceArchive>>,
  encrypted: boolean,
  ciphertextBytes: number | null,
): OfflineArtifactVerificationReport {
  return Object.freeze({
    schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
    version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
    artifact: Object.freeze({
      kind: encrypted ? 'encrypted_workspace_archive' : 'workspace_archive',
      schema: WORKSPACE_ARCHIVE_SCHEMA,
      version: archive.version,
    }),
    state: 'verified',
    valid: true,
    checks: Object.freeze({
      structure: 'verified',
      contentIntegrity: 'verified',
      authenticatedEncryption: encrypted ? 'verified' : 'not_applicable',
    }),
    summary: Object.freeze({
      inputBytes: inputBytes(raw),
      sectionCount: archive.sections.length,
      recordCount: archive.sections.reduce((sum, section) => sum + section.recordCount, 0),
      ciphertextBytes,
    }),
    limitations: Object.freeze([
      'Verification checks the retained file against its declared versioned integrity contract; it does not establish that the original observations were accurate or remain current.',
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
    throw new TypeError('This signed review-artifact schema or version is not supported.');
  }
  const integrity = record(value.integrity);
  if (!integrity
    || integrity.algorithm !== 'SHA-256'
    || typeof integrity.digestSha256 !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(integrity.digestSha256)) {
    throw new TypeError('The signed review artifact has a missing or malformed integrity envelope.');
  }
  const { integrity: _integrity, ...unsigned } = value;
  if (await sha256ArtifactDigest(unsigned) !== integrity.digestSha256) {
    throw new TypeError('The signed review artifact failed its SHA-256 integrity check.');
  }
  if (schema === DOMAIN_CONTROL_MANIFEST_SCHEMA) verifyDomainControlManifest(value);
  return Object.freeze({
    schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
    version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
    artifact: Object.freeze({ kind: 'signed_review_artifact', schema, version }),
    state: 'verified',
    valid: true,
    checks: Object.freeze({
      structure: 'verified',
      contentIntegrity: 'verified',
      authenticatedEncryption: 'not_applicable',
    }),
    summary: Object.freeze({
      inputBytes: inputBytes(raw),
      sectionCount: null,
      recordCount: null,
      ciphertextBytes: null,
    }),
    limitations: Object.freeze([
      'Digest verification detects changes to this exported artifact; it does not authenticate the analyst, collection source, or truth of the retained statements.',
    ]),
  });
}

export async function verifyOfflineArtifact(
  raw: string,
  options: Readonly<{ passphrase?: string | null }> = {},
): Promise<OfflineArtifactVerificationReport> {
  const value = parseJson(raw);

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
        valid: true,
        checks: Object.freeze({
          structure: 'verified',
          contentIntegrity: 'not_checked',
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
    return archiveReport(raw, archive, true, inspected.ciphertextBytes);
  }

  const schema = typeof value.schema === 'string' ? value.schema : '';
  const version = artifactVersion(value);
  if (schema === WORKSPACE_ARCHIVE_SCHEMA) {
    return archiveReport(raw, await readWorkspaceArchive(value), false, null);
  }

  if (schema === CASE_RESPONSE_PACKET_SCHEMA) {
    if (version !== CASE_RESPONSE_PACKET_VERSION) {
      throw new TypeError('This case-response packet version is not supported.');
    }
    const integrity = record(value.integrity);
    if (!integrity || !await verifyCaseResponsePacketIntegrity(value as CaseResponsePacket)) {
      throw new TypeError('The case-response packet failed its manifest integrity check.');
    }
    return Object.freeze({
      schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
      version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
      artifact: Object.freeze({ kind: 'case_response_packet', schema, version }),
      state: 'verified',
      valid: true,
      checks: Object.freeze({
        structure: 'verified',
        contentIntegrity: 'verified',
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

  if (schema === SAVED_LOOKUP_SCHEMA) {
    if (version !== SAVED_LOOKUP_SCHEMA_VERSION) {
      throw new TypeError('This saved Lookup document version is not supported.');
    }
    const document = parseSavedLookupDocument(raw, { label: 'Saved Lookup artifact' });
    return Object.freeze({
      schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
      version: OFFLINE_ARTIFACT_VERIFICATION_VERSION,
      artifact: Object.freeze({ kind: 'saved_lookup', schema, version }),
      state: 'structure_valid',
      valid: true,
      checks: Object.freeze({
        structure: 'verified',
        contentIntegrity: 'not_checked',
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
    'WHOISleuth offline artifact verification',
    `Artifact: ${report.artifact.kind} · ${report.artifact.schema} v${report.artifact.version}`,
    `State: ${report.state}`,
    `Structure: ${report.checks.structure}`,
    `Content integrity: ${report.checks.contentIntegrity}`,
    `Authenticated encryption: ${report.checks.authenticatedEncryption}`,
    `Input bytes: ${report.summary.inputBytes}`,
  ];
  if (report.summary.sectionCount !== null) lines.push(`Sections: ${report.summary.sectionCount}`);
  if (report.summary.recordCount !== null) lines.push(`Records: ${report.summary.recordCount}`);
  if (report.summary.ciphertextBytes !== null) lines.push(`Ciphertext bytes: ${report.summary.ciphertextBytes}`);
  for (const limitation of report.limitations) lines.push(`Limitation: ${limitation}`);
  return `${lines.join('\n')}\n`;
}
