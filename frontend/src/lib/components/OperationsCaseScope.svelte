<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import type { OperationsReportSourceState } from '$lib/analysis/brand-protection-operations-report.ts';
  import { buildOperationsScopeReview } from '$lib/analysis/operations-contributors.ts';
  import { caseWorkspaceHref } from '$lib/analysis/case-response-stage.ts';
  import { formatEvidenceDate } from '$lib/analysis/evidence-time.ts';
  import CaseIncidentCoverage from './CaseIncidentCoverage.svelte';

  let { records, sourceState, campaignDomains }: {
    records: readonly CaseRecord[];
    sourceState: OperationsReportSourceState;
    campaignDomains?: readonly string[];
  } = $props();
  let page = $state(1);
  const review = $derived(buildOperationsScopeReview(records, sourceState, campaignDomains));
  const pages = $derived(Math.max(1, Math.ceil(review.rows.length / 10)));
  const currentPage = $derived(Math.min(page, pages));
  const visible = $derived(review.rows.slice((currentPage - 1) * 10, currentPage * 10));
</script>

<details class="case-scope">
  <summary>Remaining incident objects and outcome scope · local view only</summary>
  {#if sourceState !== 'ready'}
    <p role="status">Case scope {sourceState === 'loading' ? 'is loading' : 'is unavailable'}. Object counts and outcomes are withheld.</p>
  {:else}
    <p>{review.rows.length} separate Cases · {review.openObjects} open incident links · {review.analystResolvedObjects} analyst-resolved links · {review.unknownObjectCoverage} exact objects with unknown action or observation coverage.</p>
    <p>{campaignDomains ? "Population: retained Cases matching this campaign's domains; same-domain incidents remain separate." : 'Population: all inspected retained Cases, independent of the action-report time window.'} Link counts are analyst metadata, not observed activity or removal.</p>
    {#if review.casesOmitted}<p>{review.casesOmitted} Cases outside the inspection cap. Counts and missing-member coverage are incomplete.</p>{/if}
    {#if review.missingDomains?.length}<details><summary>{review.missingDomains.length} campaign domain{review.missingDomains.length === 1 ? '' : 's'} without an inspected Case</summary><ul>{#each review.missingDomains as domain}<li><code>{domain}</code> · object coverage unavailable</li>{/each}</ul></details>{/if}
    {#if visible.length}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -- the named overflow region provides native keyboard access to all columns -->
      <div class="table-wrap" role="region" aria-label="Remaining Case object and outcome scope" tabindex="0"><table>
        <caption>Separate Case scope; no campaign elimination or response causation inferred</caption>
        <thead><tr><th scope="col">Case</th><th scope="col">Retained objects</th><th scope="col">Recorded provider outcome</th><th scope="col">Independent review and closure</th></tr></thead>
        <tbody>{#each visible as row (row.record.id)}<tr>
          <td><a href={caseWorkspaceHref(row.record.id, 'response')} aria-label={`${row.record.title || row.record.domain} · Case ${row.record.id}`}>{row.record.title || row.record.domain}</a><small>Case ID: {row.record.id}</small><small>{row.record.domain}</small>{#if row.historyIncomplete}<small>Retained lifecycle history is incomplete.</small>{/if}</td>
          <td>{row.openObjects} open · {row.analystResolvedObjects} analyst-resolved
            {#if !row.coverage.length}<small>No incident links retained; exact-object coverage unavailable.</small>{/if}
          </td>
          <td>{#if row.lifecycle.latestProviderOutcome}<span>{row.lifecycle.latestProviderOutcome.outcome.replaceAll('_', ' ')}</span><small>Source class: {row.providerEvent?.sourceClass ?? 'unknown'}</small><small>Event: {row.lifecycle.latestProviderOutcome.eventId}</small><time datetime={row.lifecycle.latestProviderOutcome.occurredAt}>{formatEvidenceDate(row.lifecycle.latestProviderOutcome.occurredAt)}</time>{:else}{row.lifecycle.providerOutcomeState === 'ambiguous' ? 'Ambiguous retained outcomes' : 'No typed provider outcome retained'}{/if}</td>
          <td>{#if row.latestReview}<span>{row.latestReview.state.replaceAll('_', ' ')}</span><small>{row.latestReview.sourceClass} · {row.latestReview.completeness}</small><small>Review: {row.latestReview.id}</small><time datetime={row.latestReview.observedAt}>{formatEvidenceDate(row.latestReview.observedAt)}</time>
              {#if row.latestReview.recheck}<small>Hostname scope: {row.latestReview.recheck.targetHostname}</small><small>Baseline reference: {row.latestReview.recheck.baselinePinId ?? 'none'} · {row.baselineRetained ? 'pin retained' : 'baseline unavailable'}</small><small>Condition comparison: {row.latestReview.recheck.conditionsMatch}</small><details><summary>Recorded recheck conditions</summary><p>{row.latestReview.recheck.question}</p><p>{row.latestReview.recheck.conditions}</p></details>{:else}<small>No structured comparison baseline or conditions retained.</small>{/if}
            {:else}{row.observedState === 'ambiguous' ? 'Ambiguous latest independent reviews' : 'No independent review retained'}{/if}
            {#if row.lifecycle.latestClosure}<small>Recorded closure: {row.lifecycle.latestClosure.reason.replaceAll('_', ' ')}</small><small>Closure ID: {row.lifecycle.latestClosure.id}</small><time datetime={row.lifecycle.latestClosure.createdAt}>Closure recorded: {formatEvidenceDate(row.lifecycle.latestClosure.createdAt)}</time>{/if}
          </td>
        </tr>
        {#if row.coverage.length}<tr class="object-details"><td colspan="4"><CaseIncidentCoverage record={row.record} /></td></tr>{/if}
        {/each}</tbody>
      </table></div>
      {#if pages > 1}<nav aria-label="Case outcome scope pages"><button class="btn" type="button" disabled={currentPage <= 1} onclick={() => page = currentPage - 1}>Previous Case scope</button><span>Page {currentPage} of {pages}</span><button class="btn" type="button" disabled={currentPage >= pages} onclick={() => page = currentPage + 1}>Next Case scope</button></nav>{/if}
    {:else}<p>No Cases in this inspected population; no resolution conclusion follows.</p>{/if}
    <details><summary>Dispute, restoration and recurrence coverage</summary><p>Explicit object event snapshots and independent reviews can retain dispute and restoration outcomes. Historical missing bindings remain unknown. A restored page, later change, review expiry or return to review does not establish malicious recurrence. Recurrence assessment remains unavailable without a comparable baseline for the same condition and object; procedural context stays separate.</p></details>
    <p>Provider assertions, independently stated object outcomes, non-reproduction under stated conditions and unavailable reviews are distinct. None establishes permanent removal, report causation or common ownership. These details stay in page memory and are excluded from aggregate JSON.</p>
  {/if}
</details>

<style>
  .case-scope{min-width:0;border-top:1px solid var(--border);padding-top:11px}summary{cursor:pointer;font-weight:650}p,li,td,th,small,time{font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}p{color:var(--muted);max-width:90ch}small,time{display:block;margin-top:4px}small{color:var(--muted)}.table-wrap{max-width:100%;overflow-x:auto}table{width:100%;table-layout:fixed;border-collapse:collapse}caption{text-align:left;padding:8px 0}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid var(--border)}nav{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}code{white-space:normal;overflow-wrap:anywhere}@media(max-width:650px){table{min-width:640px}}
</style>
