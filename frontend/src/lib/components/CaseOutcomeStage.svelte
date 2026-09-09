<script lang="ts">
  import {
    CASE_CLOSURE_REASONS, CASE_OBSERVED_EFFECT_SOURCE_CLASSES, CASE_OBSERVED_EFFECT_STATES,
    CASE_PIN_COMPLETENESS, caseLookupTarget, type CaseRecord,
  } from '$lib/cases';
  import { buildCaseResponseLifecycleSummary } from '$lib/analysis/case-response-model.ts';
  import { isoFromLocal, list } from '$lib/analysis/case-response-form-values.ts';
  import type { CaseResponsePresentation, PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { createDraftRevision } from '$lib/controllers/submitted-draft';

  let { record, mode, mutationBusy, persist }: {
    record: CaseRecord;
    mode: CaseResponsePresentation;
    mutationBusy: boolean;
    persist: PersistCaseResponse;
  } = $props();

  let expanded = $state(false);
  $effect(() => { expanded = mode === 'quick'; });

  let effectState = $state('not_checked');
  let effectObservedAt = $state('');
  let effectSourceClass = $state('analyst');
  let effectSource = $state('Analyst review');
  let effectCompleteness = $state('unknown');
  let effectEvidencePinId = $state('');
  let effectSightingId = $state('');
  let effectFollowUpAt = $state('');
  let effectLimitations = $state('');
  let closureReason = $state('unable_to_proceed');
  let closureSummary = $state('');
  let closureReviewId = $state('');
  let closureActionId = $state('');
  let closureLimitations = $state('');
  const effectDraft = createDraftRevision(() => record.id);
  const closureDraft = createDraftRevision(() => record.id);
  const responseLifecycle = $derived(buildCaseResponseLifecycleSummary(record));
  const userObservedEffectSourceClasses = CASE_OBSERVED_EFFECT_SOURCE_CLASSES.filter((value) => value !== 'import');
  const closureNeedsReview = $derived(closureReason === 'independently_not_reproduced' || closureReason === 'infrastructure_changed');
  const closureNeedsAction = $derived(closureReason === 'provider_reported_resolution_not_independently_checked');
  const eligibleClosureReviews = $derived(record.observedEffects.reviews.filter((review) =>
    closureReason === 'independently_not_reproduced'
      ? review.state === 'not_reproduced'
      : closureReason === 'infrastructure_changed' ? review.state === 'changed' : true));
  const eligibleClosureActions = $derived(record.actions.filter((action) =>
    closureNeedsAction ? action.providerOutcome === 'provider_reports_resolved' : true));

  async function addObservedEffectReview() {
    const unchanged = effectDraft.capture();
    if (!await persist({
      observedEffectReview: {
        state: effectState,
        observedAt: isoFromLocal(effectObservedAt) || new Date().toISOString(),
        sourceClass: effectSourceClass,
        source: effectSource,
        completeness: effectCompleteness,
        evidencePinId: effectEvidencePinId || null,
        sightingId: effectSightingId || null,
        followUpAt: isoFromLocal(effectFollowUpAt),
        limitations: list(effectLimitations),
      },
    }, `Recorded an independent observed-effect review for ${record.domain}.`) || !unchanged()) return;
    effectLimitations = '';
    effectEvidencePinId = '';
    effectSightingId = '';
  }

  async function closeCaseDeliberately() {
    const unchanged = closureDraft.capture();
    if (!await persist({
      closure: {
        reason: closureReason,
        summary: closureSummary,
        observedEffectReviewId: closureReviewId || null,
        actionId: closureActionId || null,
        limitations: list(closureLimitations),
      },
    }, `Recorded a deliberate closure for ${record.domain}.`) || !unchanged()) return;
    closureSummary = '';
    closureReviewId = '';
    closureActionId = '';
    closureLimitations = '';
  }
</script>

<section class="case-response-stage" aria-label="Case independent review and closure">
  <details id={`case-response-outcome-${record.id}`} bind:open={expanded}>
    <summary>{mode === 'quick' ? 'Record recheck outcome and closure' : 'Verify remediation independently and close deliberately'}</summary>
    <div class="response-form remediation-review">
      <p class="notice">Provider responses, independent observations and analyst closure are separate records.</p>
      <a class="btn" href={`/lookup?q=${encodeURIComponent(caseLookupTarget(record))}`}>Prepare a recheck for {caseLookupTarget(record)}</a>
      <dl class="separate-times">
        <div><dt>Provider outcome time</dt><dd>{responseLifecycle.latestProviderOutcome ? `${responseLifecycle.latestProviderOutcome.occurredAt} · ${responseLifecycle.latestProviderOutcome.outcome.replaceAll('_', ' ')}` : `Withheld — ${responseLifecycle.providerOutcomeState}`}</dd></div>
        <div><dt>Independently observed change time</dt><dd>{responseLifecycle.latestObservedChangeAt ?? `Withheld — ${responseLifecycle.observedChangeState}`}</dd></div>
      </dl>
      {#if record.observedEffects.reviews.length && !responseLifecycle.latestObservedEffect}
        <p class="history-warning">A single latest independent review cannot be selected from the retained observation times. Review the individual records before drawing a conclusion.</p>
      {/if}
      {#if record.observedEffects.preV13HistoryUnavailable || record.closures.preV13HistoryUnavailable}
        <p class="history-warning">This Case predates v13. Earlier independent review or deliberate closure history is unavailable and was not reconstructed.</p>
      {/if}
      <form class="stack" aria-labelledby={`effect-review-title-${record.id}`} oninput={effectDraft.changed} onchange={effectDraft.changed} onsubmit={(event) => { event.preventDefault(); void addObservedEffectReview(); }}>
        <strong id={`effect-review-title-${record.id}`}>Append independent observed-effect review</strong>
        <div class="two-columns">
          <label class="field">Observed effect<select bind:value={effectState}>{#each CASE_OBSERVED_EFFECT_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
          <label class="field">{mode === 'quick' ? 'Observed at' : 'Observation time'}<input type="datetime-local" bind:value={effectObservedAt}></label>
          <label class="field">Source class<select bind:value={effectSourceClass}>{#each userObservedEffectSourceClasses as value}<option {value}>{value}</option>{/each}</select></label>
          <label class="field">{mode === 'quick' ? 'Source' : 'Separately attributed source'}<input bind:value={effectSource} maxlength="80" required></label>
          <label class="field">Completeness<select bind:value={effectCompleteness}>{#each CASE_PIN_COMPLETENESS as value}<option {value}>{value}</option>{/each}</select></label>
          <label class="field">{mode === 'quick' ? 'Current evidence' : 'Evidence pin'}<select bind:value={effectEvidencePinId}><option value="">No evidence pin</option>{#each record.evidencePins as pin}<option value={pin.id}>{pin.label}</option>{/each}</select></label>
          <label class="field">Existing sighting<select bind:value={effectSightingId}><option value="">No sighting</option>{#each record.sightings as sighting}<option value={sighting.id}>{sighting.state.replaceAll('_', ' ')} · {sighting.source}</option>{/each}</select></label>
          <label class="field">{mode === 'quick' ? 'Follow up at' : 'Scheduled local follow-up'}<input type="datetime-local" bind:value={effectFollowUpAt}></label>
        </div>
        <label class="field">Limitations <small>one per line</small><textarea bind:value={effectLimitations} maxlength="2000" rows="2"></textarea></label>
        <button class="btn" type="submit" disabled={mutationBusy || mode === 'quick' && effectState === 'not_checked'}>{mode === 'quick' ? 'Record independent outcome' : 'Record independent review'}</button>
      </form>
      {#if record.observedEffects.reviews.length}
        <ol class="records embedded-records" aria-label="Independent observed-effect reviews">
          {#each [...record.observedEffects.reviews].reverse() as review}
            <li><strong>{review.state.replaceAll('_', ' ')}</strong><p>{review.source}</p><small>Review ID {review.id} · {review.observedAt} · {review.sourceClass} · {review.completeness}</small>{#if review.evidencePinId}<small>Evidence pin: {review.evidencePinId}</small>{/if}{#if review.sightingId}<small>Sighting: {review.sightingId}</small>{/if}{#if review.followUpAt}<small>Scheduled follow-up: {review.followUpAt}</small>{/if}{#if review.limitations.length}<small>Limitations: {review.limitations.join('; ')}</small>{/if}</li>
          {/each}
        </ol>
      {/if}
      {#if record.observedEffects.omitted}<p class="history-warning">{record.observedEffects.omitted} earlier independent review{record.observedEffects.omitted === 1 ? '' : 's'} omitted by bounded retention.</p>{/if}

      <form class="stack closure-form" aria-labelledby={`closure-title-${record.id}`} oninput={closureDraft.changed} onchange={closureDraft.changed} onsubmit={(event) => { event.preventDefault(); void closeCaseDeliberately(); }}>
        <strong id={`closure-title-${record.id}`}>Deliberate analyst closure</strong>
        <p class="notice">Select the reason that the retained evidence supports. A timeout or failure to reproduce does not establish removal.</p>
        <div class="two-columns">
          <label class="field">{mode === 'quick' ? 'Reason' : 'Closure reason'}<select bind:value={closureReason}>{#each CASE_CLOSURE_REASONS as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
          <label class="field">Independent review<select bind:value={closureReviewId} required={closureNeedsReview}><option value="">{closureNeedsReview ? 'Select the required typed review' : 'No linked review'}</option>{#each eligibleClosureReviews as review}<option value={review.id}>{review.state.replaceAll('_', ' ')} · {review.observedAt}</option>{/each}</select></label>
          <label class="field">Provider action<select bind:value={closureActionId} required={closureNeedsAction}><option value="">{closureNeedsAction ? 'Select the required provider-resolution action' : 'No linked provider action'}</option>{#each eligibleClosureActions as action}<option value={action.id}>{action.type.replaceAll('_', ' ')} · {action.providerOutcome?.replaceAll('_', ' ') ?? action.state.replaceAll('_', ' ')}</option>{/each}</select></label>
        </div>
        <label class="field">Closure summary<textarea bind:value={closureSummary} maxlength="2000" rows="2" required></textarea></label>
        <label class="field">Closure limitations <small>one per line</small><textarea bind:value={closureLimitations} maxlength="2000" rows="2"></textarea></label>
        <button class="btn" type="submit" disabled={mutationBusy}>Close case with reason</button>
      </form>
      {#if record.closures.records.length}
        <ol class="records embedded-records" aria-label="Deliberate case closures">
          {#each [...record.closures.records].reverse() as closure}
            <li><strong>{closure.reason.replaceAll('_', ' ')}</strong><p>{closure.summary}</p><small>Closure ID {closure.id} · {closure.createdAt}</small>{#if closure.observedEffectReviewId}<small>Independent review: {closure.observedEffectReviewId}</small>{/if}{#if closure.actionId}<small>Provider action: {closure.actionId}</small>{/if}{#if closure.limitations.length}<small>Limitations: {closure.limitations.join('; ')}</small>{/if}</li>
          {/each}
        </ol>
      {/if}
    </div>
  </details>

</section>
