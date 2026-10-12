<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { loadCases, type CaseRecord } from '#lib/cases.ts';
  import { subscribeBrowserLocalData } from '#lib/browser-local-data-service.ts';
  import { readConsoleReferenceView, subscribeConsoleReferenceView, removeConsoleCaseCheckpoint, clearConsoleCaseCheckpoints, clearConsoleReferenceView,
    type ConsoleReferenceView, type PinnedCaseCheckpoint } from '#lib/console-workflow-state.ts';
  import { CASE_WORKSPACE_SECTIONS, caseWorkspaceHref } from '#lib/analysis/case-response-stage.ts';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import DeferredSurface from './DeferredSurface.svelte';
  let view = $state<ConsoleReferenceView>(readConsoleReferenceView());
  let records = $state.raw<readonly CaseRecord[]>([]);
  let phase = $state<'empty' | 'loading' | 'ready' | 'unavailable'>('empty');
  let selected = $state<string[]>([]);
  let staged = $state.raw<Readonly<{ caseId: string; checkpointIds: readonly string[] }> | null>(null);
  let message = $state('');
  let mounted = false, generation = 0;
  const key = (ref: PinnedCaseCheckpoint) => JSON.stringify([ref.caseId, ref.snapshotId]);
  const rows = $derived(view.checkpoints.map(ref => {
    const cases = records.filter(record => record.id === ref.caseId);
    const snapshots = cases.length === 1 ? cases[0]!.evidenceHistory.filter(snapshot => snapshot.id === ref.snapshotId) : [];
    return { ref, key: key(ref), record: cases.length === 1 ? cases[0] : null, snapshot: snapshots.length === 1 ? snapshots[0] : null,
      ambiguous: cases.length > 1 || snapshots.length > 1 };
  }));
  async function refresh() {
    const request = ++generation, requested = readConsoleReferenceView();
    view = requested; records = []; staged = null;
    selected = selected.filter(value => requested.checkpoints.some(ref => key(ref) === value));
    if (!requested.checkpoints.length) { phase = 'empty'; return; }
    phase = 'loading';
    try {
      const loaded = await loadCases();
      const current = readConsoleReferenceView();
      if (!mounted || request !== generation || current.workspaceId !== requested.workspaceId
        || JSON.stringify(current.checkpoints) !== JSON.stringify(requested.checkpoints)) return;
      records = loaded.filter(record => requested.checkpoints.some(ref => ref.caseId === record.id));
      phase = 'ready';
    } catch { if (mounted && request === generation) { records = []; phase = 'unavailable'; } }
  }
  function updateView() {
    const next = readConsoleReferenceView();
    const referencesChanged = next.workspaceId !== view.workspaceId || JSON.stringify(next.checkpoints) !== JSON.stringify(view.checkpoints);
    view = next;
    if (referencesChanged) void refresh();
  }
  function choose(ref: PinnedCaseCheckpoint, checked: boolean) {
    const id = key(ref); staged = null; message = '';
    if (!checked) selected = selected.filter(value => value !== id);
    else if (!selected.includes(id) && selected.length < 2) selected = [...selected, id];
  }
  function review() {
    const chosen = rows.filter(row => selected.includes(row.key));
    if (phase !== 'ready' || chosen.length !== 2 || chosen.some(row => !row.snapshot) || chosen[0]!.ref.caseId !== chosen[1]!.ref.caseId) {
      staged = null; message = 'Choose two available checkpoints from one Case. Other comparison families are separate.'; return;
    }
    staged = Object.freeze({ caseId: chosen[0]!.ref.caseId, checkpointIds: Object.freeze(chosen.map(row => row.ref.snapshotId)) });
  }
  async function remove(ref?: PinnedCaseCheckpoint) {
    if (ref) removeConsoleCaseCheckpoint(ref); else clearConsoleCaseCheckpoints();
    await tick();
    (document.getElementById('console-pinned-checkpoints') ?? document.getElementById('main-content'))?.focus({ preventScroll: true });
  }
  async function clear() {
    clearConsoleReferenceView(); await tick();
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }
  onMount(() => {
    mounted = true; void refresh();
    const unsubscribeView = subscribeConsoleReferenceView(updateView);
    const unsubscribeCases = subscribeBrowserLocalData('cases', () => { if (view.checkpoints.length) void refresh(); });
    return () => { mounted = false; generation++; records = []; unsubscribeView(); unsubscribeCases(); };
  });
</script>

<div class="reference-view">
  {#if view.checkpoints.length}
    <details>
      <summary id="console-pinned-checkpoints">Pinned checkpoints · {view.checkpoints.length} of 4</summary>
      <p>Exact references in this tab, not duplicate evidence. They survive Console navigation and clear on lock, sign-out or leaving the Console.</p>
      {#if phase === 'loading'}<p role="status">Reading retained checkpoints…</p>{/if}
      {#if phase === 'unavailable'}<p role="alert">The retained Cases could not be read. References remain pinned; no replacement was selected.</p><button type="button" class="btn small" onclick={() => void refresh()}>Retry checkpoint read</button>{/if}
      <ul aria-label="Pinned Case checkpoint references">
        {#each rows as row (row.key)}
          <li>
            <label><input type="checkbox" checked={selected.includes(row.key)} disabled={phase !== 'ready' || !row.snapshot || selected.length >= 2 && !selected.includes(row.key)} onchange={event => choose(row.ref, event.currentTarget.checked)}>
              <span>{row.record?.title || row.record?.domain || 'Case reference'}<code>Case {row.ref.caseId} · checkpoint {row.ref.snapshotId}</code>
                {#if row.snapshot}<small>{formatEvidenceDate(row.snapshot.capturedAt)} · retained {row.snapshot.source} · {row.snapshot.scanDepth}</small>
                {:else if phase === 'ready'}<small>{row.ambiguous ? 'Ambiguous exact reference; none was selected.' : 'Exact checkpoint is no longer retained.'}</small>{/if}</span>
            </label>
            <a href={caseWorkspaceHref(row.ref.caseId, 'evidence')}>Open Case evidence</a>
            <button type="button" class="btn small" aria-label={`Remove pinned checkpoint ${row.ref.caseId} ${row.ref.snapshotId}`} onclick={() => void remove(row.ref)}>Remove</button>
          </li>
        {/each}
      </ul>
      <div class="actions"><button type="button" class="btn small" disabled={phase !== 'ready' || selected.length !== 2} onclick={review}>Review selected checkpoints</button><button type="button" class="btn small" onclick={() => void remove()}>Clear pinned checkpoints</button></div>
      {#if message}<p role="status">{message}</p>{/if}
      {#if staged}<DeferredSurface load={() => import('./CaseCheckpointStage.svelte')} props={{ cases: records, initialSelection: staged }} loadingLabel="Opening selected checkpoint comparison…" unavailableLabel="The checkpoint comparison could not be opened. Retained evidence has not changed." />{/if}
    </details>
  {/if}
  {#if view.visits.length}
    <details>
      <summary>Visited Cases · {view.visits.length}</summary>
      <p>Successful Case navigation in this tab, not an observed relationship or investigation history.</p>
      <nav aria-label="Visited Case contexts"><ol>{#each view.visits as visit, index}<li><a href={caseWorkspaceHref(visit.caseId, visit.section)}>{index + 1}. Case <code>{visit.caseId}</code> · {CASE_WORKSPACE_SECTIONS.find(section => section.id === visit.section)?.label}</a></li>{/each}</ol></nav>
      <button type="button" class="btn small" onclick={() => void clear()}>Clear tab references and visits</button>
    </details>
  {/if}
</div>

<style>
  .reference-view{min-width:0;margin-top:8px;font-size:var(--text-xs)}details{min-width:0}summary{min-height:44px;align-content:center;cursor:pointer;width:fit-content;max-width:100%;overflow-wrap:anywhere}p{line-height:1.6;color:var(--muted)}ul,ol{padding:0;list-style:none;display:grid;gap:8px}li{display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0}label{display:flex;gap:8px;align-items:start;flex:1 1 20rem;min-width:0;min-height:44px}label input{flex:none;width:18px;height:18px;margin-top:3px}label span{min-width:0;overflow-wrap:anywhere}code,small{display:block;white-space:normal;overflow-wrap:anywhere;margin-top:4px}small{color:var(--muted)}a,button{min-height:44px;align-content:center;max-width:100%;overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;gap:8px}nav code{display:inline}@media print{.reference-view{display:none!important}}
</style>
