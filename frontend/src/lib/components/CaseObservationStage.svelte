<script lang="ts">
  import {
    CASE_PIN_COMPLETENESS,
    CASE_SIGHTING_CATEGORIES,
    CASE_SIGHTING_STATES,
    type CaseRecord,
    type editCase,
  } from '$lib/cases';
  import { buildCaseSightingChronology } from '$lib/analysis/case-sighting-chronology.ts';
  import { isoFromLocal, list } from '$lib/analysis/case-response-form-values.ts';
  import { createDraftRevision } from '$lib/controllers/submitted-draft';

  let { record, visible, mutationBusy, persist }: {
    record: CaseRecord;
    visible: boolean;
    mutationBusy: boolean;
    persist: (patch: Parameters<typeof editCase>[1], success: string) => Promise<boolean>;
  } = $props();

  // Keep this instance mounted for one Case while presentations change.
  // Only a committed write clears the corresponding accepted draft.
  let pinLabel = $state('');
  let pinValue = $state('');
  let pinSource = $state('lookup evidence');
  let pinObservedAt = $state('');
  let pinCompleteness = $state('complete');
  let pinLimitations = $state('');
  let sightingState = $state('observed_by_deployment');
  let sightingCategory = $state('website');
  let sightingSource = $state('WHOISleuth deep lookup');
  let sightingObservedAt = $state('');
  let sightingCompleteness = $state('complete');
  let sightingEvidencePinId = $state('');
  let sightingLimitations = $state('');
  const pinDraft = createDraftRevision(() => record.id);
  const sightingDraft = createDraftRevision(() => record.id);

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
    if (!await persist({
      evidencePin: {
        label: pinLabel,
        value: pinValue,
        source: pinSource,
        observedAt: isoFromLocal(pinObservedAt) || new Date().toISOString(),
        completeness: pinCompleteness,
        limitations: list(pinLimitations),
      },
    }, `Pinned analyst-selected evidence for ${record.domain}.`) || !unchanged()) return;
    pinLabel = '';
    pinValue = '';
    pinLimitations = '';
  }

  async function addSighting() {
    const unchanged = sightingDraft.capture();
    if (!await persist({
      sighting: {
        state: sightingState,
        category: sightingCategory,
        source: sightingSource,
        observedAt: isoFromLocal(sightingObservedAt) || new Date().toISOString(),
        completeness: sightingCompleteness,
        evidencePinId: sightingEvidencePinId || null,
        limitations: list(sightingLimitations),
      },
    }, `Recorded a source-qualified sighting for ${record.domain}.`) || !unchanged()) return;
    sightingLimitations = '';
  }

</script>

{#if visible}
  <details id={`case-response-observation-${record.id}`}>
    <summary>Pin an observed fact</summary>
    <form class="response-form" oninput={pinDraft.changed} onchange={pinDraft.changed} onsubmit={(event) => { event.preventDefault(); void addPin(); }}>
      <div class="two-columns">
        <label class="field">Label
          <input bind:value={pinLabel} maxlength="80" required placeholder="Observed login form">
        </label>
        <label class="field">Source
          <input bind:value={pinSource} maxlength="80" required placeholder="Lookup evidence">
        </label>
        <label class="field">Observed at
          <input type="datetime-local" bind:value={pinObservedAt}>
        </label>
        <label class="field">Completeness
          <select bind:value={pinCompleteness}>
            {#each CASE_PIN_COMPLETENESS as value}<option {value}>{value}</option>{/each}
          </select>
        </label>
      </div>
      <label class="field">Fact
        <textarea bind:value={pinValue} maxlength="1000" rows="2" required></textarea>
      </label>
      <label class="field">Limitations <small>one per line</small>
        <textarea bind:value={pinLimitations} maxlength="2000" rows="2"></textarea>
      </label>
      <button class="btn" type="submit" disabled={mutationBusy}>Pin evidence</button>
    </form>
    {#if record.evidencePins.length}
      <ol class="records">
        {#each [...record.evidencePins].reverse() as pin}
          <li>
            <strong>{pin.label}</strong>
            <p>{pin.value}</p>
            <small>{pin.source} · {pin.completeness} · {pin.observedAt}</small>
            {#if pin.limitations.length}<small>Limits: {pin.limitations.join('; ')}</small>{/if}
          </li>
        {/each}
      </ol>
    {/if}
  </details>

  <details id={`case-response-observation-sightings-${record.id}`}>
    <summary>Record a source-qualified sighting</summary>
    <form class="response-form" oninput={sightingDraft.changed} onchange={sightingDraft.changed} onsubmit={(event) => { event.preventDefault(); void addSighting(); }}>
      <p class="notice">Use observed or reported states for source evidence. Analyst confirmed, not reproduced, and expired are review conclusions and do not alter the original observation.</p>
      <div class="two-columns">
        <label class="field">Sighting state
          <select bind:value={sightingState}>
            {#each CASE_SIGHTING_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}
          </select>
        </label>
        <label class="field">Evidence category
          <select bind:value={sightingCategory}>
            {#each CASE_SIGHTING_CATEGORIES as value}<option {value}>{value}</option>{/each}
          </select>
        </label>
        <label class="field">Source
          <input bind:value={sightingSource} maxlength="80" required>
        </label>
        <label class="field">Observed or reviewed at
          <input type="datetime-local" bind:value={sightingObservedAt}>
        </label>
        <label class="field">Completeness
          <select bind:value={sightingCompleteness}>
            {#each CASE_PIN_COMPLETENESS as value}<option {value}>{value}</option>{/each}
          </select>
        </label>
        {#if record.evidencePins.length}
          <label class="field">Supporting evidence pin
            <select bind:value={sightingEvidencePinId}>
              <option value="">No pin selected</option>
              {#each record.evidencePins as pin}<option value={pin.id}>{pin.label}</option>{/each}
            </select>
          </label>
        {/if}
      </div>
      <label class="field">Limitations <small>one per line</small>
        <textarea bind:value={sightingLimitations} maxlength="2000" rows="2"></textarea>
      </label>
      <button class="btn" type="submit" disabled={mutationBusy}>Record sighting</button>
    </form>
    {#if record.sightings.length}
      <ol class="records">
        {#each [...record.sightings].reverse() as sighting}
          <li>
            <strong>{sighting.state.replaceAll('_', ' ')} · {sighting.category}</strong>
            <p>{sighting.source}</p>
            <small>{sighting.sourceClass} source · {sighting.completeness} · {sighting.observedAt}</small>
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
                <div><dt>First observed</dt><dd>{entry.firstObservedAt}</dd></div>
                <div><dt>Last observed</dt><dd>{entry.lastObservedAt}</dd></div>
                <div><dt>Observations</dt><dd>{entry.observationCount}</dd></div>
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

{/if}

<style>
  details {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--panel);
  }
  summary {
    padding: 11px 12px;
    cursor: pointer;
    font: 700 var(--text-xs) var(--mono);
  }
  details[open] > summary { border-bottom: 1px solid var(--border); }
  .response-form { display: grid; gap: 10px; padding: 12px; }
  .two-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  textarea, input, select { width: 100%; }
  .field small { color: var(--muted); }
  .records { display: grid; gap: 8px; margin: 0; padding: 0 12px 12px; list-style: none; }
  .records li {
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--panel-raised);
  }
  .records strong, .records small { display: block; }
  .records p { margin: 5px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .records small { color: var(--muted); font-size: var(--text-2xs); }
  .notice {
    margin: 0;
    padding: 9px 10px;
    border-left: 3px solid var(--amber);
    background: rgb(var(--amber-rgb) / .06);
    color: var(--muted);
    font-size: var(--text-xs);
  }
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
    font-size: var(--text-2xs);
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
    font-size: var(--text-2xs);
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
    font-size: var(--text-2xs);
  }
  .chronology dt {
    color: var(--muted);
  }
  .chronology dd {
    font-family: var(--mono);
    overflow-wrap: anywhere;
  }
  @media (max-width: 800px) { .two-columns { grid-template-columns: 1fr; } }
</style>
