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
    <header><div><p class="eyebrow">Cross-case comparison</p><h3>{groups.length} observed relationship{groups.length===1?'':'s'}</h3></div>{#if summary.truncated}<span>Partial result</span>{/if}</header>
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
              <button type="button" onclick={()=>openCase(item.id)}>Open {item.domain}</button>
            {/each}
          </div>
        </article>
      {/each}
    </div>
    <details><summary>Interpretation limits</summary>{#each summary.limitations as limitation}<p>{limitation}</p>{/each}</details>
  </section>
{/if}

<style>
  .case-relationships{padding:14px;border:1px solid var(--border);border-radius:10px;background:var(--panel-raised)}
  header{display:flex;justify-content:space-between;gap:12px}h3{margin:0}header span{color:#f2b84b;font-size:.64rem}.intro,article p,details p{color:var(--muted);font-size:.68rem}.relationship-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}article{min-width:0;padding:12px;border:1px solid var(--border);border-radius:9px;background:var(--panel)}article strong,article small,article code{display:block}article small{margin-top:4px;color:var(--muted);font-size:.62rem}article code{margin-top:7px;color:var(--accent);font-size:.62rem;overflow-wrap:anywhere}.related-domains{display:flex;flex-wrap:wrap;gap:6px}.related-domains button{min-height:34px;padding:6px 9px;border:1px solid var(--border);border-radius:8px;background:var(--panel-raised);font-size:.64rem}details{margin-top:11px}summary{color:var(--muted);cursor:pointer;font-size:.68rem}
  @media(max-width:700px){.relationship-list{grid-template-columns:1fr}}
</style>

