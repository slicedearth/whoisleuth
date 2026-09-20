import { MAX_CASES } from '../contracts/case-portability.mts';
import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_TOTAL_BYTES } from '../contracts/selected-file-limits.mts';
import { readCaseAttachments, type CaseAttachment } from '../cases/case-attachment-model.mts';
import { sha256ArtifactBytes } from '../evidence/artifact-integrity.mts';
import { retainedFileGroups, type RetainedFileInput } from '../evidence/retained-file.mts';
import type { readWorkspaceArchive } from './workspace-archive.mts';

export type ReviewedWorkspaceArchive = Awaited<ReturnType<typeof readWorkspaceArchive>>;

/** Partition content, not provenance: duplicate references remain in Case data. */
export function workspaceAttachmentGroups(archive: ReviewedWorkspaceArchive): readonly (readonly CaseAttachment[])[] {
  const section = archive.sections.find(item => item.id === 'cases');
  if (!section || section.status !== 'ready') throw new Error('Required file coverage cannot be determined from an unsupported Case section.');
  const rows = (section.data as { cases?: unknown })?.cases;
  if (!Array.isArray(rows) || rows.length > MAX_CASES) throw new Error('Backup Case records cannot be inspected for required files.');
  return retainedFileGroups(rows.flatMap(row => readCaseAttachments(row?.attachments) ?? []));
}

/** Match complete selected bytes to the downloaded backup, never filenames. */
export async function matchRecoveryFiles(groups: readonly (readonly CaseAttachment[])[], input: readonly Blob[]): Promise<readonly RetainedFileInput[]> {
  if (!Array.isArray(input) || !input.length || input.length > MAX_SELECTED_FILES) throw new Error(`Select 1–${MAX_SELECTED_FILES} files per operation.`);
  let bytes = 0;
  const files = input.map(file => {
    if (!(file instanceof Blob) || !file.size || file.size > MAX_SELECTED_FILE_TOTAL_BYTES - bytes) throw new Error(`Selected recovery files are empty or exceed ${MAX_SELECTED_FILE_TOTAL_BYTES / 1024 / 1024} MiB in this operation.`);
    bytes += file.size;
    return file.slice();
  });
  const expected = new Map(groups.flat().map(item => [item.digestSha256, item]));
  const matched = new Map<string, RetainedFileInput>();
  for (const file of files) {
    const body = new Uint8Array(await file.arrayBuffer());
    try {
      const digest = await sha256ArtifactBytes(body), reference = expected.get(digest);
      if (!reference || reference.byteLength !== body.byteLength) throw new Error('A selected file does not match any file reference in this backup. No files from this operation were added.');
      matched.set(digest, { reference: { digestSha256: digest, byteLength: reference.byteLength }, file });
    } finally { body.fill(0); }
  }
  return [...matched.values()];
}

function caseIds(archive: ReviewedWorkspaceArchive): string[] | null {
  const section = archive.sections.find(item => item.id === 'cases');
  if (!section || section.status !== 'ready') return null;
  const rows = (section.data as { cases?: unknown })?.cases;
  if (!Array.isArray(rows) || rows.length > MAX_CASES || rows.some(row => !row || typeof row.id !== 'string')) return null;
  return rows.map(row => row.id as string).sort();
}

/** Expected checksums come from the selected backup, not the merge's output. */
export function compareRecoveredWorkspace(source: ReviewedWorkspaceArchive, restored: ReviewedWorkspaceArchive) {
  const sections = source.sections.filter(section => section.id !== 'settings').map(section => {
    const actual = restored.sections.find(item => item.id === section.id);
    const state = section.status !== 'ready' || !actual || actual.status !== 'ready' ? 'unavailable'
      : section.recordCount !== actual.recordCount ? 'changed'
      // The archive reader already validates each section's schema identity.
      : section.version !== actual.version ? 'migrated'
      : section.checksum === actual.checksum ? 'exact' : 'changed';
    return { id: section.id, label: section.label, records: actual?.recordCount ?? null, expectedRecords: section.recordCount, state } as const;
  });
  const expectedIds = caseIds(source), actualIds = caseIds(restored);
  const identitiesMatch = expectedIds !== null && actualIds !== null && JSON.stringify(expectedIds) === JSON.stringify(actualIds);
  return { sections, caseCount: actualIds?.length ?? null, identitiesMatch,
    metadataMatches: sections.length > 0 && sections.every(section => section.state === 'exact') && identitiesMatch };
}
