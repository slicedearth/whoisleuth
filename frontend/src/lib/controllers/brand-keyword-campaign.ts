import {
  reviseBrandKeywordCampaign,
  matchBrandKeywordTerms,
  brandKeywordCampaignState,
  keywordCampaignCorpusRevision,
  type KeywordCampaignCorpus,
  type BrandKeywordCampaign,
  type BrandKeywordCampaignInput,
  type BrandKeywordCampaignSnapshot,
} from '../../../../packages/workspace/brand-keyword-campaign.mts';
import {
  candidateExceptionState,
  MAX_CANDIDATE_OBSERVATIONS,
  type WatchPriority,
} from '../../../../packages/workspace/brand-candidate-workflow.mts';
import {
  profileDomainMatch,
  previewBrandDomainExclusions,
  type BrandProfileSignalProfile,
} from '../analysis/brand-profile-signals.ts';

export type KeywordCampaignDraft = {
  id: string;
  expectedRevision: number | null;
  name: string;
  positive: string;
  negative: string;
  startsAt: string;
  endsAt: string;
  paused: boolean;
  defaultPriority: WatchPriority;
};
export function keywordCampaignDraft(
  value: BrandKeywordCampaign | null,
  id: string,
  now: string,
): KeywordCampaignDraft {
  return {
    id: value?.id ?? id,
    expectedRevision: value?.revision ?? null,
    name: value?.name ?? '',
    positive: value?.positiveTerms.join('\n') ?? '',
    negative: value?.negativeTerms.join('\n') ?? '',
    startsAt: value?.startsAt ?? now,
    endsAt: value?.endsAt ?? '',
    paused: value?.paused ?? false,
    defaultPriority: value?.defaultPriority ?? 'unassigned',
  };
}

/** Matching is independent of the campaign window, declarations and previous analyst reviews. */
export function explainKeywordCampaignMatch(
  hostname: string,
  campaign: BrandKeywordCampaignSnapshot,
  now: string,
) {
  const match = matchBrandKeywordTerms(hostname, campaign.positiveTerms, campaign.negativeTerms);
  return {
    ...match,
    outcome: match.excludedTerms.length ? 'vetoed' as const : match.matched ? 'matched' as const : 'missing_positive' as const,
    missingTerms: campaign.positiveTerms.filter((term) => !match.terms.includes(term)),
    state: brandKeywordCampaignState(campaign, now),
  };
}

/** Compare the explicitly selected, already validated Brand corpus without changing its records. */
export function compareKeywordCampaignCorpus(
  profile: KeywordCampaignCorpus,
  before: BrandKeywordCampaign | null,
  after: BrandKeywordCampaign,
  now: string,
) {
  const revision = keywordCampaignCorpusRevision(profile);
  if (before && before.id !== after.id)
    throw new TypeError('Compare revisions of the same keyword campaign.');
  const rows = profile.candidateObservations.map((candidate) => {
    const previous = before ? explainKeywordCampaignMatch(candidate.domain, before, now) : null;
    const proposed = explainKeywordCampaignMatch(candidate.domain, after, now);
    const change = previous === null ? 'no_baseline' : previous.matched === proposed.matched
      ? proposed.matched ? 'unchanged_match' : 'unchanged_nonmatch'
      : proposed.matched ? 'added' : 'removed';
    return {
      domain: candidate.domain, before: previous, after: proposed, change,
      declaration: profileDomainMatch(candidate.domain, profile),
      sources: candidate.sources.map((source) => ({ ...source })),
      reviews: profile.candidateExceptions.filter((review) => review.domain === candidate.domain)
        .map((review) => ({
          purpose: review.purpose, ruleKey: review.ruleKey, reason: review.reason,
          revision: review.revision, reviewedAt: review.reviewedAt, expiresAt: review.expiresAt,
          state: candidateExceptionState(review, candidate, profile.id, now),
          previousRevisions: review.history.length, omittedRevisions: review.historyOmitted,
        })),
    } as const;
  });
  return {
    profileId: profile.id, profileName: profile.name, profileUpdatedAt: profile.updatedAt,
    revision, comparedAt: now, maximum: MAX_CANDIDATE_OBSERVATIONS,
    beforeRevision: before?.revision ?? null, afterRevision: after.revision, rows,
    beforeHistoryOmitted: before?.historyOmitted ?? null,
    beforeMatches: before ? rows.filter((row) => row.before?.matched).length : null,
    afterMatches: rows.filter((row) => row.after.matched).length,
    counts: {
      added: rows.filter((row) => row.change === 'added').length,
      removed: rows.filter((row) => row.change === 'removed').length,
      unchanged_match: rows.filter((row) => row.change === 'unchanged_match').length,
      unchanged_nonmatch: rows.filter((row) => row.change === 'unchanged_nonmatch').length,
      no_baseline: rows.filter((row) => row.change === 'no_baseline').length,
    },
  };
}
export type KeywordCampaignComparison = ReturnType<typeof compareKeywordCampaignCorpus>;
/** Preview and persistence consume the same detached, fully validated submission. */
export function previewKeywordCampaignDraft(
  draft: KeywordCampaignDraft,
  current: BrandKeywordCampaign | null,
  now: string,
) {
  const lines = (value: string) => {
    if (value.length > 20 * 81)
      throw new RangeError('Campaign literal input exceeds its bounded text size.');
    return value
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean);
  };
  const input: BrandKeywordCampaignInput = {
    id: draft.id,
    name: draft.name,
    positiveTerms: lines(draft.positive),
    negativeTerms: lines(draft.negative),
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    paused: draft.paused,
    defaultPriority: draft.defaultPriority,
  };
  return {
    input,
    expectedRevision: draft.expectedRevision,
    now,
    campaign: reviseBrandKeywordCampaign(current, input, draft.expectedRevision, now),
  };
}

/** Reuse the Brand preview's hostname and declaration owner; examples stay in page memory. */
export function previewKeywordCampaignHosts(
  input: string,
  campaign: BrandKeywordCampaign,
  profile: BrandProfileSignalProfile,
  now: string,
) {
  if (input.length > 5120) throw new RangeError('Enter at most 20 bounded example hostnames.');
  if (!input.trim()) return [];
  const preview = previewBrandDomainExclusions(input, profile, profile);
  if (preview.state !== 'ready') throw new TypeError(preview.detail);
  if (preview.rows.length > 20)
    throw new RangeError('Enter at most 20 example hostnames; no partial preview was evaluated.');
  const active = brandKeywordCampaignState(campaign, now) === 'active';
  return preview.rows.map((row) => ({
    domain: row.domain,
    declaration: row.after,
    ...explainKeywordCampaignMatch(row.domain, campaign, now),
    active,
  }));
}
