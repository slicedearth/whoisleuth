<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import { buildCaseRelationshipTable } from '$lib/analysis/case-relationship-table.js';

  let { records, onselect }:{records:CaseRecord[];onselect?:(record:CaseRecord)=>void}=$props();
  let type=$state('all');
  let query=$state('');
  let sort=$state('type');
  let direction=$state('asc');
  const table=$derived(buildCaseRelationshipTable(records,{type,query,sort,direction}));

  function openCase(id:string){const target=records.find((record)=>record.id===id);if(target)onselect?.(target);}
  function clear(){type='all';query='';sort='type';direction='asc';}
</script>

<section class="relationship-workspace" aria-labelledby="case-relationship-table-title">
  <header>
    <div><p class="eyebrow">Cross-case comparison</p><h2 id="case-relationship-table-title">Relationship table</h2><p>Review exact relationships derived from the latest compact evidence already stored in this browser.</p></div>
    {#if table.truncated}<span class="partial">Partial result</span>{/if}
  </header>

  <fieldset class="relationship-filters card">
    <legend>Relationship table controls</legend>
    <label class="search">Search<input bind:value={query} maxlength="100" placeholder="Value, method, or case domain" autocomplete="off"></label>
    <label>Relationship<select bind:value={type}><option value="all">All relationships</option><option value="nameserver_set">Nameserver sets</option><option value="http_final_origin">Final website origins</option></select></label>
    <label>Sort<select bind:value={sort}><option value="type">Relationship</option><option value="value">Observed value</option><option value="member_count">Case count</option></select></label>
    <button type="button" aria-label={`Sort ${direction==='asc'?'descending':'ascending'}`} onclick={()=>direction=direction==='asc'?'desc':'asc'}>{direction==='asc'?'Ascending':'Descending'}</button>
    <button type="button" onclick={clear} disabled={type==='all'&&!query&&sort==='type'&&direction==='asc'}>Clear</button>
  </fieldset>

  <p class="result-count" role="status" aria-live="polite">Showing {table.rows.length} of {table.matchingRelationships} matching relationship{table.matchingRelationships===1?'':'s'} from {table.totalRelationships} observed.</p>

  {#if table.rows.length}
    <div class="table-wrap">
      <table aria-describedby="relationship-table-limit">
        <caption>Cross-case relationships from latest browser-local case evidence</caption>
        <thead><tr><th scope="col">Relationship</th><th scope="col">Observed value</th><th scope="col">Cases</th><th scope="col">Interpretation</th></tr></thead>
        <tbody>
          {#each table.rows as row (`${row.type}:${row.value}`)}
            <tr>
              <td data-label="Relationship"><strong>{row.label}</strong><small>{row.method}</small></td>
              <td data-label="Observed value"><code>{row.value}</code></td>
              <td data-label="Cases"><span class="case-count">{row.caseCount} case{row.caseCount===1?'':'s'}</span><div class="case-pivots">{#each row.cases as item}<button type="button" onclick={()=>openCase(item.id)}>Open {item.domain}</button>{/each}</div>{#if row.omittedCases}<small>{row.omittedCases} additional case{row.omittedCases===1?'':'s'} omitted from this table row.</small>{/if}</td>
              <td data-label="Interpretation"><p>{row.description}</p></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <section class="empty card"><h3>{table.totalRelationships?'No relationships match these filters':'No cross-case relationships yet'}</h3><p>{table.totalRelationships?'Clear or broaden the filters to see other observed relationships.':'Capture comparable evidence in at least two cases to create an investigation pivot.'}</p></section>
  {/if}

  <details id="relationship-table-limit"><summary>Interpretation and coverage limits</summary>{#each table.limitations as limitation}<p>{limitation}</p>{/each}<p>The table displays at most 50 relationships and 20 case pivots per row. Partial-result labels disclose when source or presentation caps apply.</p></details>
</section>

<style>
  .relationship-workspace>header{display:flex;justify-content:space-between;gap:16px;align-items:start}.relationship-workspace h2{margin:0}.relationship-workspace>header p:last-child,.result-count,details p,.empty p{color:var(--muted);font-size:.7rem}.partial{color:#f2b84b;font-size:.66rem}.relationship-filters{display:flex;min-width:0;flex-wrap:wrap;gap:10px;align-items:end;margin-top:16px;padding:14px}.relationship-filters legend{padding:0 5px;color:var(--muted);font-size:.64rem}.relationship-filters label{color:var(--muted);font-size:.65rem}.relationship-filters input,.relationship-filters select{display:block;min-height:38px;margin-top:5px;padding:7px 9px;border:1px solid var(--border);border-radius:8px;background:var(--panel)}.relationship-filters .search{flex:1;min-width:190px}.relationship-filters .search input{width:100%}.relationship-filters button,.case-pivots button{min-height:38px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--panel-raised);font-size:.66rem}.result-count{margin:12px 2px}.table-wrap{overflow:auto;border:1px solid var(--border);border-radius:11px;background:var(--panel)}table{width:100%;border-collapse:collapse;font-size:.7rem}caption{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}th,td{padding:12px 10px;border-top:1px solid var(--border);text-align:left;vertical-align:top}thead th{border-top:0;color:var(--muted);font-size:.62rem;text-transform:uppercase;letter-spacing:.05em}td strong,td small{display:block}td small,td p,.case-count{color:var(--muted);font-size:.64rem}td code{display:block;max-width:300px;color:var(--accent);font-size:.64rem;overflow-wrap:anywhere}.case-pivots{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0}.case-pivots button{min-height:32px;padding:5px 7px}.empty{display:grid;min-height:260px;place-content:center;padding:28px;text-align:center}.empty h3{margin:0}details{margin-top:13px}details summary{color:var(--muted);cursor:pointer;font-size:.68rem}
  @media(max-width:800px){.relationship-workspace>header{flex-direction:column}.relationship-filters{display:grid}.relationship-filters .search{min-width:0}.relationship-filters input,.relationship-filters select,.relationship-filters button{width:100%}.table-wrap{overflow:visible;border:0;background:none}table,tbody,tr,td{display:block;width:100%}thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}tbody{display:grid;gap:10px}tr{overflow:hidden;border:1px solid var(--border);border-radius:10px;background:var(--panel)}td{display:grid;grid-template-columns:minmax(90px,110px) minmax(0,1fr);gap:8px;border-top:1px solid var(--border)}td:first-child{border-top:0}td::before{content:attr(data-label);color:var(--muted);font-size:.6rem;text-transform:uppercase;letter-spacing:.04em}td>*,td>div{grid-column:2;min-width:0}.case-pivots button{width:100%;overflow-wrap:anywhere}}
</style>
