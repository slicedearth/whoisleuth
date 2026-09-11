<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { getCase, dispositionLabel, statusLabel } from '$lib/cases';
  import { formattedCaseNumber } from '../../../../packages/cases/case-workflow-metadata.mts';
  import { caseWorkspaceContext } from '$lib/analysis/case-workspace-context';
  import { selectConsoleCase } from '$lib/console-workflow-state';
  import { subscribeBrowserLocalData } from '$lib/browser-local-data-service';
  import { createSelectedCaseContextReader, type SelectedCaseContextState } from '$lib/controllers/selected-case-context';
  import { monitorViewFromUrl } from '$lib/controllers/monitor-route-controller';

  let { caseId }: { caseId: string } = $props();
  let contextState = $state<SelectedCaseContextState | null>(null);
  let open = $state(false);
  let mounted = false;
  const record = $derived(contextState?.id === caseId && (contextState.phase === 'ready' || contextState.phase === 'loading') ? contextState.record : null);
  const context = $derived(record ? caseWorkspaceContext(record) : null);
  const href = $derived(`/cases?case=${encodeURIComponent(caseId)}`);
  const insideCaseEditor = $derived(page.url.pathname === '/cases' || (page.url.pathname === '/monitor' && monitorViewFromUrl(page.url) === 'cases'));
  const reader = createSelectedCaseContextReader({
    selectedId: () => caseId,
    read: getCase,
    publish: (next) => { contextState = next; },
  });

  function date(value: string | null) { return value ? new Date(value).toLocaleString() : 'Observation time unavailable'; }
  function requestRefresh() {
    if (insideCaseEditor || document.visibilityState === 'hidden') return;
    void reader.refresh();
  }
  async function clearSelection() {
    selectConsoleCase(null);
    await tick();
    document.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true });
  }
  $effect(() => {
    caseId;
    insideCaseEditor;
    if (mounted) requestRefresh();
  });
  onMount(() => {
    mounted = true;
    requestRefresh();
    const unsubscribe = subscribeBrowserLocalData('cases', requestRefresh);
    const onFocus = () => requestRefresh();
    const onVisibility = () => { if (document.visibilityState === 'visible') requestRefresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted = false;
      reader.stop();
      unsubscribe();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });
</script>

{#if !insideCaseEditor}
<section class="selected-case" aria-label="Selected Case" aria-busy={!contextState || contextState.phase === 'loading'}>
  {#if record && context}
    <div class="context-heading">
      <span><span class="context-label">Selected Case</span><a href={href}>{record.domain}</a></span>
      <span class="context-state">{statusLabel(record.status)} · Analyst: {dispositionLabel(record.disposition)}</span>
      <button class="btn" type="button" aria-label="Clear Case selection" onclick={clearSelection}>Clear</button>
    </div>
    <details bind:open>
      <summary>Evidence and response context</summary>
      {#if open}
        <p class="case-reference">{formattedCaseNumber(record.id)}</p>
        <div class="context-sections">
          <section aria-label="Case hypotheses">
            <h2>Open hypotheses ({context.hypotheses.length})</h2>
            {#if context.hypotheses.length}<ul>{#each context.hypotheses as hypothesis}<li><p>{hypothesis.statement}</p>{#if hypothesis.rationale}<p class="muted">{hypothesis.rationale}</p>{/if}<small>{hypothesis.evidencePinIds.length} linked evidence {hypothesis.evidencePinIds.length === 1 ? 'pin' : 'pins'}</small></li>{/each}</ul>{:else}<p>No open hypothesis recorded.</p>{/if}
          </section>
          <section aria-label="Case decisions">
            <h2>Analyst decision</h2>
            {#if context.decisions.length}
              {#if context.decisions.length > 1}<p>Multiple decisions share the latest recorded time or have no usable time. None is selected as authoritative.</p>{/if}
              {#each context.decisions as decision}<article><h3>{decision.summary}</h3><p>{decision.rationale}</p><small>Confidence: {decision.confidence}{#if decision.confidenceBasis} · {decision.confidenceBasis}{/if}</small></article>{/each}
              {#if context.earlierDecisions}<a href={`${href}#case-response-${encodeURIComponent(caseId)}`}>Review all {record.decisions.length} recorded decisions</a>{/if}
            {:else}<p>No evidence-linked decision recorded.</p>{/if}
          </section>
          <section aria-label="Case evidence pins">
            <h2>Selected evidence ({record.evidencePins.length} {record.evidencePins.length === 1 ? 'pin' : 'pins'})</h2>
            {#if record.evidencePins.length}<ul>{#each record.evidencePins as pin}<li><strong>{pin.label}</strong><p>{pin.value}</p><small>{pin.source} · {pin.sourceState ?? 'State unknown'} · {pin.completeness} · {date(pin.observedAt)}</small>{#if pin.limitations.length}<ul>{#each pin.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}</li>{/each}</ul>{:else}<p>No evidence pins retained.</p>{/if}
          </section>
          <section aria-label="Case report history">
            <h2>Response history ({record.actions.length} {record.actions.length === 1 ? 'action' : 'actions'})</h2>
            {#if record.actions.length}<ul>{#each record.actions as action}<li><strong>{action.recipient}</strong><p>{action.type.replaceAll('_', ' ')} · {action.state.replaceAll('_', ' ')}</p>{#if action.reference}<p>Reference: {action.reference}</p>{/if}{#if action.providerOutcome}<p>Provider-reported outcome: {action.providerOutcome.replaceAll('_', ' ')}</p>{/if}{#if action.outcome}<p>{action.outcome}</p>{/if}<small>{action.history.length} retained transition records{#if action.historyOmitted} · {action.historyOmitted} omitted{/if}</small>{#each action.historyLimitations as limitation}<p class="muted">{limitation}</p>{/each}</li>{/each}</ul>{:else}<p>No response action recorded.</p>{/if}
            <a href={`${href}#case-response-${encodeURIComponent(caseId)}`}>Open response records and independent rechecks</a>
          </section>
          <section aria-label="Case follow-up dates">
            <h2>Recorded follow-ups</h2>
            {#if context.followUps.length}<ul>{#each context.followUps as followUp}<li>{followUp.label} · <time datetime={followUp.at}>{date(followUp.at)}</time></li>{/each}</ul>{:else}<p>No active follow-up date recorded.</p>{/if}
          </section>
        </div>
      {/if}
    </details>
    {#if context.followUps[0]}<p class="next-review">Earliest recorded follow-up: <time datetime={context.followUps[0].at}>{date(context.followUps[0].at)}</time></p>{/if}
    {#if contextState?.phase === 'loading'}<p class="next-review" role="status">Refreshing retained Case context…</p>{/if}
  {:else}
    <div class="context-heading"><span class="context-label">Selected Case</span><button class="btn" type="button" onclick={clearSelection}>Clear selection</button></div>
    {#if contextState?.phase === 'missing'}<p role="status">The selected Case is no longer in this browser workspace.</p><a href="/cases">Choose a Case</a>
    {:else if contextState?.phase === 'unavailable'}<p role="status">The selected Case could not be read. Its saved state is unknown.</p><button class="btn" type="button" onclick={requestRefresh}>Retry Case read</button>
    {:else}<p role="status">Reading selected Case…</p>{/if}
  {/if}
</section>
{/if}

<style>
  .selected-case{min-width:0;margin:0 0 20px;padding:12px 0;border-bottom:1px solid var(--border);font-size:var(--text-sm);overflow-wrap:anywhere}
  .context-heading{display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap}
  .context-heading>span:first-child{display:flex;gap:6px 12px;flex-wrap:wrap;min-width:0}
  .context-label{color:var(--muted);font-weight:650}
  .context-heading a{font-weight:700}
  .context-heading .btn{margin-left:auto;min-height:44px}
  .context-state{color:var(--text)}
  details{margin-top:8px}
  summary{padding:8px 0;cursor:pointer;font:inherit}
  .case-reference{font-family:var(--mono);font-size:var(--text-xs);color:var(--muted)}
  .context-sections{max-width:80ch;display:grid;gap:16px;padding:8px 0}
  .context-sections section{min-width:0}
  .context-sections h2{margin:0 0 8px;font-size:var(--text-lg)}
  .context-sections h3{margin:8px 0;font-size:var(--text-sm)}
  .context-sections ul{padding-left:20px;margin:8px 0}
  .context-sections li+li,.context-sections article+article{margin-top:12px}
  .context-sections p{margin:6px 0}
  .context-sections small{font-size:var(--text-xs);color:var(--muted)}
  .next-review{margin:0;color:var(--muted);font-size:var(--text-xs)}
  @media(max-width:600px){.context-heading{align-items:flex-start}.context-state{flex-basis:100%;order:3}.context-heading .btn{margin-left:0}.context-heading>span:first-child{flex:1 1 140px}}
</style>
