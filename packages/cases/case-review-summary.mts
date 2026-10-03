import { MAX_RESPONSE_LABEL_LENGTH, MAX_RESPONSE_VALUE_LENGTH, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH } from '../contracts/case-portability.mts';
import { array, digest, enumeration, exact, iso, text } from '../evidence/artifact-structure.mts';

/** A local report is not an imported provider finding or a new source sighting. */
export type LocalCaseReviewSummary = Readonly<{
  title: string;
  summary: string;
  reviewedAt: string;
  reportDigestSha256: string;
  completeness: 'partial' | 'inconclusive';
  limitations: readonly string[];
}>;

export function localCaseReviewPin(raw: LocalCaseReviewSummary) {
  const review = exact(raw, ['title', 'summary', 'reviewedAt', 'reportDigestSha256', 'completeness', 'limitations'], 'Local review summary');
  const title = text(review.title, 'Review title', MAX_RESPONSE_LABEL_LENGTH);
  iso(review.reviewedAt, 'Local review time'); digest(review.reportDigestSha256, 'Retained report identity');
  const summary = text(review.summary, 'Local review summary', MAX_RESPONSE_VALUE_LENGTH);
  const value = text(`${summary} Review file: ${review.reportDigestSha256}.`, 'Retained review summary', MAX_RESPONSE_VALUE_LENGTH);
  const limitations = [
    `Local review completed ${review.reviewedAt}; this is not a source event time or a provider report.`,
    ...array(review.limitations, 'Review limitations', MAX_RESPONSE_LIMITATIONS - 1).map(value => text(value, 'Review limitation', MAX_RESPONSE_LIMITATION_LENGTH)),
  ];
  return { label: 'Local review summary', value, source: title, observedAt: null,
    completeness: enumeration(review.completeness, ['partial', 'inconclusive'] as const, 'Review completeness'), truncated: false, limitations };
}
