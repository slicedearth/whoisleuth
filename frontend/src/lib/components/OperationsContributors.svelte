<script lang="ts">
  import type { OperationsReportContributor } from '#lib/analysis/brand-protection-operations-report.ts';
  import { operationsContributorMetricLabel } from '#lib/analysis/operations-contributors.ts';
  import { caseWorkspaceHref } from '#lib/analysis/case-response-stage.ts';
  let { contributors, omitted }: { contributors: readonly OperationsReportContributor[]; omitted: number } = $props();
  let metric = $state('counts.actions'), page = $state(1);
  const metrics = $derived([...new Set(contributors.map(row => row.metric))].sort());
  const rows = $derived(contributors.filter(row => row.metric === metric));
  const pages = $derived(Math.max(1, Math.ceil(rows.length / 10)));
  const currentPage = $derived(Math.min(page, pages));
  const visible = $derived(rows.slice((currentPage - 1) * 10, currentPage * 10));
</script>

<details class="contributors">
  <summary>Contributing records and duration exclusions · local view only</summary>
  <label>Metric or exclusion<select bind:value={metric} onchange={() => page = 1}><option value="counts.actions">{operationsContributorMetricLabel('counts.actions')}</option>{#each metrics.filter(value => value !== 'counts.actions') as value}<option value={value}>{operationsContributorMetricLabel(value)}</option>{/each}</select></label>
  <p>{rows.length} retained contributor reference{rows.length === 1 ? '' : 's'} for this selection.{omitted ? ` ${omitted} additional references omitted by the local view cap; aggregate metrics are unchanged, so this list is not complete.` : ''}</p>
  <div class="table-wrap"><table>
    <caption>{operationsContributorMetricLabel(metric)} · contributing records</caption>
    <thead><tr><th scope="col">Case</th><th scope="col">Record references</th><th scope="col">Basis</th></tr></thead>
    <tbody>{#each visible as row, index (`${currentPage}:${index}`)}<tr>
      <td><a href={caseWorkspaceHref(row.caseId, 'response')}>Case {row.caseId}</a></td>
      <td>{#if row.actionId}<small>Action: {row.actionId}</small>{/if}{#if row.eventId}<small>Event: {row.eventId}</small>{/if}{#if row.reviewId}<small>Review: {row.reviewId}</small>{/if}{#if !row.actionId && !row.eventId && !row.reviewId}Case denominator{/if}</td>
      <td>{row.reason.replaceAll('_', ' ')}{#if row.seconds !== undefined}<small>Recorded interval: {row.seconds}s</small>{/if}</td>
    </tr>{/each}</tbody>
  </table></div>
  {#if !rows.length}<p>No contributor references retained for this selection; check source/window and view-cap exclusions.</p>{/if}
  {#if pages > 1}<nav aria-label="Operations contributor pages"><button class="btn" type="button" disabled={currentPage <= 1} onclick={() => page = currentPage - 1}>Previous contributors</button><span>Page {currentPage} of {pages}</span><button class="btn" type="button" disabled={currentPage >= pages} onclick={() => page = currentPage + 1}>Next contributors</button></nav>{/if}
  <details><summary>About this review</summary><p>References use the same calculation as the aggregate metrics but stay in page memory, outside exports. Cases remain distinct by ID. Provider assertions and independent changed reviews are separate; neither establishes removal, causation or campaign elimination. Review recurrence, dispute and restoration in the retained Case evidence.</p></details>
</details>

<style>
  .contributors{min-width:0;border-top:1px solid var(--border);padding-top:11px}summary{cursor:pointer;font-weight:650}p,label,td,th,small{font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}p{color:var(--muted);max-width:85ch}label{display:grid;gap:5px}select{max-width:100%;min-width:0}.table-wrap{max-width:100%;overflow-x:auto}table{width:100%;table-layout:fixed;border-collapse:collapse}caption{text-align:left;padding:8px 0}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid var(--border)}small{display:block}nav{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}@media(max-width:600px){table{min-width:480px}}
</style>
