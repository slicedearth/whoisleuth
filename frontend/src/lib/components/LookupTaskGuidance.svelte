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

<section class="task-guidance card" aria-labelledby="lookup-task-guidance-title">
  <header>
    <div><p class="eyebrow">Task guidance</p><h2 id="lookup-task-guidance-title">Choose evidence depth for the question</h2></div>
    <label>Analyst question
      <select value={task} onchange={(event) => ontask(event.currentTarget.value as LookupTaskView)}>
        {#each LOOKUP_TASK_VIEWS as option}<option value={option.id}>{option.label}</option>{/each}
      </select>
    </label>
  </header>
  <div class="guidance-copy">
    <p><strong>{guidance.recommendation === 'review_retained' ? 'Review retained evidence first' : `${guidance.recommendation === 'fast' ? 'Fast' : 'Deep'} recommended`}.</strong> {guidance.reason}</p>
    <p class="limitation">{guidance.limitation}</p>
  </div>
  <div class="guidance-actions">
    <button class="btn" type="button" onclick={applyRecommendation} disabled={lookupMode === guidance.recommendation}>Use {guidance.recommendation === 'fast' ? 'Fast' : 'Deep'} recommendation</button>
    <span>You can still choose either depth below.</span>
  </div>
</section>

<style>
  .task-guidance{display:grid;gap:12px;margin-bottom:14px;padding:var(--card-pad)}.task-guidance>header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.task-guidance h2{margin:3px 0 0;font:700 var(--text-md) var(--mono)}.task-guidance header label{display:grid;min-width:min(340px,100%);gap:5px;color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}.task-guidance select{width:100%}.guidance-copy{display:grid;gap:6px;padding:11px;border-left:3px solid var(--accent);background:rgb(var(--accent-rgb) / .06)}.guidance-copy p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}.guidance-copy strong{color:var(--text)}.guidance-copy .limitation{color:var(--amber)}.guidance-actions{display:flex;flex-wrap:wrap;align-items:center;gap:9px}.guidance-actions span{color:var(--muted);font-size:var(--text-2xs);line-height:1.45}@media(max-width:620px){.task-guidance>header{display:grid}.guidance-actions,.guidance-actions .btn{width:100%}}
</style>
