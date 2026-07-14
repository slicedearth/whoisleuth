<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import { buildCaseRelationships } from '$lib/analysis/case-relationships.js';
  import { projectCaseRelationshipGraph } from '$lib/analysis/case-relationship-graph.js';

  let { records, onselect }:{records:CaseRecord[];onselect?:(record:CaseRecord)=>void}=$props();
  let selectedId=$state('');
  let type=$state('all');
  const relationships=$derived(buildCaseRelationships(records));
  const graph=$derived(projectCaseRelationshipGraph(relationships,{type}));
  const selectedNode:any=$derived(graph.nodes.find((node:any)=>node.id===selectedId)||graph.relationshipNodes[0]||graph.caseNodes[0]||null);

  function select(id:string){selectedId=id;}
  function keyboardSelect(event:KeyboardEvent,id:string){if(event.key==='Enter'||event.key===' '){event.preventDefault();select(id);}}
  function openCase(id:string){const target=records.find((record)=>record.id===id);if(target)onselect?.(target);}
  function connectedRelationships(node:any){
    const ids=new Set(graph.edges.filter((edge:any)=>edge.caseId===node.id).map((edge:any)=>edge.relationshipId));
    return graph.relationshipNodes.filter((item:any)=>ids.has(item.id));
  }
</script>

<section class="relationship-graph card" aria-labelledby="case-relationship-graph-title">
  <header>
    <div><p class="eyebrow">Visual investigation map</p><h2 id="case-relationship-graph-title">Relationship graph</h2><p>Explore exact pivots from the latest compact case evidence. The table below remains the complete accessible view.</p></div>
    {#if graph.truncated}<span class="partial">Partial overview</span>{/if}
  </header>

  {#if graph.totalRelationships}
    <div class="graph-controls"><label>Relationship filter<select bind:value={type}><option value="all">All relationships</option><option value="nameserver_set">Nameserver sets</option><option value="http_final_origin">Final website origins</option></select></label><span role="status" aria-live="polite">{graph.matchingRelationships} matching relationship{graph.matchingRelationships===1?'':'s'}</span></div>
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
            <g class="node case-node" class:selected={selectedNode?.id===node.id} role="button" tabindex="0" aria-label={`Case ${node.label}`} onclick={()=>select(node.id)} onkeydown={(event)=>keyboardSelect(event,node.id)}>
              <title>Case: {node.label}</title><rect x={node.x} y={node.y} width={node.width} height={node.height} rx="8"/><text x={node.x+12} y={node.y+21}>{node.displayLabel}</text>
            </g>
          {/each}
          {#each graph.relationshipNodes as node (node.id)}
            <g class="node relationship-node" class:selected={selectedNode?.id===node.id} role="button" tabindex="0" aria-label={`${node.label}: ${node.value}`} onclick={()=>select(node.id)} onkeydown={(event)=>keyboardSelect(event,node.id)}>
              <title>{node.label}: {node.value}</title><rect x={node.x} y={node.y} width={node.width} height={node.height} rx="8"/><text x={node.x+12} y={node.y+21}>{node.displayLabel}</text>
            </g>
          {/each}
        </g>
      </svg>
    </div>

    {#if selectedNode}
      <section class="inspector" aria-live="polite" aria-atomic="true">
        {#if selectedNode.kind==='relationship'}
          <p class="eyebrow">Selected relationship</p><h3>{selectedNode.label}</h3><code>{selectedNode.value}</code><small>{selectedNode.method}</small><p>{selectedNode.description}</p>
          <div class="pivots">{#each selectedNode.cases as item}<button type="button" onclick={()=>openCase(item.id)}>Open {item.domain}</button>{/each}</div>
        {:else}
          <p class="eyebrow">Selected case</p><h3>{selectedNode.label}</h3>
          <button type="button" class="open-case" onclick={()=>openCase(selectedNode.caseId)}>Open case</button>
          <ul>{#each connectedRelationships(selectedNode) as relationship}<li><button type="button" onclick={()=>select(relationship.id)}>{relationship.label}: {relationship.value}</button></li>{/each}</ul>
        {/if}
      </section>
    {/if}
  {:else}
    <section class="empty"><h3>No relationship graph yet</h3><p>Capture comparable evidence in at least two cases to create investigation pivots.</p></section>
  {/if}

  <details><summary>Graph coverage and interpretation</summary>{#each graph.limitations as limitation}<p>{limitation}</p>{/each}<p>The visual overview displays at most 12 relationships, 24 cases, and 48 edges. Use the table below for filtering, full values, and a larger bounded result set.</p></details>
</section>

<style>
  .relationship-graph{min-width:0;padding:18px;margin-bottom:18px}.relationship-graph>header{display:flex;justify-content:space-between;gap:16px;align-items:start}.relationship-graph h2,.inspector h3,.empty h3{margin:0}.relationship-graph>header p:last-child,.help,.inspector p,.inspector small,.empty p,details p{color:var(--muted);font-size:.68rem}.partial{color:#f2b84b;font-size:.66rem}.graph-controls{display:flex;align-items:end;justify-content:space-between;gap:12px;margin:14px 0 8px}.graph-controls label,.graph-controls span{color:var(--muted);font-size:.64rem}.graph-controls select{display:block;min-height:38px;margin-top:5px;padding:7px 9px;border:1px solid var(--border);border-radius:8px;background:var(--panel)}.help{margin:14px 0 8px}.graph-scroll{max-width:100%;overflow:auto;border:1px solid var(--border);border-radius:10px;background:linear-gradient(180deg,var(--panel),var(--panel-raised))}svg{display:block;width:100%;min-width:680px;height:auto;max-height:620px}.edges line{stroke:color-mix(in srgb,var(--muted) 32%,transparent);stroke-width:1.5}.edges line.active{stroke:var(--accent);stroke-width:3}.node{cursor:pointer;outline:none}.node rect{fill:var(--panel-raised);stroke:var(--border);stroke-width:1.5}.relationship-node rect{fill:color-mix(in srgb,var(--accent) 8%,var(--panel-raised));stroke:color-mix(in srgb,var(--accent) 50%,var(--border))}.node text{fill:var(--text);font-family:var(--font-mono);font-size:13px;pointer-events:none}.node:hover rect,.node:focus-visible rect,.node.selected rect{stroke:var(--accent);stroke-width:3}.inspector{min-width:0;padding:14px;margin-top:12px;border:1px solid var(--border);border-radius:10px;background:var(--panel)}.inspector code,.inspector small{display:block;margin-top:6px;overflow-wrap:anywhere}.inspector code{color:var(--accent);font-size:.68rem}.pivots{display:flex;flex-wrap:wrap;gap:6px}.pivots button,.open-case,.inspector li button{min-height:34px;padding:6px 9px;border:1px solid var(--border);border-radius:8px;background:var(--panel-raised);font-size:.64rem;overflow-wrap:anywhere}.inspector ul{display:grid;gap:6px;padding:0;margin:10px 0 0;list-style:none}.inspector li button{width:100%;text-align:left}.empty{display:grid;min-height:220px;place-content:center;text-align:center}details{margin-top:13px}details summary{color:var(--muted);cursor:pointer;font-size:.68rem}
  @media(max-width:700px){.relationship-graph{padding:14px}.relationship-graph>header,.graph-controls{align-items:stretch;flex-direction:column}.graph-controls select{width:100%}.graph-scroll{overscroll-behavior-x:contain}.pivots{display:grid}.pivots button{width:100%}}
</style>
