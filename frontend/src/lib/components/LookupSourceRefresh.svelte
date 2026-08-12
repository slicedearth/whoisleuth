<script lang="ts">
  import {
    requestLookupSourceRefresh,
    mergeLookupSourceRefreshLedger,
    type LookupSourceRefreshLedger,
    type LookupSourceRefreshPlan,
    type LookupSourceRefreshPlanItem,
    type LookupSourceRefreshResult,
  } from '$lib/analysis/lookup-source-refresh.ts';

  let {
    plan,
    query,
    depth,
  }: {
    plan: LookupSourceRefreshPlan;
    query: string;
    depth: 'deep' | 'fast';
  } = $props();

  let active = $state('');
  let message = $state('');
  let ledger = $state<LookupSourceRefreshLedger | null>(null);
  const results = $derived(ledger?.entries || []);

  async function refresh(item: LookupSourceRefreshPlanItem) {
    if (active) return;
    active = item.id;
    message = '';
    const previous = [...results].reverse().find((result) => result.id === item.id);
    const outcome = await requestLookupSourceRefresh(item, query, depth, {
      supersedesObservedAt: previous?.observedAt || previous?.supersedesObservedAt || item.supersedesObservedAt,
    });
    if (outcome.ok) {
      ledger = mergeLookupSourceRefreshLedger(ledger, outcome.value);
      message = outcome.value.state === 'unavailable'
        ? `${item.label} was attempted in a separate versioned chain, but no new observation was recorded. The original Lookup evidence was not changed.`
        : `${item.label} refreshed in a separate versioned chain. The original Lookup evidence was not changed.`;
    } else {
      message = outcome.message;
    }
    active = '';
  }

  function formatted(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }
</script>

{#if plan.items.length}
  <section class="source-refresh" aria-labelledby="source-refresh-title">
    <div>
      <h5 id="source-refresh-title">Retry or refresh a source</h5>
      <p>{plan.stale && plan.ageDays !== null
        ? `This unified result is ${plan.ageDays} days old. Refreshes stay separate so observation times are not silently mixed.`
        : 'Only limited source families are offered. Refreshes stay separate so observation times are not silently mixed.'}</p>
    </div>
    <ul class="refresh-actions">
      {#each plan.items as item}
        <li>
          <span><strong>{item.label}</strong><small>{item.reason}{item.reason === 'stale' && item.ageDays !== null && item.ageDays !== undefined ? ` · ${item.ageDays}d / ${item.staleAfterDays}d` : ''}</small></span>
          <p>{item.requestDisclosure}</p>
          <button class="btn" type="button" onclick={() => refresh(item)} disabled={Boolean(active)}>
            {active === item.id ? 'Refreshing…' : `Refresh ${item.label}`}
          </button>
        </li>
      {/each}
    </ul>
    {#if results.length}
      <ul class="refresh-results" aria-label="Separate source refresh results">
        {#each results as result}
          <li>
            <span class={`state state-${result.state}`}>{result.state}</span>
            <p><strong>{result.id.replaceAll('_', ' ')}</strong> · {result.detail}</p>
            <small>{result.observedAt ? `Observed ${formatted(result.observedAt)}` : `Attempted ${formatted(result.attemptedAt)} · no new observation`} · supersedes {result.supersedesObservedAt ? formatted(result.supersedesObservedAt) : 'no earlier observation'} · transient only</small>
          </li>
        {/each}
      </ul>
    {/if}
    <p class="message refresh-status" role="status" aria-live="polite" aria-atomic="true">{message}</p>
    {#if ledger?.truncated}<p class="message">Older transient refresh entries were dropped at the local history bound.</p>{/if}
    <ul class="limitations">{#each plan.limitations as limitation}<li>{limitation}</li>{/each}</ul>
  </section>
{/if}

<style>
  .source-refresh{display:grid;gap:10px;margin-top:14px;padding-top:13px;border-top:1px solid var(--border)}
  h5{margin:0;font:700 var(--text-sm) var(--mono)}
  .source-refresh>div>p,.refresh-actions p,.message,.limitations,.refresh-results p,.refresh-results small{margin:4px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .refresh-actions,.refresh-results{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:0;padding:0;list-style:none}
  .refresh-actions li,.refresh-results li{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .refresh-actions span{display:flex;justify-content:space-between;gap:7px}
  .refresh-actions strong{font:700 var(--text-xs) var(--mono)}
  .refresh-actions small{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  .refresh-actions button{width:100%;margin-top:8px}
  .refresh-results{grid-template-columns:1fr}
  .refresh-results li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 8px}
  .refresh-results p{margin:0}
  .refresh-results small{grid-column:2}
  .state{align-self:start;padding:3px 6px;border:1px solid var(--border-strong);border-radius:999px;color:var(--text);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  .state-complete{color:var(--text)}
  .state-limited{border-color:var(--amber);border-style:dashed;color:var(--amber)}
  .state-unavailable{border-color:var(--muted);border-style:dotted;color:var(--muted)}
  .limitations{margin:0;padding-left:18px}
  .refresh-status:empty{min-height:0;margin:0}
  @media(max-width:760px){.refresh-actions{grid-template-columns:1fr}}
</style>
