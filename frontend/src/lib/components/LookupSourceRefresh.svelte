<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import {
    requestLookupSourceRefresh, mergeLookupSourceRefreshLedger, MAX_LOOKUP_SOURCE_REFRESH_HISTORY,
    type LookupSourceRefreshLedger, type LookupSourceRefreshPlan, type LookupSourceRefreshPlanItem,
    type LookupSourceRefreshResult, type SourceRefreshCaseTarget,
  } from '$lib/analysis/lookup-source-refresh.ts';
  import { originalSourceRefreshFacts, sourceRefreshTarget } from '$lib/analysis/lookup-source-observation.ts';
  import { compareCheckpointFacts } from '$lib/analysis/case-evidence-checkpoint.ts';
  import type { LookupHttpResponse } from '$lib/analysis/lookup-response.ts';
  import { downloadLocalFile } from '$lib/download-local-file.ts';
  import LookupSourceCheckpoint from './LookupSourceCheckpoint.svelte';

  let { plan, original, depth, ledger, onledgerchange, caseTarget }: {
    plan: LookupSourceRefreshPlan;
    original: LookupHttpResponse;
    depth: 'deep' | 'fast';
    ledger: LookupSourceRefreshLedger | null;
    onledgerchange: (value: LookupSourceRefreshLedger) => void;
    caseTarget: SourceRefreshCaseTarget;
  } = $props();
  const headingId = $props.id();
  let active = $state('');
  let message = $state('');
  let baseline = $state<'original' | 'previous'>('original');
  let request: AbortController | null = null;
  let cancelledFromControl = false;
  const results = $derived(ledger?.entries ?? []);
  const full = $derived(results.length >= MAX_LOOKUP_SOURCE_REFRESH_HISTORY);

  $effect(() => {
    original;
    return () => { request?.abort(); request = null; active = ''; };
  });
  onDestroy(() => request?.abort());

  function blocked(item: LookupSourceRefreshPlanItem): string {
    try { sourceRefreshTarget(item.id, original); return ''; }
    catch (cause) { return cause instanceof Error ? cause.message : 'The source target is unavailable.'; }
  }
  async function refresh(item: LookupSourceRefreshPlanItem, trigger: HTMLButtonElement) {
    if (active || full || blocked(item)) return;
    const selectedOriginal = original;
    const controller = new AbortController();
    request = controller;
    cancelledFromControl = false;
    active = item.id;
    message = '';
    const outcome = await requestLookupSourceRefresh(item, selectedOriginal, depth, {
      signal: controller.signal,
    });
    if (controller !== request || selectedOriginal !== original) return;
    if (outcome.ok) {
      onledgerchange(mergeLookupSourceRefreshLedger(ledger, outcome.value));
      message = outcome.value.state === 'unavailable'
        ? 'No new source observation was retained. The original Lookup is unchanged.'
        : 'Refreshed facts are ready to compare. The original Lookup is unchanged.';
    } else message = outcome.message;
    active = '';
    request = null;
    await tick();
    if (cancelledFromControl && selectedOriginal === original) trigger.focus();
  }
  function comparisonInput(result: LookupSourceRefreshResult, index: number) {
    const previous = baseline === 'previous'
      ? results.slice(0, index).reverse().find(entry => entry.id === result.id && entry.facts.length) : null;
    return { label: previous ? 'refresh ' + (results.indexOf(previous) + 1) : 'the original Lookup',
      facts: previous?.facts ?? originalSourceRefreshFacts(result.id, original, depth) };
  }
  function comparisons(result: LookupSourceRefreshResult, index: number) {
    return compareCheckpointFacts(comparisonInput(result, index).facts, result.facts)
      .filter(row => row.before !== 'Not recorded' || row.after !== null);
  }
  function download(result: LookupSourceRefreshResult, index: number) {
    const rows = comparisons(result, index);
    const content = [
      'Source refresh review', 'Target: ' + sourceRefreshTarget(result.id, original),
      'Source: ' + result.id, 'Request time: ' + result.attemptedAt,
      'Compared with: ' + comparisonInput(result, index).label,
      'Result: ' + result.state, result.detail,
      ...rows.flatMap(row => ['', row.label + ': ' + row.state.replaceAll('_', ' '),
        'Before: ' + row.before, 'After: ' + (row.after ?? 'Not recorded'),
        'Source: ' + row.source, 'Observed: ' + (row.observedAt ?? 'Unknown'), ...row.limitations]),
      '', 'This readable review does not replace or authenticate the original evidence.',
    ].join('\n');
    downloadLocalFile(new Blob([content], { type: 'text/plain;charset=utf-8' }), 'source-refresh-review.txt');
    message = 'Prepared a readable source review. Review the file before sharing.';
  }
  function remove(index: number) {
    if (active || !ledger) return;
    onledgerchange({ ...ledger, entries: results.filter((_, entryIndex) => entryIndex !== index) });
    message = 'Removed this transient review. Any facts already saved in a Case are unchanged.';
  }
</script>

{#if plan.items.length}
  <section class="source-refresh" aria-labelledby={headingId}>
    <header>
      <h5 id={headingId}>Retry or refresh a source</h5>
      <p>Compare a source with the original result or its previous refresh. Saving selected facts never rewrites the original Lookup.</p>
    </header>
    <ul class="refresh-actions">
      {#each plan.items as item}
        <li>
          <strong>{item.label}</strong>
          <p>{item.requestDisclosure}</p>
          {#if blocked(item)}<p>{blocked(item)}</p>{/if}
          <button class="btn" type="button" onclick={event => void refresh(item, event.currentTarget)} disabled={Boolean(active) || full || Boolean(blocked(item))}>
            {active === item.id ? 'Refreshing…' : 'Refresh ' + item.label}
          </button>
        </li>
      {/each}
    </ul>
    {#if active}<button class="btn cancel" type="button" onclick={() => {cancelledFromControl = true;request?.abort();}}>Cancel source refresh</button>{/if}
    {#if full}<p>The review holds {MAX_LOOKUP_SOURCE_REFRESH_HISTORY} refreshes. Save or download anything needed, then remove a reviewed entry before another request.</p>{/if}
    {#if results.length}
      <label class="baseline">Compare with
        <select bind:value={baseline}>
          <option value="original">Original Lookup</option>
          <option value="previous">Previous refresh of this source</option>
        </select>
      </label>
      <ol class="refresh-results" aria-label="Separate source refresh results">
        {#each results as result, index (result)}
          <li>
            <details open={index === results.length - 1}>
              <summary><strong>{plan.items.find(item => item.id === result.id)?.label ?? result.id}</strong> · {result.state} · request {index + 1}</summary>
              <p>{result.detail}</p>
              <p>Compared with {comparisonInput(result, index).label}.</p>
              <p>Requested <time datetime={result.attemptedAt}>{result.attemptedAt}</time>. Each fact retains its source time; cached data may be older than this request.</p>
              {#if result.facts.length}
                <div class="comparison-grid independent-grid">
                  {#each comparisons(result, index) as row (row.field)}
                    <article data-state={row.state}>
                      <header><strong>{row.label}</strong><span>{row.state.replaceAll('_', ' ')}</span></header>
                      <dl><div><dt>Before</dt><dd>{row.before}</dd></div><div><dt>Refreshed</dt><dd>{row.after ?? 'Not recorded'}</dd></div></dl>
                      <small>{row.source} · {row.observedAt ?? 'Observation time unknown'}</small>
                      {#if row.state === 'incomparable'}<p>{row.limitations[0]}</p>{/if}
                    </article>
                  {/each}
                </div>
                {#if original.type === 'domain'}
                  <LookupSourceCheckpoint label={plan.items.find(item => item.id === result.id)?.label ?? 'Source'} facts={result.facts}
                    record={caseTarget.record} ready={caseTarget.ready} busy={caseTarget.busy} status={caseTarget.status}
                    oncreate={caseTarget.oncreate} onsave={fields => caseTarget.onsave(result.facts, fields)} />
                {/if}
              {/if}
              <div class="review-actions">
                <button class="btn" type="button" onclick={() => download(result, index)}>Download readable refresh review</button>
                <button class="btn" type="button" disabled={Boolean(active)} onclick={() => remove(index)}>Remove transient refresh {index + 1}</button>
              </div>
            </details>
          </li>
        {/each}
      </ol>
    {/if}
    <p class="refresh-status" role="status" aria-live="polite" aria-atomic="true">{message}</p>
    <details class="limits"><summary>Source refresh boundaries</summary>
      <ul>{#each plan.limitations as limitation}<li>{limitation}</li>{/each}</ul>
    </details>
  </section>
{/if}

<style>
  .source-refresh{display:grid;gap:12px;margin-top:14px;padding-top:13px;border-top:1px solid var(--border);min-width:0}
  h5{margin:0;font:700 var(--text-sm) var(--mono)}
  p,small,.limits{color:var(--muted);font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}
  p{margin:6px 0}small{font-size:var(--text-2xs)}
  .refresh-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:start;gap:8px;margin:0;padding:0;list-style:none}
  .refresh-actions li,.refresh-results>li{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .refresh-actions strong{font:700 var(--text-xs) var(--mono)}
  .refresh-actions button{width:100%;margin-top:8px}
  .cancel{justify-self:start}
  .baseline{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:var(--text-xs)}
  .baseline select{min-width:0;max-width:100%}
  .refresh-results{display:grid;gap:8px;margin:0;padding:0;list-style:none}
  summary{padding:6px 0;font-size:var(--text-xs);overflow-wrap:anywhere}
  .comparison-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}
  article{min-width:0;padding:10px;background:var(--panel-raised);border:1px solid var(--border);border-radius:var(--radius-sm)}
  article header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-size:var(--text-xs)}
  article header span{color:var(--muted)}
  article[data-state="changed"]{border-inline-start:3px solid var(--amber)}
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:10px 0}
  dl div{min-width:0}dt{color:var(--muted);font-size:var(--text-2xs)}dd{margin:3px 0 0;font-size:var(--text-xs);overflow-wrap:anywhere}
  .review-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .refresh-status:empty{margin:0}
  @media(max-width:760px){.refresh-actions,.comparison-grid{grid-template-columns:1fr}}
  @media(max-width:390px){dl{grid-template-columns:1fr}}
</style>
