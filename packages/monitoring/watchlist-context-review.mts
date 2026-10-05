import type { WatchlistCollection } from '../workspace/watchlist-store.mts';
import type { WatchlistChange, WatchlistHistoryEvent } from '../workspace/watchlist-history.mts';
import { domainTransitionReview } from '../investigation/domain-transition-review.mts';
import { latestObservationCohort } from '../evidence/latest-observations.mts';
import {
  analystReviewMaterialFingerprint,
  analystReviewSubjectKey,
  analystReviewAgeAt,
  type AnalystReviewItem,
} from './analyst-review-state.mts';

/** Source-qualified transitions remain independent of discovery suppression and scoring. */
export function projectWatchlistContextReviews(watchlists: WatchlistCollection, now: string) {
  const items: AnalystReviewItem[] = [];
  const details: Array<{ subjectKey: string; changes: WatchlistChange[] }> = [];
  let truncated = false;
  outer: for (const [name, entry] of Object.entries(watchlists).slice(0, 100)) {
    const byDomain = new Map<
      string,
      Array<{ event: WatchlistHistoryEvent; changes: WatchlistChange[] }>
    >();
    for (const event of entry.history) {
      const grouped = new Map<string, WatchlistChange[]>();
      for (const change of event.changes) {
        if (!domainTransitionReview(change.field, change.before, change.after)) continue;
        const rows = grouped.get(change.domain) ?? [];
        rows.push(change);
        grouped.set(change.domain, rows);
      }
      for (const [domain, changes] of grouped) {
        const observations = byDomain.get(domain) ?? [];
        observations.push({ event, changes });
        byDomain.set(domain, observations);
      }
    }
    for (const metadata of entry.domainMetadata.slice(0, 2_000)) {
      const observations = byDomain.get(metadata.domain) ?? [];
      const latest = latestObservationCohort(
        observations,
        (observation) => observation.event.checkedAt,
      );
      const retained = [...latest.latest, ...latest.undated];
      if (!retained.length) continue;
      for (const context of metadata.contexts.slice(0, 20)) {
        if (items.length >= 500) {
          truncated = true;
          break outer;
        }
        const ambiguous = latest.undated.length > 0 || latest.latest.length !== 1;
        const changes = retained.flatMap((observation) => observation.changes);
        const observedAt = latest.observedAt ?? '';
        const prompts = [
          ...new Set(
            changes
              .map((change) => domainTransitionReview(change.field, change.before, change.after))
              .filter(Boolean),
          ),
        ];
        const sourceScope = [...new Set(changes.map((change) => change.field))].sort();
        const subjectKey = analystReviewSubjectKey('comparison', [
          'watch_domain_context',
          name,
          metadata.domain,
          context.brandProfileId,
        ]);
        details.push({ subjectKey, changes });
        items.push({
          id: `watch-context:${name}:${metadata.domain}:${context.brandProfileId ?? 'local'}`,
          kind: 'watchlist_change',
          evidenceFamily: 'comparison',
          subjectKey,
          materialFingerprint: analystReviewMaterialFingerprint([
            metadata.domain,
            context.brandProfileId,
            context.reason,
            // A repeated observation clock alone is not a new transition.
            changes
              .map((change) => [change.field, change.before, change.after, change.kind])
              .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
          ]),
          requiresExpiry: true,
          priority:
            context.priority === 'p1'
              ? 'urgent'
              : context.priority === 'p2' || changes.some((change) => change.tone === 'danger')
                ? 'high'
                : 'normal',
          title: `Review observed changes for ${metadata.domain}`,
          detail: `${context.brandProfileId ? `Exact Brand context ${context.brandProfileId}` : 'Watchlist-only context'}; analyst priority ${context.priority}. Watch reason: ${context.reason || 'Not assigned'}. Changed fields: ${sourceScope.join(', ')}. ${prompts.join(' ')} ${ambiguous ? 'Source time is missing or tied; no unique latest event is selected.' : 'The earlier value is the last comparable retained baseline; its exact field observation time is not retained.'}`,
          source: 'Saved watchlist comparable changes',
          sourceIds: sourceScope,
          caseDomain: metadata.domain,
          observedAt,
          dueAt: context.reviewDueAt,
          age: analystReviewAgeAt(observedAt, now),
          completeness:
            ambiguous ||
            retained.some(
              (observation) =>
                observation.event.omittedChanges > 0 ||
                observation.event.conclusiveCount < observation.event.resultCount,
            )
              ? 'partial'
              : 'complete',
          nextAction: 'review',
          rankingReason:
            'Suggested attention only. Analyst-set priority is retained and is not automatically changed.',
          href: `/monitor?view=watchlists&watchlist=${encodeURIComponent(name)}&domain=${encodeURIComponent(metadata.domain)}`,
          retryHref: null,
          caseId: null,
          campaignIds: [],
          dismissalTarget: null,
        });
      }
    }
  }
  return { items, details, truncated };
}
