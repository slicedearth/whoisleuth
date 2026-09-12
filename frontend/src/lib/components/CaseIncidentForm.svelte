<script lang="ts">
  import { untrack } from 'svelte';
  import { casesForDomain, type CaseRecord, type CaseIncidentInput } from '$lib/analysis/case-model.ts';
  import { caseNumber } from '../../../../packages/cases/case-workflow-metadata.mts';
  import { MAX_CASE_OBJECTIVE_LENGTH } from '../../../../packages/contracts/case-portability.mts';

  let { records, initialDomain = '', create, created, ondirty }: {
    records: CaseRecord[];
    initialDomain?: string;
    create: (input: CaseIncidentInput) => Promise<CaseRecord | null>;
    created: (record: CaseRecord) => void | Promise<void>;
    ondirty: (dirty: boolean) => void;
  } = $props();
  let domain = $state(untrack(() => initialDomain));
  let title = $state('');
  let sourceId = $state('');
  let snapshotId = $state('');
  let busy = $state(false);
  let dirty = $state(false);
  let message = $state('');
  const sources = $derived(casesForDomain(records, domain).filter(record => record.evidenceHistory.length));
  const source = $derived(sources.find(record => record.id === sourceId));
  $effect(() => { if (!dirty && !busy) domain = initialDomain; });
  $effect(() => { ondirty(dirty); });
  function changed() { dirty = true; message = ''; }
  async function submit() {
    if (busy) return;
    if (sourceId && (!source || !source.evidenceHistory.some(snapshot => snapshot.id === snapshotId))) {
      message = 'Select an available observation or start without one.';
      return;
    }
    busy = true;
    try {
      const record = await create({ domain, title, ...(sourceId ? { reuse: { caseId: sourceId, snapshotId } } : {}) });
      if (!record) return;
      dirty = false;
      ondirty(false);
      title = ''; sourceId = ''; snapshotId = '';
      try { await created(record); }
      catch { message = 'The incident Case was saved, but could not be opened. Select it from the Case list; do not create it again.'; }
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not create the incident Case.';
    } finally { busy = false; }
  }
</script>

<details class="incident-form card">
  <summary>Create a separate incident Case</summary>
  <form oninput={changed} onsubmit={(event) => { event.preventDefault(); void submit(); }}>
    <fieldset disabled={busy}>
      <label>Domain<input bind:value={domain} required autocomplete="off" spellcheck="false" oninput={() => { sourceId = ''; snapshotId = ''; }}></label>
      <label>Incident title<input bind:value={title} required maxlength={MAX_CASE_OBJECTIVE_LENGTH} placeholder="Describe this investigation" autocomplete="off"></label>
      {#if sources.length}
        <label>Reuse a retained observation<select bind:value={sourceId} onchange={() => snapshotId = ''}>
          <option value="">Start without retained evidence</option>
          {#each sources as record (record.id)}<option value={record.id}>{record.title || record.domain} · Case …{caseNumber(record.id).slice(-8)}</option>{/each}
        </select></label>
        {#if source}
          <label>Observation<select bind:value={snapshotId} required><option value="">Select an observation</option>
            {#each source.evidenceHistory as snapshot (snapshot.id)}<option value={snapshot.id}>{new Date(snapshot.capturedAt).toLocaleString()} · {snapshot.scanDepth} · {snapshot.id}</option>{/each}
          </select></label>
          <small>Only this observation is copied, with its original timestamps. Notes and decisions stay with the source Case.</small>
        {/if}
      {/if}
      <button class="btn primary" type="submit" disabled={!domain.trim() || !title.trim() || Boolean(sourceId && !snapshotId)}>{busy ? 'Creating…' : 'Create incident Case'}</button>
    </fieldset>
    {#if message}<p role="status">{message}</p>{/if}
  </form>
</details>

<style>
  .incident-form { margin-block: 12px; padding: 14px 16px; min-width: 0; }
  summary { cursor: pointer; font-weight: 650; }
  form { margin-top: 14px; }
  fieldset { display: grid; gap: 12px; min-width: 0; margin: 0; padding: 0; border: 0; }
  label { display: grid; gap: 6px; min-width: 0; font-size: var(--text-sm); }
  input, select { width: 100%; min-width: 0; min-height: 44px; }
  button { justify-self: start; }
  small, p { margin: 0; color: var(--muted); overflow-wrap: anywhere; }
</style>
