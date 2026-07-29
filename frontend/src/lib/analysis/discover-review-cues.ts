export const MAX_DISCOVER_REVIEW_CUES = 5;

export type DiscoverReviewCueInput = Readonly<{
  referenceMatch: boolean;
  mixedScript: boolean;
  internationalized: boolean;
  generationPathCount: number;
  certificateObserved: boolean;
}>;

export function discoverReviewCues(input: DiscoverReviewCueInput): string[] {
  const cues: string[] = [];
  if (input.referenceMatch) cues.push('source or profile character match');
  if (input.mixedScript) cues.push('mixed writing scripts');
  if (input.internationalized) cues.push('internationalized domain');
  if (Number.isFinite(input.generationPathCount) && input.generationPathCount > 1) cues.push('multiple generation paths');
  if (input.certificateObserved) cues.push('certificate-log observation');
  return cues.slice(0, MAX_DISCOVER_REVIEW_CUES);
}
