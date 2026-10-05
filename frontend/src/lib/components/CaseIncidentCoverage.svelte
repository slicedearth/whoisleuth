<script lang="ts">
  import type { CaseRecord } from '#lib/cases.ts';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import { buildCaseIncidentCoverage } from '../../../../packages/cases/case-workflow-metadata.mts';
  let { record }: { record: CaseRecord } = $props();
  let page = $state(1);
  const rows = $derived(buildCaseIncidentCoverage(record));
  const pages = $derived(Math.max(1, Math.ceil(rows.length / 10)));
  const currentPage = $derived(Math.min(page, pages));
  const visible = $derived(rows.slice((currentPage - 1) * 10, currentPage * 10));
</script>

<details class="coverage">
  <summary>Exact incident-object coverage · {rows.length} retained objects</summary>
  {#if rows.length}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- the named overflow region provides native keyboard access to every column -->
    <div class="table-wrap" role="region" aria-label="Incident link coverage table" tabindex="0"><table>
      <caption>Explicit object identities and retained incident links, including analyst-resolved links</caption>
      <thead><tr><th scope="col">Exact object</th><th scope="col">Analyst scope</th><th scope="col">Analyst metadata time</th><th scope="col">Response coverage</th></tr></thead>
      <tbody>{#each visible as row (JSON.stringify(row.responseObject))}<tr>
        <td><code>{row.target.url}</code><small>Type: {row.responseObject.kind.replaceAll('_', ' ')} · hostname: {row.hostname}</small></td>
        <td>{row.targetRetained ? row.target.state === 'resolved' ? 'Analyst-resolved link' : 'Open link' : row.responseObject.incidentTargetId ? 'Historical object · no matching current link' : 'Domain or hostname scope'}</td>
        <td>{#if row.targetRetained}<small>Added: <time datetime={row.target.createdAt}>{formatEvidenceDate(row.target.createdAt)}</time></small><small>Updated: <time datetime={row.target.updatedAt}>{formatEvidenceDate(row.target.updatedAt)}</time></small>{:else}<small>No current incident-link metadata. Observation and event times remain separate.</small>{/if}</td>
        <td>{row.actionCoverage === 'bound' ? `${row.actionIds.length} explicitly bound action${row.actionIds.length === 1 ? '' : 's'}` : 'Unknown action binding'}<small>Exact-object observation coverage {row.observationCoverage}</small>
          {#if row.providerEvents.length}<details><summary>Source-attributed response events · {row.providerEvents.length}</summary>{#each row.providerEvents as event}<small>{event.outcome?.replaceAll('_', ' ') ?? event.state} · {event.sourceClass} · <time datetime={event.occurredAt}>{formatEvidenceDate(event.occurredAt)}</time> · action {event.actionId}</small>{/each}</details>{/if}
          {#if row.reviews.length}<details><summary>Independent object reviews · {row.reviews.length}</summary>{#each row.reviews as review}<small>{review.state.replaceAll('_', ' ')}{review.objectOutcome ? ` · ${review.objectOutcome}` : ''} · {review.completeness} · {review.source} · <time datetime={review.observedAt}>{formatEvidenceDate(review.observedAt)}</time></small>{#if review.recheck}<small>Conditions: {review.recheck.conditions} · {review.recheck.conditionsMatch} · baseline {review.recheck.baselinePinId ?? 'not retained'}</small>{/if}{/each}</details>{/if}
          {#if row.closures.length}<details><summary>Deliberate object closures · {row.closures.length}</summary>{#each row.closures as closure}<small>{closure.reason.replaceAll('_', ' ')} · <time datetime={closure.createdAt}>{formatEvidenceDate(closure.createdAt)}</time> · {closure.summary}</small>{/each}</details>{/if}
        </td>
      </tr>{/each}</tbody>
    </table></div>
    {#if pages > 1}<nav aria-label="Incident coverage pages"><button class="btn" type="button" disabled={currentPage <= 1} onclick={() => page = currentPage - 1}>Previous links</button><span>Page {currentPage} of {pages}</span><button class="btn" type="button" disabled={currentPage >= pages} onclick={() => page = currentPage + 1}>Next links</button></nav>{/if}
  {:else}<p>No exact incident objects retained.</p>{/if}
  <details><summary>About this review</summary><p>Each link is a separate analyst-associated object; a shared hostname or Case establishes neither ownership nor action binding. Added and updated times are metadata, not observation clocks. Only explicit event snapshots and exact-object reviews contribute to coverage. Provider claims remain distinct from independent observations; unavailable collection is not removal. Restoration or dispute does not establish malicious recurrence or report causation. Resolving one link leaves other objects and internal follow-ups independent.</p></details>
</details>

<style>
  .coverage{min-width:0;border-top:1px solid var(--border);padding-top:12px}summary{cursor:pointer;font-weight:650}p,small{color:var(--muted);font-size:var(--text-xs);line-height:1.5}p{max-width:85ch}small{display:block;margin-top:4px}.table-wrap{max-width:100%;overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:var(--text-xs);table-layout:fixed}caption{text-align:left;padding:8px 0;color:var(--muted)}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid var(--border);overflow-wrap:anywhere}th:first-child{width:35%}code{white-space:normal;overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}@media(max-width:600px){table{min-width:560px}}
</style>
