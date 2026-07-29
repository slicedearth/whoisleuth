<script lang="ts">
  import type {
    AcquisitionDueDiligence,
    AcquisitionReviewState,
  } from '$lib/analysis/acquisition-due-diligence.ts';
  import {
    ACQUISITION_MANUAL_CHECKS,
    buildAcquisitionDecisionPacket,
    type AcquisitionDecision,
    type AcquisitionManualCheck,
  } from '$lib/analysis/acquisition-decision-packet.ts';

  let { review, target, observedAt, synthetic = false }: {
    review: AcquisitionDueDiligence;
    target: string;
    observedAt: string | null;
    synthetic?: boolean;
  } = $props();
  let decision = $state<AcquisitionDecision>('unresolved');
  let rationale = $state('');
  let reviewedChecks = $state<AcquisitionManualCheck[]>([]);
  let exportStatus = $state('');

  const checkLabels: Readonly<Record<AcquisitionManualCheck, string>> = {
    eligibility: 'Registry eligibility and current availability checked',
    counterparty: 'Counterparty authority and terms checked',
    transfer: 'Transfer, lock, waiting-period and escrow requirements checked',
    continuity: 'DNS, mail, web and certificate continuity planned',
    legal: 'Trade mark, dispute, tax and legal review completed outside WHOISleuth',
  };

  function stateLabel(state: AcquisitionReviewState): string {
    return {
      authoritative: 'Authority observed',
      observed: 'Observed',
      review: 'Review',
      unavailable: 'Unavailable',
    }[state];
  }

  function toggleCheck(check: AcquisitionManualCheck, selected: boolean): void {
    reviewedChecks = selected
      ? [...new Set([...reviewedChecks, check])]
      : reviewedChecks.filter((item) => item !== check);
  }

  async function exportDecision(): Promise<void> {
    try {
      const exported = await buildAcquisitionDecisionPacket({
        target,
        evidenceObservedAt: observedAt,
        decision,
        rationale,
        reviewedChecks,
        synthetic,
        review,
      });
      const url = URL.createObjectURL(new Blob([exported.content], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exported.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      exportStatus = `Downloaded a ${exported.document.analystReview.state}${synthetic ? ' synthetic' : ''} acquisition review. No request or submission was made.`;
    } catch (cause) {
      exportStatus = cause instanceof Error ? cause.message : 'Could not export the acquisition review.';
    }
  }
</script>

<details class="acquisition card">
  <summary>
    <span>Acquisition due diligence</span>
    <span class:attention={review.items.some((item) => item.state === 'review' || item.state === 'unavailable')}>
      {review.label}
    </span>
  </summary>
  <div class="body">
    <p class="intro">Organize existing registration, lifecycle, service, and contact evidence before a manual acquisition decision. No additional lookup or valuation is performed.</p>
    <div class="review-grid">
      {#each review.items as item}
        <article class:attention={item.state === 'review'} class:unavailable={item.state === 'unavailable'}>
          <header><span>{item.label}</span><strong>{stateLabel(item.state)}</strong></header>
          <p>{item.detail}</p>
          <small>{item.provenance}</small>
        </article>
      {/each}
    </div>
    <section class="transition-section" aria-labelledby="acquisition-transition-title">
      <h5 id="acquisition-transition-title">Transition dependency map</h5>
      <p>Plan continuity from the services observed in this capture. Unavailable evidence remains an open question.</p>
      <div class="review-grid">
        {#each review.transitionDependencies as item}
          <article class:attention={item.state === 'review'} class:unavailable={item.state === 'unavailable'}>
            <header><span>{item.label}</span><strong>{stateLabel(item.state)}</strong></header>
            <p>{item.detail}</p>
            <small>{item.provenance}</small>
          </article>
        {/each}
      </div>
    </section>
    <section class="transition-section" aria-labelledby="acquisition-policy-title">
      <h5 id="acquisition-policy-title">Registry and registrar policy checks</h5>
      <p>These are manual confirmation prompts, not policy claims derived by WHOISleuth.</p>
      <div class="review-grid">
        {#each review.policyChecks as item}
          <article class:attention={item.state === 'review'} class:unavailable={item.state === 'unavailable'}>
            <header><span>{item.label}</span><strong>{stateLabel(item.state)}</strong></header>
            <p>{item.detail}</p>
            <small>{item.provenance}</small>
          </article>
        {/each}
      </div>
    </section>
    <section class="next-steps" aria-labelledby="acquisition-next-steps-title">
      <h5 id="acquisition-next-steps-title">Manual decision checklist</h5>
      <ol>{#each review.nextSteps as step}<li>{step}</li>{/each}</ol>
    </section>
    <section class="decision-workspace" aria-labelledby="acquisition-decision-title">
      <div>
        <h5 id="acquisition-decision-title">Analyst decision workspace</h5>
        <p>Record a bounded local review artifact. This does not reserve, value, purchase, submit, or transfer the domain.{synthetic ? ' The download remains explicitly marked as synthetic.' : ''}</p>
      </div>
      <label class="field">Current decision
        <select bind:value={decision}>
          <option value="unresolved">Unresolved</option>
          <option value="continue_manual_review">Continue manual review</option>
          <option value="pause">Pause review</option>
          <option value="do_not_proceed">Do not proceed</option>
        </select>
      </label>
      <fieldset>
        <legend>Manual checks</legend>
        {#each ACQUISITION_MANUAL_CHECKS as check}
          <label class="check">
            <input type="checkbox" checked={reviewedChecks.includes(check)} onchange={(event) => toggleCheck(check, event.currentTarget.checked)}>
            <span>{checkLabels[check]}</span>
          </label>
        {/each}
      </fieldset>
      <label class="field">Rationale or unresolved questions
        <textarea bind:value={rationale} maxlength="2000" rows="3" placeholder="Record what is verified, what remains unknown, and the next manual step."></textarea>
      </label>
      <button class="btn" type="button" onclick={exportDecision}>Download acquisition review</button>
      {#if exportStatus}<p class="export-status" role="status">{exportStatus}</p>{/if}
    </section>
    <details class="limits">
      <summary>Interpretation limits</summary>
      <ul>{#each review.limitations as limitation}<li>{limitation}</li>{/each}</ul>
    </details>
  </div>
</details>

<style>
  .acquisition{min-width:0;padding:0}
  .acquisition>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;cursor:pointer;font:700 var(--text-xs) var(--mono)}
  .acquisition>summary:focus-visible,.limits>summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .acquisition>summary span:last-child{color:var(--muted);font-size:var(--text-2xs);text-align:right}
  .acquisition>summary span.attention{color:var(--amber)}
  .body{display:grid;gap:11px;padding:0 var(--card-pad) var(--card-pad);border-top:1px solid var(--border)}
  .intro{max-width:820px;margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .review-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  article{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  article.attention{border-color:color-mix(in srgb,var(--amber) 38%,var(--border))}
  article.unavailable{border-style:dashed}
  article header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  article header span{font-weight:700;font-size:var(--text-xs)}
  article header strong{flex:0 0 auto;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  article.attention header strong{color:var(--amber)}
  article p{margin:6px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  article small{display:block;margin-top:7px;color:var(--muted);font:var(--text-2xs) var(--mono)}
  .next-steps{padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .next-steps h5,.transition-section h5{margin:0;font:700 var(--text-xs) var(--mono)}
  .next-steps ol,.limits ul{margin:8px 0 0;padding-left:20px;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .transition-section{display:grid;gap:8px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .transition-section>p{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .decision-workspace{display:grid;gap:10px;padding:11px;border:1px solid color-mix(in srgb,var(--accent2) 35%,var(--border));border-radius:var(--radius-sm);background:var(--panel)}
  .decision-workspace h5{margin:0;font:700 var(--text-xs) var(--mono)}
  .decision-workspace>div>p,.export-status{margin:4px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .decision-workspace .field{display:grid;gap:5px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .decision-workspace select,.decision-workspace textarea{width:100%}
  .decision-workspace fieldset{display:grid;gap:7px;margin:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .decision-workspace legend{padding:0 5px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .check{display:flex;align-items:flex-start;gap:8px;color:var(--text);font-size:var(--text-xs);line-height:1.4}
  .check input{margin-top:2px}
  .decision-workspace .btn{justify-self:start}
  .limits>summary{color:var(--muted);font:650 var(--text-2xs) var(--mono);cursor:pointer}
  @media(max-width:760px){
    .acquisition>summary{align-items:flex-start}
    .acquisition>summary span:last-child{max-width:48%}
    .review-grid{grid-template-columns:minmax(0,1fr)}
  }
</style>
