import type { ReviewSessionPosition, ReviewSessionRecord } from '../../../packages/contracts/review-session-contract.mts';
import { emptyReviewSessionStore, normalizeReviewSessionPosition, normalizeReviewSessionStore } from '../../../packages/workspace/review-session.mts';
import { readBrowserLocalData, updateBrowserLocalData } from './browser-local-data-service.ts';
import { assertLocalRecordCurrent } from './local-mutation-outcome.ts';

export async function loadReviewSession(): Promise<ReviewSessionRecord | null> {
  return normalizeReviewSessionStore(await readBrowserLocalData('review_session')).records[0] ?? null;
}
export async function saveReviewSession(position: ReviewSessionPosition, expected: ReviewSessionRecord | null): Promise<ReviewSessionRecord> {
  const submitted = normalizeReviewSessionPosition(position);
  const prior = expected ? normalizeReviewSessionStore({ ...emptyReviewSessionStore(), records: [expected] }).records[0]! : null;
  const record: ReviewSessionRecord = { id: 'inbox', revision: crypto.randomUUID(), updatedAt: new Date().toISOString(), ...submitted };
  return updateBrowserLocalData('review_session', current => {
    assertLocalRecordCurrent(current.records[0], prior, 'saved review position');
    if (!prior && current.records.length) throw new Error('Another tab saved a review position. Reload it before replacing it; nothing was overwritten.');
    return { document: normalizeReviewSessionStore({ ...current, records: [record] }), result: record };
  });
}
export async function discardReviewSession(expected: ReviewSessionRecord): Promise<void> {
  const prior = normalizeReviewSessionStore({ ...emptyReviewSessionStore(), records: [expected] }).records[0]!;
  return updateBrowserLocalData('review_session', current => {
    assertLocalRecordCurrent(current.records[0], prior, 'saved review position');
    return { document: emptyReviewSessionStore(), result: undefined };
  });
}
