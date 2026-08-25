<script lang="ts">
  import type { BrandProfile } from '$lib/brand-profiles';
  import {
    buildDomainPostureMatrix,
    type DomainPostureMatrixCell,
    type DomainPostureMatrixState,
  } from '$lib/analysis/domain-posture-matrix.ts';

  let { active }: { active: BrandProfile } = $props();
  const generatedAt = new Date().toISOString();
  const matrix = $derived(buildDomainPostureMatrix(active, generatedAt));

  function stateLabel(state: DomainPostureMatrixState): string {
    if (state === 'approved_window') return 'Approved window';
    if (state === 'not_configured') return 'Not configured';
    return state[0]?.toUpperCase() + state.slice(1);
  }

  function cellTitle(cell: DomainPostureMatrixCell): string {
    const context = cell.suppressionReason
      ? ` Suppression: ${cell.suppressionReason}`
      : cell.approvedWindowSummary
        ? ` Approved window: ${cell.approvedWindowSummary}`
        : '';
    return `${cell.label}: ${stateLabel(cell.state)}. ${cell.explanation}${context}`;
  }

  function date(value: string): string {
    return new Date(value).toLocaleString('en-AU');
  }
</script>

<section class="card posture-matrix" aria-labelledby="portfolio-posture-matrix-title">
  <header class="section-head">
    <div>
      <p class="eyebrow">Owned domains</p>
      <h2 id="portfolio-posture-matrix-title">Owned-domain comparison</h2>
      <p>Compare expected settings with the latest saved observation for each official domain.</p>
    </div>
    <span class="scope">{matrix.baselineCount}/{matrix.rows.length} configured · {matrix.observationCount} observed</span>
  </header>

  {#if matrix.rows.length}
    <div class="state-summary" aria-label="Owned-domain comparison state counts">
      {#each Object.entries(matrix.stateCounts).filter(([, count]) => count > 0) as [state, count]}
        <span class={`state-${state}`}>{stateLabel(state as DomainPostureMatrixState)} <strong>{count}</strong></span>
      {/each}
    </div>

    <div class="matrix-scroll">
      <table>
        <caption class="visually-hidden">Official domains by expected setting and saved comparison state</caption>
        <thead><tr><th scope="col">Official domain</th>{#each matrix.columns as column}<th scope="col">{column.label}</th>{/each}</tr></thead>
        <tbody>
          {#each matrix.rows as row (row.domain)}
            <tr>
              <th scope="row"><strong>{row.domain}</strong><small>{row.lifecycle.replaceAll('_', ' ')} · {row.zoneIntent.replaceAll('_', ' ')}</small></th>
              {#each row.cells as cell (cell.field)}
                <td class={`state-${cell.state}`} title={cellTitle(cell)}>
                  <strong>{stateLabel(cell.state)}</strong>
                  <span><a href={cell.baselineHref}>Expected</a>{#if cell.observationHref}<a href={cell.observationHref}>Observed</a>{:else}<em>No observation</em>{/if}</span>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="mobile-rows">
      {#each matrix.rows as row (row.domain)}
        <article>
          <header><div><h3>{row.domain}</h3><p>{row.lifecycle.replaceAll('_', ' ')} · {row.zoneIntent.replaceAll('_', ' ')}</p></div><span>{row.observationAt ? date(row.observationAt) : 'No retained observation'}</span></header>
          <dl>{#each row.cells as cell (cell.field)}<div class={`state-${cell.state}`}><dt>{cell.label}</dt><dd><strong>{stateLabel(cell.state)}</strong><span><a href={cell.baselineHref}>Expected</a>{#if cell.observationHref}<a href={cell.observationHref}>Observed</a>{:else}<em>No observation</em>{/if}</span></dd></div>{/each}</dl>
        </article>
      {/each}
    </div>

    <div class="retained-observations">
      <h3>Retained observation sources</h3>
      {#each matrix.rows.filter((row) => row.observationId) as row (row.domain)}
        <details id={row.observationId ?? undefined}>
          <summary><span>{row.domain}</span><strong>{row.observationAt ? date(row.observationAt) : 'Unavailable'}</strong></summary>
          <p>Expected settings updated {row.baselineUpdatedAt ? date(row.baselineUpdatedAt) : 'at an unavailable time'}.</p>
          <ul>{#each row.observationChecks as check}<li><code>{check.id}</code> · {check.status}{#if check.records.length} · {check.records.join(' · ')}{:else} · no comparable record retained{/if}</li>{/each}</ul>
        </details>
      {/each}
      {#if matrix.observationCount === 0}<p class="empty">No settings observation has been saved. This gap is not treated as alignment.</p>{/if}
    </div>
  {:else}
    <p class="empty">Add an official domain before comparing expected and observed settings.</p>
  {/if}

  <ul class="limitations">{#each matrix.limitations as limitation}<li>{limitation}</li>{/each}</ul>
</section>

<style>
  .posture-matrix{display:grid;gap:16px;margin-top:16px;padding:var(--card-pad);min-width:0}.posture-matrix h2,.posture-matrix h3{margin:0}.section-head p:not(.eyebrow),.empty{max-width:76ch;color:var(--muted);font-size:var(--text-sm);line-height:1.5}.scope{white-space:nowrap;border:1px solid var(--border);border-radius:999px;padding:5px 9px;color:var(--muted);font-size:var(--text-xs)}.state-summary{display:flex;flex-wrap:wrap;gap:6px}.state-summary span{padding:4px 8px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:600 var(--text-2xs) var(--mono)}.matrix-scroll{max-width:100%;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-md)}table{width:100%;min-width:1180px;border-collapse:collapse;background:var(--panel)}th,td{padding:9px;border-right:1px solid var(--border);border-bottom:1px solid var(--border);text-align:left;vertical-align:top;font-size:var(--text-2xs)}tr:last-child th,tr:last-child td{border-bottom:0}th:last-child,td:last-child{border-right:0}thead th{color:var(--muted);text-transform:uppercase;letter-spacing:.05em}tbody th{min-width:180px}tbody th strong,tbody th small{display:block;overflow-wrap:anywhere}tbody th small{margin-top:4px;color:var(--muted);font-weight:400;text-transform:capitalize}td>strong{display:block}td>span{display:flex;flex-wrap:wrap;gap:6px;margin-top:5px}td a,.mobile-rows a{font-size:var(--text-2xs)}td em,.mobile-rows em{color:var(--muted);font-size:var(--text-2xs);font-style:normal}.state-aligned>strong,.state-aligned dt+dd>strong{color:var(--success)}.state-drift>strong,.state-drift dt+dd>strong{color:var(--danger)}.state-approved_window>strong,.state-approved_window dt+dd>strong,.state-review>strong,.state-review dt+dd>strong,.state-suppressed>strong,.state-suppressed dt+dd>strong{color:var(--amber)}.state-unavailable>strong,.state-unavailable dt+dd>strong,.state-unknown>strong,.state-unknown dt+dd>strong,.state-unsupported>strong,.state-unsupported dt+dd>strong{color:var(--muted)}.mobile-rows{display:none}.retained-observations{display:grid;gap:7px}.retained-observations>h3{font-size:var(--text-sm)}.retained-observations details{scroll-margin-top:16px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.retained-observations details:target{outline:2px solid var(--accent);outline-offset:2px}.retained-observations summary{display:flex;justify-content:space-between;gap:12px;cursor:pointer;font-size:var(--text-xs)}.retained-observations summary span,.retained-observations li{overflow-wrap:anywhere}.retained-observations p,.retained-observations li,.limitations{color:var(--muted);font-size:var(--text-xs);line-height:1.5}.retained-observations ul,.limitations{margin:7px 0 0;padding-left:20px}.visually-hidden{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:760px){.section-head{display:grid;gap:10px}.scope{justify-self:start}.matrix-scroll{display:none}.mobile-rows{display:grid;gap:10px}.mobile-rows article{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}.mobile-rows article>header{display:grid;gap:5px}.mobile-rows h3,.mobile-rows p,.mobile-rows header span{overflow-wrap:anywhere}.mobile-rows p,.mobile-rows header span{margin:3px 0 0;color:var(--muted);font-size:var(--text-2xs)}.mobile-rows dl{display:grid;gap:6px;margin:10px 0 0}.mobile-rows dl>div{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;padding-top:6px;border-top:1px solid var(--border)}.mobile-rows dt,.mobile-rows dd{min-width:0;margin:0;font-size:var(--text-xs)}.mobile-rows dd>strong{display:block}.mobile-rows dd>span{display:flex;flex-wrap:wrap;gap:6px;margin-top:3px}.retained-observations summary{align-items:flex-start;flex-direction:column;gap:3px}}
</style>
