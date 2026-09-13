import { MAX_EDITABLE_CASE_INPUT_BYTES } from '../../../packages/contracts/case-portability.mts';
import { caseReviewDocument, caseReviewFileSelection, matchCaseReviewFiles, readCaseReviewDocument } from '../../../packages/cases/case-review-package.mts';
import type { CaseRecord } from '../../../packages/cases/case-record-contracts.mts';
import { canonicalArtifactJsonV2 } from '../../../packages/evidence/artifact-integrity.mts';
import { boundedJsonLimitsForBytes, parseBoundedJson } from '../../../lib/bounded-json.mts';
import { readRetainedCaseFiles } from './case-attachments.ts';
import { readBrowserLocalData } from './browser-local-data-service.ts';
import type { BrowserInvestigationPackageReview, SelectedInvestigationFile } from './investigation-package-worker-model.ts';

export async function prepareCaseReviewHandoff(record: CaseRecord, ids: readonly string[], signal: AbortSignal,
  readFiles: typeof readRetainedCaseFiles = readRetainedCaseFiles) {
  const document = caseReviewDocument(record), snapshot = readCaseReviewDocument(document);
  const selection = caseReviewFileSelection(snapshot, [...ids]);
  signal.throwIfAborted();
  const retained = selection.files.length ? await readFiles(selection.files) : [];
  signal.throwIfAborted();
  const files: SelectedInvestigationFile[] = [{ file: new Blob([document], { type: 'application/json' }), mediaType: 'application/json',
    source: { identity: 'Case review copy', observedAt: null } }];
  for (const reference of selection.files) {
    const found = retained.find(item => item.attachment.digestSha256 === reference.digestSha256 && item.attachment.byteLength === reference.byteLength);
    if (!found || found.file.size !== reference.byteLength) throw new Error('Selected original bytes are missing. Restore them or explicitly change the selection; no file was omitted.');
    // Per-reference provenance stays in the unchanged Case. One deduplicated
    // body must not arbitrarily inherit one of several observation sources.
    files.push({ file: found.file, mediaType: 'application/octet-stream', source: { identity: 'Case attachment bytes; source declarations are in the Case', observedAt: null } });
  }
  return { record: snapshot, expectedCase: canonicalArtifactJsonV2(snapshot), files, selection };
}

export async function assertCaseReviewHandoffCurrent(expectedCase: string, id: string,
  readCases: () => Promise<CaseRecord[]> = () => readBrowserLocalData('cases')): Promise<void> {
  const current = (await readCases()).find(record => record.id === id);
  if (!current || canonicalArtifactJsonV2(current) !== expectedCase) throw new Error('This Case changed after the handoff check. Check its current contents again; no package was downloaded.');
}

/** Package identity has already been verified by the bounded worker. */
export async function readPackagedCaseReview(review: BrowserInvestigationPackageReview) {
  if (!review.identityVerified) throw new Error('Every package file must match its manifest before reviewing a returned Case.');
  const candidates: { record: CaseRecord; document: string; entryId: string; digest: string }[] = [];
  for (const item of review.entries) {
    if (item.entry.schema !== null || item.entry.version === null || item.interpretation === 'opaque') continue;
    const file = review.contents.get(item.entry.id);
    if (!file || file.size > MAX_EDITABLE_CASE_INPUT_BYTES) throw new Error('A possible Case file exceeds the review bound.');
    const document = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    const value = parseBoundedJson(document, { label: 'Packaged Case', maximumBytes: MAX_EDITABLE_CASE_INPUT_BYTES, limits: boundedJsonLimitsForBytes(MAX_EDITABLE_CASE_INPUT_BYTES) });
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'cases')) continue;
    candidates.push({ record: readCaseReviewDocument(document), document, entryId: item.entry.id, digest: item.entry.contentDigestSha256 });
  }
  if (candidates.length !== 1) throw new Error('The review package must contain exactly one ordinary current Case export. No Case was selected arbitrarily.');
  const candidate = candidates[0]!;
  const attachments = matchCaseReviewFiles(candidate.record, review.entries.filter(item => item.entry.id !== candidate.entryId && item.state === 'identity_verified')
    .map(item => ({ id: item.entry.id, digestSha256: item.entry.contentDigestSha256, byteLength: item.entry.byteLength })));
  return { ...candidate, attachments, missing: attachments.filter(item => !item.entries.length),
    files: review.contents, encryption: review.encryption };
}
