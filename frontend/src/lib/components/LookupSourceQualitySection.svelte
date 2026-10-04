<script lang="ts">
  import LookupEvidenceSection from './LookupEvidenceSection.svelte';
  import LookupFamilySummary from './LookupFamilySummary.svelte';
  import DeferredSurface from './DeferredSurface.svelte';
  import type { LookupSectionControls } from '#lib/controllers/lookup-section-navigation.ts';
  import type { buildLookupRouteAnalysis } from '#lib/analysis/lookup-route-analysis.ts';
  import type { LookupViewModel, LookupHttpResponse } from '#lib/analysis/lookup-response.ts';
  import type { lookupSectionSurfaces } from './lookup-section-surfaces.ts';
  import type {
    SourceRefreshCaseTarget,
    LookupSourceRefreshLedger,
    LookupFreshnessThresholds,
  } from '#lib/analysis/lookup-source-refresh.ts';

  type Analysis = ReturnType<typeof buildLookupRouteAnalysis>;
  let {
    view,
    analysis,
    surfaces,
    controls,
    original,
    refreshLedger,
    onrefreshchange,
    caseTarget,
    onpolicychange,
  }: {
    view: LookupViewModel;
    analysis: Analysis;
    surfaces: ReturnType<typeof lookupSectionSurfaces>['source-quality'];
    controls: LookupSectionControls;
    original: LookupHttpResponse | null;
    refreshLedger: LookupSourceRefreshLedger | null;
    onrefreshchange: (value: LookupSourceRefreshLedger) => void;
    caseTarget: SourceRefreshCaseTarget;
    onpolicychange: (value: {
      mode: 'task-default' | 'analyst-custom';
      thresholdsDays: LookupFreshnessThresholds;
    }) => void;
  } = $props();
  const { availability, timing: lookupTiming } = $derived(view);
  const {
    evidenceQualityMatrix,
    lookupDecisionFacts,
    lookupSourceRefreshPlan,
    lookupEvidenceDepth,
    lookupSummary,
  } = $derived(analysis);
</script>

<LookupEvidenceSection id="source-quality" title="Source quality" family="quality">
  <LookupFamilySummary
    label="Source quality"
    description="Review collection completeness, freshness, timing, provenance, and diagnostic routes before relying on a conclusion."
    metrics={[
      `${evidenceQualityMatrix.completeCount} complete`,
      `${evidenceQualityMatrix.limitedCount} limited`,
      `${evidenceQualityMatrix.entries.length} records`,
    ]}
    expanded={controls.expanded}
    onpreload={controls.onpreload}
    onshow={controls.onshow}
    onhide={controls.onhide}
  />
  {#if controls.expanded && original}
    <DeferredSurface
      load={surfaces.quality.load}
      loadingLabel="Loading source-quality review…"
      unavailableLabel="Source-quality review could not be loaded."
      onready={controls.onready}
      props={{
        matrix: evidenceQualityMatrix,
        lookupDecisionFacts,
        refreshPlan: lookupSourceRefreshPlan,
        original: original,
        refreshLedger: refreshLedger,
        onrefreshchange: onrefreshchange,
        caseTarget,
        depth: lookupEvidenceDepth,
        timing: lookupTiming,
        onpolicychange: onpolicychange,
      }}
    />
    <DeferredSurface
      load={surfaces.facts.load}
      loadingLabel="Loading evidence facts and diagnostics…"
      unavailableLabel="Evidence facts and diagnostics could not be loaded."
      props={{
        facts: [...lookupSummary.facts],
        diagnostics: [...lookupSummary.diagnostics],
        hasAssessment: availability.applicable !== false,
      }}
    />
  {/if}
</LookupEvidenceSection>
