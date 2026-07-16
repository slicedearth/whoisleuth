<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import { buildCaseRelationships } from '$lib/analysis/case-relationships.js';

  let { record, records, onselect }:{record:CaseRecord;records:CaseRecord[];onselect?:(record:CaseRecord)=>void}=$props();
  const summary=$derived(buildCaseRelationships(records));
  const groups=$derived(summary.groups.filter((group)=>group.cases.some((item)=>item.id===record.id)));

  function openCase(id:string){const target=records.find((item)=>item.id===id);if(target)onselect?.(target);}
</script>

{#if groups.length}
  <section class="case-relationships" aria-label={`Related cases for ${record.domain}`}>
    <header class="section-head"><div><p class="eyebrow">Cross-case comparison</p><h3>{groups.length} observed relationship{groups.length===1?'':'s'}</h3></div>{#if summary.truncated}<span class="partial">Partial result</span>{/if}</header>
    <p class="intro">Compare the latest compact evidence already stored in this browser. These are investigation pivots, not ownership or maliciousness conclusions.</p>
    <div class="relationship-list">
      {#each groups as group}
        <article>
          <strong>{group.label}</strong>
          <small>{group.method}</small>
          <code>{group.value}</code>
          <p>{group.description}</p>
          <div class="related-domains">
            {#each group.cases.filter((item)=>item.id!==record.id) as item}
              <button type="button" class="btn small" onclick={()=>openCase(item.id)}>Open {item.domain}</button>
            {/each}
          </div>
        </article>
      {/each}
    </div>
    <details><summary>Interpretation limits</summary>{#each summary.limitations as limitation}<p>{limitation}</p>{/each}</details>
  </section>
{/if}

<style>
  .case-relationships{padding:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  h3{margin:0;font-size:var(--text-md)}.intro,article p,details p{color:var(--muted);font-size:var(--text-xs);line-height:1.5}.relationship-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}article{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}article strong,article small,article code{display:block}article strong{font-size:var(--text-sm)}article small{margin-top:4px;color:var(--muted);font-size:var(--text-2xs)}article code{margin-top:7px;color:var(--accent);font-size:var(--text-xs);font-family:var(--mono);overflow-wrap:anywhere}.related-domains{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.related-domains .btn{overflow-wrap:anywhere}details{margin-top:11px}summary{color:var(--muted);cursor:pointer;font-size:var(--text-xs)}
  @media(max-width:700px){.relationship-list{grid-template-columns:1fr}}
</style>

