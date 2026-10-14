import type { CaseRecord } from '../../../../packages/cases/case-model.mts';
import { readCaseAttachment, type CaseAttachment } from '../../../../packages/cases/case-attachment-model.mts';
import { caseNumber } from '../../../../packages/cases/case-workflow-metadata.mts';
import type { ObservationContext } from '../../../../packages/comparison/capture-context.mts';
import { MAX_CASES } from '../../../../packages/contracts/case-portability.mts';
import { MAX_SELECTED_FILES } from '../../../../packages/contracts/selected-file-limits.mts';

export type GalleryFileKind = 'png' | 'text';
export type GalleryFileReference = Readonly<{ caseId: string; attachmentId: string }>;
export type GalleryFile = Readonly<{
  reference: GalleryFileReference; key: string; kind: GalleryFileKind;
  caseNumber: string; caseTitle: string; caseDomain: string;
  attachment: CaseAttachment;
}>;

export function galleryFileKind(file: CaseAttachment): GalleryFileKind | null {
  if (file.mediaType === 'image/png') return 'png';
  return file.mediaType === 'application/octet-stream' && /\.(?:txt|text)$/iu.test(file.fileName) ? 'text' : null;
}

export function resolveGalleryFile(records: readonly CaseRecord[], reference: GalleryFileReference) {
  const matches = records.filter(record => record.id === reference.caseId);
  if (matches.length !== 1) return null;
  const record = matches[0]!;
  const attachments = (record.attachments ?? []).filter(file => file.id === reference.attachmentId);
  if (attachments.length !== 1) return null;
  const attachment = readCaseAttachment(attachments[0]), kind = galleryFileKind(attachment);
  if (!kind) return null;
  return { reference: { ...reference }, key: JSON.stringify([record.id, attachment.id]), kind,
    caseNumber: caseNumber(record.id), caseTitle: record.title || record.domain, caseDomain: record.domain, attachment } satisfies GalleryFile;
}

export function retainedGalleryInventory(records: readonly CaseRecord[]) {
  if (!Array.isArray(records) || records.length > MAX_CASES
    || records.some(record => (record.attachments?.length ?? 0) > MAX_SELECTED_FILES))
    throw new TypeError('Gallery input exceeds the supported Case or attachment collection. No partial inventory was produced.');
  const files: GalleryFile[] = [];
  let eligible = 0, ambiguous = 0;
  const identities = new Map<string, number>();
  for (const record of records) identities.set(record.id, (identities.get(record.id) ?? 0) + 1);
  for (const record of records) {
    const ids = new Set<string>(), duplicates = new Set<string>();
    for (const file of record.attachments ?? []) { if (ids.has(file.id)) duplicates.add(file.id); ids.add(file.id); }
    for (const file of record.attachments ?? []) {
      const kind = galleryFileKind(file);
      if (!kind) continue;
      if (identities.get(record.id) !== 1 || duplicates.has(file.id)) { ambiguous++; continue; }
      eligible++;
      files.push({ reference: { caseId: record.id, attachmentId: file.id }, key: JSON.stringify([record.id, file.id]), kind,
        caseNumber: caseNumber(record.id), caseTitle: record.title || record.domain, caseDomain: record.domain, attachment: readCaseAttachment(file) });
    }
  }
  return { files, eligible, ambiguous };
}

export function filterGalleryFiles(files: readonly GalleryFile[], kind: GalleryFileKind, query: string) {
  const needle = query.slice(0, 200).trim().toLocaleLowerCase();
  return files.filter(file => file.kind === kind && (!needle || [file.caseNumber, file.caseTitle, file.caseDomain,
    file.attachment.fileName, file.attachment.source ?? ''].some(value => value.toLocaleLowerCase().includes(needle))));
}

export function gallerySelectionSignature(records: readonly CaseRecord[], references: readonly GalleryFileReference[]) {
  const resolved = references.map(reference => resolveGalleryFile(records, reference));
  if (resolved.some(file => !file)) return null;
  // Comparison identity follows the selected content and its declared provenance,
  // not search text, display labels or unrelated edits to the enclosing Case.
  return JSON.stringify(resolved.map(file => {
    const { digestSha256, byteLength, mediaType, source, observedAt, retainedAt, derivation } = file!.attachment;
    return { reference: file!.reference, kind: file!.kind, digestSha256, byteLength, mediaType,
      source, observedAt, retainedAt, derivation: derivation ?? null };
  }));
}

export function galleryObservationContext(file: GalleryFile): ObservationContext {
  // A Case domain or attachment source is not an observed hostname/vantage.
  return { observedAt: file.attachment.observedAt, observerLabel: null, vantageLabel: null, conditions: null };
}
