import type { BrandProfile } from '../workspace/brand-profile-model.mts';
import type { WatchlistCollection } from '../workspace/watchlist-store.mts';
import {
  candidateExceptionState,
  candidateMaterialFingerprint,
  normalizeCandidateObservation,
  type BrandCandidateObservation,
} from '../workspace/brand-candidate-workflow.mts';
import { sha256IdentityHex } from '../evidence/record-identity.mts';
import {
  analystReviewSubjectKey,
  analystReviewAgeAt,
  analystReviewLifecycle,
  emptyAnalystReviewStateStore,
  type AnalystReviewItem,
  type AnalystReviewStateStore,
} from './analyst-review-state.mts';

function identity(value: unknown) {
  return sha256IdentityHex(new TextEncoder().encode(JSON.stringify(value)));
}

export function scopedCandidateExclusion(
  candidate: BrandCandidateObservation,
  profile: Pick<BrandProfile, 'id' | 'candidateExceptions'>,
  now: string,
) {
  const matches = candidate.matches.filter((match) => match.brandProfileId === profile.id);
  const active = profile.candidateExceptions.filter(
    (exception) => candidateExceptionState(exception, candidate, profile.id, now) === 'active',
  );
  if (
    !matches.length ||
    !matches.every((match) => active.some((exception) => exception.ruleKey === match.ruleKey))
  )
    return null;
  return {
    kind: 'scoped_exception' as const,
    matchedDomain: candidate.domain,
    reason: `Exact Brand/domain/rule exception(s): ${active.map((exception) => `${exception.reason} (expires ${exception.expiresAt})`).join('; ')}`,
  };
}

/** A nomination is not a Lookup result and carries no availability or Risk value. */
export function discoveryCandidateObservation(
  candidate: Readonly<{
    domain: string;
    source: string;
    mutationTypes: readonly string[];
    certificateTransparency?: Readonly<{
      hostnames: readonly string[];
      firstObservedAt: string | null;
      lastObservedAt: string | null;
    }> | null;
  }>,
  profile: Pick<BrandProfile, 'id' | 'name'>,
  localObservedAt: string,
): BrandCandidateObservation | null {
  if (candidate.mutationTypes.length > 20) return null;
  const paths = candidate.mutationTypes.length ? candidate.mutationTypes : ['manual_selection'];
  return normalizeCandidateObservation({
    domain: candidate.domain,
    matches: paths.map((path) => ({
      brandProfileId: profile.id,
      ruleKey: `match:${identity([candidate.source, path])}`,
      term: candidate.source,
      reason: `${path.replaceAll('_', ' ')} nomination selected for ${profile.name}`,
    })),
    sources: (candidate.certificateTransparency?.hostnames.length
      ? candidate.certificateTransparency.hostnames.slice(0, 12)
      : [candidate.domain]
    ).map((observedHostname) => ({
      source: candidate.certificateTransparency
        ? 'certificate-log search'
        : candidate.mutationTypes.includes('rdap_nameserver_search')
          ? 'registry nameserver-search nomination'
          : 'local candidate generation',
      revision: null,
      observedHostname,
      sourceFirstObservedAt: candidate.certificateTransparency?.firstObservedAt ?? null,
      sourceLastObservedAt: candidate.certificateTransparency?.lastObservedAt ?? null,
      firstLocalObservedAt: localObservedAt,
      completeness: 'unknown',
      gap: `No source revision or continuous coverage is retained by this discovery result.${candidate.certificateTransparency && candidate.certificateTransparency.hostnames.length > 12 ? ` ${candidate.certificateTransparency.hostnames.length - 12} additional hostnames omitted; omitted-hostname content digest ${identity([...candidate.certificateTransparency.hostnames.slice(12)].sort())}.` : ''}`,
    })),
  });
}

export function candidateReviewItem(
  candidate: BrandCandidateObservation,
  profile: Pick<BrandProfile, 'id' | 'name'>,
  now: string,
): AnalystReviewItem {
  const sourceTimes = candidate.sources
    .map((source) => source.sourceLastObservedAt)
    .filter((time): time is string => Boolean(time))
    .sort();
  const observedAt = sourceTimes.at(-1) ?? '';
  return {
    id: `candidate:${identity([profile.id, candidate.domain])}`,
    kind: 'detection_rule',
    evidenceFamily: 'rule',
    subjectKey: analystReviewSubjectKey('rule', ['brand_candidate', profile.id, candidate.domain]),
    materialFingerprint: candidateMaterialFingerprint(candidate, profile.id),
    requiresExpiry: true,
    priority: 'normal',
    title: `Review candidate ${candidate.domain}`,
    detail: `Candidate nomination for ${profile.name}; no infringement assessment or Lookup baseline is implied.`,
    source: 'Retained candidate provenance',
    sourceIds: [...new Set(candidate.sources.map((source) => source.source))],
    caseDomain: candidate.domain,
    observedAt,
    dueAt: null,
    age: analystReviewAgeAt(observedAt, now),
    completeness:
      candidate.sources.length &&
      candidate.sources.every((source) => source.completeness === 'complete')
        ? 'complete'
        : 'partial',
    nextAction: 'review',
    rankingReason: 'Analyst candidate review; independent of Risk or monitoring urgency.',
    href: `/brands?candidate=${encodeURIComponent(candidate.domain)}`,
    retryHref: null,
    caseId: null,
    campaignIds: [],
    dismissalTarget: null,
  };
}

export function projectBrandCandidateReview(
  profile: BrandProfile,
  watchlists: WatchlistCollection,
  reviewState: AnalystReviewStateStore = emptyAnalystReviewStateStore(),
  now = new Date().toISOString(),
) {
  return profile.candidateObservations.slice(0, 200).map((candidate) => {
    const item = candidateReviewItem(candidate, profile, now),
      lifecycle = analystReviewLifecycle(item, reviewState, now);
    const matches = candidate.matches.filter((match) => match.brandProfileId === profile.id);
    const exceptionStates = profile.candidateExceptions
      .filter((exception) => exception.domain === candidate.domain)
      .map((exception) => ({
        exception,
        state: candidateExceptionState(exception, candidate, profile.id, now),
      }));
    const declaration = profile.officialDomains.includes(candidate.domain)
      ? 'Exact official-domain declaration'
      : profile.approvedPartnerDomains.includes(candidate.domain)
        ? 'Exact approved-partner declaration'
        : profile.allowlistedDomains.includes(candidate.domain)
          ? 'Exact legacy domain allowlist entry'
          : null;
    const excluded =
      Boolean(declaration) ||
      (matches.length > 0 &&
        matches.every((match) =>
          exceptionStates.some(
            (row) => row.exception.ruleKey === match.ruleKey && row.state === 'active',
          ),
        ));
    const trackedIn = Object.entries(watchlists)
      .slice(0, 100)
      .filter(([, entry]) =>
        entry.domainMetadata.some(
          (metadata) =>
            metadata.domain === candidate.domain &&
            metadata.contexts.some((context) => context.brandProfileId === profile.id),
        ),
      )
      .map(([name]) => name);
    return {
      candidate,
      item,
      lifecycle,
      matches,
      exceptionStates,
      declaration,
      trackedIn,
      excluded,
      status: excluded
        ? 'excluded'
        : trackedIn.length
          ? 'already_tracked'
          : lifecycle.effectiveDisposition !== 'open'
            ? 'deferred'
            : 'new',
    } as const;
  });
}
