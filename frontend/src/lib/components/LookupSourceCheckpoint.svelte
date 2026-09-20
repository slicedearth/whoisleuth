<script lang="ts">
  import { tick } from 'svelte';
  import LookupEvidenceCheckpoint from './LookupEvidenceCheckpoint.svelte';
  import type { CheckpointFact } from '$lib/analysis/case-evidence-checkpoint.ts';
  import type { CaseRecord } from '$lib/cases';
  import type { LocalMutationOutcome } from '$lib/local-mutation-outcome.ts';

  let { label, facts, record, ready, busy, status, oncreate, onsave }: {
    label: string;
    facts: readonly CheckpointFact[];
    record: CaseRecord | null;
    ready: boolean;
    busy: boolean;
    status: string;
    oncreate: () => Promise<void>;
    onsave: (fields: string[]) => Promise<LocalMutationOutcome>;
  } = $props();
  const id = $props.id();
  let open = $state(false);
  let message = $state('');
  let container = $state<HTMLDetailsElement>();
  const pins = $derived(record?.evidencePins.filter(pin => facts.some(fact => fact.field === pin.field)) ?? []);

  async function create() {
    await oncreate();
    await tick();
    message = status;
    if (record) container?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
  }

  async function save(fields: string[]) {
    const outcome = await onsave(fields);
    await tick();
    message = status;
    return outcome;
  }
</script>

{#if facts.some(fact => fact.value !== null)}
  <details class="source-checkpoint compact-disclosure" bind:open bind:this={container}>
    <summary>Pin {label} facts to Case</summary>
    {#if open}
      {#if record}
        <p class="destination">Saving to the Case for <strong>{record.domain}</strong>.</p>
        <LookupEvidenceCheckpoint {facts} {pins} onsave={save} actionBusy={busy || !ready}
          headingId={`${id}-facts`} title={`${label} facts`} allowTransition={false} />
      {:else}
        <p>Save this observation to a Case before selecting facts for later review.</p>
        <button class="btn" type="button" disabled={busy || !ready} onclick={() => void create()}>Save lookup to Case</button>
      {/if}
      {#if !ready}<p>Case storage is not ready. Review the storage status in Case and response before saving.</p>{/if}
      {#if message}<p role="status">{message}</p>{/if}
    {/if}
  </details>
{/if}

<style>
  .source-checkpoint{margin-top:8px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);min-width:0}
  summary{min-height:34px;font-size:var(--text-xs);font-weight:650;color:var(--text)}
  p{margin:10px 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}
  .source-checkpoint :global(.checkpoint){padding:0;border:0;box-shadow:none;background:transparent}
</style>
