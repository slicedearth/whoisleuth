<script lang="ts">
  import { tick } from 'svelte';
  import { editCase, type CaseRecord } from '$lib/cases';

  let { record, onsaved, oncommitted, onmessage }:{
    record: CaseRecord;
    onsaved: () => void | Promise<void>;
    oncommitted: (cases: CaseRecord[]) => void;
    onmessage: (message: string) => void;
  } = $props();

  let name = $state('');
  let evidencePinIds = $state<string[]>([]);
  let checkpointIds = $state<string[]>([]);
  let assertionIds = $state<string[]>([]);
  let actionIds = $state<string[]>([]);
  let mutationBusy = $state(false);
  let nameInput: HTMLInputElement;
  const checkpoints = $derived([...new Map(record.evidencePins.flatMap((pin) => pin.checkpointId ? [[pin.checkpointId, pin]] : [])).entries()]);
  const referenceCount = $derived(evidencePinIds.length + checkpointIds.length + assertionIds.length + actionIds.length);

  function toggle(values: string[], id: string, checked: boolean): string[] {
    return checked ? [...new Set([...values, id])] : values.filter((item) => item !== id);
  }

  function prunedNote(pruned: number): string {
    return pruned ? ` Pruned ${pruned} old evidence snapshot${pruned === 1 ? '' : 's'} to stay within storage.` : '';
  }

  async function reconcileCommitted(
    committed: Awaited<ReturnType<typeof editCase>>,
    success: string,
  ): Promise<void> {
    try {
      await onsaved();
    } catch {
      try {
        oncommitted(committed.cases);
      } catch {
        onmessage(`${success} The change was saved, but Cases could not be reread or reconciled in the current view. Reload before changing this branch again.${prunedNote(committed.pruned)}`);
        return;
      }
      onmessage(`${success} The change was saved, but Cases could not be reread. The complete committed Case snapshot is shown locally; reload to retry the browser-local read.${prunedNote(committed.pruned)}`);
      return;
    }
    onmessage(`${success}${prunedNote(committed.pruned)}`);
  }

  async function restoreMutationFocus(
    focusTarget: HTMLElement | null,
    fallbackTarget: HTMLElement | null = null,
  ): Promise<void> {
    await tick();
    const activeTarget = document.activeElement;
    const focusWasDisplaced = activeTarget === null
      || activeTarget === document.body
      || activeTarget === document.documentElement;
    if (activeTarget !== focusTarget && !focusWasDisplaced) return;
    const target = focusTarget?.isConnected && !focusTarget.matches(':disabled')
      ? focusTarget
      : fallbackTarget?.isConnected && !fallbackTarget.matches(':disabled')
        ? fallbackTarget
        : null;
    target?.focus({ preventScroll: true });
  }

  async function create(): Promise<void> {
    if (mutationBusy) return;
    const focusTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    mutationBusy = true;
    try {
      let committed: Awaited<ReturnType<typeof editCase>>;
      try {
        committed = await editCase(record.id, { branch: { name, evidencePinIds, checkpointIds, assertionIds, actionIds } });
      } catch (cause) {
        onmessage(cause instanceof Error ? cause.message : 'Could not create the investigation branch.');
        return;
      }
      await reconcileCommitted(committed, `Created an investigation branch for ${record.domain}.`);
      name = '';
      evidencePinIds = [];
      checkpointIds = [];
      assertionIds = [];
      actionIds = [];
    } finally {
      mutationBusy = false;
      await restoreMutationFocus(focusTarget, nameInput);
    }
  }

  async function setState(id: string, state: 'active' | 'resolved'): Promise<void> {
    if (mutationBusy) return;
    const focusTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    mutationBusy = true;
    try {
      let committed: Awaited<ReturnType<typeof editCase>>;
      try {
        committed = await editCase(record.id, { branchUpdate: { id, state } });
      } catch (cause) {
        onmessage(cause instanceof Error ? cause.message : 'Could not update the investigation branch.');
        return;
      }
      await reconcileCommitted(
        committed,
        `${state === 'resolved' ? 'Resolved' : 'Reopened'} the investigation branch for ${record.domain}.`,
      );
    } finally {
      mutationBusy = false;
      await restoreMutationFocus(focusTarget);
    }
  }
</script>

<details>
  <summary>Group evidence and decisions into investigation branches</summary>
  <form class="branch-form" onsubmit={(event) => { event.preventDefault(); void create(); }}>
    <p class="notice">A branch is a named, reference-only view of case material. It does not copy evidence, run a query, or turn a hypothesis into an observed fact.</p>
    <label class="field">Branch name<input bind:this={nameInput} bind:value={name} maxlength="80" required disabled={mutationBusy} placeholder="Alternative infrastructure explanation"></label>
    <div class="reference-groups">
      {#if record.evidencePins.length}
        <fieldset disabled={mutationBusy}><legend>Evidence pins</legend>{#each record.evidencePins as pin}<label><input type="checkbox" checked={evidencePinIds.includes(pin.id)} onchange={(event) => evidencePinIds = toggle(evidencePinIds, pin.id, event.currentTarget.checked)}><span>{pin.label}</span></label>{/each}</fieldset>
      {/if}
      {#if checkpoints.length}
        <fieldset disabled={mutationBusy}><legend>Evidence checkpoints</legend>{#each checkpoints as [id, pin]}<label><input type="checkbox" checked={checkpointIds.includes(id)} onchange={(event) => checkpointIds = toggle(checkpointIds, id, event.currentTarget.checked)}><span>{pin.label}</span></label>{/each}</fieldset>
      {/if}
      {#if record.assertions.length}
        <fieldset disabled={mutationBusy}><legend>Assertions</legend>{#each record.assertions as assertion}<label><input type="checkbox" checked={assertionIds.includes(assertion.id)} onchange={(event) => assertionIds = toggle(assertionIds, assertion.id, event.currentTarget.checked)}><span>{assertion.statement}</span></label>{/each}</fieldset>
      {/if}
      {#if record.actions.length}
        <fieldset disabled={mutationBusy}><legend>Actions</legend>{#each record.actions as action}<label><input type="checkbox" checked={actionIds.includes(action.id)} onchange={(event) => actionIds = toggle(actionIds, action.id, event.currentTarget.checked)}><span>{action.type.replaceAll('_', ' ')} · {action.recipient}</span></label>{/each}</fieldset>
      {/if}
    </div>
    <button class="btn" type="submit" disabled={mutationBusy || !name.trim() || !referenceCount}>{mutationBusy ? 'Saving…' : 'Create branch'}</button>
  </form>

  {#if record.branches?.length}
    <ol class="branches">
      {#each [...record.branches].reverse() as branch}
        <li>
          <div><strong>{branch.name}</strong><span class:resolved={branch.state === 'resolved'}>{branch.state}</span></div>
          <p>{branch.evidencePinIds.length} pin{branch.evidencePinIds.length === 1 ? '' : 's'} · {branch.checkpointIds.length} checkpoint{branch.checkpointIds.length === 1 ? '' : 's'} · {branch.assertionIds.length} assertion{branch.assertionIds.length === 1 ? '' : 's'} · {branch.actionIds.length} action{branch.actionIds.length === 1 ? '' : 's'}</p>
          <small>Updated {branch.updatedAt}</small>
          <button class="btn small" type="button" disabled={mutationBusy} onclick={() => void setState(branch.id, branch.state === 'active' ? 'resolved' : 'active')}>{branch.state === 'active' ? 'Mark resolved' : 'Reopen'}</button>
        </li>
      {/each}
    </ol>
  {/if}
</details>

<style>
  details{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  summary{padding:11px 12px;cursor:pointer;font:700 var(--text-xs) var(--mono)}details[open]>summary{border-bottom:1px solid var(--border)}
  .branch-form{display:grid;gap:10px;padding:12px}.notice{margin:0;padding:9px 10px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .06);color:var(--muted);font-size:var(--text-xs)}
  .field{display:grid;gap:5px}.field input{width:100%}
  .reference-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.reference-groups fieldset{display:grid;align-content:start;gap:6px;min-width:0;margin:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm)}legend{padding:0 4px;font:700 var(--text-xs) var(--mono)}.reference-groups label{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px;align-items:start;color:var(--muted);font-size:var(--text-xs)}.reference-groups span{overflow-wrap:anywhere}
  .branches{display:grid;gap:8px;margin:0;padding:0 12px 12px;list-style:none}.branches li{display:grid;gap:6px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.branches li>div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px}.branches span{color:var(--accent);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}.branches span.resolved{color:var(--success)}.branches p{margin:0;color:var(--muted);font-size:var(--text-xs)}.branches small{color:var(--muted);font-size:var(--text-2xs)}.branches button{justify-self:start}
  @media(max-width:700px){.reference-groups{grid-template-columns:minmax(0,1fr)}.branch-form>.btn,.branches button{width:100%}}
</style>
