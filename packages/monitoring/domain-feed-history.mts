import {
  buildDomainFeedReview,
  domainFeedDefinition,
  normalizeDomainFeedReview,
  normalizeDomainFeedSelection,
  strictDomainFeedHostname,
  type DomainFeedReview,
  type DomainFeedSelection,
  type DomainFeedSnapshotMetadata,
} from './domain-feed.mts';
import { sha256IdentityHex } from '../evidence/record-identity.mts';

/** Edition retention is bounded independently of the number of domains in a file. */
export const DOMAIN_FEED_HISTORY_EDITIONS = 8;
export const DOMAIN_FEED_HISTORY_ATTEMPTS = 64;
export const DOMAIN_FEED_REFRESH_OUTCOMES = [
  'updated',
  'unchanged',
  'failed',
  'cleanup-failed',
  'interrupted',
] as const;
export type DomainFeedRefreshOutcome = (typeof DOMAIN_FEED_REFRESH_OUTCOMES)[number];
export type DomainFeedEdition = Readonly<{
  sequence: number;
  metadata: DomainFeedSnapshotMetadata;
  membershipRetained: boolean;
}>;
export type DomainFeedCursor = Readonly<{
  schemaVersion: 1;
  feedId: string;
  epoch: string;
  through: number;
  sequence: number;
  after: string;
  selectionDigest: string;
}>;
export type DomainFeedHistoryPage = Readonly<{
  feedId: string;
  epoch: string;
  through: number;
  sequence: number;
  state: 'review' | 'gap' | 'complete';
  review: DomainFeedReview | null;
  nextCursor: DomainFeedCursor;
  editions: readonly DomainFeedEdition[];
  attempts: readonly Readonly<{ at: string; outcome: DomainFeedRefreshOutcome }>[] | null;
  earlierEditionsUnavailable: boolean;
}>;

export function domainFeedSelectionDigest(selection: DomainFeedSelection): string {
  const normal = normalizeDomainFeedSelection(selection);
  // Only matching inputs bind a cursor. Private Brand context never leaves the browser.
  const negative = normal.negativeTerms ?? [];
  return sha256IdentityHex(
    new TextEncoder().encode(
      JSON.stringify({
        hosts: [...normal.hosts].sort(),
        terms: [...normal.terms].sort(),
        negativeTerms: [...negative].sort(),
      }),
    ),
  );
}

export function normalizeDomainFeedCursor(
  value: unknown,
  feedId: string,
  selection: DomainFeedSelection,
): DomainFeedCursor {
  domainFeedDefinition(feedId);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid feed review cursor.');
  const cursor = value as DomainFeedCursor;
  if (
    Object.keys(cursor).sort().join(',') !==
      'after,epoch,feedId,schemaVersion,selectionDigest,sequence,through' ||
    cursor.schemaVersion !== 1 ||
    cursor.feedId !== feedId ||
    typeof cursor.epoch !== 'string' ||
    !/^[a-f0-9-]{36}$/u.test(cursor.epoch) ||
    !Number.isSafeInteger(cursor.through) ||
    cursor.through < 1 ||
    !Number.isSafeInteger(cursor.sequence) ||
    cursor.sequence < 1 ||
    cursor.sequence > cursor.through + 1 ||
    !(cursor.after === '' || strictDomainFeedHostname(cursor.after) === cursor.after) ||
    cursor.selectionDigest !== domainFeedSelectionDigest(selection)
  )
    throw new TypeError('Feed cursor does not match the selected source and rules.');
  return Object.freeze({ ...cursor });
}

export function normalizeDomainFeedHistoryPage(
  value: unknown,
  feedId: string,
  selection: DomainFeedSelection,
): DomainFeedHistoryPage {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid feed history reply.');
  const page = value as DomainFeedHistoryPage;
  if (
    Object.keys(page).sort().join(',') !==
      'attempts,earlierEditionsUnavailable,editions,epoch,feedId,nextCursor,review,sequence,state,through' ||
    page.feedId !== feedId ||
    !['review', 'gap', 'complete'].includes(page.state) ||
    !Array.isArray(page.editions) ||
    page.editions.length < 1 ||
    page.editions.length > DOMAIN_FEED_HISTORY_EDITIONS ||
    !(
      page.attempts === null ||
      (Array.isArray(page.attempts) && page.attempts.length <= DOMAIN_FEED_HISTORY_ATTEMPTS)
    ) ||
    typeof page.earlierEditionsUnavailable !== 'boolean'
  )
    throw new TypeError('Invalid feed history reply.');
  const cursor = normalizeDomainFeedCursor(page.nextCursor, feedId, selection);
  if (
    page.epoch !== cursor.epoch ||
    page.through !== cursor.through ||
    !Number.isSafeInteger(page.sequence) ||
    page.sequence < 1 ||
    page.sequence > page.through + 1 ||
    cursor.sequence < page.sequence ||
    (page.state !== 'gap' && cursor.sequence > page.sequence + 1)
  )
    throw new TypeError('Invalid feed history progress.');
  let last = 0;
  for (const edition of page.editions) {
    if (
      !edition ||
      Object.keys(edition).sort().join(',') !== 'membershipRetained,metadata,sequence' ||
      !Number.isSafeInteger(edition.sequence) ||
      edition.sequence <= last ||
      typeof edition.membershipRetained !== 'boolean'
    )
      throw new TypeError('Invalid retained edition.');
    const metadata = edition.metadata;
    if (
      !metadata ||
      Object.keys(metadata).sort().join(',') !==
        'acquiredAt,bytes,declaredPublishedAt,declaredVersion,feedId,importedAt,revision,rows'
    )
      throw new TypeError('Invalid retained edition.');
    buildDomainFeedReview(metadata, normalizeDomainFeedSelection({}), [], {
      matched: 0,
      omitted: 0,
      truncated: false,
    });
    if (metadata.feedId !== feedId) throw new TypeError('Retained edition source differs.');
    if (last && edition.sequence !== last + 1)
      throw new TypeError('Retained edition range is not contiguous.');
    last = edition.sequence;
  }
  if (page.through > last || page.earlierEditionsUnavailable !== page.editions[0]!.sequence > 1)
    throw new TypeError('Invalid retained history range.');
  for (const attempt of page.attempts ?? [])
    if (
      !attempt ||
      Object.keys(attempt).sort().join(',') !== 'at,outcome' ||
      typeof attempt.at !== 'string' ||
      !Number.isFinite(Date.parse(attempt.at)) ||
      new Date(attempt.at).toISOString() !== attempt.at ||
      !DOMAIN_FEED_REFRESH_OUTCOMES.includes(attempt.outcome)
    )
      throw new TypeError('Invalid refresh history.');
  const review = page.review === null ? null : normalizeDomainFeedReview(page.review);
  if (page.state === 'review') {
    const edition = page.editions.find((item) => item.sequence === page.sequence);
    if (
      !review ||
      !edition?.membershipRetained ||
      review.feedId !== feedId ||
      Object.entries(edition.metadata).some(
        ([key, item]) => review[key as keyof DomainFeedReview] !== item,
      ) ||
      domainFeedSelectionDigest(review.selection) !== domainFeedSelectionDigest(selection) ||
      review.selection.brandProfileId !== null ||
      review.truncated !== (cursor.sequence === page.sequence) ||
      (review.truncated ? cursor.after !== review.matches.at(-1)?.domain : cursor.after !== '')
    )
      throw new TypeError('Feed history review is not bound to this edition.');
  } else if (
    page.review !== null ||
    cursor.after !== '' ||
    (page.state === 'complete' &&
      (page.sequence !== page.through + 1 || cursor.sequence !== page.sequence)) ||
    (page.state === 'gap' &&
      (cursor.sequence <= page.sequence ||
        page.sequence > page.through ||
        page.editions.some(
          (edition) =>
            edition.sequence >= page.sequence &&
            edition.sequence < cursor.sequence &&
            edition.membershipRetained,
        )))
  )
    throw new TypeError('Invalid feed history state.');
  return { ...page, review, nextCursor: cursor };
}
