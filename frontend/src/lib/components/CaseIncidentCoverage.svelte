<script lang="ts">
  import type { CaseRecord } from '#lib/cases.ts';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import { buildCaseIncidentCoverage } from '../../../../packages/cases/case-workflow-metadata.mts';
  let { record }: { record: CaseRecord } = $props();
  const id = $props.id();
  let page = $state(1);
  let disclosures = $state<(HTMLDetailsElement | undefined)[]>([]);
  const rows = $derived(buildCaseIncidentCoverage(record));
  const pages = $derived(Math.max(1, Math.ceil(rows.length / 10)));
  const currentPage = $derived(Math.min(page, pages));
  const visible = $derived(rows.slice((currentPage - 1) * 10, currentPage * 10));

  function inspectResponse(index: number) {
    const disclosure = disclosures[index];
    if (!disclosure) return;
    disclosure.open = true;
    disclosure.querySelector('summary')?.focus();
  }
</script>

<details class="coverage">
  <summary>Exact incident-object coverage · {rows.length} retained objects</summary>
  {#if rows.length}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- the named overflow region provides native keyboard access to every column -->
    <div class="table-wrap" role="region" aria-label="Incident link coverage table" tabindex="0">
      <table>
        <caption
          >Explicit object identities and retained incident links, including analyst-resolved links</caption
        >
        <thead
          ><tr
            ><th scope="col">Exact object</th><th scope="col">Analyst scope</th><th scope="col"
              >Analyst metadata time</th
            ><th scope="col">Response coverage</th></tr
          ></thead
        >
        <tbody>
          {#each visible as row, index (JSON.stringify(row.responseObject))}
            <tr>
              <td
                ><code>{row.target.url}</code><small
                  >Type: {row.responseObject.kind.replaceAll('_', ' ')} · hostname: {row.hostname}</small
                ></td
              >
              <td
                >{row.targetRetained
                  ? row.target.state === 'resolved'
                    ? 'Analyst-resolved link'
                    : 'Open link'
                  : row.responseObject.incidentTargetId
                    ? 'Historical object · no matching current link'
                    : 'Domain or hostname scope'}</td
              >
              <td>
                {#if row.targetRetained}
                  <small
                    >Added: <time datetime={row.target.createdAt}
                      >{formatEvidenceDate(row.target.createdAt)}</time
                    ></small
                  >
                  <small
                    >Updated: <time datetime={row.target.updatedAt}
                      >{formatEvidenceDate(row.target.updatedAt)}</time
                    ></small
                  >
                {:else}<small
                    >No current incident-link metadata. Observation and event times remain separate.</small
                  >{/if}
              </td>
              <td>
                {row.actionCoverage === 'bound'
                  ? `${row.actionIds.length} explicitly bound action${row.actionIds.length === 1 ? '' : 's'}`
                  : 'Unknown action binding'}
                <small>Exact-object observation coverage {row.observationCoverage}</small>
                <small
                  >Response records: {row.providerEvents.length + row.unappliedProviderEvents.length} ·
                  independent reviews: {row.reviews.length}</small
                >
                <button
                  class="btn"
                  type="button"
                  aria-controls={`${id}-object-${index}`}
                  onclick={() => inspectResponse(index)}>Inspect response history</button
                >
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#each visible as row, index (`${record.id}:${JSON.stringify(row.responseObject)}`)}
      <details class="response-detail" id={`${id}-object-${index}`} bind:this={disclosures[index]}>
        <summary
          >Response history · {row.responseObject.kind.replaceAll('_', ' ')} · {row.target
            .url}</summary
        >
        {#if !row.responseContexts.length}<p
            >No action or recipient context retained for this exact object.</p
          >{/if}
        {#if row.responseContexts.length}<details
            ><summary>Action and recipient context · {row.responseContexts.length}</summary>
            <ul class="records" aria-label="Action and recipient records">
              {#each row.responseContexts as context (context.actionId)}<li
                  aria-label={`${context.recipient} · action ${context.actionId}`}
                >
                  <strong>{context.recipient} · {context.type.replaceAll('_', ' ')}</strong>
                  <small
                    >Current action: {context.currentState.replaceAll('_', ' ')} · {context.actionId}</small
                  >
                  <small
                    >{context.currentlyBound
                      ? 'Currently bound to this exact object'
                      : 'Historical events only; current action binding differs'}</small
                  >
                  <details
                    ><summary>Current recipient route</summary>
                    <small>Source: {context.contactSource}</small>
                    <small
                      >Route observed: {formatEvidenceDate(context.routeObservedAt)} · review after: {formatEvidenceDate(
                        context.routeReviewAfter,
                      )}</small
                    >
                    <small
                      >Metadata updated: {formatEvidenceDate(context.metadataUpdatedAt)}. This is
                      current route context, not a snapshot of the recipient at each earlier review.</small
                    >
                    {#each context.contactLimitations as limitation}<small>{limitation}</small
                      >{/each}
                  </details>
                  {#if context.reviewEvents.length}<details
                      ><summary
                        >Review and authorisation events · {context.reviewEvents.length}</summary
                      >
                      <ul class="records"
                        >{#each context.reviewEvents as event (event.id)}<li>
                            <small
                              >{event.nextState.replaceAll('_', ' ')} · {event.sourceClass} ·
                              <time datetime={event.occurredAt}
                                >{formatEvidenceDate(event.occurredAt)}</time
                              ></small
                            >
                            <small
                              >{event.applied
                                ? 'Applied to action history'
                                : 'Retained but not applied to current state'} · event {event.id}</small
                            >
                            <small
                              >{event.provenance}{event.reference
                                ? ` · ${event.reference}`
                                : ''}</small
                            >
                          </li>{/each}</ul
                      >
                    </details>{:else}<small
                      >No exact-object review or authorisation event retained.</small
                    >{/if}
                  {#if context.deliveryEvents.length}<details
                      ><summary>Recorded deliveries · {context.deliveryEvents.length}</summary>
                      <ul class="records"
                        >{#each context.deliveryEvents as event (event.id)}<li>
                            <small
                              >Analyst-recorded delivery: <time datetime={event.occurredAt}
                                >{formatEvidenceDate(event.occurredAt)}</time
                              >
                              · event {event.id}</small
                            >
                            <small
                              >{event.applied
                                ? 'Applied to action history'
                                : 'Retained but not applied to current state'} · {event.provenance}</small
                            >
                            {#if event.reference}<small>Reference: {event.reference}</small>{/if}
                            {#if event.packetReceipt}
                              <small
                                >Packet recipient: {event.packetReceipt.recipient} · audience
                                {event.packetReceipt.profile.replaceAll('_', ' ')}</small
                              >
                              <small
                                >Packet prepared: <time
                                  datetime={event.packetReceipt.packetGeneratedAt}
                                  >{formatEvidenceDate(event.packetReceipt.packetGeneratedAt)}</time
                                >
                                · format v{event.packetReceipt.packetVersion}</small
                              >
                              <small
                                >Canonical JSON SHA-256: <code
                                  >{event.packetReceipt.packetDigestSha256}</code
                                ></small
                              >
                            {:else}<small
                                >Exact packet identity, preparation time and historical recipient
                                are not retained in this delivery record.</small
                              >{/if}
                            {#each event.limitations as limitation}<small>{limitation}</small
                              >{/each}
                          </li>{/each}</ul
                      >
                    </details>{:else}<small
                      >No exact-object delivery event retained. A reviewed or authorised action does
                      not establish packet preparation or delivery.</small
                    >{/if}
                  {#if context.correction}<details
                      ><summary>Linked {context.correction.purpose.replaceAll('_', ' ')}</summary>
                      <small
                        >Original action: {context.correction.originActionId ?? 'unavailable'} · delivery
                        event: {context.correction.deliveryEventId}</small
                      >
                      <small
                        >Original packet format v{context.correction.packetVersion} · SHA-256
                        <code>{context.correction.packetDigestSha256}</code></small
                      >
                      <small
                        >{context.correction.linkAvailable
                          ? 'The original receipt matches the exact recipient, packet and affected object subset.'
                          : 'The exact original delivery linkage is unavailable; the retained reference does not establish a match.'}</small
                      >
                      <small
                        >The linked action has its own review and delivery history; the original is
                        not changed.</small
                      >
                    </details>{/if}
                  {#if context.historyOmitted || context.historyLimitations.length}<details
                      ><summary
                        >History limitations{context.historyOmitted
                          ? ` · ${context.historyOmitted} omitted events`
                          : ''}</summary
                      >{#each context.historyLimitations as limitation}<small>{limitation}</small
                        >{/each}</details
                    >{/if}
                </li>{/each}
            </ul>
          </details>{/if}
        {#if row.providerEvents.length}<details
            ><summary>Source-attributed response events · {row.providerEvents.length}</summary
            >{#each row.providerEvents as event}<small
                >{event.outcome?.replaceAll('_', ' ') ?? event.state} · {event.sourceClass} ·
                <time datetime={event.occurredAt}>{formatEvidenceDate(event.occurredAt)}</time>
                · action {event.actionId}</small
              >{/each}</details
          >{/if}
        {#if row.unappliedProviderEvents.length}<details
            ><summary>Other retained response events · {row.unappliedProviderEvents.length}</summary
            ><small
              >These competing events remain retained but are not applied to the current action
              state.</small
            >{#each row.unappliedProviderEvents as event}<small
                >{event.outcome?.replaceAll('_', ' ') ?? event.state} · {event.sourceClass} ·
                <time datetime={event.occurredAt}>{formatEvidenceDate(event.occurredAt)}</time>
                · action {event.actionId} · event {event.eventId}</small
              ><small>{event.provenance}{event.reference ? ` · ${event.reference}` : ''}</small
              >{/each}</details
          >{/if}
        {#if row.reviews.length}<details
            ><summary>Independent object reviews · {row.reviews.length}</summary
            >{#each row.reviews as review}<small
                >{review.state.replaceAll('_', ' ')}{review.objectOutcome
                  ? ` · ${review.objectOutcome}`
                  : ''} · {review.completeness} · {review.source} ·
                <time datetime={review.observedAt}>{formatEvidenceDate(review.observedAt)}</time
                ></small
              >{#if review.recheck}<small
                  >Conditions: {review.recheck.conditions} · {review.recheck.conditionsMatch} · baseline
                  {review.recheck.baselinePinId ?? 'not retained'}</small
                >{/if}{/each}</details
          >{/if}
        {#if row.closures.length}<details
            ><summary>Deliberate object closures · {row.closures.length}</summary
            >{#each row.closures as closure}<small
                >{closure.reason.replaceAll('_', ' ')} ·
                <time datetime={closure.createdAt}>{formatEvidenceDate(closure.createdAt)}</time>
                · {closure.summary}</small
              >{/each}</details
          >{/if}
      </details>
    {/each}
    {#if pages > 1}
      <nav aria-label="Incident coverage pages">
        <button
          class="btn"
          type="button"
          disabled={currentPage <= 1}
          onclick={() => (page = currentPage - 1)}>Previous links</button
        >
        <span>Page {currentPage} of {pages}</span>
        <button
          class="btn"
          type="button"
          disabled={currentPage >= pages}
          onclick={() => (page = currentPage + 1)}>Next links</button
        >
      </nav>
    {/if}
  {:else}<p>No exact incident objects retained.</p>{/if}
  <details>
    <summary>About this review</summary>
    <p
      >Each link is a separate analyst-associated object; a shared hostname or Case establishes
      neither ownership nor action binding. Added and updated times are metadata, not observation
      clocks. Only explicit event snapshots and exact-object reviews contribute to coverage. Packet
      preparation has no separate retained log: generation details are shown only where a delivery
      receipt retains them. A receipt identifies canonical packet JSON, not delivered message or PDF
      bytes, external acceptance or authorship. Provider claims remain distinct from independent
      observations; unavailable collection is not removal. Restoration or dispute does not establish
      malicious recurrence or report causation. Resolving one link leaves other objects and internal
      follow-ups independent.</p
    >
  </details>
</details>

<style>
  .coverage {
    min-width: 0;
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  summary {
    cursor: pointer;
    font-weight: 650;
  }
  p,
  small {
    color: var(--muted);
    font-size: var(--text-xs);
    line-height: 1.5;
  }
  p {
    max-width: 85ch;
  }
  small {
    display: block;
    margin-top: 4px;
  }
  .table-wrap {
    max-width: 100%;
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-xs);
    table-layout: fixed;
  }
  caption {
    text-align: left;
    padding: 8px 0;
    color: var(--muted);
  }
  th,
  td {
    text-align: left;
    vertical-align: top;
    padding: 9px;
    border-bottom: 1px solid var(--border);
    overflow-wrap: anywhere;
  }
  th:first-child {
    width: 35%;
  }
  code {
    white-space: normal;
    overflow-wrap: anywhere;
  }
  button {
    margin-top: 8px;
    white-space: normal;
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .response-detail {
    border-bottom: 1px solid var(--border);
    padding: 12px 0;
    overflow-wrap: anywhere;
  }
  .response-detail > summary {
    scroll-margin-top: 9rem;
  }
  .response-detail details {
    margin-top: 8px;
  }
  .records {
    list-style: none;
    margin: 8px 0;
    padding: 0;
  }
  .records > li + li {
    border-top: 1px solid var(--border);
    margin-top: 10px;
    padding-top: 10px;
  }
  @media (max-width: 600px) {
    table {
      min-width: 560px;
    }
  }
</style>
