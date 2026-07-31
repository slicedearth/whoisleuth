<script lang="ts">
  import type { BulkPeerOutlierMatrix } from '$lib/analysis/bulk-peer-outliers.ts';

  let {
    matrix,
    exportMatrix,
  }: {
    matrix: BulkPeerOutlierMatrix;
    exportMatrix: () => void;
  } = $props();
</script>

{#if matrix.cohortSize >= 3}
  <section class="outliers card" aria-labelledby="bulk-outlier-title">
    <header>
      <div>
        <p class="eyebrow">Peer comparison</p>
        <h2 id="bulk-outlier-title">Local cohort outliers</h2>
        <p>Find low-frequency differences within the current filtered view. These are review cues, not risk or attribution conclusions.</p>
      </div>
      <button type="button" class="btn small" disabled={!matrix.rows.length} onclick={exportMatrix}>Export outliers</button>
    </header>

    <div class="summary" aria-label="Peer comparison summary">
      <span><strong>{matrix.cohortSize}</strong> compared</span>
      <span><strong>{matrix.dimensions.length}</strong> dimensions</span>
      <span><strong>{matrix.rows.length}</strong> uncommon rows</span>
    </div>

    {#if matrix.rows.length}
      <div class="row-list">
        {#each matrix.rows as row (row.domain)}
          <article>
            <header><strong>{row.domain}</strong><span>{row.findings.length} uncommon value{row.findings.length === 1 ? '' : 's'}</span></header>
            <ul>
              {#each row.findings as finding}
                <li>
                  <strong>{finding.label}</strong>
                  <code>{finding.value}</code>
                  <span>Observed in {finding.frequency} of {finding.observedCount}; local baseline: {finding.baselineValue}</span>
                </li>
              {/each}
            </ul>
          </article>
        {/each}
      </div>
    {:else}
      <p class="empty">No value met the conservative low-frequency threshold in this view. This does not mean the domains are equivalent or complete.</p>
    {/if}

    <details>
      <summary>Comparison baselines and limits</summary>
      <div class="baselines">
        {#each matrix.dimensions as dimension}
          <p><strong>{dimension.label}</strong><span>{dimension.baselineValue} · {dimension.baselineCount}/{dimension.observedCount} observed{dimension.excludedCount ? ` · ${dimension.excludedCount} unavailable` : ''}</span></p>
        {/each}
      </div>
      <ul class="limitations">{#each matrix.limitations as limitation}<li>{limitation}</li>{/each}</ul>
    </details>
  </section>
{/if}

<style>
  .outliers{min-width:0;padding:var(--card-pad)}
  .outliers>header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
  h2{margin:2px 0 0;font-size:var(--text-lg)}
  header p:not(.eyebrow){max-width:720px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  header button{flex:0 0 auto}
  .summary{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
  .summary span{padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:var(--text-2xs) var(--mono)}
  .summary strong{color:var(--violet);font-size:var(--text-sm)}
  .row-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}
  .row-list article{min-width:0;padding:11px;border:1px solid color-mix(in srgb,var(--violet) 34%,var(--border));border-radius:var(--radius-md);background:var(--panel-raised)}
  .row-list article>header{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .row-list article>header strong{overflow-wrap:anywhere}
  .row-list article>header span{flex:0 0 auto;color:var(--violet);font:650 var(--text-2xs) var(--mono)}
  .row-list ul{display:grid;gap:7px;margin:10px 0 0;padding:0;list-style:none}
  .row-list li{display:grid;gap:3px;padding-top:7px;border-top:1px solid var(--border)}
  .row-list li strong{font-size:var(--text-xs)}
  .row-list code{color:var(--text);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .row-list li span,.empty{color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  details{margin-top:12px;border-top:1px solid var(--border)}
  summary{padding:11px 0;color:var(--text);font:680 var(--text-xs) var(--mono);cursor:pointer}
  summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .baselines{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
  .baselines p{display:grid;gap:2px;margin:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .baselines strong{font-size:var(--text-xs)}
  .baselines span{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .limitations{margin:10px 0 0;padding-left:18px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  @media(max-width:720px){
    .outliers>header{display:grid}
    .outliers>header button{width:100%}
    .row-list,.baselines{grid-template-columns:minmax(0,1fr)}
  }
</style>
