<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { CASE_PRACTICE_SCENARIOS, type CasePracticeScenario } from '#lib/analysis/case-practice.ts';
  import CasePracticeSession from './CasePracticeSession.svelte';
  import PracticeCompanion from './PracticeCompanion.svelte';
  let { onreset, visible = true, requestedScenario = null }: {
    onreset: (scenario: CasePracticeScenario) => void; visible?: boolean; requestedScenario?: string | null;
  } = $props();
  const knownScenario = (value: string | null) => CASE_PRACTICE_SCENARIOS.find(scenario => scenario.id === value)?.id;
  const initialScenario = untrack(() => knownScenario(requestedScenario)) ?? 'credential-form';
  let active = $state<CasePracticeScenario>(initialScenario);
  let selected = $state<CasePracticeScenario>(initialScenario);
  let previousRequest = untrack(() => requestedScenario);
  const unavailableRequest = $derived(requestedScenario !== null && !knownScenario(requestedScenario));
  $effect.pre(() => {
    if (requestedScenario === previousRequest) return;
    previousRequest = requestedScenario;
    const next = knownScenario(requestedScenario);
    // Later tour links propose a choice; only the existing confirmation replaces drafts.
    if (next) selected = next;
  });
  let presentation = $state(false), companion = $state(false);
  async function changeScenario() { active = selected; await tick(); document.getElementById('case-practice-title')?.focus(); }
</script>

<div class="practice-reading" class:presentation>
{#if unavailableRequest}<p role="status">That fictional tour is not available in this build. Choose a practice scenario below; an open practice has not been replaced.</p>{/if}
<div class="scenario-choice"><label>Practice scenario<select bind:value={selected}>{#each CASE_PRACTICE_SCENARIOS as scenario}<option value={scenario.id}>{scenario.title}</option>{/each}</select></label>
  {#if selected !== active}<div><p>Changing scenario discards this practice Case and its drafts.</p><button class="btn" type="button" onclick={() => void changeScenario()}>Discard practice and change scenario</button><button class="btn" type="button" onclick={() => selected = active}>Keep current practice</button></div>{/if}
</div>
<div class="practice-options" role="group" aria-label="Optional fictional presentation">
  <label><input type="checkbox" bind:checked={presentation}> Larger practice reading</label>
  <label><input type="checkbox" bind:checked={companion}> Show practice companion</label>
</div>
{#if companion}<PracticeCompanion />{/if}
{#key active}<CasePracticeSession scenario={active} onreset={() => onreset(active)} {visible} />{/key}
</div>

<style>
  .practice-reading{min-width:0}.presentation{--text-xs:.95rem;--text-sm:1.0625rem;--text-md:1.1875rem;--text-lg:1.4rem}.practice-options{display:flex;flex-wrap:wrap;gap:8px 20px;margin-bottom:16px}.practice-options label{display:flex;align-items:center;gap:8px;min-height:44px;font-size:var(--text-sm)}.practice-options input{width:18px;height:18px;flex:none}@media print{.practice-options{display:none}}
  .scenario-choice{display:grid;gap:12px;margin-bottom:20px;max-width:50rem}.scenario-choice label{display:grid;gap:8px;font-size:var(--text-sm)}select{min-width:0;max-width:100%;min-height:44px}.scenario-choice button{margin:0 8px 8px 0}.scenario-choice p{line-height:1.5}
</style>
