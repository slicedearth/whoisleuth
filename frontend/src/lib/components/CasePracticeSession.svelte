<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { createCasePracticeSession, CASE_PRACTICE_OBSERVED_AT, casePracticeDefinition, casePracticeRoutes, casePracticeJourneyActions, casePracticeJourneyMaterials, casePracticeFeedback, type CasePracticeScenario } from '$lib/analysis/case-practice.ts';
  import { provideDocumentCaseDraftStorage } from '$lib/controllers/case-draft.svelte.ts';
  import type { PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { restoreSubmittedFocus } from '$lib/controllers/submitted-draft.ts';
  import CaseObservationStage from './CaseObservationStage.svelte';
  import CaseAssessmentStage from './CaseAssessmentStage.svelte';
  import CaseRecheckReview from './CaseRecheckReview.svelte';
  import CaseEvidenceFact from './CaseEvidenceFact.svelte';
  import CaseRequestedEvidence from './CaseRequestedEvidence.svelte';
  import '$lib/components/case-response-stage.css';

  let { onreset, scenario }: { onreset: () => void; scenario: CasePracticeScenario } = $props();
  const session = createCasePracticeSession(untrack(() => scenario));
  const definition = $derived(casePracticeDefinition(scenario));
  const routes = $derived(casePracticeRoutes(scenario));
  const initialPinIds = session.read().evidencePins.map(pin => pin.id);
  provideDocumentCaseDraftStorage(session.storage);
  let record = $state(session.read());
  const feedback = $derived(casePracticeFeedback(record, initialPinIds, scenario));
  let step = $state('evidence');
  let message = $state('');
  let mutationBusy = $state(false);
  let live = true;
  const steps = $derived([{ id: 'evidence', label: 'Pin a fact' }, { id: 'assessment', label: 'Record a conclusion' }, { id: 'recheck', label: 'Review a later capture' },
    ...(['credential-form', 'requested-amendment'].includes(scenario) ? [{ id: 'response', label: scenario === 'credential-form' ? 'Rehearse separate response scopes' : 'Prepare requested evidence' }] : [])]);
  const materials = $derived(scenario === 'credential-form' ? casePracticeJourneyMaterials(record) : []);
  const journeyActions = $derived(casePracticeJourneyActions(record));
  const materialSignature = $derived(JSON.stringify(materials));
  let pageCopyReviewed = $state(false);
  let adCopyReviewed = $state(false);
  let reviewedSignature = $state('');
  $effect(() => { materialSignature; pageCopyReviewed = false; adCopyReviewed = false; reviewedSignature = ''; });
  onDestroy(() => { live = false; session.close(); });

  const persist: PersistCaseResponse = async (patch, success, focusFallback, receipt) => {
    if (mutationBusy || !live) return false;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    mutationBusy = true;
    try {
      record = session.edit(patch, receipt);
      message = `${success} Practice only; nothing was written to your saved workspace.`;
      return true;
    } catch (cause) { message = cause instanceof Error ? cause.message : 'The practice change was not saved.'; return false; }
    finally {
      mutationBusy = false; await tick();
      if (live) restoreSubmittedFocus(origin, focusFallback?.() ?? origin, origin?.closest('form'));
    }
  };
  async function select(id: string) {
    step = id; await tick();
    if (live) document.getElementById(`practice-${id}`)?.focus();
  }
  async function advanceJourney(operation: 'prepare' | 'deliver' | 'close-page') {
    if (!live || mutationBusy) return;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const owner = document.getElementById('practice-response')?.closest('.case-practice');
    mutationBusy = true;
    try {
      record = session.journey(operation, reviewedSignature);
      message = operation === 'prepare' ? 'Prepared two fictional drafting actions. Review the separate recipient material.'
        : operation === 'deliver' ? 'Recorded separate simulated delivery references and a fictional page acknowledgement. Nothing was exported or submitted.'
        : 'Closed only the independently reviewed page action and incident link. The advertisement remains unresolved and this practice Case remains open.';
    } catch (cause) { message = cause instanceof Error ? cause.message : 'The practice step could not be recorded.'; }
    finally { mutationBusy = false; await tick(); if (live) restoreSubmittedFocus(origin, document.getElementById('practice-response'), owner); }
  }
</script>

<section class="case-practice" aria-labelledby="case-practice-title">
  <header><div><h2 id="case-practice-title" tabindex="-1">Practise a Case review</h2><p>Use actual Case forms and explicitly simulated response steps with supplied fictional evidence. Edits and drafts stay only on this page and disappear on restart, reload or navigation. No target collection or external submission controls are provided. Unfamiliar-human evaluation remains pending.</p></div><button class="btn" type="button" onclick={onreset} disabled={mutationBusy}>Discard practice and restart</button></header>
  <nav aria-label="Case practice steps">{#each steps as item, index}<button class="btn" type="button" aria-current={step === item.id ? 'step' : undefined} onclick={() => void select(item.id)}>{index + 1}. {item.label}</button>{/each}</nav>
  <p class="practice-status" role="status">{message}</p>
  <div hidden={step !== 'evidence'}>
    <h3 id="practice-evidence" tabindex="-1">Pin a fact with its source</h3>
    <p>{definition.observation} Pin the relevant observation with its source and time <time datetime={CASE_PRACTICE_OBSERVED_AT}>1 September 2026, 12:00 UTC</time>.</p>
    {#each record.evidencePins.filter((_, index) => index !== 1) as pin}<CaseEvidenceFact {pin} />{/each}
    {#if scenario === 'provider-resolved'}<p>Provider-reported outcome: <strong>{record.actions[0]!.providerOutcome?.replaceAll('_', ' ')}</strong>. No independent recheck is pre-recorded.</p>{/if}
    <CaseObservationStage {record} mode="quick" {mutationBusy} {persist} />
  </div>
  <div hidden={step !== 'assessment'}>
    <h3 id="practice-assessment" tabindex="-1">Explain what the evidence supports</h3>
    <p>Select a reviewed disposition, link the evidence and explain the uncertainty. {definition.assessment}</p>
    <details><summary>Compare an adequate and an inadequate report</summary><p><strong>Adequate:</strong> {definition.adequate}</p><p><strong>Inadequate:</strong> {definition.inadequate}</p><p>The exercise supports evidence pins, conclusions and rechecks. Other scenario-specific actions described here are guidance unless an interactive response step is provided.</p>{#each routes as route}<p><strong>{route.platformLabel}: {route.label}</strong> · reviewed {route.reviewedAt}, recheck before {route.reviewAfter}. The official reference is available in Resources reporting guidance. {route.privacyNote}</p>{/each}</details>
    <CaseAssessmentStage {record} mode="quick" {mutationBusy} {persist} onmessage={value => message = value} />
  </div>
  {#if scenario === 'credential-form'}
    <div hidden={step !== 'response'} class="practice-response">
      <h3 id="practice-response" tabindex="-1">Separate page response from advertisement distribution</h3>
      <p>The supplied lure leads to a copied offer and credential form. The reference prose has no logo or brand name. Copyright authority is unverified; this exercise makes no rights declaration. No actual packet export or provider submission occurs.</p>
      {#if !materials.length}<p>First record an evidence-linked conclusion, then prepare the two reserved fictional recipients.</p><button class="btn" type="button" onclick={() => advanceJourney('prepare')}>Prepare fictional recipient copies</button>
      {:else}
        {#each materials as material, index}<section aria-label={`${index === 0 ? 'Page' : 'Advertisement'} recipient material`}><h4>{index === 0 ? 'Page security scope' : 'Advertisement distribution scope'}</h4><p>Recipient: <code>{material.recipientRoute?.contact}</code>. Exact object: <code>{material.incident.abusiveUrls[0]}</code></p><p>{material.selectedEvidence.length} selected evidence references. These contain metadata, not pin values or file bytes. The final writer’s creation time, authorisation, provenance and integrity envelope are not simulated by this preview.</p><details><summary>Inspect exact fictional recipient material</summary><pre>{JSON.stringify(material, null, 2)}</pre></details></section>{/each}
        {#if record.actions.every(action => action.state === 'drafting')}
          <label><input type="checkbox" bind:checked={pageCopyReviewed}>I reviewed the fictional page recipient’s exact scope and selected references</label>
          <label><input type="checkbox" bind:checked={adCopyReviewed}>I reviewed the separate fictional advertisement recipient’s scope and limitations</label>
          <button class="btn" type="button" disabled={!pageCopyReviewed || !adCopyReviewed} onclick={() => reviewedSignature = materialSignature}>Confirm fictional disclosure review</button>
          <button class="btn" type="button" disabled={reviewedSignature !== materialSignature} onclick={() => advanceJourney('deliver')}>Record separate simulated deliveries</button>
        {:else}
          <ul aria-label="Practice response records">{#each record.actions as action}<li><strong>{action.recipient}</strong> · {action.state}<ul>{#each action.history.filter(event => event.reference) as event}<li>{event.reference} · {event.sourceClass}</li>{/each}</ul></li>{/each}</ul>
          {#if journeyActions[0]?.state === 'acknowledged'}<p><strong>Supplied independent later observation:</strong> the complete exact offer-page capture, under the same unauthenticated viewport, shows ordinary text and no credential form. The advertisement was not reviewed. This is fictional independent evidence, not the provider acknowledgement.</p><button class="btn" type="button" onclick={() => advanceJourney('close-page')}>Record supplied independent review and close only the page scope</button>
          {:else}<p>Page scope closed after the supplied complete comparable observation. Advertisement distribution remains unresolved. The Case itself is not closed, and no general safety or removal claim is made.</p>{/if}
        {/if}
      {/if}
    </div>
  {:else if scenario === 'requested-amendment'}
    <div hidden={step !== 'response'}><h3 id="practice-response" tabindex="-1">Preserve the original delivery and prepare an amendment</h3><p>The reserved digest identifies synthetic practice history only. Use the actual requested-evidence form to select references and record limitations. Creating a drafting amendment does not deliver it.</p><CaseRequestedEvidence {record} {persist} {mutationBusy} onamendment={() => { message = 'The drafting amendment is retained only in this practice Case. Review and delivery are not rehearsed by this step.'; }} /></div>
  {/if}
  <div hidden={step !== 'recheck'} class="case-response-stage">
    <h3 id="practice-recheck" tabindex="-1">Keep an incomplete recheck inconclusive</h3>
    <p>{definition.recheck}</p>
    <p>Choose the saved question and the <strong>Later capture did not complete</strong> evidence. Retain its source details. Try <strong>not reproduced</strong> with comparable conditions to see why the form refuses that conclusion, then record <strong>unavailable</strong>.</p>
    <CaseEvidenceFact pin={record.evidencePins[1]!} />
    <CaseRecheckReview {record} mode="quick" {mutationBusy} {persist} />
    {#if record.observedEffects.reviews.length}<ul aria-label="Practice recheck records">{#each record.observedEffects.reviews as review}<li><strong>{review.state.replaceAll('_', ' ')}</strong> · {review.completeness} · {review.source}<br><small>{review.observedAt}</small></li>{/each}</ul>{/if}
  </div>
  <details class="practice-check"><summary>Check your reasoning</summary><ul aria-label="Practice record checks">{#each feedback as item}<li>{item.complete ? 'Recorded' : 'Not yet recorded'}: {item.label}</li>{/each}</ul><p>{definition.assessment}</p><p>These checks cover the recorded links and states, not the quality of your reasoning. No free-text answer is graded. Compare your explanation with the retained evidence.</p></details>
</section>

<style>
  .case-practice>[hidden]{display:none}
  .practice-response{display:grid;gap:12px;min-width:0}.practice-response section{padding-block:12px;border-top:1px solid var(--border);min-width:0}.practice-response pre{max-height:360px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}.practice-response code{overflow-wrap:anywhere}.practice-response label{display:flex;align-items:start;gap:8px;line-height:1.5}.practice-response input{flex:none;width:auto}
  .case-practice{display:grid;gap:18px;min-width:0}.case-practice header{display:flex;flex-wrap:wrap;align-items:start;justify-content:space-between;gap:16px}.case-practice header>div{flex:1 1 32rem;min-width:0}.case-practice h2{margin:0}.case-practice p{max-width:85ch;line-height:1.65;overflow-wrap:anywhere}.case-practice header p{margin-bottom:0;color:var(--muted)}nav{display:flex;flex-wrap:wrap;gap:8px}nav button[aria-current]{border-color:var(--interface-accent);background:rgb(var(--interface-accent-rgb)/.08);color:var(--interface-accent)}.practice-status{margin:0;color:var(--muted);min-height:1.5em}.practice-check{padding-top:16px;border-top:1px solid var(--border)}.practice-check summary{min-height:44px}.practice-check li{margin-block:8px;line-height:1.5}
  @media(max-width:560px){nav button,header>button{width:100%}.case-practice{gap:12px}}
</style>
