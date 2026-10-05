<script lang="ts">
  import type { CaseRecord } from '#lib/cases.ts';
  import type { MessageIntakeResult } from '../../../../packages/contracts/message-intake.mts';
  import { MAX_RESPONSE_REFERENCE_LENGTH, MAX_RESPONSE_LABEL_LENGTH } from '../../../../packages/contracts/case-portability.mts';
  import { compareCaseIncomingNotice } from '../../../../packages/cases/case-response-actions.mts';
  import { caseIncidentTargets, caseTypeIds } from '../../../../packages/cases/case-workflow-metadata.mts';
  import { resolvePlatformReportingRoutes } from '../../../../packages/cases/platform-reporting-routes.mts';
  import { reviewClock } from '#lib/review-clock.ts';
  let { record, result }: { record: CaseRecord; result: MessageIntakeResult } = $props();
  let actionId = $state(''), reference = $state(''), organisation = $state(''), confirmed = $state(false), page = $state(1);
  const action = $derived(record.actions.find(value => value.id === actionId) ?? null);
  const review = $derived.by(() => {
    try { return compareCaseIncomingNotice(action, result.report, { reference, claimedOrganisation: organisation, confirmedOutOfBand: confirmed, now: new Date($reviewClock).toISOString() }); }
    catch { return { comparisons: [{ label: 'Notice fields', state: 'unknown' as const, explanation: 'Use bounded single-line comparison fields. No conclusion is available.' }], routeFreshness: 'unknown' as const, confirmation: 'not_reported' as const }; }
  });
  const pages = $derived(Math.max(1, Math.ceil(review.comparisons.length / 10)));
  const currentPage = $derived(Math.min(page, pages));
  const visible = $derived(review.comparisons.slice((currentPage - 1) * 10, currentPage * 10));
  const officialRoutes = $derived.by(() => {
    if (!action) return [];
    const routes = caseIncidentTargets(record, { includeResolved: true }).flatMap(target => resolvePlatformReportingRoutes(target.url, caseTypeIds(record), new Date($reviewClock)).routes);
    return routes.filter((route, index) => route.contact === action.recipient && routes.findIndex(other => other.id === route.id) === index);
  });
  function clearFields() { reference = ''; organisation = ''; confirmed = false; page = 1; }
</script>

<details class="notice">
  <summary>Compare an unexpected response notice locally</summary>
  <p>This comparison stays in page memory and is not included when saving the intake review. It does not authenticate a sender, confirm a provider outcome, close this Case or authorise disclosure.</p>
  <label>Recorded action<select bind:value={actionId} onchange={clearFields}><option value="">Choose an action</option>{#each record.actions as item (item.id)}<option value={item.id}>{item.type.replaceAll('_', ' ')} · {item.recipient} · {item.id}</option>{/each}</select></label>
  {#if action}
    <p>Retained recipient: {action.recipient}. Route source: {action.contactSource ?? 'Not retained'}. Route freshness: {review.routeFreshness}. Source text is not a trusted link or authenticated identity.</p>
    <label>Reference in the notice (optional, transient)<input bind:value={reference} maxlength={MAX_RESPONSE_REFERENCE_LENGTH} oninput={() => { confirmed = false; page = 1; }} autocomplete="off" spellcheck="false"></label>
    <label>Claimed organisation (optional, transient)<input bind:value={organisation} maxlength={MAX_RESPONSE_LABEL_LENGTH} oninput={() => confirmed = false} autocomplete="off"></label>
    <ul>{#each visible as comparison}<li><strong>{comparison.label} · {comparison.state}</strong><p>{comparison.explanation}</p></li>{/each}</ul>
    {#if pages > 1}<nav aria-label="Notice comparison pages"><button class="btn" type="button" disabled={currentPage <= 1} onclick={() => page = currentPage - 1}>Previous comparisons</button><span>Page {currentPage} of {pages}</span><button class="btn" type="button" disabled={currentPage >= pages} onclick={() => page = currentPage + 1}>Next comparisons</button></nav>{/if}
    <label class="confirmation"><input type="checkbox" bind:checked={confirmed}> I independently contacted a known official route out of band</label>
    <p>Confirmation: {review.confirmation === 'analyst_reported_out_of_band' ? 'Analyst-reported out-of-band contact, not independently verified here' : 'Not reported'}.</p>
    {#if officialRoutes.length}<p>Independently review a retained official catalogue route:</p><ul>{#each officialRoutes as route (route.id)}<li><a href={route.guidanceUrl} target="_blank" rel="noopener noreferrer">{route.platformLabel} · {route.label} official guidance<span class="sr-only"> (opens in a new tab)</span></a> · reviewed {route.reviewedAt}, review after {route.reviewAfter}</li>{/each}</ul>{:else}<p>No matching official catalogue route is retained here. Independently obtain a known official route; do not use the supplied notice link for confirmation.</p>{/if}
    <p>Do not open supplied attachments, provide credentials or accept payment instructions. From and Reply-To domains are shown separately; exact sender addresses and message subjects are not retained. {result.report.coverage.state === 'partial' ? 'Input review is partial; missing context remains unknown.' : ''}</p>
  {/if}
</details>

<style>
  .notice{min-width:0;border-top:1px solid var(--border);padding-top:12px}summary{cursor:pointer;font-weight:650}label{display:grid;gap:5px;margin-top:10px}input,select{width:100%;min-width:0}p,li,label{font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}p{max-width:85ch;color:var(--muted)}ul{padding-left:20px}.confirmation{display:flex;align-items:start;gap:8px}.confirmation input{width:auto;flex:none}nav{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
</style>
