<script lang="ts">
  import type { LookupDecisionSupport } from '$lib/analysis/lookup-decision-support.ts';

  let { support }: { support: LookupDecisionSupport } = $props();

  function stateLabel(value: 'conflict' | 'uncertain'): string {
    return value === 'conflict' ? 'Disagreement' : 'Uncertain';
  }
</script>

<section class="decision-support card" aria-labelledby="decision-support-title">
  <header>
    <div>
      <p class="eyebrow">Investigation lens</p>
      <h4 id="decision-support-title">{support.guidance.label}</h4>
      <p>{support.guidance.summary}</p>
    </div>
    <div class="counts" aria-label="Decision-support summary">
      <span class:attention={support.counts.conflicts > 0}><strong>{support.counts.conflicts}</strong> disagreements</span>
      <span class:attention={support.counts.uncertainties > 0}><strong>{support.counts.uncertainties}</strong> uncertain</span>
    </div>
  </header>

  <div class="decision-grid">
    <section aria-labelledby="task-questions-title">
      <h5 id="task-questions-title">Questions to answer</h5>
      <ol class="questions">
        {#each support.guidance.questions as question}<li>{question}</li>{/each}
      </ol>
    </section>

    <section aria-labelledby="next-actions-title">
      <h5 id="next-actions-title">Useful next actions</h5>
      {#if support.actions.length}
        <ul class="actions">
          {#each support.actions as action}
            <li>
              <a href={action.href}>{action.label}</a>
              <span>{action.reason}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">No contextual action is available from the settled evidence. Review the source-quality matrix before drawing a conclusion.</p>
      {/if}
    </section>
  </div>

  {#if support.entries.length}
    <details>
      <summary>Review {support.entries.length} disagreement and uncertainty record{support.entries.length === 1 ? '' : 's'}</summary>
      <ul class="decision-list">
        {#each support.entries as entry (entry.id)}
          <li class:conflict={entry.state === 'conflict'}>
            <div class="entry-head">
              <span class="state state-{entry.state}">{stateLabel(entry.state)}</span>
              <span class="importance">{entry.importance} relevance</span>
            </div>
            <strong>{entry.title}</strong>
            <p>{entry.detail}</p>
            <footer>
              <span>Sources: {entry.sources.join(' + ')}</span>
              <a href={entry.href}>Open evidence</a>
            </footer>
          </li>
        {/each}
      </ul>
      <p class="note">Unavailable, partial, stale, and truncated evidence remains uncertainty. It is not converted into a disagreement, absence, or safety conclusion.</p>
    </details>
  {/if}
</section>

<style>
  .decision-support{min-width:0;padding:var(--card-pad)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
  header h4{margin:2px 0 0;font:700 var(--text-lg) var(--mono)}
  header p:not(.eyebrow){max-width:760px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .counts{display:flex;flex:0 0 auto;gap:7px}
  .counts span{padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:var(--text-2xs) var(--mono)}
  .counts strong{color:var(--text);font-size:var(--text-sm)}
  .counts .attention strong{color:var(--amber)}
  .decision-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}
  .decision-grid>section{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  h5{margin:0 0 8px;font:700 var(--text-xs) var(--mono)}
  .questions,.actions{margin:0;padding-left:20px}
  .questions li{margin:5px 0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .actions{display:grid;gap:8px;list-style:none;padding:0}
  .actions li{display:grid;gap:2px}
  .actions a{font:700 var(--text-xs) var(--mono)}
  .actions span,.empty{color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  details{margin-top:12px;border-top:1px solid var(--border)}
  summary{padding:12px 0;color:var(--text);font:680 var(--text-xs) var(--mono);cursor:pointer}
  summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .decision-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0;padding:0;list-style:none}
  .decision-list>li{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .decision-list>li.conflict{border-color:color-mix(in srgb,var(--amber) 42%,var(--border))}
  .entry-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}
  .state,.importance{font:650 var(--text-2xs) var(--mono)}
  .state{padding:3px 6px;border:1px solid var(--border);border-radius:999px;color:var(--muted)}
  .state-conflict{border-color:color-mix(in srgb,var(--amber) 48%,var(--border));color:var(--amber)}
  .importance{color:var(--muted);text-transform:capitalize}
  .decision-list strong{display:block;font-size:var(--text-xs);line-height:1.4}
  .decision-list p{margin:5px 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .decision-list footer{display:flex;align-items:flex-end;justify-content:space-between;gap:8px;margin-top:8px;color:var(--muted);font-size:var(--text-2xs)}
  .decision-list footer span{overflow-wrap:anywhere}
  .decision-list footer a{flex:0 0 auto;font:650 var(--text-2xs) var(--mono)}
  .note{margin:9px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  @media(max-width:760px){
    header{display:grid}
    .counts{width:100%}
    .counts span{flex:1}
    .decision-grid,.decision-list{grid-template-columns:minmax(0,1fr)}
  }
</style>
