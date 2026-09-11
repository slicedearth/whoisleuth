<script lang="ts">
  import {
    CASE_PIN_COMPLETENESS,
    CASE_SIGHTING_CATEGORIES,
    CASE_SIGHTING_STATES,
    type CaseRecord,
  } from '$lib/cases';
  import { buildCaseSightingChronology } from '$lib/analysis/case-sighting-chronology.ts';
  import { isoFromUtcInput, utcDateTimeInputAttributes, list } from '$lib/analysis/case-response-form-values.ts';
  import { createCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import CaseDraftRecovery from './CaseDraftRecovery.svelte';
  import type { CaseResponsePresentation, PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import CaseEvidenceFact from './CaseEvidenceFact.svelte';
  import CaseEvidencePinSelect from './CaseEvidencePinSelect.svelte';
  import CaseLinkedEvidence from './CaseLinkedEvidence.svelte';

  let { record, mode, mutationBusy, persist }: {
    record: CaseRecord;
    mode: CaseResponsePresentation;
    mutationBusy: boolean;
    persist: PersistCaseResponse;
  } = $props();

  let expanded = $state(false);
  $effect(() => { expanded = mode === 'quick'; });

  // Keep this instance mounted for one Case while presentations change.
  // Only a committed write clears the corresponding accepted draft.
  const pinDraft = createCaseDraft(() => record.id, 'evidence-pin', {
    pinLabel: '',
    pinValue: '',
    pinSource: 'lookup evidence',
    pinObservedAt: '',
    pinCompleteness: 'complete',
    pinLimitations: ''
  });
  const sightingDraft = createCaseDraft(() => record.id, 'sighting', {
    sightingState: 'observed_by_deployment',
    sightingCategory: 'website',
    sightingSource: 'WHOISleuth deep lookup',
    sightingObservedAt: '',
    sightingCompleteness: 'complete',
    sightingEvidencePinId: '',
    sightingLimitations: ''
  });

  const sightingChronology = $derived(buildCaseSightingChronology(record.sightings));
  const sightingReviewConclusionCount = $derived(
    record.sightings.filter((sighting) =>
      sighting.state === 'not_reproduced' || sighting.state === 'expired').length,
  );

  function countLabel(count: number, singular: string): string {
    return `${count} ${singular}${count === 1 ? '' : 's'}`;
  }

  async function addPin() {
    const unchanged = pinDraft.capture();
    if (!await pinDraft.persist(persist, {
      evidencePin: {
        label: pinDraft.value.pinLabel,
        value: pinDraft.value.pinValue,
        source: pinDraft.value.pinSource,
        observedAt: isoFromUtcInput(pinDraft.value.pinObservedAt),
        completeness: pinDraft.value.pinCompleteness,
        limitations: list(pinDraft.value.pinLimitations),
      },
    }, `Pinned analyst-selected evidence for ${record.domain}.`) || !unchanged()) return;
    pinDraft.value.pinLabel = '';
    pinDraft.value.pinValue = '';
    pinDraft.value.pinLimitations = '';
  }

  async function addSighting() {
    const unchanged = sightingDraft.capture();
    if (!await sightingDraft.persist(persist, {
      sighting: {
        state: sightingDraft.value.sightingState,
        category: sightingDraft.value.sightingCategory,
        source: sightingDraft.value.sightingSource,
        observedAt: isoFromUtcInput(sightingDraft.value.sightingObservedAt),
        completeness: sightingDraft.value.sightingCompleteness,
        evidencePinId: sightingDraft.value.sightingEvidencePinId || null,
        limitations: list(sightingDraft.value.sightingLimitations),
      },
    }, `Recorded a source-qualified sighting for ${record.domain}.`) || !unchanged()) return;
    sightingDraft.value.sightingLimitations = '';
  }

</script>

<section class="case-response-stage" aria-label="Case observations">
  <details id={`case-response-observation-${record.id}`} bind:open={expanded}>
    <summary>Pin an observed fact</summary>
    <form class="response-form" data-recovery-form={pinDraft.form} oninput={pinDraft.changed} onsubmit={(event) => { event.preventDefault(); void addPin(); }}>
      <p class="notice">Date and time fields use UTC.</p>
      <div class="two-columns">
        <label class="field">Label
          <input bind:value={pinDraft.value.pinLabel} maxlength="80" required placeholder="Observed login form">
        </label>
        <label class="field">Source
          <input bind:value={pinDraft.value.pinSource} maxlength="80" required placeholder="Lookup evidence">
        </label>
        <div class="field">
          <label for={`pin-observed-at-${record.id}`}>Observed at</label>
          <input id={`pin-observed-at-${record.id}`} aria-describedby={`pin-time-help-${record.id}`} type="datetime-local" {...utcDateTimeInputAttributes} bind:value={pinDraft.value.pinObservedAt}>
          <small id={`pin-time-help-${record.id}`}>Optional; leave blank if unknown.</small>
        </div>
        <label class="field">Completeness
          <select bind:value={pinDraft.value.pinCompleteness}>
            {#each CASE_PIN_COMPLETENESS as value}<option {value}>{value}</option>{/each}
          </select>
        </label>
      </div>
      <label class="field">Fact
        <textarea bind:value={pinDraft.value.pinValue} maxlength="1000" rows="2" required></textarea>
      </label>
      <label class="field">Limitations <small>one per line</small>
        <textarea bind:value={pinDraft.value.pinLimitations} maxlength="2000" rows="2"></textarea>
      </label>
      <button class="btn" type="submit" disabled={pinDraft.state.busy || mutationBusy}>Pin evidence</button>
      <CaseDraftRecovery draft={pinDraft} />
    </form>
    {#if record.evidencePins.length}
      <ol class="records">
        {#each [...record.evidencePins].reverse() as pin}
          <li>
            <CaseEvidenceFact {pin} />
          </li>
        {/each}
      </ol>
    {/if}
  </details>

  <details id={`case-response-observation-sightings-${record.id}`}>
    <summary>Record a source-qualified sighting</summary>
    <form class="response-form" data-recovery-form={sightingDraft.form} oninput={sightingDraft.changed} onsubmit={(event) => { event.preventDefault(); void addSighting(); }}>
      <p class="notice">Date and time fields use UTC.</p>
      <p class="notice">Use observed or reported states for source evidence. Analyst confirmed, not reproduced, and expired are review conclusions and do not alter the original observation.</p>
      <div class="two-columns">
        <label class="field">Sighting state
          <select bind:value={sightingDraft.value.sightingState}>
            {#each CASE_SIGHTING_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}
          </select>
        </label>
        <label class="field">Evidence category
          <select bind:value={sightingDraft.value.sightingCategory}>
            {#each CASE_SIGHTING_CATEGORIES as value}<option {value}>{value}</option>{/each}
          </select>
        </label>
        <label class="field">Source
          <input bind:value={sightingDraft.value.sightingSource} maxlength="80" required>
        </label>
        <div class="field">
          <label for={`sighting-observed-at-${record.id}`}>Observed or reviewed at</label>
          <input id={`sighting-observed-at-${record.id}`} aria-describedby={`sighting-time-help-${record.id}`} type="datetime-local" {...utcDateTimeInputAttributes} bind:value={sightingDraft.value.sightingObservedAt}>
          <small id={`sighting-time-help-${record.id}`}>Optional; leave blank if unknown.</small>
        </div>
        <label class="field">Completeness
          <select bind:value={sightingDraft.value.sightingCompleteness}>
            {#each CASE_PIN_COMPLETENESS as value}<option {value}>{value}</option>{/each}
          </select>
        </label>
        {#if record.evidencePins.length}
          <CaseEvidencePinSelect label="Supporting evidence pin" pins={record.evidencePins} bind:value={sightingDraft.value.sightingEvidencePinId} emptyLabel="No pin selected" />
        {/if}
      </div>
      <label class="field">Limitations <small>one per line</small>
        <textarea bind:value={sightingDraft.value.sightingLimitations} maxlength="2000" rows="2"></textarea>
      </label>
      <button class="btn" type="submit" disabled={sightingDraft.state.busy || mutationBusy}>Record sighting</button>
      <CaseDraftRecovery draft={sightingDraft} />
    </form>
    {#if record.sightings.length}
      <ol class="records">
        {#each [...record.sightings].reverse() as sighting}
          <li>
            <strong>{sighting.state.replaceAll('_', ' ')} · {sighting.category}</strong>
            <p>{sighting.source}</p>
            <small>{sighting.sourceClass} source · {sighting.completeness} · {sighting.observedAt ?? 'Observation time unavailable'}</small>
            {#if sighting.evidencePinId}<CaseLinkedEvidence pins={record.evidencePins} ids={[sighting.evidencePinId]} />{/if}
            {#if sighting.limitations.length}<small>Limits: {sighting.limitations.join('; ')}</small>{/if}
          </li>
        {/each}
      </ol>
    {/if}
    {#if sightingChronology.length}
      <section class="chronology" aria-labelledby={`sighting-chronology-${record.id}`}>
        <div>
          <strong id={`sighting-chronology-${record.id}`}>Observation chronology</strong>
          <span>{countLabel(sightingChronology.length, 'source sequence')}</span>
        </div>
        <p>First and last observed describe retained evidence, not domain creation, activation, or removal. Review conclusions remain outside these ranges.</p>
        <ol>
          {#each sightingChronology as entry}
            <li>
              <div><strong>{entry.category}</strong><span>{entry.sourceClass} · {entry.completeness}</span></div>
              <p>{entry.source}</p>
              <dl>
                <div><dt>First dated observation</dt><dd>{entry.firstObservedAt ?? 'Unavailable'}</dd></div>
                <div><dt>Last dated observation</dt><dd>{entry.lastObservedAt ?? 'Unavailable'}</dd></div>
                <div><dt>Observations</dt><dd>{entry.observationCount}</dd></div>
                {#if entry.undatedCount}<div><dt>Time unavailable</dt><dd>{entry.undatedCount}</dd></div>{/if}
              </dl>
              {#if entry.limitations.length}<small>Limits: {entry.limitations.join('; ')}</small>{/if}
            </li>
          {/each}
        </ol>
        {#if sightingReviewConclusionCount}
          <small>{countLabel(sightingReviewConclusionCount, 'review conclusion')} retained separately and excluded from observed ranges.</small>
        {/if}
      </section>
    {/if}
  </details>

</section>

<style>
  .chronology {
    display: grid;
    gap: 8px;
    margin: 0 12px 12px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--panel-raised);
  }
  .chronology>div {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 6px;
  }
  .chronology>div>span,.chronology>p,.chronology>small {
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .chronology>p {
    margin: 0;
    line-height: 1.5;
  }
  .chronology ol {
    display: grid;
    grid-template-columns: repeat(auto-fit,minmax(min(230px,100%),1fr));
    gap: 7px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .chronology li {
    min-width: 0;
    padding: 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--panel);
  }
  .chronology li>div {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px;
  }
  .chronology li>div>strong {
    font: 700 var(--text-xs) var(--mono);
    text-transform: capitalize;
  }
  .chronology li>div>span,.chronology li>small {
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .chronology li>p {
    margin: 6px 0;
    overflow-wrap: anywhere;
  }
  .chronology dl {
    display: grid;
    gap: 3px;
    margin: 0;
  }
  .chronology dl div {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 8px;
  }
  .chronology dt,.chronology dd {
    margin: 0;
    font-size: var(--text-xs);
  }
  .chronology dt {
    color: var(--muted);
  }
  .chronology dd {
    font-family: var(--mono);
    overflow-wrap: anywhere;
  }
</style>
