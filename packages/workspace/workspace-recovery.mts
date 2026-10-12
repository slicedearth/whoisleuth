import { MAX_CASES } from '../contracts/case-portability.mts';
import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_TOTAL_BYTES } from '../contracts/selected-file-limits.mts';
import { readCaseAttachments, type CaseAttachment } from '../cases/case-attachment-model.mts';
import { sha256ArtifactBytes } from '../evidence/artifact-integrity.mts';
import { retainedFileGroups, type RetainedFileInput, type RetainedFileReference } from '../evidence/retained-file.mts';
import type { readWorkspaceArchive } from './workspace-archive.mts';
import type { CaseRecord } from '../cases/case-record-contracts.mts';

export type ReviewedWorkspaceArchive = Awaited<ReturnType<typeof readWorkspaceArchive>>;

export type RecoveryPackageIdentity = RetainedFileReference & Readonly<{
  manifestSchema: string; manifestVersion: number; encryptionVersion: number | null;
}>;

/** One latest matched source per original bounds this index by the reviewed archive. */
export function recoverySourceIndex(sources: ReadonlyMap<string, RecoveryPackageIdentity | null>) {
  const packages = new Map<string, RecoveryPackageIdentity & { matchedFiles: number }>();
  let originalFiles = 0;
  for (const source of sources.values()) {
    if (!source) { originalFiles++; continue; }
    const existing = packages.get(source.digestSha256);
    if (existing) existing.matchedFiles++;
    else packages.set(source.digestSha256, { ...source, matchedFiles: 1 });
  }
  return Object.freeze({ originalFiles, packages: Object.freeze([...packages.values()].map(item => Object.freeze(item))) });
}

export type RecoveryFile = Readonly<{
  digestSha256: string; byteLength: number;
  references: readonly Readonly<{ caseId: string; attachment: CaseAttachment }>[];
  state: 'missing' | 'unverified';
}>;

/** Inspect each bounded storage group; an unreadable group is not absence. */
export async function inspectRecoveryFiles(archive: ReviewedWorkspaceArchive,
  read: (group: readonly CaseAttachment[]) => Promise<ReadonlyMap<string, Blob | null>>) {
  return inspectCaseOriginalFiles(archiveCaseRecords(archive), read);
}

/** A Case review and a recovery rehearsal inspect the same bounded file groups. */
export async function inspectCaseOriginalFiles(rows: readonly Pick<CaseRecord, 'id' | 'attachments'>[],
  read: (group: readonly CaseAttachment[]) => Promise<ReadonlyMap<string, Blob | null>>,
  signal?: AbortSignal) {
  if (!Array.isArray(rows) || rows.length > MAX_CASES) throw new Error('Case records cannot be inspected for required files.');
  signal?.throwIfAborted();
  const references = new Map<string, { caseId: string; attachment: CaseAttachment }[]>();
  for (const row of rows) for (const attachment of readCaseAttachments(row.attachments) ?? []) {
    const existing = references.get(attachment.digestSha256) ?? [];
    existing.push({ caseId: row.id, attachment }); references.set(attachment.digestSha256, existing);
  }
  const groups = retainedFileGroups([...references.values()].flatMap(items => items.map(item => item.attachment)));
  let verified = 0, missing = 0, unverified = 0, bytes = 0;
  const checklist: RecoveryFile[] = [];
  for (const group of groups) {
    signal?.throwIfAborted();
    let files: ReadonlyMap<string, Blob | null> | null = null;
    try { files = await read(group); } catch { /* Keep failed reads distinct from missing bytes. */ }
    signal?.throwIfAborted();
    for (const item of group) {
      if (files?.get(item.digestSha256)) { verified++; bytes += item.byteLength; continue; }
      const state = files === null ? 'unverified' as const : 'missing' as const;
      if (state === 'missing') missing++; else unverified++;
      checklist.push(Object.freeze({ digestSha256: item.digestSha256, byteLength: item.byteLength,
        references: Object.freeze(references.get(item.digestSha256)!), state }));
    }
  }
  return Object.freeze({ expected: verified + missing + unverified, verified, missing, unverified, bytes,
    checklist: Object.freeze(checklist) });
}

/** Partition content, not provenance: duplicate references remain in Case data. */
export function workspaceAttachmentGroups(archive: ReviewedWorkspaceArchive): readonly (readonly CaseAttachment[])[] {
  return retainedFileGroups(archiveCaseRecords(archive).flatMap(row => readCaseAttachments(row?.attachments) ?? []));
}

function archiveCaseRecords(archive: ReviewedWorkspaceArchive): Pick<CaseRecord, 'id' | 'attachments'>[] {
  const section = archive.sections.find(item => item.id === 'cases');
  if (!section || section.status !== 'ready') throw new Error('Required file coverage cannot be determined from an unsupported Case section.');
  const rows = (section.data as { cases?: unknown })?.cases;
  if (!Array.isArray(rows) || rows.length > MAX_CASES) throw new Error('Backup Case records cannot be inspected for required files.');
  return rows;
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
