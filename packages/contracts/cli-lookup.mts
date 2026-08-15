import { defineSchemaCompatibility } from './schema-compatibility.mts';

export const CLI_LOOKUP_SCHEMA = 'whoisleuth.cli.lookup';
export const LEGACY_CLI_LOOKUP_VERSION = 1;
export const CLI_LOOKUP_VERSION = 2;
export const SUPPORTED_CLI_LOOKUP_VERSIONS = Object.freeze([
  LEGACY_CLI_LOOKUP_VERSION,
  CLI_LOOKUP_VERSION,
] as const);
export const MAX_CLI_LOOKUP_BYTES = 8 * 1024 * 1024;

export const CLI_LOOKUP_COMPATIBILITY = defineSchemaCompatibility({
  id: 'cli.lookup',
  kind: 'cli_document',
  schema: CLI_LOOKUP_SCHEMA,
  currentVersion: CLI_LOOKUP_VERSION,
  supportedVersions: SUPPORTED_CLI_LOOKUP_VERSIONS,
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'read_only',
  writeSemantics: 'read_only',
  byteBudget: MAX_CLI_LOOKUP_BYTES,
  owner: 'packages/contracts/cli-lookup.mts',
  note: 'Saved domain lookups preserve version 1 compatibility while version 2 can retain bounded Deep homepage metadata for offline review and evidence export.',
});
