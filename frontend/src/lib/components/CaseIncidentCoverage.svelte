<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import { buildCaseIncidentCoverage } from '../../../../packages/cases/case-workflow-metadata.mts';
  let { record }: { record: CaseRecord } = $props();
  let page = $state(1);
  const rows = $derived(buildCaseIncidentCoverage(record));
  const pages = $derived(Math.max(1, Math.ceil(rows.length / 10)));
  const currentPage = $derived(Math.min(page, pages));
  const visible = $derived(rows.slice((currentPage - 1) * 10, currentPage * 10));
</script>

<details class="coverage">
  <summary>Exact incident-object coverage · {rows.length} retained links</summary>
  <p>Each exact link is a separate analyst-associated object. Sharing a hostname or Case does not establish common ownership or bind a response action to every link.</p>
  {#if rows.length}
    <div class="table-wrap"><table>
      <caption>Retained incident links, including analyst-resolved links</caption>
      <thead><tr><th scope="col">Exact object</th><th scope="col">Analyst scope</th><th scope="col">Recorded time</th><th scope="col">Response coverage</th></tr></thead>
      <tbody>{#each visible as row (row.target.id)}<tr>
        <td><code>{row.target.url}</code><small>Hostname: {row.hostname}</small></td>
        <td>{row.target.state === 'resolved' ? 'Analyst-resolved link' : 'Open link'}</td>
        <td><small>Added: {row.target.createdAt}</small><small>Updated: {row.target.updatedAt}</small></td>
        <td>Unknown action binding<small>Exact-object observation coverage unknown</small></td>
      </tr>{/each}</tbody>
    </table></div>
    {#if pages > 1}<nav aria-label="Incident coverage pages"><button class="btn" type="button" disabled={currentPage <= 1} onclick={() => page = currentPage - 1}>Previous links</button><span>Page {currentPage} of {pages}</span><button class="btn" type="button" disabled={currentPage >= pages} onclick={() => page = currentPage + 1}>Next links</button></nav>{/if}
  {:else}<p>No exact incident objects are retained. Domain-level evidence does not supply missing object coverage.</p>{/if}
  <p>Added and updated times describe analyst metadata, not first or last observation. Provider outcomes and independent rechecks remain separate Case records; hostname-scoped rechecks do not establish exact-page removal, restoration or recurrence. Resolving a link does not resolve other objects or internal follow-ups.</p>
</details>

<style>
  .coverage{min-width:0;border-top:1px solid var(--border);padding-top:12px}summary{cursor:pointer;font-weight:650}p,small{color:var(--muted);font-size:var(--text-xs);line-height:1.5}p{max-width:85ch}small{display:block;margin-top:4px}.table-wrap{max-width:100%;overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:var(--text-xs);table-layout:fixed}caption{text-align:left;padding:8px 0;color:var(--muted)}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid var(--border);overflow-wrap:anywhere}th:first-child{width:35%}code{white-space:normal;overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}@media(max-width:600px){table{min-width:560px}}
</style>
