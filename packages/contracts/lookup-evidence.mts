import { defineSchemaCompatibility } from './schema-compatibility.mts';

export const LOOKUP_EVIDENCE_SCHEMA = 'whoisleuth.lookup-evidence';
export const V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION = 26;
export const PUBLISHED_V2_LOOKUP_EVIDENCE_SCHEMA_VERSION = 27;
export const LATEST_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION = 28;
export const PRIVACY_MINIMIZED_LOOKUP_EVIDENCE_SCHEMA_VERSION = PUBLISHED_V2_LOOKUP_EVIDENCE_SCHEMA_VERSION;
export const LOOKUP_EVIDENCE_SCHEMA_VERSION = LATEST_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION;
export const SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS = Object.freeze([
  V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  PUBLISHED_V2_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
]);
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
  note: 'Exact v1.47.4 version 26, published v2.0.1 version 27, and latest-public v2.1.0 version 28 remain replayable; version 28 adds a bounded official-source registrar-standing projection.',
});
