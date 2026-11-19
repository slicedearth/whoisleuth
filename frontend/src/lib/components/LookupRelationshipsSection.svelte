<script lang="ts">
  import LookupEvidenceSection from './LookupEvidenceSection.svelte';
  import LookupFamilySummary from './LookupFamilySummary.svelte';
  import DeferredSurface from './DeferredSurface.svelte';
  import WebArchiveHistory from './WebArchiveHistory.svelte';
  import type { LookupSectionControls } from '#lib/controllers/lookup-section-navigation.ts';
  import type { buildLookupRouteAnalysis } from '#lib/analysis/lookup-route-analysis.ts';
  import type { LookupVisualView } from './LookupVisualWorkspace.svelte';
  import type { lookupSectionSurfaces } from './lookup-section-surfaces.ts';
  import { projectEvidenceTopology } from '#lib/analysis/evidence-topology.ts';

  type Analysis = ReturnType<typeof buildLookupRouteAnalysis>;
  let {
    analysis,
    surfaces,
    controls,
    resultType,
    archiveTarget = null,
    visualView = $bindable(),
  }: {
    analysis: Analysis;
    surfaces: ReturnType<typeof lookupSectionSurfaces>['relationships-history'];
    controls: LookupSectionControls;
    resultType: string;
    archiveTarget?: Readonly<{ domain: string; registrationCreatedAt: string | null }> | null;
    visualView: LookupVisualView;
  } = $props();
  const {
    evidenceTopologyTarget,
    evidenceTopologyNodes,
    lookupAssetGraph,
    analystEvidencePivots,
    activationContext,
  } = $derived(analysis);
  const evidenceTopologyProjection = $derived(
    projectEvidenceTopology(evidenceTopologyTarget, evidenceTopologyNodes),
  );
</script>

<LookupEvidenceSection
  id="relationships-history"
  title="Relationships and history"
  family="relationships"
>
  <LookupFamilySummary
    label="Relationships and history"
    description="Inspect source coverage, exact observed relationships, optional passive pivots, and dated lifecycle events in one workspace."
    metrics={[
      `${evidenceTopologyProjection.provenanceCounts.direct} mapped direct sources`,
      `${evidenceTopologyProjection.provenanceCounts.derived} mapped derived analyses`,
      `${lookupAssetGraph.edges.length} relationships`,
      `${activationContext.events.filter((event) => Boolean(event.date)).length} dated events`,
    ]}
    expanded={controls.expanded}
    onpreload={controls.onpreload}
    onshow={controls.onshow}
    onhide={controls.onhide}
  />
  {#if controls.expanded}
    <DeferredSurface
      load={surfaces.workspace.load}
      loadingLabel="Loading relationships and history workspace…"
      unavailableLabel="Relationships and history could not be loaded."
      onready={controls.onready}
      props={{
        view: visualView,
        setview: (value: LookupVisualView) => (visualView = value),
        target: evidenceTopologyTarget,
        nodes: evidenceTopologyNodes,
        graph: lookupAssetGraph,
        pivots: analystEvidencePivots,
        events: activationContext.events,
        context: resultType === 'domain' ? activationContext : null,
        onnavigate: controls.onnavigate,
      }}
    />
    {#if archiveTarget}<WebArchiveHistory domain={archiveTarget.domain} registrationCreatedAt={archiveTarget.registrationCreatedAt} />{/if}
  {/if}
</LookupEvidenceSection>
