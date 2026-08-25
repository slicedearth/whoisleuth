<script lang="ts">
  export type CaseResponseStageId = 'observation' | 'assessment' | 'response_decision' | 'outcome_tracking' | 'evidence_handoff';
  export type CaseResponseStage = Readonly<{
    id: CaseResponseStageId;
    number: number;
    label: string;
    status: 'complete' | 'in_progress' | 'not_started' | 'attention';
    summary: string;
    nextRequirement: string;
  }>;

  let { stages, oncontinue, onadvanced }: {
    stages: readonly CaseResponseStage[];
    oncontinue: (stage: CaseResponseStageId) => void | Promise<void>;
    onadvanced: () => void;
  } = $props();

  const current = $derived(stages.find((stage) => stage.status !== 'complete') ?? stages.at(-1));
</script>

<section class="quick-guide" aria-labelledby="case-response-quick-title">
  <header>
    <div><p class="eyebrow">Guided view</p><h4 id="case-response-quick-title">Case response steps</h4></div>
    <button class="btn" type="button" onclick={onadvanced}>Open full form</button>
  </header>
  {#if current}
    <div class="next-requirement" role="status">
      <span>Next incomplete requirement</span>
      <strong>{current.label}</strong>
      <p>{current.nextRequirement}</p>
      <button class="primary" type="button" onclick={() => oncontinue(current.id)}>Continue {current.label.toLowerCase()}</button>
    </div>
  {/if}
  <ol class="stages">
    {#each stages as stage}
      <li data-status={stage.status}>
        <span class="stage-number">0{stage.number}</span>
        <div><strong>{stage.label}</strong><small>{stage.status.replaceAll('_', ' ')}</small><p>{stage.summary}</p><p><b>Next:</b> {stage.nextRequirement}</p></div>
        <button class="btn small" type="button" onclick={() => oncontinue(stage.id)}>Review stage</button>
      </li>
    {/each}
  </ol>
</section>

<style>
  .quick-guide{display:grid;gap:12px}.quick-guide>header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.quick-guide h4{margin:3px 0 0;font:700 var(--text-md) var(--mono)}.next-requirement{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;padding:13px;border:1px solid color-mix(in srgb,var(--accent) 42%,var(--border));border-radius:var(--radius-sm);background:rgb(var(--accent-rgb) / .06)}.next-requirement span{color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}.next-requirement strong{grid-column:1;font:700 var(--text-sm) var(--mono)}.next-requirement p{grid-column:1;margin:2px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}.next-requirement button{grid-column:2;grid-row:1/span 3;align-self:center}.stages{display:grid;gap:7px;margin:0;padding:0;list-style:none}.stages li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:start;padding:11px;border-left:3px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.stages li[data-status='complete']{border-left-color:var(--success)}.stages li[data-status='attention']{border-left-color:var(--amber)}.stages li[data-status='in_progress']{border-left-color:var(--accent)}.stage-number{color:var(--interface-accent);font:750 var(--text-xs) var(--mono)}.stages div{display:grid;gap:3px;min-width:0}.stages strong{font:700 var(--text-xs) var(--mono)}.stages small{color:var(--muted);font-size:var(--text-2xs);text-transform:uppercase}.stages p{margin:3px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45;overflow-wrap:anywhere}.stages b{color:var(--text)}@media(max-width:700px){.quick-guide>header,.next-requirement{display:grid}.quick-guide>header .btn,.next-requirement button{width:100%}.next-requirement button{grid-column:1;grid-row:auto}.stages li{grid-template-columns:auto minmax(0,1fr)}.stages li>button{grid-column:1/-1;width:100%}}
</style>
