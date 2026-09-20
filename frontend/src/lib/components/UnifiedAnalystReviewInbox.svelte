<script lang="ts">
  import AnalystReviewInbox from './AnalystReviewInbox.svelte';
  import { buildAnalystReviewInbox, type AnalystReviewDismissalReason, type AnalystReviewItem } from '$lib/analysis/analyst-review-inbox.ts';
  import { buildLocalAnalystReviewProjection } from '$lib/analysis/analyst-review-local-projections.ts';
  import { buildCertificateReviewInbox } from '$lib/analysis/certificate-review-inbox.ts';
  import type { AnalystReviewDisposition, AnalystReviewStateStore } from '$lib/analysis/analyst-review-state.ts';
  import type { BrandProfile } from '$lib/brand-profiles';
  import type { BulkSession } from '$lib/bulk-sessions';
  import type { CaseRecord } from '$lib/cases';
  import type { DetectionRule } from '$lib/detection-rules';
  import type { WebsiteProfileSnapshot } from '$lib/website-snapshots';
  import type { Watchlists } from '$lib/watchlists';

  let {
    cases,
    watchlists,
    bulkSessions,
    profiles,
    detectionRules,
    websiteSnapshots,
    reviewState,
    selectedSubjectKey = '',
    ondismiss,
    onreview,
    oncount,
  }: {
    cases: readonly CaseRecord[];
    watchlists: Watchlists;
    bulkSessions: readonly BulkSession[];
    profiles: readonly BrandProfile[];
    detectionRules: readonly DetectionRule[];
    websiteSnapshots: readonly WebsiteProfileSnapshot[];
    reviewState: AnalystReviewStateStore;
    selectedSubjectKey?: string;
    ondismiss?: (item: AnalystReviewItem, reason: AnalystReviewDismissalReason) => void | Promise<void>;
    onreview?: (item: AnalystReviewItem, input: { disposition: AnalystReviewDisposition; rationale: string; expiresAt: string | null; reviewDueAt: string | null }) => void | Promise<void>;
    oncount?: (count: number) => void;
  } = $props();

  const review = $derived.by(() => {
    const now = new Date().toISOString();
    const localProjection = buildLocalAnalystReviewProjection({ cases, profiles, detectionRules, websiteSnapshots, watchlists, bulkSessions, reviewState }, now);
    const certificateProjection = buildCertificateReviewInbox(profiles, cases, { now, reviewState });
    return { now, inbox: buildAnalystReviewInbox({
      cases,
      watchlists,
      bulkSessions,
      reviewState,
      projectedItems: [...localProjection.items, ...certificateProjection.reviewItems],
      projectedAdmissions: [localProjection.admission, certificateProjection.reviewAdmission],
    }, now) };
  });
  const inbox = $derived(review.inbox);

  $effect(() => { oncount?.(inbox.counts.all); });
</script>

<AnalystReviewInbox
  {inbox}
  {selectedSubjectKey}
  now={review.now}
  {...(ondismiss ? { ondismiss } : {})}
  {...(onreview ? { onreview } : {})}
/>
