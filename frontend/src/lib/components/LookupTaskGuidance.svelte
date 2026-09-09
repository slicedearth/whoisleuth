<script lang="ts">
  import { lookupTaskGuidance } from '$lib/analysis/lookup-task-guidance.ts';
  import { LOOKUP_TASK_VIEWS, type LookupTaskView } from '$lib/analysis/lookup-presentation.ts';

  let { task, lookupMode, ontask, onmode }: {
    task: LookupTaskView;
    lookupMode: 'fast' | 'deep';
    ontask: (task: LookupTaskView) => void;
    onmode: (mode: 'fast' | 'deep') => void;
  } = $props();

  const guidance = $derived(lookupTaskGuidance(task));

  function applyRecommendation() {
    if (guidance.recommendation === 'fast' || guidance.recommendation === 'deep') onmode(guidance.recommendation);
  }
</script>

<section class="task-guidance" aria-label="Question and depth guidance">
    <label>Analyst question
      <select value={task} onchange={(event) => ontask(event.currentTarget.value as LookupTaskView)}>
        {#each LOOKUP_TASK_VIEWS as option}<option value={option.id}>{option.label}</option>{/each}
      </select>
    </label>
  <details>
    <summary>{guidance.recommendation === 'review_retained' ? 'Review retained evidence first' : `${guidance.recommendation === 'fast' ? 'Fast' : 'Deep'} recommended`}</summary>
  <div class="guidance-copy">
    <p>{guidance.reason}</p>
    <p class="limitation">{guidance.limitation}</p>
  </div>
  <div class="guidance-actions">
    <button class="btn" type="button" onclick={applyRecommendation} disabled={lookupMode === guidance.recommendation}>Use {guidance.recommendation === 'fast' ? 'Fast' : 'Deep'} recommendation</button>
  </div>
  </details>
</section>

<style>
  .task-guidance{display:grid;grid-template-columns:minmax(0,26rem) minmax(0,1fr);gap:12px 20px;align-items:start;margin-block:16px;padding-block:12px;border-block:1px solid var(--border)}
  label{display:grid;min-width:0;gap:5px;color:var(--muted);font:650 var(--text-xs) var(--mono)}
  select{width:100%;min-width:0}
  details{min-width:0}
  summary{padding:12px 0;cursor:pointer;font-size:var(--text-sm)}
  .guidance-copy{display:grid;gap:8px;max-width:72ch}
  .guidance-copy p{margin:0;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .guidance-copy .limitation{color:var(--amber)}
  .guidance-actions{margin-top:12px}
  @media(max-width:760px){.task-guidance{grid-template-columns:1fr;gap:4px}summary,select{min-height:44px}.guidance-actions .btn{width:100%}}
</style>
