import { MAX_EDITABLE_CASE_INPUT_BYTES } from '../../../packages/contracts/case-portability.mts';
import { caseReviewDocument, caseReviewFileSelection, matchCaseReviewFiles, readCaseReviewDocument } from '../../../packages/cases/case-review-package.mts';
import type { CaseRecord } from '../../../packages/cases/case-record-contracts.mts';
import { canonicalArtifactJsonV2 } from '../../../packages/evidence/artifact-integrity.mts';
import { boundedJsonLimitsForBytes, parseBoundedJson } from '../../../packages/analysis/bounded-json.mts';
import { readRetainedCaseFiles } from './case-attachments.ts';
import { browserLocalDataCollection, browserLocalDataProvider, readBrowserLocalData } from './browser-local-data-service.ts';
import type { BrowserInvestigationPackageReview, SelectedInvestigationFile } from './investigation-package-worker-model.ts';
import { readCaseAttachments, type CaseAttachment } from '../../../packages/cases/case-attachment-model.mts';
import { inspectCaseOriginalFiles } from '../../../packages/workspace/workspace-recovery.mts';

/** Deliberate local inspection only; no bytes or check result are retained. */
export async function inspectRetainedCaseOriginals(record: CaseRecord, signal: AbortSignal, ids?: readonly string[]) {
  const expectedCase = canonicalArtifactJsonV2(record), id = record.id;
  const attachments = ids === undefined ? readCaseAttachments(record.attachments) ?? []
    : caseReviewFileSelection(record, ids).selected;
  signal.throwIfAborted();
  const [provider, definition] = await Promise.all([browserLocalDataProvider(), browserLocalDataCollection('cases')]);
  signal.throwIfAborted();
  const result = await inspectCaseOriginalFiles([{ id, attachments }], group => provider.readFiles(definition,
    group.map(({ digestSha256, byteLength }) => ({ digestSha256, byteLength }))), signal);
  signal.throwIfAborted();
  await assertCaseCurrent(expectedCase, id, () => readBrowserLocalData('cases'),
    'This Case changed while its files were being checked. Review its current contents and check again; no saved work changed.');
  signal.throwIfAborted();
  return Object.freeze({ ...result, checkedReferences: Object.freeze(attachments) });
}

/** A byte check covers only the exact references deliberately included in it. */
export function caseOriginalFileState(inspection: Awaited<ReturnType<typeof inspectRetainedCaseOriginals>> | null,
  reference: CaseAttachment): 'not_checked' | 'verified' | 'missing' | 'unverified' {
  const checked = inspection?.checkedReferences.find(item => item.id === reference.id);
  if (!checked || canonicalArtifactJsonV2(checked) !== canonicalArtifactJsonV2(reference)) return 'not_checked';
  return inspection!.checklist.find(item => item.digestSha256 === checked.digestSha256 && item.byteLength === checked.byteLength)?.state ?? 'verified';
}

/** Compare completed checks only. A different reference is not a changed file. */
export function compareCaseOriginalChecks(previous: Awaited<ReturnType<typeof inspectRetainedCaseOriginals>> | null,
  current: Awaited<ReturnType<typeof inspectRetainedCaseOriginals>>) {
  const earlier = new Map(previous?.checkedReferences.map(reference =>
    [canonicalArtifactJsonV2(reference), caseOriginalFileState(previous, reference)]));
  let compared = 0;
  const changed = current.checkedReferences.flatMap(reference => {
    const before = earlier.get(canonicalArtifactJsonV2(reference));
    if (before === undefined) return [];
    compared++;
    const after = caseOriginalFileState(current, reference);
    return before === after ? [] : [Object.freeze({ referenceId: reference.id, before, after })];
  });
  return Object.freeze({ compared, changed: Object.freeze(changed),
    newlyChecked: current.checkedReferences.length - compared,
    notRechecked: earlier.size - compared });
}

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
  await assertCaseCurrent(expectedCase, id, readCases,
    'This Case changed after the handoff check. Check its current contents again; no package was downloaded.');
}

async function assertCaseCurrent(expectedCase: string, id: string, readCases: () => Promise<CaseRecord[]>, changedMessage: string) {
  const current = (await readCases()).find(record => record.id === id);
  if (!current || canonicalArtifactJsonV2(current) !== expectedCase) throw new Error(changedMessage);
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
