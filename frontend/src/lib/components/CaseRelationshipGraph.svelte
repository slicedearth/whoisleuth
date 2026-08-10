<script lang="ts">
  import IntelligenceIcon, { type IntelligenceIconName } from '$lib/components/IntelligenceIcon.svelte';
  import type { CaseRecord } from '$lib/cases';
  import {
    MAX_RELATIONSHIP_GRAPH_GROUP_CASES,
    MAX_RELATIONSHIP_GRAPH_HIDDEN,
    MAX_RELATIONSHIP_GRAPH_PINS,
    projectCaseRelationshipGraph,
  } from '$lib/analysis/case-relationship-graph.ts';
  import type {
    CaseRelationshipGraphCaseNode,
    CaseRelationshipGraphEdge,
    CaseRelationshipGraphRelationshipNode,
  } from '$lib/analysis/case-relationship-graph.ts';
  import type { CaseRelationshipQuery, CaseRelationshipSummary } from '$lib/analysis/case-relationships.ts';
  import { buildRelationshipGraphExport } from '$lib/analysis/case-relationship-graph-export.ts';
  import { horizontalConnectionPath } from '$lib/analysis/evidence-topology.ts';

  let {
    records,
    summary,
    query,
    selectedRelationshipId,
    setSelectedRelationshipId,
    onselect,
  }:{
    records:CaseRecord[];
    summary:CaseRelationshipSummary;
    query:CaseRelationshipQuery;
    selectedRelationshipId:string;
    setSelectedRelationshipId:(id:string)=>void;
    onselect?:(record:CaseRecord)=>void;
  }=$props();
  let selectedCaseNodeId=$state('');
  let oneHop=$state(false);
  let pinnedIds=$state<string[]>([]);
  let hiddenIds=$state<string[]>([]);
  let groupCaseIds=$state<string[]>([]);
  let exportFormat=$state<'json'|'graphml'|'gexf'>('json');
  let exportMessage=$state('');
  const focusId=$derived(selectedRelationshipId||selectedCaseNodeId);
  const graph=$derived(projectCaseRelationshipGraph(summary,{...query,selectedRelationshipId,focusId,oneHop,pinnedIds,hiddenIds,groupCaseIds}));
  const selectedNode=$derived(graph.nodes.find((node)=>node.id===focusId)||null);
  const actionableSelection=$derived(Boolean(focusId&&graph.nodes.some((node)=>node.id===focusId)));
  const selectedPinned=$derived(Boolean(actionableSelection&&selectedNode&&graph.view.pinnedIds.includes(selectedNode.id)));
  const selectedPinAtCapacity=$derived(Boolean(selectedNode&&graph.view.pinnedIds.length>=MAX_RELATIONSHIP_GRAPH_PINS&&!graph.view.pinnedIds.includes(selectedNode.id)));
  const viewChanged=$derived(graph.view.oneHop||graph.view.pinnedIds.length>0||graph.view.hiddenIds.length>0||graph.view.groupCaseIds.length>0);

  $effect(()=>{
    const sameIds=(left:string[],right:string[])=>left.length===right.length&&left.every((id,index)=>id===right[index]);
    if(!sameIds(pinnedIds,graph.view.pinnedIds))pinnedIds=graph.view.pinnedIds;
    if(!sameIds(hiddenIds,graph.view.hiddenIds))hiddenIds=graph.view.hiddenIds;
    if(!sameIds(groupCaseIds,graph.view.groupCaseIds))groupCaseIds=graph.view.groupCaseIds;
    if(selectedCaseNodeId&&graph.view.focusId!==selectedCaseNodeId)selectedCaseNodeId='';
  });

  $effect(()=>{
    if(!selectedRelationshipId)return;
    selectedCaseNodeId='';
    if(hiddenIds.includes(selectedRelationshipId))hiddenIds=hiddenIds.filter((id)=>id!==selectedRelationshipId);
  });

  function selectRelationship(id:string){selectedCaseNodeId='';setSelectedRelationshipId(id);}
  function selectCase(id:string){selectedCaseNodeId=id;setSelectedRelationshipId('');}
  function keyboardSelect(event:KeyboardEvent,id:string,kind:'case'|'relationship'){
    if(event.key!=='Enter'&&event.key!==' ')return;
    event.preventDefault();
    if(kind==='relationship')selectRelationship(id);else selectCase(id);
  }
  function openCase(id:string){const target=records.find((record)=>record.id===id);if(target)onselect?.(target);}
  function toggleOneHop(){if(!actionableSelection)return;oneHop=!graph.view.oneHop;}
  function togglePin(){if(!actionableSelection||!selectedNode)return;const id=selectedNode.id;const current=graph.view.pinnedIds;if(current.includes(id)){pinnedIds=current.filter((item)=>item!==id);return;}if(current.length<MAX_RELATIONSHIP_GRAPH_PINS)pinnedIds=[...current,id];}
  function hideSelected(){if(!actionableSelection||!selectedNode||graph.view.hiddenIds.length>=MAX_RELATIONSHIP_GRAPH_HIDDEN)return;const{id,kind}=selectedNode;hiddenIds=[...graph.view.hiddenIds,id];pinnedIds=graph.view.pinnedIds.filter((item)=>item!==id);groupCaseIds=graph.view.groupCaseIds.filter((item)=>item!==id);if(kind==='relationship')setSelectedRelationshipId('');else selectedCaseNodeId='';oneHop=false;}
  function resetView(){oneHop=false;pinnedIds=[];hiddenIds=[];groupCaseIds=[];}
  function toggleGroupCase(id:string){const current=graph.view.groupCaseIds;if(current.includes(id)){groupCaseIds=current.filter((item)=>item!==id);return;}if(current.length<MAX_RELATIONSHIP_GRAPH_GROUP_CASES)groupCaseIds=[...current,id];}
  function connectedCaseIds(node:CaseRelationshipGraphRelationshipNode):string[]{const visible=new Set<string>(graph.caseNodes.map((item)=>String(item.id)));const ids:string[]=node.cases.map((item)=>`case:${item.id}`);return [...new Set<string>(ids.filter((id)=>visible.has(id)))];}
  function canGroupConnectedCases(node:CaseRelationshipGraphRelationshipNode){const current=graph.view.groupCaseIds;const ungrouped=connectedCaseIds(node).filter((id)=>!current.includes(id));return ungrouped.length>0&&ungrouped.length<=MAX_RELATIONSHIP_GRAPH_GROUP_CASES-current.length;}
  function groupConnectedCases(node:CaseRelationshipGraphRelationshipNode){if(!canGroupConnectedCases(node))return;groupCaseIds=[...new Set([...graph.view.groupCaseIds,...connectedCaseIds(node)])];}
  function date(value:string){const parsed=new Date(value);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();}
  function sourceLabel(value:string){return value.split('_').filter(Boolean).map((part)=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ')||'Unknown';}
  function completenessLabel(node:CaseRelationshipGraphRelationshipNode){if(node.truncated)return 'Partial or truncated';if(node.complete===true)return 'Complete';if(node.complete===false)return 'Partial';return 'Unknown';}
  function connectedRelationships(node:CaseRelationshipGraphCaseNode){
    const ids=new Set(graph.edges.filter((edge)=>edge.caseId===node.id).map((edge)=>edge.relationshipId));
    return graph.relationshipNodes.filter((item)=>ids.has(item.id));
  }
  function edgePath(edge:CaseRelationshipGraphEdge){return horizontalConnectionPath({x:edge.x1??0,y:edge.y1??0},{x:edge.x2??0,y:edge.y2??0});}
  function relationshipIcon(node:CaseRelationshipGraphRelationshipNode):IntelligenceIconName{
    return({nameserver_set:'nameserver',http_final_origin:'origin',ip_address:'ip',certificate:'tls',tracking_identifier:'tracker',favicon:'favicon',official_asset:'asset'} as Record<string,IntelligenceIconName>)[node.type]||'network';
  }
  function downloadGraph(){
    try{
      const output=buildRelationshipGraphExport(summary,{format:exportFormat,...query});
      const blob=new Blob([output.content],{type:output.mimeType});
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement('a');
      anchor.href=url;anchor.download=output.filename;anchor.click();URL.revokeObjectURL(url);
      exportMessage=`Downloaded ${output.nodeCount} nodes and ${output.edgeCount} edges${output.truncated?' from a bounded partial graph':''}.`;
    }catch(cause){exportMessage=cause instanceof Error?cause.message:'Could not export the relationship graph.';}
  }
</script>

<section class="relationship-graph card" aria-labelledby="case-relationship-graph-title">
  <header class="section-head">
    <div><p class="eyebrow">Visual investigation map</p><h2 id="case-relationship-graph-title">Relationship graph</h2><p>Explore exact pivots from retained local observations. The table below remains the complete accessible view.</p></div>
    {#if graph.truncated}<span class="partial">Partial overview</span>{/if}
  </header>

  {#if graph.totalRelationships}
    <div class="export-controls" role="group" aria-label="Relationship graph export controls">
      <label class="field">Graph export format<select bind:value={exportFormat}><option value="json">WHOISleuth JSON</option><option value="graphml">GraphML</option><option value="gexf">GEXF</option></select></label>
      <button type="button" class="btn" disabled={!graph.matchingRelationships} onclick={downloadGraph}>Export filtered graph</button>
      <small>The local download includes the bounded filtered graph and provenance. Transient focus, pin, hide, comparison-group, selected-relationship, and private table-view state are excluded.</small>
      {#if exportMessage}<span role="status" aria-live="polite">{exportMessage}</span>{/if}
    </div>
  {/if}

  {#if graph.allNodeCount}
    <div class="view-controls" role="group" aria-label="Relationship graph view controls">
      <button type="button" class="btn small" aria-pressed={graph.view.oneHop} disabled={!actionableSelection} onclick={toggleOneHop}>{graph.view.oneHop?'Show overview':'Focus one hop'}</button>
      <button type="button" class="btn small" aria-pressed={selectedPinned} disabled={!actionableSelection||selectedPinAtCapacity} onclick={togglePin}>{selectedPinned?'Unpin selected':'Pin selected'}</button>
      <button type="button" class="btn small" disabled={!actionableSelection||graph.view.hiddenIds.length>=MAX_RELATIONSHIP_GRAPH_HIDDEN} onclick={hideSelected}>Hide selected</button>
      <button type="button" class="btn small" disabled={!viewChanged} onclick={resetView}>Reset view</button>
      <span role="status" aria-live="polite">{graph.nodes.length} of {graph.allNodeCount} nodes visible · {graph.view.pinnedIds.length} pinned · {graph.view.hiddenIds.length} hidden</span>
    </div>
  {/if}

  {#if graph.nodes.length}
    <p id="relationship-graph-help" class="help">Select a case or relationship node with a pointer, Enter, or Space to inspect its evidence and pivots.</p>
    <div class="graph-scroll">
      <svg viewBox={`0 0 ${graph.width} ${graph.height}`} role="group" aria-labelledby="case-relationship-graph-title relationship-graph-help">
        <defs>
          <pattern id="relationship-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" class="grid-line" /></pattern>
          <filter id="relationship-node-glow" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="2.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <rect width={graph.width} height={graph.height} class="graph-background" aria-hidden="true" />
        <rect width={graph.width} height={graph.height} fill="url(#relationship-grid)" aria-hidden="true" />
        <g class="edges" aria-hidden="true">
          {#each graph.edges as edge (edge.id)}
            <path d={edgePath(edge)} class:active={selectedNode&&(edge.caseId===selectedNode.id||edge.relationshipId===selectedNode.id)} />
          {/each}
        </g>
        <g class="nodes">
          {#each graph.caseNodes as node (node.id)}
            <g class="node case-node" class:selected={selectedCaseNodeId===node.id} class:pinned={graph.view.pinnedIds.includes(node.id)} role="button" tabindex="0" aria-pressed={selectedCaseNodeId===node.id} aria-label={`Case ${node.label}${graph.view.pinnedIds.includes(node.id)?', pinned':''}`} onclick={()=>selectCase(node.id)} onkeydown={(event)=>keyboardSelect(event,node.id,'case')}>
              <title>Case: {node.label}</title><rect x={node.x} y={node.y} width={node.width} height={node.height} rx="8"/><circle cx={node.x+17} cy={node.y+16} r="9" class="node-icon-disc"/><IntelligenceIcon name="case" size={12} x={node.x+11} y={node.y+10} className="graph-node-icon"/><text x={node.x+32} y={node.y+21}>{node.displayLabel}</text>
            </g>
          {/each}
          {#each graph.relationshipNodes as node (node.id)}
            <g class="node relationship-node" class:selected={selectedRelationshipId===node.id} class:pinned={graph.view.pinnedIds.includes(node.id)} role="button" tabindex="0" aria-pressed={selectedRelationshipId===node.id} aria-label={`${node.label}: ${node.value}${graph.view.pinnedIds.includes(node.id)?', pinned':''}`} onclick={()=>selectRelationship(node.id)} onkeydown={(event)=>keyboardSelect(event,node.id,'relationship')}>
              <title>{node.label}: {node.value}</title><rect x={node.x} y={node.y} width={node.width} height={node.height} rx="8"/><circle cx={node.x+18} cy={node.y+16} r="10" class="node-icon-disc"/><IntelligenceIcon name={relationshipIcon(node)} size={14} x={node.x+11} y={node.y+9} className="graph-node-icon"/><text x={node.x+34} y={node.y+21}>{node.displayLabel}</text>
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
            <div><dt>Local use</dt><dd>{selectedNode.commonalityExplanation}</dd></div>
            <div><dt>Sources</dt><dd>{selectedNode.sources?.map(sourceLabel).join(', ')||'Unavailable'}</dd></div>
            <div><dt>Observed</dt><dd>{selectedNode.firstObservedAt?date(selectedNode.firstObservedAt):'Unavailable'}{#if selectedNode.lastObservedAt&&selectedNode.lastObservedAt!==selectedNode.firstObservedAt} to {date(selectedNode.lastObservedAt)}{/if}</dd></div>
            <div><dt>Completeness</dt><dd>{completenessLabel(selectedNode)}</dd></div>
            <div><dt>Scope distance</dt><dd>{selectedNode.lineagePaths.length?`${Math.min(...selectedNode.lineagePaths.map((path)=>path.scopeDistance))} hop${Math.min(...selectedNode.lineagePaths.map((path)=>path.scopeDistance))===1?'':'s'} from a retained domain seed`:'Unavailable'}</dd></div>
            {#if selectedNode.campaigns?.length}<div><dt>Campaigns</dt><dd>{selectedNode.campaigns.map((item)=>item.label).join(', ')}</dd></div>{/if}
          </dl>
          {#if selectedNode.lineagePaths.length}
            <details class="lineage"><summary>Discovery paths ({selectedNode.lineagePaths.length + selectedNode.omittedLineagePaths})</summary>
              <ol>{#each selectedNode.lineagePaths.slice(0,8) as path}<li><strong>{path.seed.label}</strong><span>{path.steps.map((step)=>`${sourceLabel(step.relationshipType)} → ${step.to.label}`).join(' → ')}</span><small>{path.scopeDistance} hop{path.scopeDistance===1?'':'s'} · {sourceLabel(path.classification)} · {path.discoveryMethod||'Method unavailable'}</small></li>{/each}</ol>
              {#if selectedNode.lineagePaths.length>8||selectedNode.omittedLineagePaths}<p>{Math.max(0,selectedNode.lineagePaths.length-8)+selectedNode.omittedLineagePaths} additional bounded path{Math.max(0,selectedNode.lineagePaths.length-8)+selectedNode.omittedLineagePaths===1?'':'s'} omitted from this inspector.</p>{/if}
            </details>
          {/if}
          {#if selectedNode.observations?.length}
            <details class="observations"><summary>Source observations ({selectedNode.observations.length + selectedNode.omittedObservations})</summary><ul>{#each selectedNode.observations.slice(0,8) as item}<li><strong>{sourceLabel(item.source)}</strong> · {sourceLabel(item.store)} · {sourceLabel(item.scanDepth)} · {sourceLabel(item.status)}<small>{date(item.observedAt)} · {item.truncated?'Truncated':item.complete===true?'Complete':item.complete===false?'Partial':'Completeness unknown'}</small></li>{/each}</ul>{#if selectedNode.observations.length>8||selectedNode.omittedObservations}<p>{Math.max(0,selectedNode.observations.length-8)+selectedNode.omittedObservations} additional observation{Math.max(0,selectedNode.observations.length-8)+selectedNode.omittedObservations===1?'':'s'} omitted from this inspector.</p>{/if}</details>
          {/if}
          {#if selectedNode.limitations?.length}<details><summary>Relationship limitations</summary>{#each selectedNode.limitations as limitation}<p>{limitation}</p>{/each}</details>{/if}
          <button type="button" class="btn small group-action" disabled={!canGroupConnectedCases(selectedNode)} onclick={()=>groupConnectedCases(selectedNode)}>Group connected cases</button>
          <div class="pivots">{#each selectedNode.cases as item}<button type="button" class="btn small" onclick={()=>openCase(item.id)}>Open {item.domain}</button>{/each}</div>
        {:else}
          <p class="eyebrow">Selected case</p><h3>{selectedNode.label}</h3>
          <div class="case-actions"><button type="button" class="btn small open-case" onclick={()=>openCase(selectedNode.caseId)}>Open case</button><button type="button" class="btn small" aria-pressed={graph.view.groupCaseIds.includes(selectedNode.id)} disabled={!graph.view.groupCaseIds.includes(selectedNode.id)&&groupCaseIds.length>=MAX_RELATIONSHIP_GRAPH_GROUP_CASES} onclick={()=>toggleGroupCase(selectedNode.id)}>{graph.view.groupCaseIds.includes(selectedNode.id)?'Remove from comparison group':'Add to comparison group'}</button></div>
          <ul>{#each connectedRelationships(selectedNode) as relationship}<li><button type="button" class="btn small" onclick={()=>selectRelationship(relationship.id)}>{relationship.label}: {relationship.value}</button></li>{/each}</ul>
        {/if}
      </section>
    {/if}
    {#if graph.comparisonCaseNodes.length}
      <section class="comparison" aria-labelledby="relationship-comparison-title">
        <header><div><p class="eyebrow">Shared-neighbour review</p><h3 id="relationship-comparison-title">Comparison group</h3></div><button type="button" class="btn small" onclick={()=>groupCaseIds=[]}>Clear group</button></header>
        <p>{graph.comparisonCaseNodes.length} of {MAX_RELATIONSHIP_GRAPH_GROUP_CASES} bounded case slots selected. This transient group is not saved or exported.</p>
        <ul class="comparison-cases">{#each graph.comparisonCaseNodes as node}<li><span>{node.label}</span><button type="button" class="btn small" aria-label={`Remove ${node.label} from comparison group`} onclick={()=>toggleGroupCase(node.id)}>Remove</button></li>{/each}</ul>
        {#if graph.comparisonCaseNodes.length<2}<p>Add another case to review relationships shared by every selected case.</p>
        {:else if graph.sharedRelationshipNodes.length}<ul class="shared-neighbours">{#each graph.sharedRelationshipNodes as node}<li><button type="button" class="btn small" onclick={()=>selectRelationship(node.id)}>{node.label}: {node.value}</button></li>{/each}</ul>
        {:else}<p>No retained relationship in this bounded graph connects every selected case. This does not establish that no relationship exists elsewhere.</p>{/if}
      </section>
    {/if}
  {:else}
    <section class="empty"><h3>{graph.allNodeCount?'No graph nodes remain in this view':graph.totalRelationships?'No relationships match these filters':graph.state==='unsupported'?'Newer local evidence is not interpreted':graph.state==='invalid'?'Local relationship evidence could not be interpreted':'No relationship graph yet'}</h3><p>{graph.allNodeCount?'Reset the transient graph view to restore hidden nodes. The complete relationship table remains available below.':graph.totalRelationships?'Clear or broaden the filters to see other retained pivots.':graph.state==='unsupported'?'This version leaves the newer local projection unchanged. Update WHOISleuth before inspecting it.':graph.state==='invalid'?'The stored records remain unchanged. Review the coverage details for the reported limitation.':'Capture comparable evidence in at least two cases to create investigation pivots.'}</p></section>
  {/if}

  <details><summary>Graph coverage and interpretation</summary>{#each graph.limitations as limitation}<p>{limitation}</p>{/each}<p>The visual overview displays at most 12 relationships, 24 cases, and 48 edges. Transient view state retains at most 8 pins, 12 hidden nodes, and 8 comparison cases. Each relationship retains at most 100 source observations; the inspector displays the newest 8. Use the table below for full values and a larger bounded result set.</p></details>
</section>

<style>
  .relationship-graph{min-width:0;padding:18px;margin-bottom:18px}.relationship-graph h2,.inspector h3,.comparison h3,.empty h3{margin:0}.relationship-graph>header p:not(.eyebrow),.help,.inspector p:not(.eyebrow),.inspector small,.comparison p,.empty p,details p{color:var(--muted);font-size:var(--text-xs);line-height:1.5}.relationship-graph>header p:not(.eyebrow){margin:6px 0 0}.partial{color:var(--amber);font:600 var(--text-2xs) var(--mono);text-transform:uppercase;letter-spacing:.05em}.export-controls{display:grid;grid-template-columns:minmax(180px,260px) auto minmax(0,1fr);gap:10px;align-items:end;margin:10px 0 14px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}.export-controls small,.export-controls span{align-self:center;color:var(--muted);font-size:var(--text-xs);line-height:1.45;overflow-wrap:anywhere}.export-controls span{grid-column:1/-1}.view-controls{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin:10px 0}.view-controls span{color:var(--muted);font-size:var(--text-xs)}.help{margin:14px 0 8px}.graph-scroll{max-width:100%;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-md);background:linear-gradient(180deg,var(--panel),var(--panel-raised))}.graph-scroll>svg{display:block;width:100%;min-width:680px;height:auto;max-height:620px}.graph-background{fill:var(--panel-raised)}.grid-line{fill:none;stroke:color-mix(in srgb,var(--border) 62%,transparent);stroke-width:1}.edges path{fill:none;stroke:color-mix(in srgb,var(--muted) 36%,transparent);stroke-width:1.5}.edges path.active{stroke:var(--accent);stroke-width:3;filter:url(#relationship-node-glow)}.node{cursor:pointer;outline:none}.node rect{fill:var(--panel-raised);stroke:var(--border);stroke-width:1.5}.relationship-node{color:var(--accent)}.case-node{color:var(--accent2)}.relationship-node rect{fill:color-mix(in srgb,var(--accent) 8%,var(--panel-raised));stroke:color-mix(in srgb,var(--accent) 50%,var(--border))}.node-icon-disc{fill:rgb(var(--accent-rgb) / .08);stroke:color-mix(in srgb,var(--accent) 45%,var(--border));stroke-width:1}.case-node .node-icon-disc{fill:rgb(var(--accent2-rgb) / .08);stroke:color-mix(in srgb,var(--accent2) 45%,var(--border))}.node :global(.graph-node-icon){overflow:visible;color:inherit;pointer-events:none}.node.pinned rect{stroke:var(--amber);stroke-dasharray:5 3}.node text{fill:var(--text);font-family:var(--mono);font-size:13px;pointer-events:none}.node:hover rect,.node:focus-visible rect,.node.selected rect{stroke:var(--accent);stroke-width:3;filter:url(#relationship-node-glow)}.inspector,.comparison{min-width:0;padding:14px;margin-top:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}.inspector h3,.comparison h3{font-size:var(--text-md);overflow-wrap:anywhere}.inspector code,.inspector small{display:block;margin-top:6px;overflow-wrap:anywhere}.inspector code{color:var(--accent);font-size:var(--text-xs);font-family:var(--mono)}.provenance{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}.provenance div{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm)}.provenance dt{color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:uppercase}.provenance dd{margin:4px 0 0;font-size:var(--text-xs);overflow-wrap:anywhere}.observations ul,.lineage ol{display:grid;gap:7px;padding:0;margin:9px 0;list-style:none}.observations li,.lineage li{padding:8px;border-left:2px solid var(--border);font-size:var(--text-xs)}.observations li small,.lineage li span,.lineage li small{display:block;margin-top:3px}.lineage li span,.lineage li small{color:var(--muted);overflow-wrap:anywhere}.pivots,.case-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.pivots .btn,.inspector li .btn{overflow-wrap:anywhere}.group-action{margin-top:10px}.inspector>ul,.comparison ul{display:grid;gap:6px;padding:0;margin:10px 0 0;list-style:none}.inspector>ul li .btn,.shared-neighbours .btn{width:100%;justify-content:flex-start;text-align:left}.comparison header,.comparison-cases li{display:flex;align-items:center;justify-content:space-between;gap:10px}.comparison-cases li{min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}.comparison-cases span{min-width:0;overflow-wrap:anywhere;font-size:var(--text-xs)}.empty{display:grid;min-height:220px;place-content:center;text-align:center}details{margin-top:13px}details summary{color:var(--muted);cursor:pointer;font-size:var(--text-xs)}
  @media(max-width:700px){.relationship-graph{padding:14px}.relationship-graph>header{align-items:stretch;flex-direction:column}.export-controls{grid-template-columns:minmax(0,1fr)}.export-controls select,.export-controls .btn,.view-controls .btn,.pivots .btn,.case-actions .btn{width:100%}.export-controls span{grid-column:auto}.view-controls,.pivots,.case-actions{display:grid}.graph-scroll{overscroll-behavior-x:contain}.provenance{grid-template-columns:minmax(0,1fr)}.comparison header{align-items:stretch;flex-direction:column}.comparison header .btn{width:100%}}
</style>
