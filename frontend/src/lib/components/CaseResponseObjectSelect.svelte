<script lang="ts">
  import type { CaseRecord } from '#lib/cases.ts';
  import { caseResponseObjectChoices, MAX_CASE_RESPONSE_OBJECTS, type CaseResponseObject } from '../../../../packages/cases/case-response-object.mts';
  let { record, label = 'Exact response object', emptyLabel = 'Unknown / not bound', value = $bindable(''), values = $bindable<string[]>([]), multiple = false, disabled = false, objects }: {
    record: CaseRecord; label?: string; emptyLabel?: string; value?: string; values?: string[]; multiple?: boolean; disabled?: boolean; objects?: readonly CaseResponseObject[];
  } = $props();
  const controlId = $props.id();
  const retainedChoices = $derived(caseResponseObjectChoices(record));
  const choices = $derived(objects ? objects.map(object => retainedChoices.find(choice => choice.value === JSON.stringify(object)) ?? { value: JSON.stringify(object), label: `${object.kind.replaceAll('_', ' ')} · ${object.identifier}` }) : retainedChoices);
  const selectedChoices = $derived(choices.filter(choice => multiple ? values.includes(choice.value) : value === choice.value));
</script>

<div class="field">
  <label for={controlId}>{label}</label>
  {#if multiple}<select id={controlId} aria-describedby={`${controlId}-hint`} multiple size="5" bind:value={values} {disabled}>{#each choices as choice (choice.value)}<option value={choice.value}>{choice.label}</option>{/each}</select>
  {:else}<select id={controlId} aria-describedby={`${controlId}-hint`} bind:value {disabled}><option value="">{emptyLabel}</option>{#each choices as choice (choice.value)}<option value={choice.value}>{choice.label}</option>{/each}</select>{/if}
  <small id={`${controlId}-hint`}>{multiple ? `Choose up to ${MAX_CASE_RESPONSE_OBJECTS} objects. Use your keyboard modifier key to select more than one on desktop.` : 'Choose the exact object and its type.'}</small>
  {#if selectedChoices.length}
    <div class="selection">
      <small>{multiple ? `${selectedChoices.length} selected` : 'Selected object'}</small>
      <ul aria-label={`Selected ${label.toLowerCase()}`}>{#each selectedChoices as choice (choice.value)}<li>{choice.label}</li>{/each}</ul>
    </div>
  {/if}
</div>

<style>
  select{width:100%;min-width:0}
  select[multiple]{font:inherit;line-height:1.5;min-height:12rem;padding:6px}
  option{padding:4px}
  small,.selection{overflow-wrap:anywhere}
  .selection{min-width:0;padding:8px 10px;border-left:2px solid var(--border)}
  .selection ul{margin:4px 0 0;padding-left:1.1em}
  .selection li{margin:4px 0}
</style>
