<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import { projectCaseRelationshipTable } from '$lib/analysis/case-relationship-table.js';
  import Pagination from '$lib/components/Pagination.svelte';

  let { records, summary, onselect }:{records:CaseRecord[];summary:any;onselect?:(record:CaseRecord)=>void}=$props();
  let type=$state('all');
  let query=$state('');
  let sort=$state('type');
  let direction=$state('asc');
  let source=$state('all');
  let period=$state('all');
  let completeness=$state('all');
  let scope=$state('all');
  let page=$state(1);
  const table=$derived(projectCaseRelationshipTable(summary,{type,query,sort,direction,source,period,completeness,scope,page}));

  function openCase(id:string){const target=records.find((record)=>record.id===id);if(target)onselect?.(target);}
  function date(value:string){const parsed=new Date(value);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();}
  function sourceLabel(value:string){return value.split('_').filter(Boolean).map((part)=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ')||'Unknown';}
  function completenessLabel(row:any){if(row.truncated)return 'Partial or truncated';if(row.complete===true)return 'Complete';if(row.complete===false)return 'Partial';return 'Unknown';}
  function setQuery(value:string){query=value;page=1;}
  function setType(value:string){type=value;page=1;}
  function setSort(value:string){sort=value;page=1;}
  function setSource(value:string){source=value;page=1;}
  function setPeriod(value:string){period=value;page=1;}
  function setCompleteness(value:string){completeness=value;page=1;}
  function setScope(value:string){scope=value;page=1;}
  function toggleDirection(){direction=direction==='asc'?'desc':'asc';page=1;}
  function setPage(value:number){page=Math.min(table.pageCount,Math.max(1,Math.trunc(value)));}
  function clear(){type='all';query='';sort='type';direction='asc';source='all';period='all';completeness='all';scope='all';page=1;}
</script>

<section class="relationship-workspace" aria-labelledby="case-relationship-table-title">
  <header class="section-head">
    <div><p class="eyebrow">Cross-case comparison</p><h2 id="case-relationship-table-title">Relationship table</h2><p>Review exact relationships and their retained local provenance without making new network requests.</p></div>
    {#if table.truncated}<span class="partial">Partial result</span>{/if}
  </header>

  <fieldset class="relationship-filters card">
    <legend>Relationship table controls</legend>
    <label class="field search">Search<input value={query} oninput={(event)=>setQuery(event.currentTarget.value)} maxlength="100" placeholder="Value, method, or case domain" autocomplete="off"></label>
    <label class="field">Relationship<select value={type} onchange={(event)=>setType(event.currentTarget.value)}><option value="all">All relationships</option><option value="nameserver_set">Nameserver sets</option><option value="http_final_origin">Final website origins</option></select></label>
    <label class="field">Sort<select value={sort} onchange={(event)=>setSort(event.currentTarget.value)}><option value="type">Relationship</option><option value="value">Observed value</option><option value="member_count">Case count</option></select></label>
    <label class="field">Source<select value={source} onchange={(event)=>setSource(event.currentTarget.value)}><option value="all">All sources</option>{#each table.sources as item}<option value={item}>{sourceLabel(item)}</option>{/each}</select></label>
    <label class="field">Observed within<select value={period} onchange={(event)=>setPeriod(event.currentTarget.value)}><option value="all">All retained time</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="365d">Last 365 days</option></select></label>
    <label class="field">Completeness<select value={completeness} onchange={(event)=>setCompleteness(event.currentTarget.value)}><option value="all">All states</option><option value="complete">Complete</option><option value="partial">Partial or truncated</option><option value="unknown">Unknown</option></select></label>
    <label class="field">Case or campaign<select value={scope} onchange={(event)=>setScope(event.currentTarget.value)}><option value="all">All cases and campaigns</option>{#each table.scopeOptions as item}<option value={item.value}>{item.kind==='case'?'Case':'Campaign'}: {item.label}</option>{/each}</select></label>
    <button type="button" class="btn" aria-label={direction==='asc'?'Ascending, switch to descending':'Descending, switch to ascending'} onclick={toggleDirection}>{direction==='asc'?'Ascending':'Descending'}</button>
    <button type="button" class="btn" onclick={clear} disabled={type==='all'&&!query&&sort==='type'&&direction==='asc'&&source==='all'&&period==='all'&&completeness==='all'&&scope==='all'}>Clear filters</button>
  </fieldset>

  {#if table.filterOptionsTruncated}<p class="filter-limit">Filter options are bounded; search still covers all retained relationship rows.</p>{/if}

  <p class="result-count" role="status" aria-live="polite">{#if table.rows.length}Showing {table.rangeStart}–{table.rangeEnd} of {table.matchingRelationships} matching relationship{table.matchingRelationships===1?'':'s'} from {table.totalRelationships} observed.{:else}No matching relationships from {table.totalRelationships} observed.{/if}</p>

  {#if table.rows.length}
    <div class="table-wrap">
      <table aria-describedby="relationship-table-limit">
        <caption>Cross-case relationships from retained browser-local investigation evidence</caption>
        <thead><tr><th scope="col">Relationship</th><th scope="col">Observed value</th><th scope="col">Cases</th><th scope="col">Interpretation</th></tr></thead>
        <tbody>
          {#each table.rows as row (`${row.type}:${row.value}`)}
            <tr>
              <td data-label="Relationship"><strong>{row.label}</strong><small>{row.method}</small></td>
              <td data-label="Observed value"><code>{row.value}</code></td>
              <td data-label="Cases"><span class="case-count">{row.caseCount} case{row.caseCount===1?'':'s'}</span><div class="case-pivots">{#each row.cases as item}<button type="button" class="btn small" onclick={()=>openCase(item.id)}>Open {item.domain}</button>{/each}</div>{#if row.omittedCases}<small>{row.omittedCases} additional case{row.omittedCases===1?'':'s'} omitted from this table row.</small>{/if}</td>
              <td data-label="Interpretation"><p>{row.description}</p><dl class="row-provenance"><div><dt>Sources</dt><dd>{row.sources?.map(sourceLabel).join(', ')||'Unavailable'}</dd></div><div><dt>Observed</dt><dd>{row.firstObservedAt?date(row.firstObservedAt):'Unavailable'}{#if row.lastObservedAt&&row.lastObservedAt!==row.firstObservedAt} to {date(row.lastObservedAt)}{/if}</dd></div><div><dt>Completeness</dt><dd>{completenessLabel(row)}</dd></div>{#if row.campaigns?.length}<div><dt>Campaigns</dt><dd>{row.campaigns.map((item:any)=>item.label).join(', ')}</dd></div>{/if}</dl>{#if row.observations?.length}<details class="row-observations"><summary>Inspect {row.observations.length + row.omittedObservations} source observation{row.observations.length + row.omittedObservations===1?'':'s'}</summary><ul>{#each row.observations.slice(0,5) as item}<li><strong>{sourceLabel(item.source)}</strong> · {sourceLabel(item.scanDepth)} · {date(item.observedAt)}</li>{/each}</ul>{#if row.observations.length>5||row.omittedObservations}<small>{Math.max(0,row.observations.length-5)+row.omittedObservations} additional observation{Math.max(0,row.observations.length-5)+row.omittedObservations===1?'':'s'} omitted from this row.</small>{/if}</details>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Pagination currentPage={table.currentPage} pageCount={table.pageCount} {setPage} ariaLabel="Case relationship pages" />
  {:else}
    <section class="empty-state card"><h3>{table.totalRelationships?'No relationships match these filters':table.state==='unsupported'?'Newer local evidence is not interpreted':table.state==='invalid'?'Local relationship evidence could not be interpreted':'No cross-case relationships yet'}</h3><p>{table.totalRelationships?'Clear or broaden the filters to see other retained relationships.':table.state==='unsupported'?'This version leaves the newer local projection unchanged. Update WHOISleuth before inspecting it.':table.state==='invalid'?'The stored records remain unchanged. Review the coverage details for the reported limitation.':'Capture comparable evidence in at least two cases to create an investigation pivot.'}</p></section>
  {/if}

  <details id="relationship-table-limit"><summary>Interpretation and coverage limits</summary>{#each table.limitations as limitation}<p>{limitation}</p>{/each}<p>Each page displays up to 50 relationships, each row displays up to 20 case pivots, and each relationship retains at most 100 source observations. Partial-result labels disclose source or per-row safety caps; ordinary pagination is not a partial result.</p></details>
</section>

<style>
  .relationship-workspace h2{margin:0}.relationship-workspace>header p:not(.eyebrow),.result-count,.filter-limit,details p{color:var(--muted);font-size:var(--text-xs);line-height:1.5}.relationship-workspace>header p:not(.eyebrow){margin:6px 0 0}.partial{color:var(--amber);font:600 var(--text-2xs) var(--mono);text-transform:uppercase;letter-spacing:.05em}.relationship-filters{display:flex;min-width:0;flex-wrap:wrap;gap:10px;align-items:end;margin-top:16px;padding:14px}.relationship-filters legend{padding:0 5px;color:var(--muted);font:600 var(--text-2xs) var(--mono)}.relationship-filters input{min-height:var(--control-h)}.relationship-filters .search{flex:1;min-width:190px}.filter-limit{margin:8px 2px 0}.result-count{margin:12px 2px}.table-wrap{overflow:auto;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}table{width:100%;border-collapse:collapse;font-size:var(--text-xs)}caption{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}th,td{padding:12px 10px;border-top:1px solid var(--border);text-align:left;vertical-align:top}thead th{border-top:0;color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:uppercase;letter-spacing:.05em}td strong,td small{display:block}td strong{font-size:var(--text-sm)}td small,td p,.case-count{color:var(--muted);font-size:var(--text-xs)}td p{margin:0;line-height:1.5}td code{display:block;max-width:320px;color:var(--accent);font-size:var(--text-xs);font-family:var(--mono);overflow-wrap:anywhere}.case-pivots{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0}.row-provenance{display:grid;gap:4px;margin:8px 0 0}.row-provenance div{display:grid;grid-template-columns:76px minmax(0,1fr);gap:6px}.row-provenance dt{color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:uppercase}.row-provenance dd{min-width:0;margin:0;overflow-wrap:anywhere}.row-observations{margin-top:8px}.row-observations ul{display:grid;gap:3px;padding-left:18px;margin:7px 0;font-size:var(--text-xs)}details{margin-top:13px}details summary{color:var(--muted);cursor:pointer;font-size:var(--text-xs)}
  @media(min-width:801px){th:nth-child(2),td:nth-child(2){min-width:180px}}
  @media(max-width:800px){.relationship-workspace>header{flex-direction:column}.relationship-filters{display:grid}.relationship-filters .search{min-width:0}.relationship-filters input,.relationship-filters select,.relationship-filters button{width:100%}.table-wrap{overflow:visible;border:0;background:none}table,tbody,tr,td{display:block;width:100%}thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}tbody{display:grid;gap:10px}tr{overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}td{display:grid;grid-template-columns:minmax(90px,110px) minmax(0,1fr);gap:8px;border-top:1px solid var(--border)}td:first-child{border-top:0}td::before{content:attr(data-label);color:var(--muted);font:600 .62rem var(--mono);text-transform:uppercase;letter-spacing:.04em}td>*,td>div{grid-column:2;min-width:0}.case-pivots .btn{width:100%;overflow-wrap:anywhere}}
</style>
