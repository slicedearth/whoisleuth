// Emergency processing bounds shared by package construction; these are not release inventory baselines.
export const MAX_PACKAGE_PROCESSING_ITEMS = 4_096;
export const MAX_PACKAGE_GRAPH_BYTES = 8 * 1024 * 1024;
export const MAX_PACKAGE_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_PACKAGE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_PACKAGE_COMPILER_CONTEXT_BYTES = 32 * 1024 * 1024;
export const MAX_PACKAGE_COMPILER_CONTEXT_FILE_BYTES = 8 * 1024 * 1024;
export const PACKAGE_PROCESS_TIMEOUT_MS = 120_000;
