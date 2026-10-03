<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import { caseResponseObjectChoices, type CaseResponseObject } from '../../../../packages/cases/case-response-object.mts';
  let { record, label = 'Exact response object', emptyLabel = 'Unknown / not bound', value = $bindable(''), values = $bindable<string[]>([]), multiple = false, disabled = false, objects }: {
    record: CaseRecord; label?: string; emptyLabel?: string; value?: string; values?: string[]; multiple?: boolean; disabled?: boolean; objects?: readonly CaseResponseObject[];
  } = $props();
  const retainedChoices = $derived(caseResponseObjectChoices(record));
  const choices = $derived(objects ? objects.map(object => retainedChoices.find(choice => choice.value === JSON.stringify(object)) ?? { value: JSON.stringify(object), label: `${object.kind.replaceAll('_', ' ')} · ${object.identifier}` }) : retainedChoices);
</script>

<label class="field">{label}
  {#if multiple}<select multiple size="5" bind:value={values} {disabled}>{#each choices as choice (choice.value)}<option value={choice.value}>{choice.label}</option>{/each}</select>
  {:else}<select bind:value {disabled}><option value="">{emptyLabel}</option>{#each choices as choice (choice.value)}<option value={choice.value}>{choice.label}</option>{/each}</select>{/if}
  <small>{multiple ? 'Choose up to 20 explicitly associated objects. Multiple selection uses your keyboard modifier key.' : 'Select the object type deliberately. A shared hostname does not bind other pages or accounts.'} Exact links remain private retained context; no collection is started.</small>
</label>

<style>select{width:100%;min-width:0}small{overflow-wrap:anywhere}</style>
