import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { LEGACY_REGISTRY_INSIGHTS_VERSION, REGISTRY_INSIGHTS_VERSION, type RegistryInsightsVersion } from './registry-insights.mts';

export const LOOKUP_EVIDENCE_SCHEMA = 'whoisleuth.lookup-evidence';
export const V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION = 26;
export const PUBLISHED_V2_LOOKUP_EVIDENCE_SCHEMA_VERSION = 27;
export const REGISTRAR_STANDING_LOOKUP_EVIDENCE_SCHEMA_VERSION = 28;
export const LATEST_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION = REGISTRAR_STANDING_LOOKUP_EVIDENCE_SCHEMA_VERSION;
export const HOSTNAME_SCOPED_LOOKUP_EVIDENCE_SCHEMA_VERSION = 29;
export const PRIVACY_MINIMIZED_LOOKUP_EVIDENCE_SCHEMA_VERSION = PUBLISHED_V2_LOOKUP_EVIDENCE_SCHEMA_VERSION;
export const FORM_ATTRIBUTED_LOOKUP_EVIDENCE_SCHEMA_VERSION = 30;
export const AUTHORITY_AWARE_LOOKUP_EVIDENCE_SCHEMA_VERSION = 31;
export const LOOKUP_EVIDENCE_SCHEMA_VERSION = AUTHORITY_AWARE_LOOKUP_EVIDENCE_SCHEMA_VERSION;
export const SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS = Object.freeze([
  V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  PUBLISHED_V2_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  LATEST_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  HOSTNAME_SCOPED_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  FORM_ATTRIBUTED_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
]);

export function lookupEvidenceRegistryInsightsVersion(schemaVersion: number): RegistryInsightsVersion {
  if (!SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS.includes(schemaVersion)) throw new TypeError('Unsupported Lookup evidence version.');
  return schemaVersion >= AUTHORITY_AWARE_LOOKUP_EVIDENCE_SCHEMA_VERSION
    ? REGISTRY_INSIGHTS_VERSION : LEGACY_REGISTRY_INSIGHTS_VERSION;
}
export const LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES = 5 * 1024 * 1024;
export const LOOKUP_EVIDENCE_PORTABLE_MAX_ENTRIES = 20_000;
export const LOOKUP_EVIDENCE_PORTABLE_MAX_DEPTH = 24;
export const LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS = 10_000;
export const LOOKUP_EVIDENCE_PORTABLE_MAX_KEY_LENGTH = 256;
export const LOOKUP_EVIDENCE_PORTABLE_MAX_STRING_LENGTH = 1024 * 1024;

export const LOOKUP_EVIDENCE_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.lookup-evidence',
  kind: 'export',
  schema: LOOKUP_EVIDENCE_SCHEMA,
  currentVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION,
  supportedVersions: SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS,
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'read_only',
  writeSemantics: 'read_only',
  byteBudget: LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES,
  owner: 'packages/contracts/lookup-evidence.mts',
  note: 'Versions 26–30 retain their registry insight derivation. Version 30 adds attributed form destinations. Version 31 retains WHOIS registration classification; collection completion is not positive registration evidence.',
});
