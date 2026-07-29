<script lang="ts">
  import type {
    BulkMailExposureReport,
    BulkMailExposureState,
  } from '$lib/analysis/bulk-mail-exposure.ts';

  let {
    report,
    selectedDomains,
    selectDomains,
    exportReport,
  }: {
    report: BulkMailExposureReport;
    selectedDomains: Set<string>;
    selectDomains: (domains: string[]) => void | Promise<void>;
    exportReport: () => void | Promise<void>;
  } = $props();

  const groups: ReadonlyArray<{ state: BulkMailExposureState; label: string }> = [
    { state: 'authenticated_mail', label: 'Mail with SPF + DMARC' },
    { state: 'mail_auth_gap', label: 'Authentication gap' },
    { state: 'mail_auth_incomplete', label: 'Authentication incomplete' },
    { state: 'null_mx', label: 'Null MX' },
    { state: 'no_explicit_mx', label: 'No explicit MX' },
    { state: 'evidence_incomplete', label: 'Evidence incomplete' },
  ];
  let activeState = $state<BulkMailExposureState | ''>('');
  const visibleRows = $derived(activeState
    ? report.rows.filter((row) => row.state === activeState)
    : report.rows);

  function domainsFor(state: BulkMailExposureState): string[] {
    return report.rows.filter((row) => row.state === state).map((row) => row.domain);
  }
</script>

{#if report.rows.length}
  <section class="mail-review card" aria-labelledby="mail-review-title">
    <header>
      <div>
        <p class="eyebrow">Defensive mail review</p>
        <h2 id="mail-review-title">Lookalike mail exposure</h2>
        <p>Compare already observed candidate mail posture with the active profile baseline. No SMTP connection, message, mailbox, or catch-all test is performed.</p>
      </div>
      <button class="btn" type="button" onclick={exportReport}>Export review</button>
    </header>

    <div class="baseline">
      <strong>{report.baseline.label}</strong>
      <span>{report.baseline.officialDomains.length
        ? report.baseline.officialDomains.join(', ')
        : 'No official domain is configured for comparison'}</span>
    </div>

    <div class="groups" role="group" aria-label="Mail exposure groups">
      {#each groups as group}
        <article class:active={activeState === group.state}>
          <button type="button" aria-pressed={activeState === group.state} onclick={() => activeState = activeState === group.state ? '' : group.state}>
            <strong>{report.counts[group.state]}</strong>
            <span>{group.label}</span>
          </button>
          <button class="select" type="button" disabled={!report.counts[group.state]} onclick={() => selectDomains(domainsFor(group.state))}>Select group</button>
        </article>
      {/each}
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr><th>Domain</th><th>Observed posture</th><th>Baseline</th><th>Review</th></tr></thead>
        <tbody>
          {#each visibleRows as row (row.domain)}
            <tr>
              <th scope="row">
                <span class="selected" aria-hidden="true">{selectedDomains.has(row.domain) ? '●' : '○'}</span>
                <span class="sr-only">{selectedDomains.has(row.domain) ? 'Selected' : 'Not selected'}</span>
                <a href={`/lookup?q=${encodeURIComponent(row.domain)}&depth=deep#query`}>{row.domain}</a>
                <small>{row.mutationTypes.join(', ') || 'No mutation provenance recorded'}</small>
              </th>
              <td data-label="Observed posture"><strong>{row.label}</strong><small>{row.detail}</small></td>
              <td data-label="Baseline"><span class={`relation ${row.baselineRelation}`}>{row.baselineRelation}</span><small>{row.baselineDetail}</small></td>
              <td data-label="Review"><span>{row.registration}</span><small>{row.limitations[0] ?? 'Review the source evidence before acting.'}</small></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <ul class="limitations">{#each report.limitations as limitation}<li>{limitation}</li>{/each}</ul>
  </section>
{/if}

<style>
  .mail-review{margin-top:16px;padding:var(--card-pad)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
  h2,p{margin:0}h2{margin-top:4px;font:700 var(--text-lg) var(--mono)}
  header p:not(.eyebrow){max-width:760px;margin-top:7px;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .baseline{display:flex;flex-wrap:wrap;gap:7px 12px;margin-top:14px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .baseline strong{color:var(--accent);font:700 var(--text-xs) var(--mono)}
  .baseline span{color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .groups{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}
  .groups article{display:grid;grid-template-columns:minmax(0,1fr) auto;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;background:var(--panel)}
  .groups article.active{border-color:color-mix(in srgb,var(--accent) 55%,var(--border))}
  .groups button{min-width:0;border:0;border-radius:0;background:transparent;color:var(--text);text-align:left}
  .groups button:first-child{padding:10px}
  .groups button:focus-visible{outline:2px solid var(--focus);outline-offset:-3px}
  .groups strong,.groups span{display:block}.groups strong{color:var(--accent);font:700 var(--text-lg) var(--mono)}.groups span{margin-top:2px;color:var(--muted);font-size:var(--text-2xs)}
  .groups .select{padding:8px;border-left:1px solid var(--border);color:var(--accent);font:650 var(--text-2xs) var(--mono)}
  .groups .select:disabled{color:var(--muted)}
  .table-wrap{margin-top:12px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  th,td{min-width:0}th a{color:var(--text);overflow-wrap:anywhere}
  th small,td strong,td small,td span{display:block;overflow-wrap:anywhere}
  th small,td small{margin-top:4px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  td strong{font-size:var(--text-xs)}
  .selected{display:inline;margin-right:5px;color:var(--accent)}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  .relation{display:inline-block;width:max-content;padding:3px 6px;border:1px solid var(--border);border-radius:999px;font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  .relation.aligned{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));color:var(--accent)}
  .relation.review{border-color:color-mix(in srgb,var(--amber) 45%,var(--border));color:var(--amber)}
  .relation.inconclusive{color:var(--muted)}
  .limitations{margin:12px 0 0;padding-left:18px;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  @media(max-width:800px){.groups{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:700px){
    header{align-items:stretch;flex-direction:column}
    header .btn{width:100%}
    .groups{grid-template-columns:1fr}
    .table-wrap{margin-inline:calc(-1 * var(--card-pad));border-inline:0;border-radius:0}
  }
</style>
