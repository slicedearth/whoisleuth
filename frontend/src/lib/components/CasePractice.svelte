<script lang="ts">
  import { tick } from 'svelte';
  import { CASE_PRACTICE_SCENARIOS, type CasePracticeScenario } from '$lib/analysis/case-practice.ts';
  import CasePracticeSession from './CasePracticeSession.svelte';
  let { onreset }: { onreset: () => void } = $props();
  let active = $state<CasePracticeScenario>('credential-form');
  let selected = $state<CasePracticeScenario>('credential-form');
  async function changeScenario() { active = selected; await tick(); document.getElementById('case-practice-title')?.focus(); }
</script>

<div class="scenario-choice"><label>Practice scenario<select bind:value={selected}>{#each CASE_PRACTICE_SCENARIOS as scenario}<option value={scenario.id}>{scenario.title}</option>{/each}</select></label>
  {#if selected !== active}<div><p>Changing scenario discards this practice Case and its drafts.</p><button class="btn" type="button" onclick={() => void changeScenario()}>Discard practice and change scenario</button><button class="btn" type="button" onclick={() => selected = active}>Keep current practice</button></div>{/if}
</div>
{#key active}<CasePracticeSession scenario={active} {onreset} />{/key}

<style>
  .scenario-choice{display:grid;gap:12px;margin-bottom:20px;max-width:50rem}.scenario-choice label{display:grid;gap:8px;font-size:var(--text-sm)}select{min-width:0;max-width:100%;min-height:44px}.scenario-choice button{margin:0 8px 8px 0}.scenario-choice p{line-height:1.5}
</style>
