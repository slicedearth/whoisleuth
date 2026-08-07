import { Buffer } from 'node:buffer';

import {
  INTERCHANGE_ARTIFACT_CONTRACTS,
  type InterchangeArtifactContract,
  type InterchangeFidelity,
} from '../lib/interchange-fidelity-registry.mts';
import { verifyOfflineArtifact } from './artifact-verify.mts';
import { mergeBrandProfiles } from '../frontend/src/lib/analysis/brand-profile-model.ts';

export const INTERCHANGE_FIDELITY_REPORT_SCHEMA = 'whoisleuth.interchange-fidelity-report';
export const INTERCHANGE_FIDELITY_REPORT_VERSION = 1;
export const MAX_INTERCHANGE_REPORT_BYTES = 15 * 1024 * 1024;

type UnknownRecord = Record<string, unknown>;
type VerificationState = 'envelope_valid' | 'not_verified' | 'structure_valid' | 'unsupported_version' | 'verified';

export type InterchangeFidelityReport = Readonly<{
  schema: typeof INTERCHANGE_FIDELITY_REPORT_SCHEMA;
  version: typeof INTERCHANGE_FIDELITY_REPORT_VERSION;
  generatedAt: string;
  recognised: boolean;
  artifact: Readonly<{
    id: InterchangeArtifactContract['id'] | null;
    schema: string | null;
    version: number | null;
    versionSupported: boolean;
  }>;
  verification: Readonly<{
    state: VerificationState;
    valid: boolean;
  }>;
  compatibility: Readonly<{
    browser: InterchangeArtifactContract['browser'] | null;
    cli: InterchangeArtifactContract['cli'] | null;
    fidelity: InterchangeFidelity;
    preservedFieldGroups: readonly string[];
    excludedFieldGroups: readonly string[];
    futureVersionBehaviour: 'reject' | null;
  }>;
  summary: Readonly<{
    inputBytes: number;
    recordCount: number | null;
    sectionCount: number | null;
    encryptedContentVerified: boolean | null;
    acceptedRecordCount: number | null;
    skippedRecordCount: number | null;
    unsupportedSectionCount: number | null;
  }>;
  limitations: readonly string[];
}>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function parseInput(raw: string): UnknownRecord {
  if (typeof raw !== 'string') throw new TypeError('Interchange input must be UTF-8 JSON text.');
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes < 1 || bytes > MAX_INTERCHANGE_REPORT_BYTES) {
    throw new TypeError(`Interchange input must be between 1 byte and ${MAX_INTERCHANGE_REPORT_BYTES} bytes.`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw.replace(/^\uFEFF/u, '')); } catch { throw new TypeError('Interchange input is not valid JSON.'); }
  const source = record(parsed);
  if (!source) throw new TypeError('Interchange input must contain one JSON object.');
  return source;
}

function nestedRecord(value: UnknownRecord, path: readonly string[]): UnknownRecord | null {
  let current: UnknownRecord | null = value;
  for (const part of path) current = record(current?.[part]);
  return current;
}

function identify(value: UnknownRecord): Readonly<{ contract: InterchangeArtifactContract; version: number | null }> | null {
  for (const contract of INTERCHANGE_ARTIFACT_CONTRACTS) {
    const container = nestedRecord(value, contract.nestedSchemaPath);
    if (container?.schema !== contract.schema) continue;
    const declared = container[contract.versionField];
    return {
      contract,
      version: Number.isSafeInteger(declared) && Number(declared) > 0 && Number(declared) <= 1000
        ? Number(declared)
        : null,
    };
  }
  return null;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('Interchange report time is invalid.');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError('Interchange report time is invalid.');
  return new Date(parsed).toISOString();
}

function validateBrandProfileExport(value: UnknownRecord): Readonly<{ accepted: number; skipped: number }> {
  const profiles = value.profiles;
  if (!Array.isArray(profiles) || profiles.length > 100) {
    throw new TypeError('Brand Profile export does not contain a bounded profiles collection.');
  }
  if (typeof value.exportedAt !== 'string' || value.exportedAt.length > 64 || !Number.isFinite(Date.parse(value.exportedAt))) {
    throw new TypeError('Brand Profile export time is invalid.');
  }
  let nextId = 0;
  const result = mergeBrandProfiles([], value, {
    nowIso: new Date(Date.parse(value.exportedAt)).toISOString(),
    makeId: () => `interchange-profile-${++nextId}`,
  });
  return Object.freeze({ accepted: result.profiles.length, skipped: result.skipped });
}

export async function buildInterchangeFidelityReport(
  raw: string,
  options: Readonly<{ generatedAt?: string; passphrase?: string | null }> = {},
): Promise<InterchangeFidelityReport> {
  const inputBytes = Buffer.byteLength(raw, 'utf8');
  const value = parseInput(raw);
  const identified = identify(value);
  const generatedAt = timestamp(options.generatedAt ?? new Date().toISOString());
  if (!identified) return Object.freeze({
    schema: INTERCHANGE_FIDELITY_REPORT_SCHEMA,
    version: INTERCHANGE_FIDELITY_REPORT_VERSION,
    generatedAt,
    recognised: false,
    artifact: Object.freeze({ id: null, schema: null, version: null, versionSupported: false }),
    verification: Object.freeze({ state: 'not_verified', valid: false }),
    compatibility: Object.freeze({
      browser: null,
      cli: null,
      fidelity: 'not_verified',
      preservedFieldGroups: Object.freeze([]),
      excludedFieldGroups: Object.freeze([]),
      futureVersionBehaviour: null,
    }),
    summary: Object.freeze({
      inputBytes, recordCount: null, sectionCount: null, encryptedContentVerified: null,
      acceptedRecordCount: null, skippedRecordCount: null, unsupportedSectionCount: null,
    }),
    limitations: Object.freeze([
      'The file did not match a registered interchange contract. Its supplied schema text and contents are not echoed.',
      'This report makes no request and does not establish that evidence is accurate, current, complete, or safe to share.',
    ]),
  });

  const { contract, version } = identified;
  const supported = version !== null && contract.versions.includes(version);
  let verificationState: VerificationState = supported ? 'not_verified' : 'unsupported_version';
  let valid = false;
  let recordCount: number | null = null;
  let sectionCount: number | null = null;
  let encryptedContentVerified: boolean | null = contract.id === 'encrypted_workspace' ? false : null;
  let acceptedRecordCount: number | null = null;
  let skippedRecordCount: number | null = null;
  let unsupportedSectionCount: number | null = null;

  if (supported && contract.fidelity !== 'unsupported') {
    try {
      if (contract.id === 'brand_profiles') {
        const validation = validateBrandProfileExport(value);
        recordCount = validation.accepted;
        acceptedRecordCount = validation.accepted;
        skippedRecordCount = validation.skipped;
        verificationState = validation.skipped === 0 ? 'structure_valid' : 'not_verified';
        valid = validation.skipped === 0;
      } else {
        const verification = await verifyOfflineArtifact(raw, { passphrase: options.passphrase ?? null });
        verificationState = verification.state;
        valid = verification.valid;
        recordCount = verification.summary.recordCount;
        sectionCount = verification.summary.sectionCount;
        const unsupportedSections = verification.summary.unsupportedSectionCount ?? 0;
        unsupportedSectionCount = unsupportedSections;
        if (unsupportedSections > 0) valid = false;
        if (contract.id === 'encrypted_workspace') encryptedContentVerified = verification.state === 'verified';
      }
    } catch {
      verificationState = 'not_verified';
      valid = false;
    }
  }

  const fidelity: InterchangeFidelity = !supported
    ? 'unsupported'
    : valid
      ? contract.fidelity
      : contract.fidelity === 'unsupported'
        ? 'unsupported'
        : 'not_verified';
  return Object.freeze({
    schema: INTERCHANGE_FIDELITY_REPORT_SCHEMA,
    version: INTERCHANGE_FIDELITY_REPORT_VERSION,
    generatedAt,
    recognised: true,
    artifact: Object.freeze({ id: contract.id, schema: contract.schema, version, versionSupported: supported }),
    verification: Object.freeze({ state: verificationState, valid }),
    compatibility: Object.freeze({
      browser: contract.browser,
      cli: contract.cli,
      fidelity,
      preservedFieldGroups: contract.preservedFieldGroups,
      excludedFieldGroups: contract.excludedFieldGroups,
      futureVersionBehaviour: contract.futureVersionBehaviour,
    }),
    summary: Object.freeze({
      inputBytes, recordCount, sectionCount, encryptedContentVerified,
      acceptedRecordCount, skippedRecordCount, unsupportedSectionCount,
    }),
    limitations: Object.freeze([
      'Compatibility describes declared field groups and supported operations, not byte-for-byte equality or evidence truth.',
      'The report emits only registered metadata, counts, and fixed field-group identifiers. Targets, notes, contacts, passphrases, and evidence values are not included.',
      'A verified integrity envelope detects file changes but does not establish author identity, source accuracy, currency, completeness, or sharing authority.',
    ]),
  });
}

export function formatInterchangeFidelityReport(report: InterchangeFidelityReport): string {
  const browser = report.compatibility.browser;
  const cli = report.compatibility.cli;
  return [
    'Interchange fidelity report',
    `Recognised     ${report.recognised ? 'yes' : 'no'}`,
    `Artifact       ${report.artifact.id ?? 'unrecognised'}`,
    `Version        ${report.artifact.version ?? 'unavailable'}${report.artifact.versionSupported ? '' : ' (unsupported)'}`,
    `Verification   ${report.verification.state}`,
    `Fidelity       ${report.compatibility.fidelity}`,
    `Browser        import ${browser?.import ?? 'unknown'} · export ${browser?.export ?? 'unknown'}`,
    `CLI            read ${cli?.read ?? 'unknown'} · write ${cli?.write ?? 'unknown'} · verify ${cli?.verify ?? 'unknown'}`,
    `Records        ${report.summary.recordCount ?? 'not disclosed'}`,
    `Sections       ${report.summary.sectionCount ?? 'not disclosed'}`,
    ...(report.summary.acceptedRecordCount === null ? [] : [`Accepted       ${report.summary.acceptedRecordCount}`]),
    ...(report.summary.skippedRecordCount === null ? [] : [`Skipped        ${report.summary.skippedRecordCount}`]),
    ...(report.summary.unsupportedSectionCount === null ? [] : [`Unsupported    ${report.summary.unsupportedSectionCount}`]),
    '',
    `Preserved      ${report.compatibility.preservedFieldGroups.join(', ') || 'none declared'}`,
    `Excluded       ${report.compatibility.excludedFieldGroups.join(', ') || 'none declared'}`,
    '',
    ...report.limitations.map((item) => `Limitation: ${item}`),
    '',
  ].join('\n');
}
