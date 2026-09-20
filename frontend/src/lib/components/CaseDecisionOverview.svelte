<script lang="ts">
  import type { CaseRecord } from '../../../../packages/cases/case-record-contracts.mts';
  import { buildCaseDecisionOverview } from '../../../../packages/cases/case-decision-overview.mts';
  import { evidenceTime } from '$lib/analysis/evidence-time.ts';
  import { caseEvidenceChoiceName, caseRecheckEvidence } from '$lib/analysis/case-evidence-presentation.ts';
  import type { CaseWorkspaceSection } from '$lib/analysis/case-response-stage.ts';
  import { reviewClock } from '$lib/review-clock.ts';
  let { record, selectSection }: { record: CaseRecord; selectSection: (section: CaseWorkspaceSection) => void | Promise<void> } = $props();
  const overview = $derived(buildCaseDecisionOverview(record, new Date($reviewClock).toISOString()));
  let selectedId = $state('');
  const selected = $derived(overview.claims.find(item => item.assertion.id === selectedId) ?? overview.claims[0]);
  let showGaps = $state(false);
  const next = $derived(overview.reviews[0]);
  const labels = { action: 'Action due', follow_up: 'Response follow-up', recheck: 'Independent recheck' };
</script>

<section class="decision-overview" aria-labelledby={`decision-overview-${record.id}`}>
  <h3 id={`decision-overview-${record.id}`}>Decision overview</h3>
  <div class="overview-grid">
    <section aria-label="Latest recorded conclusions">
      <h4>Latest recorded conclusion{overview.conclusions.length === 1 ? '' : 's'}</h4>
      {#each overview.conclusions as item (item.decision.id)}
        <article>
          <strong>{item.decision.summary}</strong>
          <p>{item.decision.rationale || 'No rationale recorded.'}</p>
          <small>{evidenceTime(item.decision.createdAt)?.readable ?? 'Record time unavailable'} · analyst confidence: {item.decision.confidence}</small>
          {#if item.decision.confidenceBasis}<p>{item.decision.confidenceBasis}</p>{/if}
          {#if item.evidenceAddedLater}<p class="review-note">Evidence was added after this decision. Review whether the conclusion still applies.</p>{/if}
          <details><summary>Linked evidence · {item.references.length}</summary>
            <ul>{#each item.references as reference (reference.id)}<li>{reference.pin ? caseEvidenceChoiceName(reference.pin, record.evidencePins.indexOf(reference.pin)) : `Unavailable pin: ${reference.id}`}</li>{/each}</ul>
          </details>
        </article>
      {:else}<p>No analyst conclusion recorded.</p>{/each}
      <button class="btn small" type="button" onclick={() => void selectSection('assessment')}>Review assessment{overview.earlierConclusions ? ` · ${overview.earlierConclusions} earlier decision${overview.earlierConclusions === 1 ? '' : 's'}` : ''}</button>
    </section>
    <section aria-label="Next scheduled review">
      <h4>Next scheduled review</h4>
      {#if next}<p><strong>{labels[next.kind]}</strong> · {next.label}</p><p>{evidenceTime(next.at)?.readable} · {next.due === null ? 'Current time unavailable' : next.due ? 'Due now' : 'Upcoming'}</p>
      {:else}<p>No dated review recorded.</p>{/if}
      <button class="btn small" type="button" onclick={() => void selectSection('response')}>Review response and recheck</button>
    </section>
  </div>
  {#if selected}
    <label class="claim-select">Open assessment
      <select value={selected.assertion.id} onchange={event => selectedId = event.currentTarget.value}>
        {#each overview.claims as item (item.assertion.id)}<option value={item.assertion.id}>{item.assertion.kind.replaceAll('_', ' ')}: {item.assertion.statement}</option>{/each}
      </select>
    </label>
    <p>{selected.assertion.statement}</p>
    {#if selected.assertion.rationale}<p>{selected.assertion.rationale}</p>{/if}
    <div class="evidence-groups">
      {#each [{ stance: 'supports', label: 'Supporting' }, { stance: 'contradicts', label: 'Contrary' }, { stance: 'unresolved', label: 'Unresolved' }, { stance: null, label: 'Unclassified links' }] as group}
        {@const refs = selected.references.filter(reference => reference.stance === group.stance)}
        {#if refs.length}<section aria-label={`${group.label} evidence`}><h4>{group.label} · {refs.length}</h4><ul>
          {#each refs as reference (reference.id)}<li>
            {#if reference.pin}<strong>{reference.pin.label}</strong><p>{reference.pin.value}</p><small>{reference.pin.source} · {caseRecheckEvidence(reference.pin).completeness} · {evidenceTime(reference.pin.observedAt)?.readable ?? 'Observation time unavailable'}</small>
            {:else}<span>Unavailable pin: {reference.id}</span>{/if}
          </li>{/each}
        </ul></section>{/if}
      {/each}
    </div>
    {#if !selected.references.length}<p>No evidence is linked to this assessment.</p>{/if}
  {:else}<p>No open assessment recorded.</p>{/if}
  <details bind:open={showGaps}><summary>Incomplete or undated pinned evidence · {overview.evidenceGaps.length}</summary>
    {#if showGaps}<ul>{#each overview.evidenceGaps as pin (pin.id)}<li><strong>{pin.label}</strong> · {pin.source} · {caseRecheckEvidence(pin).completeness}{#if pin.truncated} · truncated{/if} · {evidenceTime(pin.observedAt)?.readable ?? 'Observation time unavailable'}{#if pin.sourceState} · source {pin.sourceState}{/if}
      {#if pin.limitations.length}<p>{pin.limitations.join(' ')}</p>{/if}</li>{/each}</ul>{/if}
  </details>
</section>

<style>
  .decision-overview{display:grid;gap:12px;min-width:0;padding:var(--card-pad);border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  h3,h4,p{margin:0}h4{font-size:var(--text-sm)}p,small,li{overflow-wrap:anywhere}p,li{font-size:var(--text-xs);line-height:1.55}small{color:var(--muted)}
  .overview-grid,.evidence-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
  section,article{min-width:0;display:grid;gap:8px}.claim-select{display:grid;gap:6px;font-size:var(--text-xs)}select{width:100%;min-width:0;max-width:100%}
  ul{display:grid;gap:10px;padding-inline-start:20px;margin:8px 0}summary{cursor:pointer;min-height:32px;align-content:center;font-size:var(--text-xs);overflow-wrap:anywhere}.btn{justify-self:start}.review-note{color:var(--amber)}
  @media(max-width:700px){.overview-grid,.evidence-groups{grid-template-columns:1fr}}
</style>
