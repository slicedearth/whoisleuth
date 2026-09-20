import { MAX_CASES } from './case-portability.mts';
import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_BYTES } from './selected-file-limits.mts';
import { defineSchemaCompatibility } from './schema-compatibility.mts';

export const LOCAL_WORKSPACE_FILE = 'workspace.sqlite';
export const LOCAL_WORKSPACE_FORMAT_VERSION = 1;
export const LOCAL_WORKSPACE_APPLICATION_ID = 0x574c5331;
export const LOCAL_WORKSPACE_MAX_FILES = MAX_CASES * MAX_SELECTED_FILES;
// A workspace can retain a bounded file for every admitted Case attachment.
// Allow database pages/free space in addition to those bytes; reads and writes
// still admit only one independently bounded collection/file batch at a time.
export const LOCAL_WORKSPACE_MAX_DATABASE_BYTES = LOCAL_WORKSPACE_MAX_FILES * MAX_SELECTED_FILE_BYTES * 2;

export const LOCAL_WORKSPACE_COMPATIBILITY = defineSchemaCompatibility({
  id: 'local.application-workspace', kind: 'filesystem_store', schema: null,
  currentVersion: LOCAL_WORKSPACE_FORMAT_VERSION, supportedVersions: [LOCAL_WORKSPACE_FORMAT_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'preserve_without_write',
  migration: 'exact_current_only', writeSemantics: 'optimistic_replace', byteBudget: LOCAL_WORKSPACE_MAX_DATABASE_BYTES,
  owner: 'lib/local-application-store.mts',
  note: 'SQLite application ID and file version precede writable access. Collection formats use their existing readers; records, retained files and write receipts commit atomically. Unsupported files remain unchanged.',
});
