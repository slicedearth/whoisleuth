import type { BrandProfile } from './brand-profile-model.ts';
import {
  buildAnalystReviewInbox,
  type AnalystReviewItem,
} from './analyst-review-inbox.ts';
import { normalizeCaseBrandProfileIds } from './case-brand-profile-references.ts';
import type { CaseRecord } from './case-model.ts';
import { normalizeOpaqueReferenceId } from './opaque-reference-id.ts';

export const MAX_BRAND_REVIEW_CASES = 500;
export const MAX_BRAND_REVIEW_PROFILES = 100;
export const MAX_BRAND_REVIEW_ROWS = 500;
export const MAX_UNRESOLVED_BRAND_PROFILE_REFERENCES = 100;
export type BrandReviewSourceState = 'loading' | 'ready' | 'unavailable';

export type BrandReviewItem = AnalystReviewItem & Readonly<{
  brandProfileId: string;
  brandProfileName: string;
}>;

export type UnresolvedBrandProfileReference = Readonly<{
  id: string;
  brandProfileId: string;
  caseId: string;
  caseDomain: string;
  href: string;
}>;

export type BrandReviewInbox = Readonly<{
  sources: Readonly<{ cases: BrandReviewSourceState; profiles: BrandReviewSourceState; activePreference: BrandReviewSourceState }>;
  activeProfile: Readonly<{ id: string; name: string }> | null;
  associatedCaseCount: number;
  items: BrandReviewItem[];
  unresolvedReferences: UnresolvedBrandProfileReference[];
  truncated: boolean;
  limitations: readonly string[];
}>;

export function brandProfileDeletionImpact(
  cases: readonly CaseRecord[],
  profileId: unknown,
  sourceState: BrandReviewSourceState,
): string {
  if (sourceState !== 'ready') {
    return sourceState === 'loading'
      ? 'Linked-case impact is still loading. Any retained associations will remain unchanged.'
      : 'Linked-case impact cannot be checked because cases could not be read. Any retained associations will remain unchanged.';
  }
  const id = normalizeOpaqueReferenceId(profileId);
  const linkedCaseCount = id
    ? cases.slice(0, MAX_BRAND_REVIEW_CASES).filter((record) => normalizeCaseBrandProfileIds(record.brandProfileIds).includes(id)).length
    : 0;
  return `${linkedCaseCount} linked case${linkedCaseCount === 1 ? '' : 's'} will retain this identifier and appear unresolved after deletion.`;
}

/**
 * Builds a disposable active-profile view over the existing source-attributed
 * analyst inbox. Associations come only from the Case owner field; no profile
 * text, domain, tag, certificate, or evidence value is matched or inferred.
 */
export function buildBrandReviewInbox(input: Readonly<{
  cases?: readonly CaseRecord[];
  profiles?: readonly BrandProfile[];
  activeProfileId?: unknown;
  sourceStates?: Readonly<{ cases?: BrandReviewSourceState; profiles?: BrandReviewSourceState; activePreference?: BrandReviewSourceState }>;
}>, now: unknown = new Date().toISOString()): BrandReviewInbox {
  const sources = {
    cases: input.sourceStates?.cases ?? 'ready',
    profiles: input.sourceStates?.profiles ?? 'ready',
    activePreference: input.sourceStates?.activePreference ?? 'ready',
  } as const;
  const sourceCases = Array.isArray(input.cases) ? input.cases : [];
  const sourceProfiles = Array.isArray(input.profiles) ? input.profiles : [];
  const cases = sources.cases === 'ready' ? sourceCases.slice(0, MAX_BRAND_REVIEW_CASES) : [];
  const profiles = sources.profiles === 'ready' ? sourceProfiles.slice(0, MAX_BRAND_REVIEW_PROFILES) : [];
  const profileById = new Map<string, BrandProfile>();
  for (const profile of profiles) {
    const id = normalizeOpaqueReferenceId(profile?.id);
    if (id && !profileById.has(id)) profileById.set(id, profile);
  }

  const activeId = sources.activePreference === 'ready' ? normalizeOpaqueReferenceId(input.activeProfileId) : null;
  const active = activeId ? profileById.get(activeId) ?? null : null;
  const associatedCases: CaseRecord[] = [];
  const unresolvedReferences: UnresolvedBrandProfileReference[] = [];
  let unresolvedOmitted = 0;

  for (const record of cases) {
    const profileIds = normalizeCaseBrandProfileIds(record.brandProfileIds);
    if (active && profileIds.includes(active.id)) associatedCases.push(record);
    for (const profileId of profileIds) {
      if (sources.profiles !== 'ready') continue;
      if (profileById.has(profileId)) continue;
      if (unresolvedReferences.length < MAX_UNRESOLVED_BRAND_PROFILE_REFERENCES) {
        unresolvedReferences.push({
          id: `${record.id}:${profileId}`,
          brandProfileId: profileId,
          caseId: record.id,
          caseDomain: record.domain,
          href: `/monitor?view=cases&case=${encodeURIComponent(record.id)}`,
        });
      } else {
        unresolvedOmitted += 1;
      }
    }
  }

  const reviewInbox = sources.cases === 'ready'
    ? buildAnalystReviewInbox({ cases: associatedCases }, now)
    : buildAnalystReviewInbox({ cases: [] }, now);
  const reviewRows = reviewInbox.items.slice(0, MAX_BRAND_REVIEW_ROWS);
  const items: BrandReviewItem[] = active
    ? reviewRows
      .map((item) => ({ ...item, brandProfileId: active.id, brandProfileName: active.name }))
    : [];

  return {
    sources,
    activeProfile: active ? { id: active.id, name: active.name } : null,
    associatedCaseCount: associatedCases.length,
    items,
    unresolvedReferences,
    truncated: (sources.cases === 'ready' && sourceCases.length > cases.length)
      || (sources.profiles === 'ready' && sourceProfiles.length > profiles.length)
      || reviewInbox.items.length > reviewRows.length
      || reviewInbox.truncated
      || unresolvedOmitted > 0,
    limitations: [
      ...reviewInbox.limitations,
      'This Brand view is a transient local projection of existing review rows for cases explicitly associated by an analyst. It makes no request, write, score, or alert.',
      'Profile names, domains, tags, certificates, and evidence values are never used to infer a Case association.',
      'An unresolved reference means its opaque profile identifier is retained but no matching local Brand Profile is currently available. It is not evidence of deletion intent, ownership, attribution, safety, or maliciousness.',
    ],
  };
}
