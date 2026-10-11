<script lang="ts">
  import { tick } from 'svelte';
  import type { CaseEvidencePin } from '#lib/cases.ts';
  import type { CasePracticeInference } from '#lib/analysis/case-practice.ts';
  import CaseEvidenceFact from './CaseEvidenceFact.svelte';

  let { exercise, evidence }: { exercise: CasePracticeInference; evidence: readonly CaseEvidencePin[] } = $props();
  let selected = $state<number | null>(null);
  let reviewed = $state<number | null>(null);
  let feedbackHeading = $state<HTMLHeadingElement>();
  let question = $state<HTMLLegendElement>();
  const feedback = $derived(reviewed === null ? null : exercise.statements[reviewed]);

  async function explain(event: SubmitEvent) {
    event.preventDefault();
    if (selected === null) return;
    reviewed = selected;
    await tick();
    feedbackHeading?.focus();
  }

  function restart() {
    selected = null;
    reviewed = null;
    question?.focus();
  }
</script>

<section class="inference-practice" aria-label="Fictional inference exercise">
  <p>Use the original supplied observations below, separate from any edits to your practice Case. No answer is saved or applied to a Case.</p>
  <details><summary>Supplied evidence</summary>
    <ul aria-label="Original fictional evidence">{#each evidence as pin}<li><CaseEvidenceFact {pin} /></li>{/each}</ul>
  </details>
  <form onsubmit={explain}>
    <fieldset>
      <legend bind:this={question} tabindex="-1">Which conclusion goes beyond the evidence?</legend>
      {#each exercise.statements as statement, index}
        <label><input type="radio" name="practice-inference" value={index} bind:group={selected} onchange={() => reviewed = null} />{statement.text}</label>
      {/each}
    </fieldset>
    <button class="btn" type="submit" disabled={selected === null}>Explain this choice</button>
  </form>
  {#if feedback}<section class="feedback" aria-label="Inference explanation">
    <h4 bind:this={feedbackHeading} tabindex="-1">{feedback.exceedsEvidence ? 'This conclusion goes beyond the evidence' : 'This statement stays within the supplied evidence'}</h4>
    <p>{feedback.explanation}</p>
    <button class="btn" type="button" onclick={restart}>Try again</button>
  </section>{/if}
</section>

<style>
  .inference-practice{display:grid;gap:16px;min-width:0;padding-block:12px;line-height:1.6}
  p,h4{margin:0}summary{min-height:44px;cursor:pointer}
  ul{display:grid;gap:16px;padding-inline-start:20px}
  form{display:grid;gap:12px;justify-items:start;min-width:0}
  fieldset{display:grid;gap:8px;min-width:0;max-width:100%;margin:0;padding:0;border:0}
  legend{padding:0 0 12px;font-weight:650;max-width:100%;overflow-wrap:anywhere}
  label{display:flex;align-items:flex-start;gap:10px;min-width:0;min-height:44px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;overflow-wrap:anywhere}
  input{flex:none;margin-block-start:5px;accent-color:var(--interface-accent)}
  .feedback{display:grid;gap:12px;justify-items:start;border-top:1px solid var(--border);padding-top:16px;min-width:0;overflow-wrap:anywhere}
</style>
