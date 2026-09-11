<script lang="ts">
  import type { CaseEvidencePin } from '$lib/cases';
  import { caseEvidenceChoiceName } from '$lib/analysis/case-evidence-presentation.ts';
  import CaseEvidenceFact from './CaseEvidenceFact.svelte';
  let { label, pins, value = $bindable(''), emptyLabel = 'No evidence pin', disabled = false }: {
    label: string;
    pins: readonly CaseEvidencePin[];
    value?: string;
    emptyLabel?: string;
    disabled?: boolean;
  } = $props();
  const id = $props.id();
  const selected = $derived(pins.find(pin => pin.id === value));
</script>

<div class="field evidence-selection">
  <label for={id}>{label}</label>
  <select {id} {disabled} bind:value aria-describedby={selected ? `${id}-fact` : undefined}>
    <option value="">{emptyLabel}</option>
    {#each pins as pin, index (pin.id)}<option value={pin.id}>{caseEvidenceChoiceName(pin, index)}</option>{/each}
  </select>
  {#if selected}<div id={`${id}-fact`} class="selected-fact"><CaseEvidenceFact pin={selected} /></div>{/if}
</div>

<style>
  .evidence-selection{display:grid;align-content:start;gap:5px;min-width:0;overflow-wrap:anywhere}
  select{width:100%;min-width:0;max-width:100%}
  .selected-fact{padding:8px 0 8px 10px;border-left:2px solid var(--border)}
</style>
