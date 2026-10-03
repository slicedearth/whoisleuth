<script lang="ts">
  import LookupEvidenceSection from './LookupEvidenceSection.svelte';
  import LookupFamilySummary from './LookupFamilySummary.svelte';
  import DeferredSurface from './DeferredSurface.svelte';
  import type { LookupSectionControls } from '$lib/controllers/lookup-section-navigation.ts';
  import type { buildLookupRouteAnalysis } from '$lib/analysis/lookup-route-analysis.ts';
  import type { Snippet } from 'svelte';
  import type { LookupViewModel } from '$lib/analysis/lookup-response.ts';
  import type { CheckpointFact } from '$lib/analysis/case-evidence-checkpoint.ts';
  import type { lookupSectionSurfaces } from './lookup-section-surfaces.ts';
  import { boundedTechnologyText, stringList } from '$lib/analysis/lookup-display-model.ts';

  type Analysis = ReturnType<typeof buildLookupRouteAnalysis>;
  let {
    view,
    analysis,
    surfaces,
    controls,
    target,
    resultType,
    caseId,
    sourceCheckpoint,
  }: {
    view: LookupViewModel;
    analysis: Analysis;
    surfaces: ReturnType<typeof lookupSectionSurfaces>['registry'];
    controls: LookupSectionControls;
    target: string;
    resultType: string;
    caseId: string;
    sourceCheckpoint: Snippet<[CheckpointFact['category'], string]>;
  } = $props();
  const {
    rdap,
    whois,
    rdapParsed,
    whoisParsed,
    registryAccess,
    registryInsights,
    registrarStanding,
  } = $derived(view);
  const {
    comparison,
    registryDisplay,
    idnAnalysis,
    sourceOnlyCount,
    redactedComparisonCount,
    limitedComparisonCount,
    caseDomain,
    lookupObservedAt,
  } = $derived(analysis);

  const sources = $derived({
    comparisonSummary: `RDAP / WHOIS comparison · ${comparison.counts.conflict} ${comparison.counts.conflict === 1 ? 'conflict' : 'conflicts'} · ${sourceOnlyCount} source-only · ${redactedComparisonCount} redacted · ${limitedComparisonCount} unavailable/incomplete · ${comparison.counts.equivalent} equivalent`,
    comparisonRows: registryDisplay.comparisonRows,
    comparisonHasConflicts: comparison.counts.conflict > 0,
    rdapError: boundedTechnologyText(rdap.error, 240),
    resultType,
    rdapParsed,
    rdapPartialDetail: registryDisplay.rdapPartialDetail,
    rdapRows: registryDisplay.rdapRows,
    whoisError: boundedTechnologyText(whois.error, 240),
    whoisRows: registryDisplay.whoisRows,
    whoisContactRoles: registryDisplay.whoisContactRoles,
    whoisTruncatedFields: stringList(whoisParsed.fieldsTruncated, 64, 80),
    registrationTrace: registryDisplay.registrationTrace,
    insights: registryInsights,
    standing: registrarStanding,
    registrar: registryDisplay.registrarRdap,
  });
</script>

<LookupEvidenceSection id="registry" title="Registration" family="registry">
  <LookupFamilySummary
    label="Registration"
    description="Compare authoritative registry evidence with separately attributed registrar RDAP and WHOIS publications."
    metrics={[
      `${registryDisplay.comparisonMetrics.equivalent} equivalent`,
      `${registryDisplay.comparisonMetrics.conflict} ${registryDisplay.comparisonMetrics.conflict === 1 ? 'conflict' : 'conflicts'}`,
      `${registryDisplay.comparisonMetrics.limitedOrSourceOnly} limited or source-only`,
    ]}
    expanded={controls.expanded}
    onpreload={controls.onpreload}
    onshow={controls.onshow}
    onhide={controls.onhide}
  />
  {#if controls.expanded}
    {#if surfaces.access.visible}
      <DeferredSurface
        load={surfaces.access.load}
        loadingLabel="Loading registry-access context…"
        unavailableLabel="Registry-access context could not be loaded."
        props={{ access: registryAccess, lookupTarget: target }}
      />
    {/if}

    {#if idnAnalysis && (idnAnalysis.hasIdn || idnAnalysis.referenceMatches.length)}
      <section class="idn-card evidence-card card" aria-labelledby="idn-title">
        <header class="section-head"
          ><div
            ><p class="eyebrow">Domain identity</p><h4 id="idn-title">IDN and confusable review</h4
            ></div
          ><span>{idnAnalysis.mappingVersion}</span></header
        >
        <div class="idn-forms stat-grid"
          ><article
            ><small>Unicode display</small><strong>{idnAnalysis.unicodeDomain}</strong></article
          ><article><small>DNS-safe ASCII</small><strong>{idnAnalysis.asciiDomain}</strong></article
          ><article
            ><small>Writing scripts</small><strong
              >{idnAnalysis.scripts.join(', ') || 'None detected'}</strong
            ></article
          ></div
        >
        {#if idnAnalysis.findings.length}<ul class="finding-list"
            >{#each idnAnalysis.findings as finding}<li
                class="callout {finding.tone === 'warning' ? 'warn' : 'info'}"
                ><strong>{finding.label}</strong><span>{finding.detail}</span></li
              >{/each}</ul
          >{/if}
        <p class="card-note"
          >Review Unicode and ASCII forms together. These are bounded similarity indicators and do
          not establish maliciousness.</p
        >
      </section>
    {/if}

    <div class="evidence-component" id="evidence-registry"
      ><DeferredSurface
        load={surfaces.sources.load}
        loadingLabel="Loading registration evidence…"
        unavailableLabel="Registration evidence could not be loaded."
        onready={controls.onready}
        props={sources}
      /></div
    >

    {#if surfaces.disclosure.visible}
      <div class="evidence-component"
        ><DeferredSurface
          load={surfaces.disclosure.load}
          loadingLabel="Loading registration-disclosure planner…"
          unavailableLabel="The disclosure planner could not be loaded."
          props={{
            domain: caseDomain,
            observedAt: lookupObservedAt,
            registryRdapEndpoint: boundedTechnologyText(rdap.endpoint, 2048),
            rdapParsed,
            registrar: registryDisplay.registrarRdap,
            caseReference: caseId,
          }}
        /></div
      >
    {/if}

    {@render sourceCheckpoint('registration', 'Registration')}
  {/if}
</LookupEvidenceSection>
<style>
  .evidence-component[id] {
    position: relative;
    scroll-margin-top: var(--local-nav-anchor-offset, 88px);
  }
  .evidence-card {
    padding: var(--card-pad);
  }
  .evidence-card .section-head p:not(.eyebrow) {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .evidence-card .stat-grid {
    margin-top: 14px;
  }
  .card-note {
    margin: 12px 0 0;
    color: var(--muted);
    font-size: var(--text-xs);
    line-height: 1.55;
  }

  .finding-list {
    display: grid;
    gap: 7px;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
  }
  .finding-list .callout {
    margin: 0;
  }
  .finding-list strong {
    display: block;
    color: var(--text);
    font-size: var(--text-xs);
  }
  .finding-list span {
    display: block;
    margin-top: 3px;
  }
</style>
