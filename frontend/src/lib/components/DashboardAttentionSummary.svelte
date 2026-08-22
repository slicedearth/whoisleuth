<script lang="ts">
  import type { DashboardAttentionSummary } from '$lib/analysis/dashboard-workspace-state.ts';

  let { summary }: { summary: DashboardAttentionSummary } = $props();

  const metrics = $derived([
    { label: 'Attention needed', value: summary.attentionNeeded, detail: 'Current Review Items not covered by a current expected, suppressed, or resolved decision.' },
    { label: 'Overdue', value: summary.overdue, detail: 'Review Items whose explicit due time has arrived.' },
    { label: 'Changed since review', value: summary.changedSinceReview, detail: 'Current fingerprints differ from an explicit reviewed fingerprint, or an explicit review-due time has arrived.' },
    { label: 'Expired decisions', value: summary.expired, detail: 'Time-bounded expectations or suppressions that have returned to review.' },
    { label: 'Open Cases', value: summary.openCases, detail: 'Browser-local Cases whose Case status is not resolved.' },
    { label: 'Watchlists', value: summary.watchlists, detail: 'Browser-local change-tracking lists, whether or not they currently project a change.' },
  ]);
</script>

<section class="attention card" aria-labelledby="dashboard-attention-title">
  <header>
    <div>
      <p class="eyebrow">Returning analyst</p>
      <h2 id="dashboard-attention-title">Attention needed</h2>
      <p>Prioritised from current retained Review Items and explicit analyst lifecycle decisions. Viewing this page does not mark anything reviewed.</p>
    </div>
    <a class="btn" href="/monitor">Open review inbox</a>
  </header>
  <div class="attention-grid">
    {#each metrics as metric}
      <article>
        <strong>{metric.value}</strong>
        <span>{metric.label}</span>
        <small>{metric.detail}</small>
      </article>
    {/each}
  </div>
  <details class="contributors">
    <summary>Records contributing to these counts</summary>
    {#if summary.items.length}
      <ol>
        {#each summary.items as item}
          <li>
            <a href={item.href}>{item.title}</a>
            <span>{item.lifecycle.state.replaceAll('_', ' ')} · {item.source}</span>
            <small>{item.detail}</small>
          </li>
        {/each}
      </ol>
      {#if summary.truncated}<p>Showing 20 prioritised Review Items. Open the inbox for the bounded complete projection.</p>{/if}
    {:else}
      <p>No current Review Item requires attention. Open Case and watchlist counts are shown separately because they do not imply a finding.</p>
    {/if}
  </details>
</section>

<style>
  .attention{display:grid;gap:14px;margin-top:28px;padding:20px}.attention>header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.attention h2{margin:3px 0 0;font:700 1.15rem var(--mono)}.attention header p:not(.eyebrow){max-width:760px;margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.5}.attention-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.attention-grid article{display:grid;min-width:0;grid-template-columns:auto minmax(0,1fr);gap:3px 9px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.attention-grid strong{grid-row:1/span 2;color:var(--interface-accent);font:750 1.45rem var(--mono)}.attention-grid span{align-self:end;font:700 var(--text-xs) var(--mono)}.attention-grid small{color:var(--muted);font-size:var(--text-2xs);line-height:1.4;overflow-wrap:anywhere}.contributors summary{cursor:pointer;font:700 var(--text-xs) var(--mono)}.contributors ol{display:grid;gap:7px;margin:11px 0 0;padding:0;list-style:none}.contributors li{display:grid;gap:3px;padding:9px 10px;border-left:3px solid var(--border);background:var(--panel-raised)}.contributors a{font:700 var(--text-xs) var(--mono);overflow-wrap:anywhere}.contributors span,.contributors small,.contributors>p{color:var(--muted);font-size:var(--text-2xs);line-height:1.45;overflow-wrap:anywhere}.contributors>p{margin:9px 0 0}@media(max-width:800px){.attention-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.attention>header{align-items:stretch;flex-direction:column}.attention>header .btn{width:100%}.attention-grid{grid-template-columns:1fr}}
</style>
