<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import {
    CASE_RELATIONSHIP_QUERY_DEFAULTS,
    caseRelationshipGroupId,
    filterInvestigationCaseRelationships,
    normalizeCaseRelationshipGroupId,
    normalizeCaseRelationshipQuery,
    type CaseRelationshipQuery,
    type CaseRelationshipSummary,
  } from '$lib/analysis/case-relationships.ts';
  import CaseRelationshipGraph from '$lib/components/CaseRelationshipGraph.svelte';
  import CaseRelationshipTable from '$lib/components/CaseRelationshipTable.svelte';

  let {
    records,
    summary,
    onselect,
  }:{
    records:CaseRecord[];
    summary:CaseRelationshipSummary;
    onselect:(record:CaseRecord)=>void;
  }=$props();

  let query=$state<CaseRelationshipQuery>({...CASE_RELATIONSHIP_QUERY_DEFAULTS});
  let selectedRelationshipId=$state('');
  const filtered=$derived(filterInvestigationCaseRelationships(summary,query));

  function sameQuery(left:CaseRelationshipQuery,right:CaseRelationshipQuery):boolean{
    return left.type===right.type
      &&left.source===right.source
      &&left.period===right.period
      &&left.completeness===right.completeness
      &&left.scope===right.scope;
  }

  $effect(()=>{
    const normalized=normalizeCaseRelationshipQuery(summary,query);
    if(!sameQuery(query,normalized)){query=normalized;selectedRelationshipId='';return;}
    if(selectedRelationshipId&&!filtered.groups.some((group)=>caseRelationshipGroupId(group)===selectedRelationshipId)){
      selectedRelationshipId='';
    }
  });

  function setFilter<K extends keyof CaseRelationshipQuery>(key:K,value:CaseRelationshipQuery[K]){
    query=normalizeCaseRelationshipQuery(summary,{...query,[key]:value});
    selectedRelationshipId='';
  }

  function clearFilters(){query={...CASE_RELATIONSHIP_QUERY_DEFAULTS};selectedRelationshipId='';}

  function setSelectedRelationshipId(value:string){
    const normalized=normalizeCaseRelationshipGroupId(value);
    selectedRelationshipId=normalized&&filtered.groups.some((group)=>caseRelationshipGroupId(group)===normalized)
      ? normalized
      : '';
  }

  function sourceLabel(value:string):string{
    return value.split('_').filter(Boolean).map((part)=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ')||'Unknown';
  }
</script>

<section class="case-relationship-workspace" aria-label="Relationship workspace">
  <fieldset class="workspace-filters card">
    <legend>Relationship workspace filters</legend>
    <label class="field">Relationship<select value={query.type} onchange={(event)=>setFilter('type',event.currentTarget.value as CaseRelationshipQuery['type'])}><option value="all">All relationships</option><option value="nameserver_set">Nameserver sets</option><option value="http_final_origin">Final website origins</option><option value="ip_address">IP addresses</option><option value="certificate">TLS certificates</option><option value="tracking_identifier">Tracking identifiers</option><option value="favicon">Favicons</option><option value="official_asset">Official assets</option></select></label>
    <label class="field">Source<select value={query.source} onchange={(event)=>setFilter('source',event.currentTarget.value)}><option value="all">All sources</option>{#each summary.sources??[] as item}<option value={item}>{sourceLabel(item)}</option>{/each}</select></label>
    <label class="field">Observed within<select value={query.period} onchange={(event)=>setFilter('period',event.currentTarget.value as CaseRelationshipQuery['period'])}><option value="all">All retained time</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="365d">Last 365 days</option></select></label>
    <label class="field">Completeness<select value={query.completeness} onchange={(event)=>setFilter('completeness',event.currentTarget.value as CaseRelationshipQuery['completeness'])}><option value="all">All states</option><option value="complete">Complete</option><option value="partial">Partial or truncated</option><option value="unknown">Unknown</option></select></label>
    <label class="field">Case or campaign<select value={query.scope} onchange={(event)=>setFilter('scope',event.currentTarget.value)}><option value="all">All cases and campaigns</option>{#each summary.scopeOptions??[] as item}<option value={item.value}>{item.kind==='case'?'Case':'Campaign'}: {item.label}</option>{/each}</select></label>
    <button type="button" class="btn" onclick={clearFilters} disabled={sameQuery(query,{...CASE_RELATIONSHIP_QUERY_DEFAULTS})}>Clear filters</button>
    <span class="matching-count" role="status" aria-live="polite">{filtered.matchingRelationships} of {filtered.totalRelationships} matching relationship{filtered.matchingRelationships===1?'':'s'}</span>
  </fieldset>
  {#if summary.filterOptionsTruncated}<p class="filter-limit">Source, case, or campaign filter options are bounded; the private table search still covers every retained relationship row that matches the common filters.</p>{/if}

  <CaseRelationshipGraph {records} {summary} {query} {selectedRelationshipId} {setSelectedRelationshipId} {onselect} />
  <CaseRelationshipTable {records} {summary} {query} {selectedRelationshipId} {setSelectedRelationshipId} {onselect} />
</section>

<style>
  .case-relationship-workspace{min-width:0}.workspace-filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:end;margin:0 0 16px;padding:14px}.workspace-filters legend{padding:0 5px;color:var(--muted);font:600 var(--text-2xs) var(--mono)}.matching-count{align-self:center;color:var(--muted);font-size:var(--text-xs)}.filter-limit{margin:-6px 2px 14px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  @media(max-width:850px){.workspace-filters{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:700px){.workspace-filters{grid-template-columns:minmax(0,1fr)}.workspace-filters select,.workspace-filters .btn{width:100%}}
</style>
