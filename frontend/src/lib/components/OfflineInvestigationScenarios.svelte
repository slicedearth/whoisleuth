<script lang="ts">
  import {
    OFFLINE_INVESTIGATION_SCENARIOS,
    evaluateOfflineScenarioChoice,
    offlineInvestigationScenario,
  } from '$lib/analysis/offline-investigation-scenarios.ts';

  let scenarioId = $state(OFFLINE_INVESTIGATION_SCENARIOS[0]?.id ?? '');
  let stepIndex = $state(0);
  let choiceId = $state('');
  let completed = $state(false);
  const scenario = $derived(offlineInvestigationScenario(scenarioId) ?? OFFLINE_INVESTIGATION_SCENARIOS[0]);
  const step = $derived(scenario?.steps[stepIndex] ?? null);
  const evaluation = $derived(step && choiceId
    ? evaluateOfflineScenarioChoice(scenario?.id, step.id, choiceId)
    : null);

  function selectScenario(event: Event) {
    scenarioId = (event.currentTarget as HTMLSelectElement).value;
    stepIndex = 0;
    choiceId = '';
    completed = false;
  }

  function next() {
    if (!scenario || !step || !evaluation?.correct) return;
    if (stepIndex >= scenario.steps.length - 1) {
      completed = true;
      return;
    }
    stepIndex += 1;
    choiceId = '';
  }

  function reset() {
    stepIndex = 0;
    choiceId = '';
    completed = false;
  }
</script>

<section class="scenario-lab card" aria-labelledby="scenario-lab-title">
  <header>
    <div>
      <p class="eyebrow">Offline practice</p>
      <h3 id="scenario-lab-title">Try a guided analyst decision.</h3>
      <p>These fixed exercises cover all three investigation paths. They use reserved fictional domains, make no requests, save nothing, and never produce a finding.</p>
    </div>
    <label><span>Scenario</span>
      <select aria-label="Practice scenario" value={scenarioId} onchange={selectScenario}>
        {#each OFFLINE_INVESTIGATION_SCENARIOS as item}
          <option value={item.id}>{item.label}</option>
        {/each}
      </select>
    </label>
  </header>

  {#if scenario}
    <div class="scenario-context">
      <div><span>Guide</span><strong>{scenario.recipeId.replaceAll('_', ' ')}</strong></div>
      <div><span>Fictional target</span><code>{scenario.target}</code></div>
      <div><span>Learning goal</span><strong>{scenario.learningGoal}</strong></div>
    </div>
    {#if completed}
      <div class="completion" role="status">
        <p class="eyebrow">Scenario complete</p>
        <h4>{scenario.label}</h4>
        <p>You preserved source authority, uncertainty, and analyst responsibility through all {scenario.steps.length} decisions.</p>
        <button class="btn" type="button" onclick={reset}>Replay scenario</button>
      </div>
    {:else if step}
      <div class="step-heading">
        <span>Decision {stepIndex + 1} of {scenario.steps.length}</span>
        <h4>{step.title}</h4>
        <p>{step.prompt}</p>
      </div>
      <ul class="evidence-list" aria-label="Evidence available for this decision">
        {#each step.evidence as item}
          <li>
            <div><strong>{item.source}</strong><span class={`state state-${item.state}`}>{item.state.replaceAll('_', ' ')}</span></div>
            <p>{item.observation}</p>
            <small>{item.limitation}</small>
          </li>
        {/each}
      </ul>
      <fieldset>
        <legend>Choose the most defensible next step</legend>
        {#each step.choices as choice}
          <label class:selected={choiceId === choice.id}>
            <input type="radio" name={`scenario-${scenario.id}-${step.id}`} value={choice.id} bind:group={choiceId}>
            <span>{choice.label}</span>
          </label>
        {/each}
      </fieldset>
      {#if evaluation}
        <div class:correct={evaluation.correct} class="feedback" role="status">
          <strong>{evaluation.correct ? 'Defensible choice' : 'Review the evidence boundary'}</strong>
          <p>{evaluation.feedback}</p>
        </div>
      {/if}
      <div class="actions">
        <button class="btn" type="button" onclick={reset} disabled={stepIndex === 0 && !choiceId}>Reset</button>
        <button class="primary" type="button" onclick={next} disabled={!evaluation?.correct}>{stepIndex === scenario.steps.length - 1 ? 'Complete scenario' : 'Next decision'}</button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .scenario-lab{display:grid;gap:18px;padding:clamp(18px,4vw,28px)}
  header{display:flex;justify-content:space-between;gap:20px;align-items:start}
  header>div{max-width:720px}
  h3,h4,.eyebrow{margin:0}
  header h3{margin-top:4px;font:700 clamp(1.2rem,2.4vw,1.65rem) var(--mono)}
  header p:not(.eyebrow),.step-heading p,.completion p{margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.6}
  header label{display:grid;min-width:min(280px,100%);gap:5px;color:var(--muted);font:700 var(--text-2xs) var(--mono)}
  .scenario-context{display:grid;grid-template-columns:.7fr .8fr 1.5fr;gap:1px;background:var(--border)}
  .scenario-context>div{display:grid;gap:5px;min-width:0;padding:11px;background:var(--panel)}
  .scenario-context span{color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .scenario-context strong,.scenario-context code{font-size:var(--text-xs);overflow-wrap:anywhere}
  .scenario-context code{color:var(--accent)}
  .step-heading{display:grid;gap:5px}
  .step-heading>span{color:var(--accent);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .step-heading h4,.completion h4{font:700 var(--text-lg) var(--mono)}
  .evidence-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(235px,100%),1fr));gap:8px;margin:0;padding:0;list-style:none}
  .evidence-list li{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .evidence-list li>div{display:flex;justify-content:space-between;gap:8px;align-items:start}
  .evidence-list strong{font:700 var(--text-xs) var(--mono)}
  .evidence-list p{margin:9px 0 6px;font-size:var(--text-xs);line-height:1.5}
  .evidence-list small{display:block;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .state{padding:3px 6px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:700 .58rem var(--mono);white-space:nowrap}
  .state-success{border-color:var(--accent2);color:var(--accent2)}.state-partial,.state-inconclusive{border-color:var(--amber);color:var(--amber)}
  fieldset{display:grid;gap:7px;margin:0;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  legend{padding:0 6px;font:700 var(--text-xs) var(--mono)}
  fieldset label{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:start;padding:10px;border:1px solid transparent;border-radius:var(--radius-sm);color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  fieldset label:hover,fieldset label.selected{border-color:var(--border-strong);background:var(--panel-raised);color:var(--text)}
  fieldset input{margin-top:2px}
  .feedback,.completion{padding:14px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .045)}
  .feedback.correct,.completion{border-left-color:var(--accent2);background:rgb(var(--accent2-rgb) / .045)}
  .feedback strong{font:700 var(--text-xs) var(--mono)}
  .feedback p{margin:5px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .actions{display:flex;justify-content:space-between;gap:8px}
  .actions button{min-width:140px}
  @media(max-width:720px){
    header{align-items:stretch;flex-direction:column}
    header label{min-width:0}
    .scenario-context{grid-template-columns:1fr}
    .actions{display:grid;grid-template-columns:1fr}
    .actions button{width:100%}
  }
</style>
