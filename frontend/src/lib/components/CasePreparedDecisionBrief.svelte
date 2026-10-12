<script lang="ts">
  import { preparedDecisionBrief, type PreparedCaseReport } from '../../../../packages/cases/prepared-report-reading.mts';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';
  import CasePreparedReferences from './CasePreparedReferences.svelte';
  let { report }: { report: PreparedCaseReport } = $props();
  let assessmentId = $state('');
  const brief = $derived(preparedDecisionBrief(report));
  const selected = $derived(brief.assessments.find(value => value.assertion.id === assessmentId)?.assertion ?? null);
</script>

<section class="decision-brief" aria-label="Prepared decision brief">
  <h3>Decision brief</h3>
  <p>This reading view does not change downloads or printing. Long reasoning and limitations continue below.</p>
  {#if brief.assessments.length}
    <label>Recorded assessment to focus
      <select bind:value={assessmentId}><option value="">Choose an assessment</option>{#each brief.assessments as item}<option value={item.assertion.id}>{item.assertion.kind.replaceAll('_', ' ')} · {item.assertion.statement}</option>{/each}</select>
    </label>
    {#if selected}
      <article aria-label="Selected prepared assessment">
        <h4>{selected.statement}</h4>
        <p>{selected.kind.replaceAll('_', ' ')} · {selected.state} · <code>{selected.id}</code></p>
        <EvidenceTimestamp value={selected.createdAt} label="assessment recorded" />
        {#if selected.updatedAt !== selected.createdAt}<EvidenceTimestamp value={selected.updatedAt} label="assessment updated" />{/if}
        {#if selected.rationale}<p class="prose">{selected.rationale}</p>{/if}
        {#if selected.provenance}<p>Declared source: {selected.provenance.sourceName}{selected.provenance.publisher ? ` · ${selected.provenance.publisher}` : ''}</p>{/if}
        <CasePreparedReferences {report} statement={{ kind: 'assertion', id: selected.id }} />
      </article>
    {/if}
  {:else}<p>No open assessment was included in this prepared report.</p>{/if}
  <section aria-label="Prepared conclusions">
    <h4>Recorded conclusions</h4>
    <p>These are Case-wide decisions, not an automatic answer to the selected assessment.</p>
    {#if brief.latestConclusions.length}<h5>Latest dated conclusions</h5>{/if}
    {#each brief.latestConclusions as decision}
      <article><h5>{decision.summary}</h5><p class="prose">{decision.rationale}</p><p>Recorded confidence: {decision.confidence}{decision.confidenceBasis ? ` · ${decision.confidenceBasis}` : ''}</p><EvidenceTimestamp value={decision.createdAt} label="decision time" /><CasePreparedReferences {report} statement={{ kind: 'decision', id: decision.id }} /></article>
    {/each}
    {#if brief.undatedConclusions.length}<h5>Undated conclusions · order unavailable</h5>{/if}
    {#each brief.undatedConclusions as decision}
      <article><h5>{decision.summary}</h5><p class="prose">{decision.rationale}</p><p>Recorded confidence: {decision.confidence}{decision.confidenceBasis ? ` · ${decision.confidenceBasis}` : ''}</p><CasePreparedReferences {report} statement={{ kind: 'decision', id: decision.id }} /></article>
    {/each}
    {#if !brief.latestConclusions.length && !brief.undatedConclusions.length}<p>No conclusion was included in this prepared report.</p>{/if}
    {#if brief.earlierConclusions}<p>{brief.earlierConclusions} earlier dated conclusion{brief.earlierConclusions === 1 ? '' : 's'} remain in the full prepared report.</p>{/if}
  </section>
  <section aria-label="Prepared next steps">
    <h4>Recorded next steps · not executed</h4>
    {#each brief.nextSteps as item}
      <article><h5>{item.assertion.statement}</h5><EvidenceTimestamp value={item.assertion.createdAt} label="next step recorded" />{#if item.assertion.rationale}<p class="prose">{item.assertion.rationale}</p>{/if}{#if item.assertion.provenance}<p>Declared source: {item.assertion.provenance.sourceName}{item.assertion.provenance.publisher ? ` · ${item.assertion.provenance.publisher}` : ''}</p>{/if}<CasePreparedReferences {report} statement={{ kind: 'assertion', id: item.assertion.id }} /></article>
    {:else}<p>No open next step was included in this prepared report.</p>{/each}
  </section>
  <section aria-label="Prepared report limitations"><h4>Scope and limitations</h4><p class="prose">{brief.limitations}</p></section>
</section>

<style>
  .decision-brief{min-width:0;overflow-wrap:anywhere}
  h3,h4,h5{margin:0 0 8px;font-family:var(--font-sans)}
  h4,h5{font-size:var(--text-sm)}
  section,article{margin-top:16px;padding-top:14px;border-top:1px solid var(--border)}
  p{margin:6px 0;font-size:var(--text-sm);line-height:1.6}
  label{display:grid;min-width:0;gap:6px;font-size:var(--text-sm);font-weight:700}
  select{width:100%;min-width:0}
  .prose{white-space:pre-wrap}
  code{white-space:normal;overflow-wrap:anywhere}
</style>
