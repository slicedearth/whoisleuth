<script lang="ts">
  import { tokenLabel } from '../../../../packages/analysis/display-label.mts';
  import {
    CASE_PIN_COMPLETENESS,
    CASE_SIGHTING_CATEGORIES,
    CASE_SIGHTING_STATES,
  } from '../../../../packages/cases/case-response-records.mts';
  import type { CaseRecord } from '../cases.ts';
  import { buildCaseSightingChronology } from '#lib/analysis/case-sighting-chronology.ts';
  import { isoFromUtcInput, utcDateTimeInputAttributes, list } from '#lib/analysis/case-response-form-values.ts';
  import { createCaseDraft } from '#lib/controllers/case-draft.svelte.ts';
  import CaseDraftRecovery from './CaseDraftRecovery.svelte';
  import type { CaseResponsePresentation, PersistCaseResponse } from '#lib/analysis/case-response-stage.ts';
  import CaseEvidenceFact from './CaseEvidenceFact.svelte';
  import CaseEvidenceLineage from './CaseEvidenceLineage.svelte';
  import CaseEvidencePinSelect from './CaseEvidencePinSelect.svelte';
  import CaseLinkedEvidence from './CaseLinkedEvidence.svelte';
  import DocumentationSearch from './DocumentationSearch.svelte';
  import CaseEvidenceRelationships from './CaseEvidenceRelationships.svelte';
  import CaseResponseObjectSelect from './CaseResponseObjectSelect.svelte';
  import { selectedCaseResponseObject } from '../../../../packages/cases/case-response-object.mts';
  import { CASE_SIGHTING_CHANNELS, CASE_SIGHTING_DEVICES } from '../../../../packages/cases/case-sighting-context.mts';

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
    pinCompleteness: 'complete' as typeof CASE_PIN_COMPLETENESS[number],
    pinLimitations: '', responseObject: ''
  });
  const sightingDraft = createCaseDraft(() => record.id, 'sighting', {
    sightingState: 'observed_by_deployment' as typeof CASE_SIGHTING_STATES[number],
    sightingCategory: 'website' as typeof CASE_SIGHTING_CATEGORIES[number],
    sightingSource: 'WHOISleuth deep lookup',
    sightingObservedAt: '',
    sightingCompleteness: 'complete' as typeof CASE_PIN_COMPLETENESS[number],
    sightingEvidencePinId: '',
    sightingLimitations: '',
    channel: 'unknown' as typeof CASE_SIGHTING_CHANNELS[number],
    deviceClass: 'unknown' as typeof CASE_SIGHTING_DEVICES[number],
    declaredCountryCode: '', reviewedPathSupplied: 'unknown' as 'unknown' | 'yes' | 'no', captureAttachmentId: ''
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
    selectionError = '';
    let responseObject;
    try { responseObject = selectedCaseResponseObject(record, pinDraft.value.responseObject); }
    catch (cause) { selectionError = cause instanceof Error ? cause.message : 'Review the selected object.'; return; }
    const unchanged = pinDraft.capture();
    if (!await pinDraft.persist(persist, {
      evidencePin: {
        label: pinDraft.value.pinLabel,
        value: pinDraft.value.pinValue,
        source: pinDraft.value.pinSource,
        observedAt: isoFromUtcInput(pinDraft.value.pinObservedAt),
        completeness: pinDraft.value.pinCompleteness,
        limitations: list(pinDraft.value.pinLimitations),
        ...(responseObject ? { responseObject, sourceState: 'reviewed', observationHostname: responseObject.kind === 'domain' || responseObject.kind === 'hostname' ? responseObject.identifier : new URL(responseObject.identifier).hostname } : {}),
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
        ...(sightingDraft.value.channel !== 'unknown' || sightingDraft.value.deviceClass !== 'unknown'
          || sightingDraft.value.declaredCountryCode.trim() || sightingDraft.value.reviewedPathSupplied !== 'unknown' || sightingDraft.value.captureAttachmentId ? {
          context: { version: 1 as const, channel: sightingDraft.value.channel, deviceClass: sightingDraft.value.deviceClass,
            declaredCountryCode: sightingDraft.value.declaredCountryCode.trim().toUpperCase() || null,
            reviewedPathSupplied: sightingDraft.value.reviewedPathSupplied, captureAttachmentId: sightingDraft.value.captureAttachmentId || null },
        } : {}),
      },
    }, `Recorded a source-qualified sighting for ${record.domain}.`) || !unchanged()) return;
    sightingDraft.value.sightingLimitations = '';
  }

  let selectionError = $state('');
</script>

{#if selectionError}<p role="alert">{selectionError} The draft remains available.</p>{/if}

<section class="case-response-stage" aria-label="Case observations">
  <details id={`case-response-observation-${record.id}`} bind:open={expanded}>
    <summary>Pin an observed fact</summary>
    <form class="response-form observation-form" data-recovery-form={pinDraft.form} oninput={pinDraft.changed} onsubmit={(event) => { event.preventDefault(); void addPin(); }}>
      <div class="observation-columns">
        <fieldset class="observation-fields">
          <legend>Observation</legend>
          <label class="field">Label
            <input bind:value={pinDraft.value.pinLabel} maxlength="80" required placeholder="Observed login form">
          </label>
          <label class="field">Fact
            <textarea bind:value={pinDraft.value.pinValue} maxlength="1000" rows="5" required></textarea>
          </label>
          <CaseResponseObjectSelect {record} label="Object observed by this evidence" bind:value={pinDraft.value.responseObject} />
        </fieldset>
        <fieldset class="observation-fields source-fields">
          <legend>Source and time</legend>
          <label class="field">Source
            <input bind:value={pinDraft.value.pinSource} maxlength="80" required placeholder="Lookup evidence">
          </label>
          <div class="field">
            <label for={`pin-observed-at-${record.id}`}>Observed at</label>
            <input id={`pin-observed-at-${record.id}`} aria-describedby={`pin-time-help-${record.id}`} type="datetime-local" {...utcDateTimeInputAttributes} bind:value={pinDraft.value.pinObservedAt}>
            <small id={`pin-time-help-${record.id}`}>Optional; leave blank if unknown.</small>
          </div>
          <p class="notice">Date and time fields use UTC.</p>
          <label class="field">Completeness
            <select bind:value={pinDraft.value.pinCompleteness}>
              {#each CASE_PIN_COMPLETENESS as value}<option {value}>{tokenLabel(value)}</option>{/each}
            </select>
          </label>
        </fieldset>
      </div>
      <fieldset class="observation-fields limitation-fields">
        <legend>Limitations</legend>
        <label class="field"><span class="sr-only">Limitations</span><small>One per line</small>
          <textarea bind:value={pinDraft.value.pinLimitations} maxlength="2000" rows="3"></textarea>
        </label>
      </fieldset>
      <button class="primary" type="submit" disabled={pinDraft.state.busy || mutationBusy}>Pin evidence</button>
      <CaseDraftRecovery draft={pinDraft} />
    </form>
    <DocumentationSearch initialQuery="evidence" label="Evidence guidance" />
    {#if record.evidencePins.length}
      <ol class="records">
        {#each [...record.evidencePins].reverse() as pin}
          <li>
            <CaseEvidenceFact {pin} copyable />
          </li>
        {/each}
      </ol>
      <CaseEvidenceLineage {record} pinIds={record.evidencePins.map(pin => pin.id)} />
    {/if}
  </details>

  <CaseEvidenceRelationships {record} {persist} {mutationBusy} />

  <details id={`case-response-observation-sightings-${record.id}`}>
    <summary>Record a source-qualified sighting</summary>
    <form class="response-form" data-recovery-form={sightingDraft.form} oninput={sightingDraft.changed} onsubmit={(event) => { event.preventDefault(); void addSighting(); }}>
      <p class="notice">Date and time fields use UTC.</p>
      <p class="notice">Use observed or reported states for source evidence. Analyst confirmed, not reproduced, and expired are review conclusions and do not alter the original observation.</p>
      <div class="two-columns">
        <label class="field">Sighting state
          <select bind:value={sightingDraft.value.sightingState}>
            {#each CASE_SIGHTING_STATES as value}<option {value}>{tokenLabel(value)}</option>{/each}
          </select>
        </label>
        <label class="field">Evidence category
          <select bind:value={sightingDraft.value.sightingCategory}>
            {#each CASE_SIGHTING_CATEGORIES as value}<option {value}>{tokenLabel(value)}</option>{/each}
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
            {#each CASE_PIN_COMPLETENESS as value}<option {value}>{tokenLabel(value)}</option>{/each}
          </select>
        </label>
        {#if record.evidencePins.length}
          <CaseEvidencePinSelect label="Supporting evidence pin" pins={record.evidencePins} bind:value={sightingDraft.value.sightingEvidencePinId} emptyLabel="No pin selected" />
        {/if}
      </div>
      <label class="field">Limitations <small>one per line</small>
        <textarea bind:value={sightingDraft.value.sightingLimitations} maxlength="2000" rows="2"></textarea>
      </label>
      <details class="sighting-context"><summary>Encounter and capture context (optional)</summary>
        <p>Record supplied conditions, not verified location or distribution. Exact links remain in their existing private evidence owner.</p>
        <div class="fields">
          <label class="field">Encounter channel<select bind:value={sightingDraft.value.channel}>{#each CASE_SIGHTING_CHANNELS as value}<option {value}>{tokenLabel(value)}</option>{/each}</select></label>
          <label class="field">Declared device class<select bind:value={sightingDraft.value.deviceClass}>{#each CASE_SIGHTING_DEVICES as value}<option {value}>{tokenLabel(value)}</option>{/each}</select></label>
          <label class="field">Declared country code <small>Optional two letters; no location lookup or verification</small><input bind:value={sightingDraft.value.declaredCountryCode} maxlength="2" pattern={'[A-Za-z]{2}'} autocomplete="off" autocapitalize="characters" spellcheck="false" /></label>
          <label class="field">Was a reviewed path supplied?<select bind:value={sightingDraft.value.reviewedPathSupplied}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
          <label class="field">Capture file reference<select bind:value={sightingDraft.value.captureAttachmentId}><option value="">No file selected</option>{#each record.attachments ?? [] as attachment (attachment.id)}<option value={attachment.id}>{attachment.fileName}</option>{/each}</select></label>
        </div>
      </details>
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
            {#if sighting.context}<dl class="sighting-context-facts">
              <div><dt>Encounter channel</dt><dd>{tokenLabel(sighting.context.channel)}</dd></div>
              <div><dt>Declared device</dt><dd>{tokenLabel(sighting.context.deviceClass)}</dd></div>
              <div><dt>Declared country</dt><dd>{sighting.context.declaredCountryCode ?? 'Unknown'}</dd></div>
              <div><dt>Reviewed path supplied</dt><dd>{tokenLabel(sighting.context.reviewedPathSupplied)}</dd></div>
              {#if sighting.context.captureAttachmentId}<div><dt>Capture reference</dt><dd>{record.attachments?.find(item => item.id === sighting.context!.captureAttachmentId)?.fileName ?? 'Referenced file unavailable'}</dd></div>{/if}
            </dl><small>Analyst-supplied context · private records only</small>{/if}
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
  .sighting-context{min-width:0}.sighting-context>p{font-size:var(--text-xs);line-height:1.6;color:var(--muted)}.sighting-context .fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:14px}.sighting-context .field{min-width:0}.sighting-context-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-block:10px}.sighting-context-facts>div{min-width:0}.sighting-context-facts dt{font-size:var(--text-xs);color:var(--muted)}.sighting-context-facts dd{margin:3px 0 0;font-size:var(--text-xs);overflow-wrap:anywhere}@media(max-width:600px){.sighting-context .fields,.sighting-context-facts{grid-template-columns:minmax(0,1fr)}}
  .observation-columns{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:24px;min-width:0}
  .observation-fields{display:grid;align-content:start;gap:14px;margin:0;padding:0;min-width:0;border:0}
  .observation-fields>legend{margin-bottom:14px;padding:0;font:650 var(--text-md) var(--font-sans);color:var(--text)}
  .source-fields{padding-left:24px;border-left:1px solid var(--border)}
  .limitation-fields{margin-top:4px;padding-top:14px;border-top:1px solid var(--border)}
  .limitation-fields>legend{margin-bottom:0;padding-right:12px}
  @container(max-width:680px){.observation-columns{grid-template-columns:minmax(0,1fr)}.source-fields{padding-left:0;padding-top:14px;border-left:0;border-top:1px solid var(--border)}.source-fields>legend{padding-right:12px}}
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
