<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { createCasePracticeSession, CASE_PRACTICE_OBSERVED_AT } from '$lib/analysis/case-practice.ts';
  import { provideDocumentCaseDraftStorage } from '$lib/controllers/case-draft.svelte.ts';
  import type { PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { restoreSubmittedFocus } from '$lib/controllers/submitted-draft.ts';
  import CaseObservationStage from './CaseObservationStage.svelte';
  import CaseAssessmentStage from './CaseAssessmentStage.svelte';
  import CaseRecheckReview from './CaseRecheckReview.svelte';
  import CaseEvidenceFact from './CaseEvidenceFact.svelte';
  import '$lib/components/case-response-stage.css';

  let { onreset }: { onreset: () => void } = $props();
  const session = createCasePracticeSession();
  provideDocumentCaseDraftStorage(session.storage);
  let record = $state(session.read());
  let step = $state('evidence');
  let message = $state('');
  let mutationBusy = $state(false);
  let live = true;
  const steps = [{ id: 'evidence', label: 'Pin a fact' }, { id: 'assessment', label: 'Record a conclusion' }, { id: 'recheck', label: 'Review a later capture' }] as const;
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
    document.getElementById(`practice-${id}`)?.focus();
  }
</script>

<section class="case-practice" aria-labelledby="case-practice-title">
  <header><div><h2 id="case-practice-title" tabindex="-1">Practise a Case review</h2><p>Use the Console’s actual forms with a fictional Case. Edits and drafts stay only on this page and disappear on restart, reload or navigation. No collection or reporting controls are provided.</p></div><button class="btn" type="button" onclick={onreset} disabled={mutationBusy}>Discard practice and restart</button></header>
  <nav aria-label="Case practice steps">{#each steps as item, index}<button class="btn" type="button" aria-current={step === item.id ? 'step' : undefined} onclick={() => void select(item.id)}>{index + 1}. {item.label}</button>{/each}</nav>
  <p class="practice-status" role="status">{message}</p>
  <div hidden={step !== 'evidence'}>
    <h3 id="practice-evidence" tabindex="-1">Pin a fact with its source</h3>
    <p>The supplied fictional page asks for an email address and password. Pin that observation with source <strong>Fictional supplied capture</strong> and time <time datetime={CASE_PRACTICE_OBSERVED_AT}>1 September 2026, 12:00 UTC</time>. Its claimed identity and intent have not been verified.</p>
    <CaseObservationStage {record} mode="quick" {mutationBusy} {persist} />
  </div>
  <div hidden={step !== 'assessment'}>
    <h3 id="practice-assessment" tabindex="-1">Explain what the evidence supports</h3>
    <p>Select a reviewed disposition, link the evidence and explain the uncertainty. A credential form can justify further review; it does not establish who operates the page or whether it is malicious.</p>
    <CaseAssessmentStage {record} mode="quick" {mutationBusy} {persist} onmessage={value => message = value} />
  </div>
  <div hidden={step !== 'recheck'} class="case-response-stage">
    <h3 id="practice-recheck" tabindex="-1">Keep an incomplete recheck inconclusive</h3>
    <p>Choose the saved question and the <strong>Later capture did not complete</strong> evidence. Retain its source details. Try <strong>not reproduced</strong> with comparable conditions to see why the form refuses that conclusion, then record <strong>unavailable</strong>.</p>
    <CaseEvidenceFact pin={record.evidencePins[1]!} />
    <CaseRecheckReview {record} mode="quick" {mutationBusy} {persist} />
    {#if record.observedEffects.reviews.length}<ul aria-label="Practice recheck records">{#each record.observedEffects.reviews as review}<li><strong>{review.state.replaceAll('_', ' ')}</strong> · {review.completeness} · {review.source}<br><small>{review.observedAt}</small></li>{/each}</ul>{/if}
  </div>
  <details class="practice-check"><summary>Check your reasoning</summary><ul><li>Observation, source and observation time are separate from the analyst’s conclusion.</li><li>The earlier credential form needs corroboration; a low score or an ordinary-looking page would not establish safety either.</li><li>The later timeout leaves the page’s state unknown. It does not establish removal, remediation or a completed takedown.</li></ul><p>There is no automated grade. Compare your explanation with the retained evidence. In a real Case, review reporting authority and the recipient before preparing a handoff.</p></details>
</section>

<style>
  .case-practice>[hidden]{display:none}
  .case-practice{display:grid;gap:18px;min-width:0}.case-practice header{display:flex;flex-wrap:wrap;align-items:start;justify-content:space-between;gap:16px}.case-practice header>div{flex:1 1 32rem;min-width:0}.case-practice h2{margin:0}.case-practice p{max-width:85ch;line-height:1.65;overflow-wrap:anywhere}.case-practice header p{margin-bottom:0;color:var(--muted)}nav{display:flex;flex-wrap:wrap;gap:8px}nav button[aria-current]{border-color:var(--interface-accent);background:rgb(var(--interface-accent-rgb)/.08);color:var(--interface-accent)}.practice-status{margin:0;color:var(--muted);min-height:1.5em}.practice-check{padding-top:16px;border-top:1px solid var(--border)}.practice-check summary{min-height:44px}.practice-check li{margin-block:8px;line-height:1.5}
  @media(max-width:560px){nav button,header>button{width:100%}.case-practice{gap:12px}}
</style>
