import { defineSchemaCompatibility } from '../packages/contracts/schema-compatibility.mts';

export const REGISTRAR_STANDING_CATALOGUE_SCHEMA = 'whoisleuth.registrar-standing-catalogue';
export const REGISTRAR_STANDING_CATALOGUE_VERSION = 1;
export const MAX_REGISTRAR_STANDING_CATALOGUE_BYTES = 512 * 1024;
export const REGISTRAR_STANDING_MAX_AGE_DAYS = 14;
export const REGISTRAR_STANDING_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
export const IANA_REGISTRAR_SOURCE_URL = 'https://www.iana.org/assignments/registrar-ids/registrar-ids-1.csv';
export const ICANN_COMPLIANCE_SOURCE_URL = 'https://www.icann.org/compliance/notices';
export const REGISTRAR_STANDING_AUDIT_SCHEMA = 'whoisleuth.registrar-standing-drift-audit';
export const REGISTRAR_STANDING_AUDIT_VERSION = 1;
export const MAX_REGISTRAR_STANDING_AUDIT_BYTES = 32 * 1024;

export type RegistrarStandingOfficialSource = 'iana_catalogue' | 'icann_index' | 'icann_notice';

export function registrarStandingOfficialSourceUrl(
  value: unknown,
  source: RegistrarStandingOfficialSource,
  noticeId: string | null = null,
): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.port
      || parsed.search
      || parsed.hash) return null;
    if (source === 'iana_catalogue') {
      return parsed.href === IANA_REGISTRAR_SOURCE_URL ? parsed.href : null;
    }
    if (source === 'icann_index') {
      return parsed.href === ICANN_COMPLIANCE_SOURCE_URL ? parsed.href : null;
    }
    const identifier = typeof noticeId === 'string'
      ? /^notice-([1-9]\d{0,7})$/u.exec(noticeId)?.[1]
      : null;
    return identifier
      && parsed.hostname === 'www.icann.org'
      && new RegExp(`^/uploads/compliance_notice/attachment/${identifier}/[A-Za-z0-9._~-]+\\.pdf$`, 'u').test(parsed.pathname)
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

export const REGISTRAR_STANDING_CATALOGUE_COMPATIBILITY = defineSchemaCompatibility({
  id: 'derived.registrar-standing-catalogue',
  kind: 'derived',
  schema: REGISTRAR_STANDING_CATALOGUE_SCHEMA,
  currentVersion: REGISTRAR_STANDING_CATALOGUE_VERSION,
  supportedVersions: [REGISTRAR_STANDING_CATALOGUE_VERSION],
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'exact_current_only',
  writeSemantics: 'normalized_rewrite',
  byteBudget: MAX_REGISTRAR_STANDING_CATALOGUE_BYTES,
  owner: 'lib/registrar-standing-catalogue-contract.mts',
  note: 'Checked-in target-free IANA accreditation and current-year ICANN compliance projection refreshed only by the bounded maintainer command.',
});

export const REGISTRAR_STANDING_AUDIT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'maintainer.registrar-standing-drift-audit',
  kind: 'cli_document',
  schema: REGISTRAR_STANDING_AUDIT_SCHEMA,
  currentVersion: REGISTRAR_STANDING_AUDIT_VERSION,
  supportedVersions: [REGISTRAR_STANDING_AUDIT_VERSION],
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'not_applicable',
  migration: 'read_only',
  writeSemantics: 'read_only',
  byteBudget: MAX_REGISTRAR_STANDING_AUDIT_BYTES,
  owner: 'lib/registrar-standing-catalogue-contract.mts',
  note: 'Target-free two-source drift report that compares bounded normalized official projections without modifying the checked-in catalogue.',
});
