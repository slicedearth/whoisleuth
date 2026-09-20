// Dependency-free report identity and resource bounds shared by assembly and
// registry verification. Importing these values does not load package builders.
export const CLI_PACKAGE_REPORT_SCHEMA = 'whoisleuth.cli-package-check';
export const CLI_PACKAGE_REPORT_VERSION = 3;

// Emergency work bound, not a release inventory or a refactoring budget.
// Each phase may visit at most 4,096 items; independent byte limits and process
// deadlines also apply. For tar validation this bounds header/padding overhead
// to 4 MiB (two 512-byte records per entry), in addition to unpacked file bytes.
export const MAX_CLI_PACKAGE_PROCESSING_ITEMS = 4_096;
export const MAX_CLI_PACKAGE_PACKED_BYTES = 2 * 1024 * 1024;
export const MAX_CLI_PACKAGE_UNPACKED_BYTES = 6 * 1024 * 1024;

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
