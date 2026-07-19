<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import {
    MAX_RELATIONSHIP_GRAPH_GROUP_CASES,
    MAX_RELATIONSHIP_GRAPH_HIDDEN,
    MAX_RELATIONSHIP_GRAPH_PINS,
    projectCaseRelationshipGraph,
  } from '$lib/analysis/case-relationship-graph.js';

  let { records, summary, onselect }:{records:CaseRecord[];summary:any;onselect?:(record:CaseRecord)=>void}=$props();
  let selectedId=$state('');
  let type=$state('all');
  let source=$state('all');
  let period=$state('all');
  let completeness=$state('all');
  let scope=$state('all');
  let oneHop=$state(false);
  let pinnedIds=$state<string[]>([]);
  let hiddenIds=$state<string[]>([]);
  let groupCaseIds=$state<string[]>([]);
  const graph=$derived(projectCaseRelationshipGraph(summary,{type,source,period,completeness,scope,focusId:selectedId,oneHop,pinnedIds,hiddenIds,groupCaseIds}));
  const selectedNode:any=$derived(graph.nodes.find((node:any)=>node.id===selectedId)||graph.relationshipNodes[0]||graph.caseNodes[0]||null);
  const actionableSelection=$derived(Boolean(selectedId&&graph.nodes.some((node:any)=>node.id===selectedId)));
  const viewChanged=$derived(graph.view.oneHop||pinnedIds.length>0||hiddenIds.length>0||groupCaseIds.length>0);

  function select(id:string){selectedId=id;}
  function keyboardSelect(event:KeyboardEvent,id:string){if(event.key==='Enter'||event.key===' '){event.preventDefault();select(id);}}
  function openCase(id:string){const target=records.find((record)=>record.id===id);if(target)onselect?.(target);}
  function clearFilters(){type='all';source='all';period='all';completeness='all';scope='all';selectedId='';oneHop=false;}
  function toggleOneHop(){if(!actionableSelection)return;oneHop=!graph.view.oneHop;}
  function togglePin(){if(!actionableSelection)return;const id=selectedNode.id;if(pinnedIds.includes(id)){pinnedIds=pinnedIds.filter((item)=>item!==id);return;}if(pinnedIds.length<MAX_RELATIONSHIP_GRAPH_PINS)pinnedIds=[...pinnedIds,id];}
  function hideSelected(){if(!actionableSelection||hiddenIds.length>=MAX_RELATIONSHIP_GRAPH_HIDDEN)return;const id=selectedNode.id;hiddenIds=[...hiddenIds,id];pinnedIds=pinnedIds.filter((item)=>item!==id);groupCaseIds=groupCaseIds.filter((item)=>item!==id);selectedId='';oneHop=false;}
  function resetView(){oneHop=false;pinnedIds=[];hiddenIds=[];groupCaseIds=[];}
  function toggleGroupCase(id:string){if(groupCaseIds.includes(id)){groupCaseIds=groupCaseIds.filter((item)=>item!==id);return;}if(groupCaseIds.length<MAX_RELATIONSHIP_GRAPH_GROUP_CASES)groupCaseIds=[...groupCaseIds,id];}
  function connectedCaseIds(node:any):string[]{const visible=new Set<string>(graph.caseNodes.map((item:any)=>String(item.id)));const ids:string[]=(node.cases||[]).map((item:any)=>`case:${item.id}`);return [...new Set<string>(ids.filter((id)=>visible.has(id)))];}
  function canGroupConnectedCases(node:any){const ungrouped=connectedCaseIds(node).filter((id)=>!groupCaseIds.includes(id));return ungrouped.length>0&&ungrouped.length<=MAX_RELATIONSHIP_GRAPH_GROUP_CASES-groupCaseIds.length;}
  function groupConnectedCases(node:any){if(!canGroupConnectedCases(node))return;groupCaseIds=[...new Set([...groupCaseIds,...connectedCaseIds(node)])];}
  function date(value:string){const parsed=new Date(value);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();}
  function sourceLabel(value:string){return value.split('_').filter(Boolean).map((part)=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ')||'Unknown';}
  function completenessLabel(node:any){if(node.truncated)return 'Partial or truncated';if(node.complete===true)return 'Complete';if(node.complete===false)return 'Partial';return 'Unknown';}
  function connectedRelationships(node:any){
    const ids=new Set(graph.edges.filter((edge:any)=>edge.caseId===node.id).map((edge:any)=>edge.relationshipId));
    return graph.relationshipNodes.filter((item:any)=>ids.has(item.id));
  }
</script>

<section class="relationship-graph card" aria-labelledby="case-relationship-graph-title">
  <header class="section-head">
    <div><p class="eyebrow">Visual investigation map</p><h2 id="case-relationship-graph-title">Relationship graph</h2><p>Explore exact pivots from retained local observations. The table below remains the complete accessible view.</p></div>
    {#if graph.truncated}<span class="partial">Partial overview</span>{/if}
  </header>

  {#if graph.totalRelationships}
    <fieldset class="graph-controls">
      <legend>Relationship graph filters</legend>
      <label class="field">Relationship<select bind:value={type}><option value="all">All relationships</option><option value="nameserver_set">Nameserver sets</option><option value="http_final_origin">Final website origins</option></select></label>
      <label class="field">Source<select bind:value={source}><option value="all">All sources</option>{#each graph.sources as item}<option value={item}>{sourceLabel(item)}</option>{/each}</select></label>
      <label class="field">Observed within<select bind:value={period}><option value="all">All retained time</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="365d">Last 365 days</option></select></label>
      <label class="field">Completeness<select bind:value={completeness}><option value="all">All states</option><option value="complete">Complete</option><option value="partial">Partial or truncated</option><option value="unknown">Unknown</option></select></label>
      <label class="field">Case or campaign<select bind:value={scope}><option value="all">All cases and campaigns</option>{#each graph.scopeOptions as item}<option value={item.value}>{item.kind==='case'?'Case':'Campaign'}: {item.label}</option>{/each}</select></label>
      <button type="button" class="btn" onclick={clearFilters} disabled={type==='all'&&source==='all'&&period==='all'&&completeness==='all'&&scope==='all'}>Clear filters</button>
      <span role="status" aria-live="polite">{graph.matchingRelationships} matching relationship{graph.matchingRelationships===1?'':'s'}</span>
      {#if graph.filterOptionsTruncated}<small>Filter options are bounded; use the table search for omitted cases.</small>{/if}
    </fieldset>
  {/if}

  {#if graph.allNodeCount}
    <div class="view-controls" role="group" aria-label="Relationship graph view controls">
      <button type="button" class="btn small" aria-pressed={graph.view.oneHop} disabled={!actionableSelection} onclick={toggleOneHop}>{graph.view.oneHop?'Show overview':'Focus one hop'}</button>
      <button type="button" class="btn small" aria-pressed={actionableSelection&&graph.view.pinnedIds.includes(selectedNode.id)} disabled={!actionableSelection||(pinnedIds.length>=MAX_RELATIONSHIP_GRAPH_PINS&&!pinnedIds.includes(selectedNode?.id))} onclick={togglePin}>{actionableSelection&&graph.view.pinnedIds.includes(selectedNode.id)?'Unpin selected':'Pin selected'}</button>
      <button type="button" class="btn small" disabled={!actionableSelection||hiddenIds.length>=MAX_RELATIONSHIP_GRAPH_HIDDEN} onclick={hideSelected}>Hide selected</button>
      <button type="button" class="btn small" disabled={!viewChanged} onclick={resetView}>Reset view</button>
      <span role="status" aria-live="polite">{graph.nodes.length} of {graph.allNodeCount} nodes visible · {graph.view.pinnedIds.length} pinned · {graph.view.hiddenIds.length} hidden</span>
    </div>
  {/if}

  {#if graph.nodes.length}
    <p id="relationship-graph-help" class="help">Select a case or relationship node with a pointer, Enter, or Space to inspect its evidence and pivots.</p>
    <div class="graph-scroll">
      <svg viewBox={`0 0 ${graph.width} ${graph.height}`} role="group" aria-labelledby="case-relationship-graph-title relationship-graph-help">
        <g class="edges" aria-hidden="true">
          {#each graph.edges as edge (edge.id)}
            <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} class:active={selectedNode&&(edge.caseId===selectedNode.id||edge.relationshipId===selectedNode.id)} />
          {/each}
        </g>
        <g class="nodes">
          {#each graph.caseNodes as node (node.id)}
            <g class="node case-node" class:selected={selectedNode?.id===node.id} class:pinned={graph.view.pinnedIds.includes(node.id)} role="button" tabindex="0" aria-label={`Case ${node.label}${graph.view.pinnedIds.includes(node.id)?', pinned':''}`} onclick={()=>select(node.id)} onkeydown={(event)=>keyboardSelect(event,node.id)}>
              <title>Case: {node.label}</title><rect x={node.x} y={node.y} width={node.width} height={node.height} rx="8"/><text x={node.x+12} y={node.y+21}>{node.displayLabel}</text>
            </g>
          {/each}
          {#each graph.relationshipNodes as node (node.id)}
            <g class="node relationship-node" class:selected={selectedNode?.id===node.id} class:pinned={graph.view.pinnedIds.includes(node.id)} role="button" tabindex="0" aria-label={`${node.label}: ${node.value}${graph.view.pinnedIds.includes(node.id)?', pinned':''}`} onclick={()=>select(node.id)} onkeydown={(event)=>keyboardSelect(event,node.id)}>
              <title>{node.label}: {node.value}</title><rect x={node.x} y={node.y} width={node.width} height={node.height} rx="8"/><text x={node.x+12} y={node.y+21}>{node.displayLabel}</text>
            </g>
          {/each}
        </g>
      </svg>
    </div>

    {#if selectedNode}
      <section class="inspector" aria-live="polite" aria-atomic="true">
        {#if selectedNode.kind==='relationship'}
          <p class="eyebrow">Selected relationship</p><h3>{selectedNode.label}</h3><code>{selectedNode.value}</code><p>{selectedNode.description}</p>
          <dl class="provenance">
            <div><dt>Method</dt><dd>{selectedNode.method||'Unavailable'}</dd></div>
            <div><dt>Classification</dt><dd>{selectedNode.classifications?.join(', ')||'Unavailable'}</dd></div>
            <div><dt>Sources</dt><dd>{selectedNode.sources?.map(sourceLabel).join(', ')||'Unavailable'}</dd></div>
            <div><dt>Observed</dt><dd>{selectedNode.firstObservedAt?date(selectedNode.firstObservedAt):'Unavailable'}{#if selectedNode.lastObservedAt&&selectedNode.lastObservedAt!==selectedNode.firstObservedAt} to {date(selectedNode.lastObservedAt)}{/if}</dd></div>
            <div><dt>Completeness</dt><dd>{completenessLabel(selectedNode)}</dd></div>
            {#if selectedNode.campaigns?.length}<div><dt>Campaigns</dt><dd>{selectedNode.campaigns.map((item:any)=>item.label).join(', ')}</dd></div>{/if}
          </dl>
          {#if selectedNode.observations?.length}
            <details class="observations"><summary>Source observations ({selectedNode.observations.length + selectedNode.omittedObservations})</summary><ul>{#each selectedNode.observations.slice(0,8) as item}<li><strong>{sourceLabel(item.source)}</strong> · {sourceLabel(item.store)} · {sourceLabel(item.scanDepth)} · {sourceLabel(item.status)}<small>{date(item.observedAt)} · {item.truncated?'Truncated':item.complete===true?'Complete':item.complete===false?'Partial':'Completeness unknown'}</small></li>{/each}</ul>{#if selectedNode.observations.length>8||selectedNode.omittedObservations}<p>{Math.max(0,selectedNode.observations.length-8)+selectedNode.omittedObservations} additional observation{Math.max(0,selectedNode.observations.length-8)+selectedNode.omittedObservations===1?'':'s'} omitted from this inspector.</p>{/if}</details>
          {/if}
          {#if selectedNode.limitations?.length}<details><summary>Relationship limitations</summary>{#each selectedNode.limitations as limitation}<p>{limitation}</p>{/each}</details>{/if}
          <button type="button" class="btn small group-action" disabled={!canGroupConnectedCases(selectedNode)} onclick={()=>groupConnectedCases(selectedNode)}>Group connected cases</button>
          <div class="pivots">{#each selectedNode.cases as item}<button type="button" class="btn small" onclick={()=>openCase(item.id)}>Open {item.domain}</button>{/each}</div>
        {:else}
          <p class="eyebrow">Selected case</p><h3>{selectedNode.label}</h3>
          <div class="case-actions"><button type="button" class="btn small open-case" onclick={()=>openCase(selectedNode.caseId)}>Open case</button><button type="button" class="btn small" aria-pressed={graph.view.groupCaseIds.includes(selectedNode.id)} disabled={!graph.view.groupCaseIds.includes(selectedNode.id)&&groupCaseIds.length>=MAX_RELATIONSHIP_GRAPH_GROUP_CASES} onclick={()=>toggleGroupCase(selectedNode.id)}>{graph.view.groupCaseIds.includes(selectedNode.id)?'Remove from comparison group':'Add to comparison group'}</button></div>
          <ul>{#each connectedRelationships(selectedNode) as relationship}<li><button type="button" class="btn small" onclick={()=>select(relationship.id)}>{relationship.label}: {relationship.value}</button></li>{/each}</ul>
        {/if}
      </section>
    {/if}
    {#if graph.comparisonCaseNodes.length}
      <section class="comparison" aria-labelledby="relationship-comparison-title">
        <header><div><p class="eyebrow">Shared-neighbour review</p><h3 id="relationship-comparison-title">Comparison group</h3></div><button type="button" class="btn small" onclick={()=>groupCaseIds=[]}>Clear group</button></header>
        <p>{graph.comparisonCaseNodes.length} of {MAX_RELATIONSHIP_GRAPH_GROUP_CASES} bounded case slots selected. This transient group is not saved or exported.</p>
        <ul class="comparison-cases">{#each graph.comparisonCaseNodes as node}<li><span>{node.label}</span><button type="button" class="btn small" aria-label={`Remove ${node.label} from comparison group`} onclick={()=>toggleGroupCase(node.id)}>Remove</button></li>{/each}</ul>
        {#if graph.comparisonCaseNodes.length<2}<p>Add another case to review relationships shared by every selected case.</p>
        {:else if graph.sharedRelationshipNodes.length}<ul class="shared-neighbours">{#each graph.sharedRelationshipNodes as node}<li><button type="button" class="btn small" onclick={()=>select(node.id)}>{node.label}: {node.value}</button></li>{/each}</ul>
        {:else}<p>No retained relationship in this bounded graph connects every selected case. This does not establish that no relationship exists elsewhere.</p>{/if}
      </section>
    {/if}
  {:else}
    <section class="empty"><h3>{graph.allNodeCount?'No graph nodes remain in this view':graph.totalRelationships?'No relationships match these filters':graph.state==='unsupported'?'Newer local evidence is not interpreted':graph.state==='invalid'?'Local relationship evidence could not be interpreted':'No relationship graph yet'}</h3><p>{graph.allNodeCount?'Reset the transient graph view to restore hidden nodes. The complete relationship table remains available below.':graph.totalRelationships?'Clear or broaden the filters to see other retained pivots.':graph.state==='unsupported'?'This version leaves the newer local projection unchanged. Update WHOISleuth before inspecting it.':graph.state==='invalid'?'The stored records remain unchanged. Review the coverage details for the reported limitation.':'Capture comparable evidence in at least two cases to create investigation pivots.'}</p></section>
  {/if}

  <details><summary>Graph coverage and interpretation</summary>{#each graph.limitations as limitation}<p>{limitation}</p>{/each}<p>The visual overview displays at most 12 relationships, 24 cases, and 48 edges. Transient view state retains at most 8 pins, 12 hidden nodes, and 8 comparison cases. Each relationship retains at most 100 source observations; the inspector displays the newest 8. Use the table below for full values and a larger bounded result set.</p></details>
</section>

<style>
  .relationship-graph{min-width:0;padding:18px;margin-bottom:18px}.relationship-graph h2,.inspector h3,.comparison h3,.empty h3{margin:0}.relationship-graph>header p:not(.eyebrow),.help,.inspector p:not(.eyebrow),.inspector small,.comparison p,.empty p,details p{color:var(--muted);font-size:var(--text-xs);line-height:1.5}.relationship-graph>header p:not(.eyebrow){margin:6px 0 0}.partial{color:var(--amber);font:600 var(--text-2xs) var(--mono);text-transform:uppercase;letter-spacing:.05em}.graph-controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:end;margin:14px 0 8px;padding:0;border:0}.graph-controls legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.graph-controls span,.graph-controls small{align-self:center;color:var(--muted);font-size:var(--text-xs)}.view-controls{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin:10px 0}.view-controls span{color:var(--muted);font-size:var(--text-xs)}.help{margin:14px 0 8px}.graph-scroll{max-width:100%;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-md);background:linear-gradient(180deg,var(--panel),var(--panel-raised))}svg{display:block;width:100%;min-width:680px;height:auto;max-height:620px}.edges line{stroke:color-mix(in srgb,var(--muted) 32%,transparent);stroke-width:1.5}.edges line.active{stroke:var(--accent);stroke-width:3}.node{cursor:pointer;outline:none}.node rect{fill:var(--panel-raised);stroke:var(--border);stroke-width:1.5}.relationship-node rect{fill:color-mix(in srgb,var(--accent) 8%,var(--panel-raised));stroke:color-mix(in srgb,var(--accent) 50%,var(--border))}.node.pinned rect{stroke:var(--amber);stroke-dasharray:5 3}.node text{fill:var(--text);font-family:var(--mono);font-size:13px;pointer-events:none}.node:hover rect,.node:focus-visible rect,.node.selected rect{stroke:var(--accent);stroke-width:3}.inspector,.comparison{min-width:0;padding:14px;margin-top:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}.inspector h3,.comparison h3{font-size:var(--text-md);overflow-wrap:anywhere}.inspector code,.inspector small{display:block;margin-top:6px;overflow-wrap:anywhere}.inspector code{color:var(--accent);font-size:var(--text-xs);font-family:var(--mono)}.provenance{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}.provenance div{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm)}.provenance dt{color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:uppercase}.provenance dd{margin:4px 0 0;font-size:var(--text-xs);overflow-wrap:anywhere}.observations ul{display:grid;gap:7px;padding:0;margin:9px 0;list-style:none}.observations li{padding:8px;border-left:2px solid var(--border);font-size:var(--text-xs)}.observations li small{margin-top:3px}.pivots,.case-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.pivots .btn,.inspector li .btn{overflow-wrap:anywhere}.group-action{margin-top:10px}.inspector>ul,.comparison ul{display:grid;gap:6px;padding:0;margin:10px 0 0;list-style:none}.inspector>ul li .btn,.shared-neighbours .btn{width:100%;justify-content:flex-start;text-align:left}.comparison header,.comparison-cases li{display:flex;align-items:center;justify-content:space-between;gap:10px}.comparison-cases li{min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}.comparison-cases span{min-width:0;overflow-wrap:anywhere;font-size:var(--text-xs)}.empty{display:grid;min-height:220px;place-content:center;text-align:center}details{margin-top:13px}details summary{color:var(--muted);cursor:pointer;font-size:var(--text-xs)}
  @media(max-width:850px){.graph-controls{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:700px){.relationship-graph{padding:14px}.relationship-graph>header{align-items:stretch;flex-direction:column}.graph-controls{grid-template-columns:minmax(0,1fr)}.graph-controls select,.graph-controls .btn,.view-controls .btn,.pivots .btn,.case-actions .btn{width:100%}.view-controls,.pivots,.case-actions{display:grid}.graph-scroll{overscroll-behavior-x:contain}.provenance{grid-template-columns:minmax(0,1fr)}.comparison header{align-items:stretch;flex-direction:column}.comparison header .btn{width:100%}}
</style>
