import type { Candidate } from '../candidate-handoff.ts';
import { discoverReviewCues } from './discover-review-cues.ts';

export type CandidateSort =
  | 'generated'
  | 'review-signals'
  | 'domain'
  | 'generation-paths'
  | 'reference'
  | 'mixed'
  | 'certificate-newest';

export type CandidateMetadata = Readonly<{
  hasIdn: boolean;
  unicodeDomain: string;
  scripts: string[];
  mixedScript: boolean;
  referenceDomains: string[];
}>;

export function candidateReviewCues(
  candidate: Candidate,
  metadata: CandidateMetadata | undefined,
): string[] {
  return discoverReviewCues({
    referenceMatch: Boolean(metadata?.referenceDomains.length),
    mixedScript: Boolean(metadata?.mixedScript),
    internationalized: Boolean(metadata?.hasIdn),
    generationPathCount: candidate.mutationTypes.length,
    certificateObserved: Boolean(candidate.certificateTransparency?.certificateCount),
  });
}

export function sortDiscoverCandidates(
  candidates: readonly Candidate[],
  sort: CandidateSort,
  metadata: ReadonlyMap<string, CandidateMetadata>,
): Candidate[] {
  if (sort === 'generated') return [...candidates];
  return [...candidates].sort((left, right) => {
    if (sort === 'domain') return left.domain.localeCompare(right.domain);
    if (sort === 'review-signals') {
      return candidateReviewCues(right, metadata.get(right.domain)).length
        - candidateReviewCues(left, metadata.get(left.domain)).length
        || right.mutationTypes.length - left.mutationTypes.length
        || left.domain.localeCompare(right.domain);
    }
    if (sort === 'generation-paths') {
      return right.mutationTypes.length - left.mutationTypes.length
        || left.domain.localeCompare(right.domain);
    }
    if (sort === 'reference') {
      return Number(Boolean(metadata.get(right.domain)?.referenceDomains.length))
        - Number(Boolean(metadata.get(left.domain)?.referenceDomains.length))
        || left.domain.localeCompare(right.domain);
    }
    if (sort === 'mixed') {
      return Number(Boolean(metadata.get(right.domain)?.mixedScript))
        - Number(Boolean(metadata.get(left.domain)?.mixedScript))
        || left.domain.localeCompare(right.domain);
    }
    const leftObserved = left.certificateTransparency?.lastObservedAt || '';
    const rightObserved = right.certificateTransparency?.lastObservedAt || '';
    return rightObserved.localeCompare(leftObserved) || left.domain.localeCompare(right.domain);
  });
}
