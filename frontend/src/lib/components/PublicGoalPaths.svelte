<script lang="ts">
  import type { PublicGuideGoal } from '#lib/public-guide.ts';

  let {
    goals,
    linkSteps = false,
    ariaLabel = 'WHOISleuth investigation paths',
  }: {
    goals: readonly PublicGuideGoal[];
    linkSteps?: boolean;
    ariaLabel?: string;
  } = $props();
</script>

{#snippet forwardArrow()}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false"><path d="M3 8h10M8 3l5 5-5 5" /></svg>
{/snippet}

<div class="goal-paths" class:guide={linkSteps} role="region" aria-label={ariaLabel}>
  {#each goals as goal}
    <article id={linkSteps ? goal.id : undefined} aria-labelledby={`goal-${goal.id}-title`}>
      <h3 id={`goal-${goal.id}-title`}>{goal.title}</h3>
      <p>{goal.summary}</p>
      <p class="requirements"><strong>What you need</strong> {goal.requirements}</p>
      <ol aria-label={`${goal.title} steps`}>
        {#each goal.steps as step}
          <li>
            {#if linkSteps}
              <a href={step.href}>{step.label}</a>
            {:else}
              <span>{step.label}</span>
            {/if}
          </li>
        {/each}
      </ol>
      <div class="path-actions">
        {#if !linkSteps}
          <a href={`/resources#${goal.id}`} aria-label={`Read the guide: ${goal.title}`}>Read the guide {@render forwardArrow()}</a>
        {/if}
        <a href={goal.example.href}>{goal.example.label} {@render forwardArrow()}</a>
      </div>
    </article>
  {/each}
</div>

<style>
  .goal-paths{
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:10px;
  }
  article{
    display:flex;
    min-width:0;
    flex-direction:column;
    padding:22px;
    border:1px solid var(--border);
    border-radius:var(--radius-lg);
    background:rgb(var(--panel-rgb) / .72);
  }
  :global(:root[data-effects='minimal']) .goal-paths:not(.guide) article{background:var(--panel)}
  h3{margin:0;font:700 clamp(1.05rem,2vw,1.28rem) var(--mono);letter-spacing:-.025em}
  p{margin:9px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.6}
  .requirements strong{color:var(--text);font-weight:650}
  ol{display:flex;align-items:center;flex-wrap:wrap;gap:6px 0;margin:22px 0 0;padding:0;list-style:none}
  li{display:flex;align-items:center;color:var(--text);font:650 var(--text-xs) var(--mono)}
  li:not(:last-child)::after{content:"→";margin:0 9px;color:var(--muted-subtle)}
  li a{display:inline-flex;align-items:center;min-height:32px;padding:4px 2px;border-bottom:1px solid transparent;color:var(--text)}
  li a:hover,li a:focus-visible{border-color:var(--accent);color:var(--accent)}
  .path-actions{display:flex;flex-wrap:wrap;gap:0 20px;margin-top:auto;padding-top:16px}
  .path-actions a{display:inline-flex;min-height:44px;align-items:center;gap:6px;color:var(--accent);font:700 var(--text-xs) var(--mono);overflow-wrap:anywhere}
  .path-actions a:hover,.path-actions a:focus-visible{color:var(--text)}
  .path-actions svg{flex:none}
  .guide{grid-template-columns:1fr;gap:0}
  .guide article{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 28px;padding:22px 0;border:0;border-top:1px solid var(--border);border-radius:0;background:transparent}
  .guide h3{font-family:var(--font-sans)}
  .guide li{font-family:var(--font-sans);font-size:.9375rem}
  .guide p{font-size:.9375rem}
  .guide p{grid-column:1;margin:0}
  .guide ol{grid-column:2;grid-row:1/3;align-self:start;margin:0}
  .guide .path-actions{grid-column:2;grid-row:3;align-self:start;padding-top:0}
  @media(max-width:680px){
    .goal-paths{grid-template-columns:1fr}
    .guide article{grid-template-columns:1fr}
    .guide ol{grid-column:1;grid-row:auto;margin-top:6px}
    .guide .path-actions{grid-column:1;grid-row:auto}
  }
</style>
