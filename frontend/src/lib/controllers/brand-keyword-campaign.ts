import {
  reviseBrandKeywordCampaign,
  matchBrandKeywordTerms,
  brandKeywordCampaignState,
  type BrandKeywordCampaign,
  type BrandKeywordCampaignInput,
} from '../../../../packages/workspace/brand-keyword-campaign.mts';
import type { WatchPriority } from '../../../../packages/workspace/brand-candidate-workflow.mts';
import {
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
    ...matchBrandKeywordTerms(row.domain, campaign.positiveTerms, campaign.negativeTerms),
    active,
  }));
}
