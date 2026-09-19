<script lang="ts">
  import { caseLookupTarget, type CaseRecord } from '$lib/cases';
  import { caseResponseQueue } from '../../../../packages/cases/case-response-queue.mts';
  import { evidenceTime } from '$lib/analysis/evidence-time.ts';
  import { reviewClock } from '$lib/review-clock.ts';
  let { record, mutationBusy, onaction, onrecheck }: {
    record: CaseRecord;
    mutationBusy: boolean;
    onaction: (id: string) => void | Promise<void>;
    onrecheck: (id: string) => void | Promise<void>;
  } = $props();
  let completed = $state(false);
  const queue = $derived(caseResponseQueue(record, new Date($reviewClock).toISOString()));
  const actions = $derived(queue.actions.filter(item => completed || item.action.state !== 'terminal'));
  const finished = $derived(queue.actions.length - queue.actions.filter(item => item.action.state !== 'terminal').length);
  const time = (value: string | null) => evidenceTime(value)?.readable ?? 'Time unavailable';
</script>

<section class="response-queue" aria-labelledby={`response-queue-${record.id}`}>
  <h3 id={`response-queue-${record.id}`}>Response and rechecks</h3>
  <p>Provider replies and independent observations are separate records.</p>
  {#if finished}<label class="finished"><input type="checkbox" bind:checked={completed}>Include completed actions · {finished}</label>{/if}
  <ul class="queue-list" aria-label="Response follow-up queue">
    {#each actions as item (item.action.id)}
      <li>
        <div class="row-title"><strong>{item.action.recipient}</strong><span>{item.action.state.replaceAll('_', ' ')}</span></div>
        <p>{item.action.type.replaceAll('_', ' ')} · route {item.routeFreshness}</p>
        <small>{item.action.contactSource} · observed {time(item.action.routeObservedAt)} · review after {item.action.routeReviewAfter ? time(item.action.routeReviewAfter) : 'not recorded'}</small>
        <div class="dates">
          {#if item.due.at}<span>Action due: {time(item.due.at)} · {item.due.due === null ? 'Clock unavailable' : item.due.due ? 'Due now' : 'Upcoming'}</span>{/if}
          {#if item.followUp.at}<span>Follow-up: {time(item.followUp.at)} · {item.followUp.due === null ? 'Clock unavailable' : item.followUp.due ? 'Due now' : 'Upcoming'}</span>{/if}
          {#if !item.due.at && !item.followUp.at}<span>No dated follow-up</span>{/if}
        </div>
        {#if item.action.reference}<p>Reference: {item.action.reference}</p>{/if}
        {#if item.action.providerOutcome}<p>Provider outcome: {item.action.providerOutcome.replaceAll('_', ' ')}{item.action.outcome ? ` · ${item.action.outcome}` : ''}</p>{/if}
        {#if item.latestEvent.latest.length || item.latestEvent.undated.length}
          <details><summary>Latest applied events · {item.latestEvent.latest.length + item.latestEvent.undated.length}</summary>
            <ol>{#each [...item.latestEvent.latest, ...item.latestEvent.undated] as event (event.id)}<li>{event.nextState.replaceAll('_', ' ')} · {event.sourceClass} · {time(event.occurredAt)}{#if event.reference}<p>{event.reference}</p>{/if}</li>{/each}</ol>
          </details>
        {/if}
        <button class="btn small" type="button" disabled={mutationBusy} onclick={() => void onaction(item.action.id)} aria-label={`Review action: ${item.action.recipient}`}>Review action and receipt</button>
      </li>
    {:else}<li>No open response action.</li>{/each}
  </ul>
  <div class="recheck-grid">
    <section aria-label="Latest independent observations">
      <h4>Latest independent observations</h4>
      {#each [...queue.independentReviews.latest, ...queue.independentReviews.undated] as review (review.id)}
        <article><strong>{review.state.replaceAll('_', ' ')}</strong><p>{review.source} · {review.sourceClass} · {review.completeness}</p><small>{time(review.observedAt)}</small>{#if review.limitations.length}<p>{review.limitations.join(' ')}</p>{/if}</article>
      {:else}<p>No independent recheck recorded.</p>{/each}
      <button class="btn small" type="button" disabled={mutationBusy} onclick={() => void onrecheck('')}>Record an independent recheck</button>
      <a class="btn small" href={`/lookup?q=${encodeURIComponent(caseLookupTarget(record))}&case=${encodeURIComponent(record.id)}`}>Prepare recheck for {caseLookupTarget(record)}</a>
    </section>
    {#if queue.questions.length}<section aria-label="Open recheck questions">
      <h4>Open recheck questions</h4>
      {#each queue.questions as item (item.question.id)}
        <article><strong>{item.question.statement}</strong><p>{item.question.recheck!.targetHostname} · {item.question.recheck!.conditions}</p>
          {#each [...item.latest.latest, ...item.latest.undated] as answer (answer.id)}<small>Recorded answer: {answer.state.replaceAll('_', ' ')} · {answer.completeness} · {time(answer.observedAt)}</small>{:else}<small>No answer recorded</small>{/each}
          <button class="btn small" type="button" disabled={mutationBusy} onclick={() => void onrecheck(item.question.id)} aria-label={`Review question: ${item.question.statement}`}>Review question and answers · {item.answers.length}</button>
        </article>
      {/each}
    </section>{/if}
  </div>
</section>

<style>
  .response-queue{display:grid;gap:12px;padding:var(--card-pad);border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);min-width:0}
  h3,h4,p{margin:0}h4{font-size:var(--text-sm)}p,small,li{overflow-wrap:anywhere}p,li{font-size:var(--text-xs);line-height:1.55}small{color:var(--muted)}
  .queue-list{list-style:none;padding:0;margin:0;display:grid;gap:12px}.queue-list>li{display:grid;gap:6px;padding-block:10px;border-bottom:1px solid var(--border);min-width:0}
  .row-title{display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap}.dates{display:grid;gap:4px}.finished{display:flex;align-items:center;gap:8px;min-height:44px;font-size:var(--text-xs)}
  .recheck-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}section,article{min-width:0}article,.recheck-grid>section{display:grid;gap:8px}.btn{justify-self:start}summary{cursor:pointer;min-height:32px;align-content:center}
  @media(max-width:700px){.recheck-grid{grid-template-columns:1fr}}
</style>
