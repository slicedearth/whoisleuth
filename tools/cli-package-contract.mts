// Dependency-free report identity and resource bounds shared by assembly and
// registry verification. Importing these values does not load package builders.
import { MAX_PACKAGE_SOURCE_BYTES } from './package-resource-bounds.mts';
export const CLI_PACKAGE_REPORT_SCHEMA = 'whoisleuth.cli-package-check';
export const CLI_PACKAGE_REPORT_VERSION = 3;

// Emergency work bound, not a release inventory or a refactoring budget.
// Each phase may visit at most 4,096 items; independent byte limits and process
// deadlines also apply. For tar validation this bounds header/padding overhead
// to 4 MiB (two 512-byte records per entry), in addition to unpacked file bytes.
export { MAX_PACKAGE_PROCESSING_ITEMS as MAX_CLI_PACKAGE_PROCESSING_ITEMS } from './package-resource-bounds.mts';
export const MAX_CLI_PACKAGE_PACKED_BYTES = 2 * 1024 * 1024;
// Compilation and copied support files share a finite output allowance of
// twice the admitted source budget. It is not tied to an earlier release size.
export const MAX_CLI_PACKAGE_UNPACKED_BYTES = MAX_PACKAGE_SOURCE_BYTES * 2;

export type CliPackageReport = Readonly<{
  schema: typeof CLI_PACKAGE_REPORT_SCHEMA;
  version: typeof CLI_PACKAGE_REPORT_VERSION;
  packageName: string;
  packageVersion: string;
  sourceModuleCount: number;
  packedEntryCount: number;
  packedBytes: number;
  unpackedBytes: number;
  runtimeDependencies: Readonly<Record<string, string>>;
  installedChecks: readonly string[];
  publicationEnabled: boolean;
  archiveFilename: string | null;
  archiveSha256: string | null;
}>;
