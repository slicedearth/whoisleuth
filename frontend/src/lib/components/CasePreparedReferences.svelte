<script lang="ts">
  import { preparedStatementReferences, type PreparedCaseReport, type PreparedReportStatement } from '../../../../packages/cases/prepared-report-reading.mts';
  import CaseEvidenceFact from './CaseEvidenceFact.svelte';
  let { report, statement }: { report: PreparedCaseReport; statement: PreparedReportStatement } = $props();
  let expanded = $state(false);
  const references = $derived(expanded ? preparedStatementReferences(report, statement) : []);
</script>

<details class="prepared-references" ontoggle={event => expanded = event.currentTarget.open}>
  <summary>Inspect linked evidence for {statement.kind} <code>{statement.id}</code></summary>
  {#if expanded}
    {#if references === null}<p>This statement is unavailable in the prepared report.</p>
    {:else if !references.length}<p>No evidence references were recorded for this statement.</p>
    {:else}
      <ul>{#each references as reference (reference.id)}
        <li>
          <p><strong>{reference.stance === 'supports' ? 'Supports this statement' : reference.stance === 'contradicts' ? 'Contradicts this statement' : reference.stance === 'unresolved' ? 'Relationship unresolved' : 'Relationship not classified'}</strong> · <code>{reference.id}</code></p>
          {#if reference.pin}<CaseEvidenceFact pin={reference.pin} copyable />
          {:else}<p>Unavailable in this prepared report. This does not establish that the evidence never existed.</p>{/if}
        </li>
      {/each}</ul>
    {/if}
  {/if}
</details>

<style>
  .prepared-references{margin-top:12px;min-width:0}
  summary{min-height:44px;cursor:pointer;overflow-wrap:anywhere}
  code{white-space:normal;overflow-wrap:anywhere}
  ul{padding-left:20px;margin:8px 0}
  li{padding:10px 0;border-top:1px solid var(--border);min-width:0}
  p{margin:0 0 8px;font-size:var(--text-sm);line-height:1.6}
</style>
