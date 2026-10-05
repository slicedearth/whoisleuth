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

<div class="goal-paths" class:guide={linkSteps} role="region" aria-label={ariaLabel}>
  {#each goals as goal, index}
    <article class:featured={index === 0} id={linkSteps ? goal.id : undefined}>
      <h3>{goal.title}</h3>
      <p>{goal.summary}</p>
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
      {#if !linkSteps}
        <a class="path-link" href={`/resources#${goal.id}`}>
          {goal.title} guide <span aria-hidden="true">→</span>
        </a>
      {/if}
    </article>
  {/each}
</div>

<style>
  .goal-paths{
    display:grid;
    grid-template-columns:minmax(0,1.08fr) minmax(0,.92fr);
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
  article.featured{
    grid-column:1 / -1;
    padding:clamp(24px,4vw,38px);
    background:
      linear-gradient(145deg,rgb(var(--overlay-rgb) / .025),transparent 64%),
      rgb(var(--panel-rgb) / .78);
  }
  :global(:root[data-effects='minimal']) .goal-paths:not(.guide) article{background:var(--panel)}
  h3{margin:0;font:700 clamp(1.05rem,2vw,1.28rem) var(--mono);letter-spacing:-.025em}
  p{margin:9px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.6}
  ol{display:flex;align-items:center;flex-wrap:wrap;gap:6px 0;margin:22px 0 0;padding:0;list-style:none}
  li{display:flex;align-items:center;color:var(--text);font:650 var(--text-xs) var(--mono)}
  li:not(:last-child)::after{content:"→";margin:0 9px;color:var(--muted-subtle)}
  li a{display:inline-flex;align-items:center;min-height:32px;padding:4px 2px;border-bottom:1px solid transparent;color:var(--text)}
  li a:hover,li a:focus-visible{border-color:var(--accent);color:var(--accent)}
  .path-link{align-self:flex-start;margin-top:auto;padding-top:24px;color:var(--accent);font:700 var(--text-xs) var(--mono)}
  .path-link:hover,.path-link:focus-visible{color:var(--text)}
  .guide{grid-template-columns:1fr;gap:0}
  .guide article,.guide article.featured{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 28px;padding:22px 0;border:0;border-top:1px solid var(--border);border-radius:0;background:transparent}
  .guide h3{font-family:var(--font-sans)}
  .guide li{font-family:var(--font-sans);font-size:.9375rem}
  .guide p{font-size:.9375rem}
  .guide p{grid-column:1;margin:0}
  .guide ol{grid-column:2;grid-row:1/3;align-self:start;margin:0}
  @media(max-width:680px){
    .goal-paths{grid-template-columns:1fr}
    article.featured{grid-column:auto}
    .guide article,.guide article.featured{grid-template-columns:1fr}
    .guide ol{grid-column:1;grid-row:auto;margin-top:6px}
  }
</style>
