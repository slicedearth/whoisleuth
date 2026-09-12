import { addCaseAttachments, assertDerivedCaseAttachmentSource, readCaseAttachment, removeCaseAttachment, type CaseAttachment } from '../../../packages/cases/case-attachment-model.mts';
import { enforceStoreBudget, type CaseRecord } from '../../../packages/cases/case-model.mts';
import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_TOTAL_BYTES } from '../../../packages/contracts/selected-file-limits.mts';
import { captureRetainedFiles } from '../../../packages/evidence/retained-file.mts';
import { sha256ArtifactBytes } from '../../../packages/evidence/artifact-integrity.mts';
import { investigationFileMediaType } from '../../../packages/investigation/investigation-manifest.mts';
import { mergeExternalFindingsIntoCase, parseExternalFindingsDocument, type ExternalFindingsDocument } from '../../../packages/interchange/external-findings-import.mts';
import { browserLocalDataCollection, browserLocalDataProvider, updateBrowserLocalData } from './browser-local-data-service.ts';

export type SelectedCaseAttachment = Readonly<{ attachment: CaseAttachment; file: Blob }>;

export async function prepareCaseAttachmentFiles(files: readonly File[], source: string | null, observedAt: string | null): Promise<readonly SelectedCaseAttachment[]> {
  if (!Array.isArray(files) || !files.length || files.length > MAX_SELECTED_FILES) throw new Error(`Select between 1 and ${MAX_SELECTED_FILES} files.`);
  let total = 0;
  const selected = files.map(file => {
    if (!(file instanceof File) || !file.size || file.size > MAX_SELECTED_FILE_TOTAL_BYTES - total) throw new Error('Selected files are empty or exceed the combined 64-MiB limit.');
    total += file.size;
    // Validate declared provenance before reading any body bytes.
    const attachment = readCaseAttachment({ id: crypto.randomUUID(), fileName: file.name, mediaType: investigationFileMediaType(file.name),
      source, observedAt, retainedAt: new Date().toISOString(), byteLength: file.size, digestSha256: `sha256:${'0'.repeat(64)}` });
    return { file: file.slice(), attachment };
  });
  const result: SelectedCaseAttachment[] = [];
  for (const item of selected) {
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    try {
      result.push({ file: item.file, attachment: readCaseAttachment({ ...item.attachment, digestSha256: await sha256ArtifactBytes(bytes) }) });
    } finally { bytes.fill(0); }
  }
  return result;
}

function preserveExistingEvidence(cases: CaseRecord[]) {
  const bounded = enforceStoreBudget(cases);
  if (bounded.pruned) throw new Error('The file references do not fit the Case metadata budget. Export or remove saved data first; existing evidence was not pruned.');
  return bounded;
}

export async function retainCaseAttachments(caseId: string, input: readonly SelectedCaseAttachment[], findings?: ExternalFindingsDocument) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_SELECTED_FILES) throw new Error(`Select between 1 and ${MAX_SELECTED_FILES} attachments to retain.`);
  const now = new Date().toISOString();
  const selected = input.map(item => ({ attachment: readCaseAttachment({ ...item.attachment, retainedAt: now }), file: item.file }));
  const bodies = new Map<Blob, { reference: { digestSha256: string; byteLength: number }; file: Blob }>();
  for (const { attachment, file } of selected) {
    const reference = { digestSha256: attachment.digestSha256, byteLength: attachment.byteLength };
    const previous = bodies.get(file);
    if (previous && JSON.stringify(previous.reference) !== JSON.stringify(reference)) throw new Error('One selected file has conflicting content declarations.');
    bodies.set(file, { reference, file });
  }
  const files = captureRetainedFiles([...bodies.values()]);
  // The bounded parser detaches fields synchronously, including reactive views.
  const imported = findings ? parseExternalFindingsDocument(findings) : null;
  return updateBrowserLocalData('cases', current => {
    const original = current.find(record => record.id === caseId);
    if (!original) throw new Error('The Case is no longer available. No files were retained.');
    for (const item of selected) assertDerivedCaseAttachmentSource(original, item.attachment);
    const merged = imported ? mergeExternalFindingsIntoCase(current, caseId, imported) : { cases: current, record: original };
    const record = addCaseAttachments(merged.record, selected.map(item => item.attachment), now);
    const { cases } = preserveExistingEvidence(merged.cases.map(item => item.id === caseId ? record : item));
    return { document: cases, result: { cases, record: cases.find(item => item.id === caseId)!, pruned: 0 } };
  }, { files });
}

export async function removeRetainedCaseAttachment(caseId: string, expected: CaseAttachment) {
  const reference = readCaseAttachment(expected), now = new Date().toISOString();
  return updateBrowserLocalData('cases', current => {
    const original = current.find(record => record.id === caseId);
    if (!original) throw new Error('The Case is no longer available.');
    const record = removeCaseAttachment(original, reference.id, reference, now);
    const cases = current.map(item => item.id === caseId ? record : item);
    return { document: cases, result: { cases, record, pruned: 0 } };
  });
}

export async function readRetainedCaseFile(attachment: CaseAttachment): Promise<Blob> {
  const expected = readCaseAttachment(attachment);
  const [provider, definition] = await Promise.all([browserLocalDataProvider(), browserLocalDataCollection('cases')]);
  const files = await provider.readFiles(definition, [{ digestSha256: expected.digestSha256, byteLength: expected.byteLength }]);
  const file = files.get(expected.digestSha256);
  if (!file) throw new Error('The reference is retained, but its original bytes are missing from this workspace. Restore or deliberately retain the matching original file.');
  return file;
}
