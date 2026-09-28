import type { BrowserLocalCollectionDocumentMap, BrowserLocalCollectionValueMap } from '../../frontend/src/lib/browser-local-data-definitions.ts';
import type { CaseRecord } from '../../packages/cases/case-model.mts';
import type { WatchlistCollection, WatchlistEntry } from '../../packages/workspace/watchlist-store.mts';
import type { ReviewSessionStore } from '../../packages/contracts/review-session-contract.mts';

/** Compiled, not executed: adapter-derived documents keep their concrete
 * types at the service boundary instead of becoming unknown or any. */
export function checkLocalDocuments(
  documents: BrowserLocalCollectionDocumentMap,
  cases: CaseRecord[],
  watchlists: WatchlistCollection,
): void {
  const readable: [CaseRecord[], WatchlistCollection, ReviewSessionStore] = [
    documents.cases, documents.watchlists, documents.review_session,
  ];
  const writable: Pick<BrowserLocalCollectionDocumentMap, 'cases' | 'watchlists'> = { cases, watchlists };
  void readable;
  void writable;
  // @ts-expect-error The Case collection is an array, not a versioned store.
  void documents.cases.records;
  // @ts-expect-error A Case array cannot replace a review-session document.
  const invalid: BrowserLocalCollectionDocumentMap['review_session'] = cases;
  void invalid;
}

export function checkLocalRecordValues(values: BrowserLocalCollectionValueMap, caseRecord: CaseRecord): void {
  const readable: [CaseRecord, WatchlistEntry] = [values.cases, values.watchlists];
  const writable: BrowserLocalCollectionValueMap['cases'] = caseRecord;
  void readable;
  void writable;
  // @ts-expect-error A single retained Case is not the complete collection.
  const invalid: BrowserLocalCollectionValueMap['cases'] = [caseRecord];
  // @ts-expect-error Case records cannot be treated as a watchlist entry.
  const wrongCollection: BrowserLocalCollectionValueMap['watchlists'] = caseRecord;
  void invalid;
  void wrongCollection;
}
