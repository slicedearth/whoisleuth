<script lang="ts">
  import type { CaseEvidencePin, CaseEvidenceRelationStance } from '$lib/cases';
  import { caseEvidenceReferences } from '$lib/analysis/case-evidence-presentation.ts';
  import CaseEvidenceFact from './CaseEvidenceFact.svelte';
  let { pins, ids, relations = [] }: {
    pins: readonly CaseEvidencePin[];
    ids: readonly string[];
    relations?: readonly { evidencePinId: string; stance: CaseEvidenceRelationStance }[];
  } = $props();
  let open = $state(false);
  const references = $derived(caseEvidenceReferences(pins, ids, relations));
</script>

{#if references.length}
  <details class="linked-evidence" bind:open>
    <summary>Linked evidence ({references.length})</summary>
    {#if open}
      <ul>
        {#each references as reference (reference.id)}
          <li>
            {#if reference.stance}<span class="stance">{reference.stance}</span>{/if}
            {#if reference.pin}<CaseEvidenceFact pin={reference.pin} />
            {:else}<p>Referenced evidence is not retained in this Case: <code>{reference.id}</code>.</p>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </details>
{/if}

<style>
  .linked-evidence{min-width:0;margin-top:8px}
  summary{padding:8px 0;font:650 var(--text-xs) var(--mono);cursor:pointer;overflow-wrap:anywhere}
  ul{display:grid;gap:12px;list-style:none;margin:8px 0;padding:0}
  li{min-width:0;border-left:2px solid var(--border);padding-left:12px;overflow-wrap:anywhere}
  p{margin:0;font-size:var(--text-sm);color:var(--muted)}
  .stance{display:block;margin-bottom:5px;color:var(--text);font:650 var(--text-xs) var(--mono);text-transform:capitalize}
</style>
