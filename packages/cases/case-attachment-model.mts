import { MAX_SELECTED_FILES, SELECTED_FILE_MEDIA_TYPES, type SelectedFileMediaType } from '../contracts/selected-file-limits.mts';
import { array, enumeration, exact, iso, text } from '../evidence/artifact-structure.mts';
import { readRetainedFileReference, type RetainedFileReference } from '../evidence/retained-file.mts';
import type { CaseRecord } from './case-record-contracts.mts';

export type CaseAttachment = RetainedFileReference & Readonly<{
  id: string;
  fileName: string;
  mediaType: SelectedFileMediaType;
  source: string | null;
  observedAt: string | null;
  retainedAt: string;
}>;

/** Case provenance is independent of deduplicated immutable content. */
export function readCaseAttachment(value: unknown): CaseAttachment {
  const item = exact(value, ['id', 'fileName', 'mediaType', 'source', 'observedAt', 'retainedAt', 'digestSha256', 'byteLength'], 'Case attachment');
  const id = text(item.id, 'Attachment ID', 128);
  const fileName = text(item.fileName, 'Attachment filename', 240);
  if (/[/\\]/u.test(fileName) || fileName === '.' || fileName === '..') throw new TypeError('Attachment filenames cannot contain a path.');
  const mediaType = enumeration(item.mediaType, SELECTED_FILE_MEDIA_TYPES, 'Attachment media type');
  const source = item.source === null ? null : text(item.source, 'Attachment source', 240);
  iso(item.observedAt, 'Attachment observation time', true); iso(item.retainedAt, 'Attachment retention time');
  return Object.freeze({ id, fileName, mediaType, source, observedAt: item.observedAt as string | null, retainedAt: item.retainedAt as string,
    ...readRetainedFileReference({ digestSha256: item.digestSha256, byteLength: item.byteLength }) });
}

export function readCaseAttachments(value: unknown): CaseAttachment[] | undefined {
  if (value === undefined) return undefined;
  const attachments = array(value, 'Case attachments', MAX_SELECTED_FILES).map(readCaseAttachment);
  if (new Set(attachments.map(item => item.id)).size !== attachments.length) throw new TypeError('Case attachment reference IDs must be unique.');
  const lengths = new Map<string, number>();
  for (const attachment of attachments) {
    const previous = lengths.get(attachment.digestSha256);
    if (previous !== undefined && previous !== attachment.byteLength) throw new TypeError('One retained file digest has conflicting byte lengths.');
    lengths.set(attachment.digestSha256, attachment.byteLength);
  }
  return attachments;
}

export function mergeCaseAttachments(local: readonly CaseAttachment[] | undefined, incoming: readonly CaseAttachment[] | undefined): CaseAttachment[] | undefined {
  if (local === undefined && incoming === undefined) return undefined;
  const result = new Map((readCaseAttachments(local) ?? []).map(item => [item.id, item]));
  for (const item of readCaseAttachments(incoming) ?? []) {
    const existing = result.get(item.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(item)) throw new TypeError('An attachment reference conflicts with retained provenance. No file or reference was overwritten.');
    result.set(item.id, item);
  }
  return readCaseAttachments([...result.values()]);
}

export function caseAttachmentReferences(cases: readonly CaseRecord[]): RetainedFileReference[] {
  return cases.flatMap(record => (record.attachments ?? []).map(({ digestSha256, byteLength }) => ({ digestSha256, byteLength })));
}

export function addCaseAttachments(record: CaseRecord, attachments: readonly CaseAttachment[], updatedAt: string): CaseRecord {
  iso(updatedAt, 'Case update time');
  return { ...record, attachments: mergeCaseAttachments(record.attachments, attachments) ?? [], updatedAt };
}

export function removeCaseAttachment(record: CaseRecord, id: string, expected: CaseAttachment, updatedAt: string): CaseRecord {
  const current = record.attachments?.find(item => item.id === id);
  if (!current) return record;
  if (JSON.stringify(readCaseAttachment(current)) !== JSON.stringify(readCaseAttachment(expected))) throw new TypeError('The attachment changed in another tab. Refresh before removing it.');
  iso(updatedAt, 'Case update time');
  return { ...record, attachments: record.attachments!.filter(item => item.id !== id), updatedAt };
}
