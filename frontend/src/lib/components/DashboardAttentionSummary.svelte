<script lang="ts">
  import type { DashboardAttentionSummary } from '$lib/analysis/dashboard-workspace-state.ts';
  import { analystReviewAttentionHref } from '$lib/analysis/analyst-review-attention.ts';

  let { summary }: { summary: DashboardAttentionSummary } = $props();

  const metrics = $derived([
    { label: 'Attention needed', value: summary.attentionNeeded, detail: 'Current Review Items not covered by a current expected, suppressed, or resolved decision.' },
    { label: 'Overdue', value: summary.overdue, detail: 'Review Items whose explicit due time has arrived.' },
    { label: 'Changed since review', value: summary.changedSinceReview, detail: 'Current fingerprints differ from an explicit reviewed fingerprint, or an explicit review-due time has arrived.' },
    { label: 'Expired decisions', value: summary.expired, detail: 'Time-bounded expectations or suppressions that have returned to review.' },
    { label: 'Open Cases', value: summary.openCases, detail: 'Saved Cases whose Case status is not resolved.' },
    { label: 'Watchlists', value: summary.watchlists, detail: 'Saved change-tracking lists, whether or not they currently project a change.' },
  ]);
</script>

<section class="attention card" aria-labelledby="dashboard-attention-title">
  <header>
    <div>
      <p class="eyebrow">Review queue</p>
      <h2 id="dashboard-attention-title">Attention needed</h2>
      <p>{summary.attentionNeeded} retained review {summary.attentionNeeded === 1 ? 'item' : 'items'} awaiting attention.</p>
    </div>
    <a class="btn" href={analystReviewAttentionHref()}>Open review inbox</a>
  </header>
  <div class="attention-grid">
    {#each metrics as metric}
      <article>
        <strong>{metric.value}</strong>
        <span>{metric.label}</span>
        <span class="sr-only">{metric.detail}</span>
      </article>
    {/each}
  </div>
  <div class="contributors">
    {#if summary.items.length}
      <ol aria-label="Items needing attention">
        {#each summary.items as item}
          <li>
            <a href={item.href}>{item.title}</a>
            <span>{item.source}{#if item.dueAt} · Due {new Date(item.dueAt).toLocaleString()}{/if}</span>
            <small>{item.detail}</small>
          </li>
        {/each}
      </ol>
      {#if summary.truncated}<p>Showing the first 20 items. Open the review inbox for the remaining admitted items.</p>{/if}
    {:else}
      <p>No current Review Item requires attention. Open Case and watchlist counts are shown separately because they do not imply a finding.</p>
    {/if}
  </div>
</section>

<style>
  .attention { display:grid; gap:14px; margin-top:28px; padding:20px; }
  .attention>header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
  .attention h2 { margin:3px 0 0; font-size:var(--text-lg); }
  .attention header p:not(.eyebrow) { margin:7px 0 0; color:var(--muted); font-size:var(--text-sm); line-height:1.5; }
  .attention-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
  .attention-grid article { display:flex; min-width:0; align-items:center; gap:8px; padding:8px 0; }
  .attention-grid strong { color:var(--text); font:700 var(--text-lg) var(--mono); }
  .attention-grid span { font-size:var(--text-xs); overflow-wrap:anywhere; }
  .contributors ol { margin:0; padding:0; list-style:none; }
  .contributors li { display:grid; gap:5px; padding:14px 0; border-top:1px solid var(--border); }
  .contributors a { font-weight:650; font-size:var(--text-sm); overflow-wrap:anywhere; }
  .contributors span,.contributors small,.contributors>p { color:var(--muted); font-size:var(--text-xs); line-height:1.5; overflow-wrap:anywhere; }
  .contributors>p { margin:9px 0 0; }
  @media(max-width:600px) {
    .attention { padding:16px; }
    .attention>header { flex-direction:column; }
    .attention-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  }
</style>
