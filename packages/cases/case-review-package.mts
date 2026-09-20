import { CASE_SCHEMA_VERSION, MAX_EDITABLE_CASE_OUTPUT_BYTES } from '../contracts/case-portability.mts';
import { MAX_SELECTED_FILE_TOTAL_BYTES } from '../contracts/selected-file-limits.mts';
import { canonicalArtifactJsonV2 } from '../evidence/artifact-integrity.mts';
import { readCaseAttachments, type CaseAttachment } from './case-attachment-model.mts';
import { readEditableCaseExport } from './case-export-input.mts';
import { buildCaseExport } from './case-storage-model.mts';
import type { CaseRecord } from './case-record-contracts.mts';

/** Uses the ordinary Case export; no parallel handoff schema or draft fields. */
export function caseReviewDocument(record: CaseRecord, now?: string): string {
  const text = `${JSON.stringify(buildCaseExport([record], now))}\n`;
  if (new TextEncoder().encode(text).byteLength > MAX_EDITABLE_CASE_OUTPUT_BYTES) throw new Error('The complete Case exceeds its review-file bound. No shortened copy was created.');
  const checked = readCaseReviewDocument(text);
  if (canonicalArtifactJsonV2(checked) !== canonicalArtifactJsonV2(record)) throw new Error('The Case cannot be exported without changing retained content. Nothing was prepared.');
  return text;
}

export function readCaseReviewDocument(text: string): CaseRecord {
  const cases = readEditableCaseExport(text);
  const root = JSON.parse(text) as { version: number };
  if (root.version !== CASE_SCHEMA_VERSION || cases.length !== 1) throw new Error('Select an ordinary current export containing exactly one Case.');
  return cases[0]!;
}

export function caseReviewFileSelection(record: CaseRecord, ids: readonly string[]) {
  const references = readCaseAttachments(record.attachments) ?? [];
  if (!Array.isArray(ids) || ids.length > references.length || new Set(ids).size !== ids.length) throw new Error('The Case file selection is invalid.');
  const wanted = new Set(ids), selected = references.filter(item => wanted.has(item.id));
  if (selected.length !== ids.length) throw new Error('A selected file reference is no longer in this Case.');
  const unique = new Map<string, CaseAttachment>();
  for (const item of selected) unique.set(item.digestSha256, item);
  const files = [...unique.values()];
  const bytes = files.reduce((sum, item) => sum + item.byteLength, 0);
  if (bytes > MAX_SELECTED_FILE_TOTAL_BYTES) throw new Error('The selected original bytes exceed the bounded handoff payload. Select a smaller group explicitly; nothing was omitted automatically.');
  return { references, selected, files, bytes, omitted: references.filter(item => !unique.has(item.digestSha256)) };
}

/** Match bytes, not filenames or source claims. Duplicated byte identities are not source identities. */
export function matchCaseReviewFiles(record: CaseRecord, files: readonly { id: string; digestSha256: string; byteLength: number }[]) {
  return (readCaseAttachments(record.attachments) ?? []).map(attachment => ({ attachment,
    entries: files.filter(file => file.digestSha256 === attachment.digestSha256 && file.byteLength === attachment.byteLength).map(file => file.id),
  }));
}
