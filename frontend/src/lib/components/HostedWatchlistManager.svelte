<script lang="ts">
  import { onMount } from 'svelte';
  import {
    fetchScheduledMonitoring,
    mutateScheduledMonitoring,
    type ScheduledMonitoringCommand,
    type ScheduledMonitoringResponse,
    type ScheduledWatchlist,
  } from '$lib/scheduled-monitoring';
  import type { Capability } from '$lib/capabilities';
  import type { WatchlistEntry, Watchlists } from '$lib/watchlists';

  let {
    capability,
    localWatchlists,
    localNames,
    restoreHosted,
    formatDate,
  }: {
    capability: Capability | null;
    localWatchlists: Watchlists;
    localNames: string[];
    restoreHosted: (name: string, entry: WatchlistEntry) => void;
    formatDate: (value: string) => string;
  } = $props();

  let response = $state<ScheduledMonitoringResponse | null>(null);
  let selectedLocal = $state('');
  let intervalHours = $state(24);
  let loading = $state(false);
  let busy = $state(false);
  let loaded = $state(false);
  let mounted = $state(false);
  let autoRequested = $state(false);
  let message = $state('');
  let error = $state('');
  const hosted = $derived(response?.state.watchlists || []);
  const selectedEntry = $derived(selectedLocal ? localWatchlists[selectedLocal] || null : null);
  const selectedHosted = $derived(selectedLocal
    ? hosted.find((item) => item.name.toLowerCase() === selectedLocal.toLowerCase()) || null
    : null);

  onMount(() => { mounted = true; });
  $effect(() => {
    if (mounted && capability?.status === 'supported' && !autoRequested) {
      autoRequested = true;
      void refresh();
    }
  });
  $effect(() => {
    if (selectedHosted) intervalHours = selectedHosted.intervalHours;
  });

  function localNameFor(name: string) {
    return localNames.find((candidate) => candidate.toLowerCase() === name.toLowerCase()) || null;
  }

  function localEntryFor(name: string) {
    const localName = localNameFor(name);
    return localName ? localWatchlists[localName] || null : null;
  }

  async function refresh() {
    if (capability?.status !== 'supported' || loading) return;
    loading = true;
    error = '';
    try {
      response = await fetchScheduledMonitoring();
      loaded = true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not load hosted monitoring.';
    } finally {
      loading = false;
    }
  }

  async function execute(command: ScheduledMonitoringCommand, success: string) {
    if (busy) return;
    busy = true;
    error = '';
    message = '';
    try {
      response = await mutateScheduledMonitoring(command);
      loaded = true;
      message = success;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not update hosted monitoring.';
    } finally {
      busy = false;
    }
  }

  async function scheduleSelected() {
    if (!selectedLocal || !selectedEntry) {
      error = 'Choose a browser-local watchlist to schedule.';
      return;
    }
    if (selectedHosted) {
      if (!confirm(`Replace the hosted snapshot for "${selectedHosted.name}" with the current browser-local watchlist?`)) return;
      await execute({
        action: 'update',
        id: selectedHosted.id,
        entry: selectedEntry,
        intervalHours,
      }, `Updated the hosted snapshot for "${selectedHosted.name}".`);
      return;
    }
    await execute({
      action: 'create',
      name: selectedLocal,
      entry: selectedEntry,
      intervalHours,
    }, `Scheduled "${selectedLocal}" for hosted monitoring.`);
  }

  async function toggle(item: ScheduledWatchlist) {
    await execute({ action: 'update', id: item.id, enabled: !item.enabled },
      `${item.enabled ? 'Paused' : 'Resumed'} hosted monitoring for "${item.name}".`);
  }

  async function replace(item: ScheduledWatchlist) {
    const local = localEntryFor(item.name);
    if (!local) return;
    if (!confirm(`Replace the hosted snapshot for "${item.name}" with the current browser-local watchlist?`)) return;
    await execute({ action: 'update', id: item.id, entry: local },
      `Updated the hosted snapshot for "${item.name}".`);
  }

  function restore(item: ScheduledWatchlist) {
    const existing = Boolean(localEntryFor(item.name));
    const prompt = existing
      ? `Replace the browser-local watchlist "${item.name}" with the hosted snapshot?`
      : `Restore the hosted snapshot "${item.name}" into this browser?`;
    if (!confirm(prompt)) return;
    try {
      restoreHosted(item.name, item.entry);
      message = `${existing ? 'Replaced' : 'Restored'} the browser-local watchlist "${item.name}".`;
      error = '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not restore the hosted snapshot.';
    }
  }

  async function remove(item: ScheduledWatchlist) {
    if (!confirm(`Delete the hosted copy of "${item.name}" and its hosted history? The browser-local watchlist is not deleted.`)) return;
    await execute({ action: 'delete', id: item.id }, `Deleted the hosted copy of "${item.name}".`);
  }

  function statusLabel(value: string) {
    const label = value.replace(/_/gu, ' ');
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
</script>

<section class="hosted card" aria-labelledby="hosted-monitoring-title">
  <header class="section-head">
    <div>
      <p class="eyebrow">Optional hosted monitoring</p>
      <h2 id="hosted-monitoring-title">Scheduled watchlists</h2>
      <p>Ordinary watchlists stay in this browser. Only a watchlist you schedule here is copied as compact encrypted evidence to the hosted store.</p>
    </div>
    {#if capability?.status === 'supported'}
      <button class="btn" onclick={refresh} disabled={loading || busy}>{loading ? 'Refreshing…' : 'Refresh'}</button>
    {/if}
  </header>

  {#if capability?.status !== 'supported'}
    <div class="state-row muted-state">
      <strong>{capability?.status === 'disabled' ? 'Disabled' : 'Unavailable'}</strong>
      <span>{capability?.reason || 'Hosted monitoring is not available in this deployment.'}</span>
    </div>
  {:else}
    {#if response}
      <div class="capacity" aria-label="Hosted monitoring capacity">
        <div><strong>{response.capacity.projectedLookupsPerWeek.toLocaleString()}</strong> of {response.capacity.admittedLookupsPerWeek.toLocaleString()} admitted lookups per week</div>
        <progress max={response.capacity.admittedLookupsPerWeek} value={Math.min(response.capacity.projectedLookupsPerWeek, response.capacity.admittedLookupsPerWeek)}></progress>
        <small>{response.capacity.reservePercent}% capacity remains reserved for delayed and resumed work. This is a scheduler admission limit, not an upstream availability guarantee.</small>
      </div>
    {/if}

    <div class="schedule-form">
      <label>Browser-local watchlist
        <select bind:value={selectedLocal} disabled={busy || !localNames.length}>
          <option value="">Choose a watchlist</option>
          {#each localNames as name}<option value={name}>{name} ({localWatchlists[name].results.length})</option>{/each}
        </select>
      </label>
      <label>Interval
        <select bind:value={intervalHours} disabled={busy}>
          <option value={6}>Every 6 hours</option>
          <option value={12}>Every 12 hours</option>
          <option value={24}>Daily</option>
          <option value={168}>Weekly</option>
        </select>
      </label>
      <button class="primary" onclick={scheduleSelected} disabled={busy || !selectedEntry}>
        {selectedHosted ? 'Replace hosted snapshot' : 'Schedule watchlist'}
      </button>
    </div>
    {#if !localNames.length}<p class="hint">Save a Bulk result as a browser-local watchlist before scheduling it.</p>{/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if message}<p class="message" role="status" aria-live="polite">{message}</p>{/if}

    {#if hosted.length}
      <div class="hosted-list">
        {#each hosted as item (item.id)}
          <article>
            <div class="hosted-summary">
              <div><strong>{item.name}</strong><small>{item.domainCount} domain{item.domainCount === 1 ? '' : 's'} · {item.intervalHours === 168 ? 'Weekly' : item.intervalHours === 24 ? 'Daily' : `Every ${item.intervalHours} hours`}</small></div>
              <span class:paused={!item.enabled}>{statusLabel(item.status)}</span>
            </div>
            <dl>
              <div><dt>Next run</dt><dd>{item.nextRunAt ? formatDate(item.nextRunAt) : 'Paused'}</dd></div>
              <div><dt>Last run</dt><dd>{item.lastRunAt ? formatDate(item.lastRunAt) : 'Not run yet'}</dd></div>
              <div><dt>Progress</dt><dd>{item.progress ? `${item.progress.completed}/${item.progress.total}` : 'No active scan'}</dd></div>
            </dl>
            {#if item.lastError}<p class="item-error">{item.lastError}</p>{/if}
            {#if item.prunedHistoryEvents}<p class="hint">{item.prunedHistoryEvents} older hosted history event{item.prunedHistoryEvents === 1 ? '' : 's'} pruned.</p>{/if}
            <div class="toolbar actions">
              <button class="btn small" onclick={() => toggle(item)} disabled={busy}>{item.enabled ? 'Pause' : 'Resume'}</button>
              <button class="btn small" onclick={() => replace(item)} disabled={busy || !localEntryFor(item.name)}>Replace from browser</button>
              <button class="btn small" onclick={() => restore(item)} disabled={busy}>Restore to browser</button>
              <button class="btn small danger" onclick={() => remove(item)} disabled={busy}>Delete hosted copy</button>
            </div>
          </article>
        {/each}
      </div>
    {:else if loaded && !loading}
      <p class="empty">No watchlists are scheduled. Browser-local monitoring is unchanged.</p>
    {/if}
  {/if}
</section>

<style>
  .hosted{margin-top:16px;padding:var(--card-pad)}
  .hosted h2{margin:0}
  .hosted .section-head p:not(.eyebrow){max-width:760px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .state-row{display:flex;gap:12px;align-items:flex-start;margin-top:18px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-md)}
  .state-row span{color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .capacity{display:grid;gap:7px;margin-top:18px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .capacity div{font-size:var(--text-xs)}
  .capacity progress{width:100%;height:8px;accent-color:var(--accent)}
  .capacity small,.hint,.empty{color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .schedule-form{display:grid;grid-template-columns:minmax(220px,1fr) minmax(150px,220px) auto;gap:12px;align-items:end;margin-top:16px}
  .schedule-form label{display:grid;gap:6px;font-size:var(--text-xs);font-weight:700}
  .schedule-form select{width:100%}
  .schedule-form .primary{min-height:42px;white-space:nowrap}
  .message{color:var(--accent);font-size:var(--text-xs)}
  .error,.item-error{color:var(--danger);font-size:var(--text-xs)}
  .hosted-list{display:grid;gap:10px;margin-top:18px}
  .hosted-list article{padding:15px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .hosted-summary{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
  .hosted-summary>div{display:grid;gap:4px;min-width:0}
  .hosted-summary strong{overflow-wrap:anywhere}
  .hosted-summary small{color:var(--muted);font-size:var(--text-2xs)}
  .hosted-summary>span{flex:none;padding:4px 9px;border:1px solid color-mix(in srgb,var(--accent) 45%,var(--border));border-radius:99px;color:var(--accent);font:600 var(--text-2xs) var(--mono)}
  .hosted-summary>span.paused{border-color:var(--border);color:var(--muted)}
  dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:14px 0}
  dl div{min-width:0}
  dt{color:var(--muted);font-size:var(--text-2xs)}
  dd{margin:3px 0 0;font-size:var(--text-xs);overflow-wrap:anywhere}
  .actions{flex-wrap:wrap}
  @media(max-width:760px){
    .hosted .section-head{display:grid;gap:12px}
    .hosted .section-head .btn{justify-self:start}
    .schedule-form{grid-template-columns:1fr}
    .schedule-form .primary{width:100%}
    dl{grid-template-columns:1fr}
    .actions .btn{flex:1 1 145px}
  }
</style>
