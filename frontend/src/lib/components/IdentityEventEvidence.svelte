<script lang="ts">
  import { untrack } from 'svelte';
  import type { IdentityEventReview } from '../../../../packages/contracts/identity-events.mts';
  import { compareIdentityEvents } from '../../../../packages/investigation/identity-event-intake.mts';
  import Pagination from './Pagination.svelte';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';
  let { review, onchange, disabled = false, headingTag = 'h4' }: {
    review: IdentityEventReview; onchange: (review: IdentityEventReview) => void; disabled?: boolean; headingTag?: 'h3' | 'h4';
  } = $props();
  const initialScope = untrack(() => review.comparison?.scope);
  let applicationId = $state(initialScope?.applicationId ?? ''), tenantId = $state(initialScope?.tenantId ?? '');
  let actorLabel = $state(initialScope?.actorLabel ?? ''), startedAt = $state(initialScope?.startedAt ?? ''), endedAt = $state(initialScope?.endedAt ?? '');
  let page = $state(1), error = $state('');
  function changed() { error = ''; if (review.comparison) onchange({ ...review, comparison: null }); }
  function compare() {
    if (disabled) return;
    try { onchange(compareIdentityEvents(review, { applicationId, tenantId: tenantId || null, actorLabel: actorLabel || null, startedAt, endedAt })); error = ''; }
    catch { error = 'Enter an application ID and an ordered time interval with explicit timezones. Optional tenant and actor fields must use the retained identifiers.'; }
  }
</script>

<section class="identity-evidence" aria-label="Selected identity events">
  <svelte:element this={headingTag} class="heading">Selected identity events</svelte:element>
  <p>{review.provider === 'entra' ? 'Entra sign-in' : 'Okta System Log'} records: {review.events.length}{review.invalidEvents ? ` · Invalid records omitted: ${review.invalidEvents}` : ''}</p>
  <p>Actor labels link records within this file only. Reported success describes the event, not whether an account is safe or compromised.</p>
  <details><summary>Compare an application and time window</summary>
    <fieldset disabled={disabled}>
      <legend class="sr-only">Selected identity comparison</legend>
      <label>Application ID<input bind:value={applicationId} oninput={changed} maxlength="160" spellcheck="false" autocomplete="off"></label>
      <label>Resource tenant ID (optional)<input bind:value={tenantId} oninput={changed} maxlength="36" spellcheck="false" autocomplete="off"></label>
      <label>Actor in this file (optional)<input bind:value={actorLabel} oninput={changed} maxlength="11" placeholder="Actor 1" spellcheck="false" autocomplete="off"></label>
      <label>From (ISO time with timezone)<input bind:value={startedAt} oninput={changed} maxlength="64" placeholder="2026-01-01T00:00:00Z" spellcheck="false"></label>
      <label>Until (ISO time with timezone)<input bind:value={endedAt} oninput={changed} maxlength="64" placeholder="2026-01-01T01:00:00Z" spellcheck="false"></label>
      <button class="btn" type="button" onclick={compare}>Compare supplied fields</button>
    </fieldset>
    {#if error}<p role="alert">{error}</p>{/if}
    <p>Use an application ID from the link or incident you are reviewing. Matching fields corroborate only the selected scope; they do not establish who acted or why.</p>
  </details>
  {#if review.comparison}<p role="status">Exact scoped matches: {review.comparison.events.filter(event => event.state === 'matched').length} · Incomplete comparisons: {review.comparison.events.filter(event => event.state === 'incomplete').length}. Fields not selected were not compared.</p>{/if}
  <ol start={(page - 1) * 10 + 1}>{#each review.events.slice((page - 1) * 10, page * 10) as event (event.sequence)}
    {@const match = review.comparison?.events.find(value => value.sequence === event.sequence)}
    <li><strong>#{event.sequence} · {event.actorLabel ?? 'Actor unavailable'} · {event.kind.replaceAll('_', ' ')}</strong>
      <p><EvidenceTimestamp value={event.occurredAt} label="reported event time" /></p>
      <dl><div><dt>Applications</dt><dd>{event.applicationIds.join(', ') || 'Unavailable'}</dd></div><div><dt>Resource tenant</dt><dd>{event.tenantId ?? 'Unavailable'}</dd></div><div><dt>Protocol</dt><dd>{event.protocol.replaceAll('_', ' ')}</dd></div><div><dt>Reported result</dt><dd>{event.result}</dd></div></dl>
      {#if match}<p>Scoped comparison: {match.state} · Application: {match.application} · Tenant: {match.tenant.replaceAll('_', ' ')} · Actor: {match.actor.replaceAll('_', ' ')} · Time: {match.time}</p>{/if}
    </li>
  {/each}</ol>
  {#if review.events.length > 10}<Pagination currentPage={page} pageCount={Math.ceil(review.events.length / 10)} setPage={next => page = next} ariaLabel="Identity event pages" />{/if}
</section>

<style>
  .identity-evidence,fieldset{display:grid;gap:12px;min-width:0}.heading,p{margin:0}.heading{font-size:var(--text-sm)}p,li,dt,dd,label{font-size:var(--text-xs);line-height:1.6;overflow-wrap:anywhere}fieldset{border:0;padding:12px 0;margin:0}label{display:grid;gap:4px}input{min-width:0;max-width:100%;width:100%}button{justify-self:start;white-space:normal;max-width:100%}ol{display:grid;gap:14px;margin:0;padding-left:24px}li{border-top:1px solid var(--border);padding-top:10px}li>*+*{margin-top:8px}summary{cursor:pointer;min-height:32px;padding-block:6px}dl{display:grid;gap:4px;margin:8px 0}dl>div{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,3fr);gap:12px}dd{margin:0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}[role=alert]{color:var(--amber)}@media(max-width:480px){dl>div{grid-template-columns:1fr;gap:0}}
</style>
