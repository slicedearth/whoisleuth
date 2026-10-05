import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { sha256IdentityHex } from '../evidence/record-identity.mts';
import { ordinaryWorkspaceRecord, assertWorkspaceInputGraph } from './hostile-input.mts';
import {
  WATCH_PRIORITIES,
  normalizeCandidateObservation,
  type BrandCandidateObservation,
  type WatchPriority,
} from './brand-candidate-workflow.mts';
import {
  MAX_BRAND_KEYWORD_CAMPAIGNS,
  MAX_BRAND_KEYWORD_CAMPAIGN_HISTORY,
  MAX_BRAND_KEYWORD_TERMS,
  MAX_BRAND_KEYWORD_TERM_LENGTH,
  MAX_PROFILE_NAME_LENGTH,
} from '../contracts/workspace-portability.mts';

export {
  MAX_BRAND_KEYWORD_CAMPAIGNS,
  MAX_BRAND_KEYWORD_CAMPAIGN_HISTORY,
  MAX_BRAND_KEYWORD_TERMS,
  MAX_BRAND_KEYWORD_TERM_LENGTH,
} from '../contracts/workspace-portability.mts';
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const ID = /^[A-Za-z0-9_-]{1,64}$/u;
export type BrandKeywordCampaignSnapshot = Readonly<{
  revision: number;
  name: string;
  positiveTerms: readonly string[];
  negativeTerms: readonly string[];
  startsAt: string;
  endsAt: string;
  paused: boolean;
  defaultPriority: WatchPriority;
  changedAt: string;
}>;
export type BrandKeywordCampaign = BrandKeywordCampaignSnapshot &
  Readonly<{
    id: string;
    createdAt: string;
    history: readonly BrandKeywordCampaignSnapshot[];
    historyOmitted: number;
  }>;
export type BrandKeywordCampaignInput = Omit<
  BrandKeywordCampaignSnapshot,
  'revision' | 'changedAt'
> &
  Readonly<{ id: string }>;

/** Shared feed and campaign literals are plain substrings, never regular expressions. */
export function normalizeBrandKeywordTerms(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_BRAND_KEYWORD_TERMS)
    throw new RangeError('Use at most 20 literal terms in each selection.');
  assertWorkspaceInputGraph(value, 'Keyword literals');
  return [
    ...new Set(
      value.map((term) => {
        if (
          typeof term !== 'string' ||
          term.length < 3 ||
          term.length > MAX_BRAND_KEYWORD_TERM_LENGTH ||
          term !== term.trim() ||
          CONTROL.test(term)
        )
          throw new TypeError(
            'Literal feed terms must contain 3–80 characters without controls or surrounding spaces.',
          );
        const literal = term.toLowerCase();
        if (literal.length > MAX_BRAND_KEYWORD_TERM_LENGTH)
          throw new TypeError('Lowercased literal terms must remain within 80 characters.');
        return literal;
      }),
    ),
  ];
}

/** The caller supplies a canonical hostname and already bounded literals. */
export function matchBrandKeywordTerms(
  hostname: string,
  positive: readonly string[],
  negative: readonly string[] = [],
) {
  const terms = positive.filter((term) => hostname.includes(term));
  const excludedTerms = negative.filter((term) => hostname.includes(term));
  return { terms, excludedTerms, matched: terms.length > 0 && excludedTerms.length === 0 };
}

function snapshot(value: unknown): BrandKeywordCampaignSnapshot {
  const raw = ordinaryWorkspaceRecord(value, 'Keyword campaign revision');
  if (!raw) throw new TypeError('A keyword campaign revision must be a record.');
  const startsAt = normalizeExplicitIsoTimestamp(raw.startsAt),
    endsAt = normalizeExplicitIsoTimestamp(raw.endsAt),
    changedAt = normalizeExplicitIsoTimestamp(raw.changedAt);
  if (!startsAt || !endsAt || !changedAt || Date.parse(endsAt) <= Date.parse(startsAt))
    throw new TypeError(
      'Use explicit campaign start and end timestamps, with the end after the start.',
    );
  if (
    typeof raw.name !== 'string' ||
    !raw.name.trim() ||
    raw.name.length > MAX_PROFILE_NAME_LENGTH ||
    CONTROL.test(raw.name)
  )
    throw new TypeError('Campaign names require 1–100 plain-text characters.');
  if (
    !Number.isSafeInteger(raw.revision) ||
    Number(raw.revision) < 1 ||
    typeof raw.paused !== 'boolean' ||
    !WATCH_PRIORITIES.some((option) => option.value === raw.defaultPriority)
  )
    throw new TypeError('The campaign revision, pause state or default priority is invalid.');
  const positiveTerms = [...normalizeBrandKeywordTerms(raw.positiveTerms)].sort(),
    negativeTerms = [...normalizeBrandKeywordTerms(raw.negativeTerms)].sort();
  if (!positiveTerms.length)
    throw new TypeError('A keyword campaign requires at least one positive literal term.');
  if (positiveTerms.some((term) => negativeTerms.includes(term)))
    throw new TypeError('The same literal cannot be both positive and negative in one campaign.');
  return {
    revision: Number(raw.revision),
    name: raw.name.trim(),
    positiveTerms,
    negativeTerms,
    startsAt,
    endsAt,
    paused: raw.paused,
    defaultPriority: raw.defaultPriority as WatchPriority,
    changedAt,
  };
}

function campaign(value: unknown): BrandKeywordCampaign {
  const raw = ordinaryWorkspaceRecord(value, 'Keyword campaign');
  if (!raw || typeof raw.id !== 'string' || !ID.test(raw.id))
    throw new TypeError('The keyword campaign identifier is invalid.');
  const current = snapshot(raw),
    createdAt = normalizeExplicitIsoTimestamp(raw.createdAt);
  if (!createdAt || Date.parse(createdAt) > Date.parse(current.changedAt))
    throw new TypeError('The campaign creation clock is invalid.');
  if (!Array.isArray(raw.history) || raw.history.length > MAX_BRAND_KEYWORD_CAMPAIGN_HISTORY)
    throw new RangeError('Retain at most eight previous campaign revisions.');
  const history = raw.history.map(snapshot).sort((a, b) => b.revision - a.revision);
  const seen = new Set<number>();
  let later = current;
  for (const item of history) {
    if (
      seen.has(item.revision) ||
      item.revision >= later.revision ||
      Date.parse(item.changedAt) > Date.parse(later.changedAt) ||
      Date.parse(item.changedAt) < Date.parse(createdAt)
    )
      throw new TypeError(
        'Campaign revision history is repeated, out of order or has conflicting clocks.',
      );
    seen.add(item.revision);
    later = item;
  }
  if (raw.historyOmitted !== current.revision - 1 - history.length)
    throw new TypeError('Campaign revision omissions must account for every earlier revision.');
  return { ...current, id: raw.id, createdAt, history, historyOmitted: Number(raw.historyOmitted) };
}

/** Equal revisions must agree even when a newer revision would otherwise win. */
export function mergeBrandKeywordCampaigns(left: unknown, right: unknown): BrandKeywordCampaign[] {
  const output = new Map<string, BrandKeywordCampaign>();
  for (const input of [left, right]) {
    if (input === undefined) continue;
    if (!Array.isArray(input) || input.length > MAX_BRAND_KEYWORD_CAMPAIGNS)
      throw new RangeError('Each Brand supports at most 20 keyword campaigns.');
    assertWorkspaceInputGraph(input, 'Brand keyword campaigns');
    for (const raw of input) {
      const incoming = campaign(raw),
        existing = output.get(incoming.id);
      if (!existing) {
        output.set(incoming.id, incoming);
        continue;
      }
      if (incoming.createdAt !== existing.createdAt)
        throw new TypeError('The same campaign identifier has conflicting creation identity.');
      const revisions = new Map<number, BrandKeywordCampaignSnapshot>();
      for (const item of [
        snapshot(existing),
        ...existing.history,
        snapshot(incoming),
        ...incoming.history,
      ]) {
        const previous = revisions.get(item.revision);
        if (previous && JSON.stringify(previous) !== JSON.stringify(item))
          throw new TypeError(
            'The same campaign revision contains conflicting intent. No campaign was imported.',
          );
        revisions.set(item.revision, item);
      }
      const [current, ...earlier] = [...revisions.values()].sort((a, b) => b.revision - a.revision);
      const history = earlier.slice(0, MAX_BRAND_KEYWORD_CAMPAIGN_HISTORY);
      output.set(
        incoming.id,
        campaign({
          ...current!,
          id: incoming.id,
          createdAt: incoming.createdAt,
          history,
          historyOmitted: current!.revision - 1 - history.length,
        }),
      );
    }
  }
  if (output.size > MAX_BRAND_KEYWORD_CAMPAIGNS)
    throw new RangeError(
      'The merged Brand exceeds its 20-campaign limit; no campaign was discarded.',
    );
  return [...output.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function normalizeBrandKeywordCampaigns(value: unknown): BrandKeywordCampaign[] {
  return mergeBrandKeywordCampaigns(undefined, value);
}

export function reviseBrandKeywordCampaign(
  existing: BrandKeywordCampaign | null,
  input: BrandKeywordCampaignInput,
  expectedRevision: number | null,
  nowRaw: string,
): BrandKeywordCampaign {
  assertWorkspaceInputGraph(input, 'Keyword campaign edit');
  if ((existing?.revision ?? null) !== expectedRevision || (existing && input.id !== existing.id))
    throw new Error(
      'The campaign changed. Reopen its saved revision before editing; nothing was overwritten.',
    );
  const now = normalizeExplicitIsoTimestamp(nowRaw);
  if (!now || (existing && Date.parse(now) < Date.parse(existing.changedAt)))
    throw new TypeError(
      'The campaign change clock precedes retained intent. Correct the clock before saving.',
    );
  if (existing && existing.revision >= Number.MAX_SAFE_INTEGER)
    throw new RangeError('The campaign revision limit is exhausted.');
  const history = existing
    ? [snapshot(existing), ...existing.history].slice(0, MAX_BRAND_KEYWORD_CAMPAIGN_HISTORY)
    : [];
  const revision = (existing?.revision ?? 0) + 1;
  return campaign({
    ...input,
    revision,
    changedAt: now,
    createdAt: existing?.createdAt ?? now,
    history,
    historyOmitted: revision - 1 - history.length,
  });
}

export function brandKeywordCampaignState(
  value: BrandKeywordCampaignSnapshot,
  nowRaw: string,
): 'active' | 'scheduled' | 'expired' | 'paused' | 'clock_unavailable' {
  const now = normalizeExplicitIsoTimestamp(nowRaw);
  if (!now || Date.parse(now) < Date.parse(value.changedAt)) return 'clock_unavailable';
  if (value.paused) return 'paused';
  if (Date.parse(now) < Date.parse(value.startsAt)) return 'scheduled';
  return Date.parse(now) >= Date.parse(value.endsAt) ? 'expired' : 'active';
}

export function keywordCampaignFeedSelection(
  value: BrandKeywordCampaign,
  brandProfileId: string,
  now: string,
) {
  if (brandKeywordCampaignState(value, now) !== 'active')
    throw new Error(
      'Choose an active campaign revision. Scheduled, paused and expired campaigns do not nominate new candidates.',
    );
  return {
    hosts: [] as string[],
    terms: [...value.positiveTerms],
    ...(value.negativeTerms.length ? { negativeTerms: [...value.negativeTerms] } : {}),
    brandProfileId,
  };
}

/** Keep source facts unchanged; add only the exact reviewed campaign revision. */
export function attributeKeywordCampaignCandidate(
  candidate: BrandCandidateObservation,
  value: BrandKeywordCampaign,
  brandProfileId: string,
  now: string,
): BrandCandidateObservation {
  keywordCampaignFeedSelection(value, brandProfileId, now);
  const { terms, matched } = matchBrandKeywordTerms(
    candidate.domain,
    value.positiveTerms,
    value.negativeTerms,
  );
  if (!matched)
    throw new Error('This candidate does not qualify for the selected campaign revision.');
  const matches = terms.map((term) => ({
    brandProfileId,
    ruleKey: `keyword:${value.id}:${value.revision}:${sha256IdentityHex(new TextEncoder().encode(term)).slice(0, 24)}`,
    term,
    reason: `Literal match for keyword campaign “${value.name}”, revision ${value.revision}. Candidate nomination only; no collection or infringement finding.`,
  }));
  const result = normalizeCandidateObservation({ ...candidate, matches });
  if (!result) throw new Error('The campaign candidate attribution is invalid.');
  return result;
}

export function keywordCampaignMatchContext(
  ruleKey: string,
  campaigns: readonly BrandKeywordCampaign[],
) {
  const match = /^keyword:([A-Za-z0-9_-]{1,64}):(\d+):([a-f0-9]{24})$/u.exec(ruleKey);
  if (!match) return null;
  const owner = campaigns.find((item) => item.id === match[1]);
  const revision =
    owner && [owner, ...owner.history].find((item) => item.revision === Number(match[2]));
  return owner &&
    revision &&
    revision.positiveTerms.some(
      (term) => sha256IdentityHex(new TextEncoder().encode(term)).slice(0, 24) === match[3],
    )
    ? { id: owner.id, revision }
    : null;
}

/** Only one unambiguous retained default may prefill an explicit handoff. */
export function keywordCampaignDefaultPriority(
  candidates: readonly BrandCandidateObservation[],
  brandProfileId: string,
  campaigns: readonly BrandKeywordCampaign[],
): WatchPriority | null {
  if (!candidates.length) return null;
  const priorities = new Set<WatchPriority>();
  for (const candidate of candidates) {
    const matches = candidate.matches.filter((match) => match.brandProfileId === brandProfileId);
    if (!matches.length) return null;
    for (const match of matches) {
      const context = keywordCampaignMatchContext(match.ruleKey, campaigns);
      if (
        !context ||
        !context.revision.positiveTerms.includes(match.term) ||
        !candidate.domain.includes(match.term)
      )
        return null;
      priorities.add(context.revision.defaultPriority);
    }
  }
  return priorities.size === 1 ? [...priorities][0]! : null;
}
