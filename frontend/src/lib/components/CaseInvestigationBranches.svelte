<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import type { PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { createDraftRevision } from '$lib/controllers/submitted-draft';

  let { record, visible, mutationBusy, persist }: {
    record: CaseRecord;
    visible: boolean;
    mutationBusy: boolean;
    persist: PersistCaseResponse;
  } = $props();

  let name = $state('');
  let evidencePinIds = $state<string[]>([]);
  let checkpointIds = $state<string[]>([]);
  let assertionIds = $state<string[]>([]);
  let actionIds = $state<string[]>([]);
  let nameInput = $state<HTMLInputElement | null>(null);
  const draft = createDraftRevision(() => record.id);
  const checkpoints = $derived([...new Map(record.evidencePins.flatMap((pin) => pin.checkpointId ? [[pin.checkpointId, pin]] : [])).entries()]);
  const referenceCount = $derived(evidencePinIds.length + checkpointIds.length + assertionIds.length + actionIds.length);

  function toggle(values: string[], id: string, checked: boolean): string[] {
    return checked ? [...new Set([...values, id])] : values.filter((item) => item !== id);
  }

  async function create(): Promise<void> {
    const unchanged = draft.capture();
    if (!await persist(
      { branch: { name, evidencePinIds, checkpointIds, assertionIds, actionIds } },
      `Created an investigation branch for ${record.domain}.`,
      () => nameInput,
    ) || !unchanged()) return;
    name = '';
    evidencePinIds = [];
    checkpointIds = [];
    assertionIds = [];
    actionIds = [];
  }

  async function setState(id: string, state: 'active' | 'resolved'): Promise<void> {
    await persist(
      { branchUpdate: { id, state } },
      `${state === 'resolved' ? 'Resolved' : 'Reopened'} the investigation branch for ${record.domain}.`,
    );
  }
</script>

{#if visible}
  <details>
    <summary>Group evidence and decisions into investigation branches</summary>
    <form class="branch-form" oninput={draft.changed} onchange={draft.changed} onsubmit={(event) => { event.preventDefault(); void create(); }}>
      <p class="notice">A branch is a named, reference-only view of case material. It does not copy evidence, run a query, or turn a hypothesis into an observed fact.</p>
      <label class="field">Branch name<input bind:this={nameInput} bind:value={name} maxlength="80" required placeholder="Alternative infrastructure explanation"></label>
      <div class="reference-groups">
        {#if record.evidencePins.length}
          <fieldset><legend>Evidence pins</legend>{#each record.evidencePins as pin}<label><input type="checkbox" checked={evidencePinIds.includes(pin.id)} onchange={(event) => evidencePinIds = toggle(evidencePinIds, pin.id, event.currentTarget.checked)}><span>{pin.label}</span></label>{/each}</fieldset>
        {/if}
        {#if checkpoints.length}
          <fieldset><legend>Evidence checkpoints</legend>{#each checkpoints as [id, pin]}<label><input type="checkbox" checked={checkpointIds.includes(id)} onchange={(event) => checkpointIds = toggle(checkpointIds, id, event.currentTarget.checked)}><span>{pin.label}</span></label>{/each}</fieldset>
        {/if}
        {#if record.assertions.length}
          <fieldset><legend>Assertions</legend>{#each record.assertions as assertion}<label><input type="checkbox" checked={assertionIds.includes(assertion.id)} onchange={(event) => assertionIds = toggle(assertionIds, assertion.id, event.currentTarget.checked)}><span>{assertion.statement}</span></label>{/each}</fieldset>
        {/if}
        {#if record.actions.length}
          <fieldset><legend>Actions</legend>{#each record.actions as action}<label><input type="checkbox" checked={actionIds.includes(action.id)} onchange={(event) => actionIds = toggle(actionIds, action.id, event.currentTarget.checked)}><span>{action.type.replaceAll('_', ' ')} · {action.recipient}</span></label>{/each}</fieldset>
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

{/if}

<style>
  .branch-form{display:grid;gap:14px;padding:8px 4px 16px}
  .field{display:grid;gap:5px}.field input{width:100%}
  .reference-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.reference-groups fieldset{display:grid;align-content:start;gap:6px;min-width:0;margin:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm)}legend{padding:0 4px;font:700 var(--text-xs) var(--mono)}.reference-groups label{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px;align-items:start;color:var(--muted);font-size:var(--text-xs)}.reference-groups span{overflow-wrap:anywhere}
  .branches{display:grid;gap:12px;margin:0;padding:0 4px 16px;list-style:none}.branches li{display:grid;gap:6px;padding-block:12px;border-top:1px solid var(--border);min-width:0}.branches li>div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px}.branches span{color:var(--accent);font:650 var(--text-xs) var(--mono);text-transform:capitalize}.branches span.resolved{color:var(--success)}.branches p{margin:0;color:var(--muted);font-size:var(--text-xs)}.branches small{color:var(--muted);font-size:var(--text-xs)}.branches button{justify-self:start}.branches strong{overflow-wrap:anywhere}
  @media(max-width:700px){.reference-groups{grid-template-columns:minmax(0,1fr)}.branch-form>.btn,.branches button{width:100%}}
</style>
