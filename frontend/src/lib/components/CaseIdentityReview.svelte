<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import type { PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { reviewIdentityIncident } from '../../../../packages/investigation/identity-incident-review.mts';
  import { IDENTITY_ACTIONS, type IdentityAction } from '../../../../packages/contracts/message-intake.mts';
  let { record, mutationBusy, persist }: { record: CaseRecord; mutationBusy: boolean; persist: PersistCaseResponse } = $props();
  let selected = $state<IdentityAction[]>([]), saved = $state('');
  const review = $derived(reviewIdentityIncident({ reportedActions: selected }));
  async function recordActions() {
    const submitted = [...selected];
    const statement = `Reported identity actions: ${IDENTITY_ACTIONS.filter(action => submitted.includes(action.id)).map(action => action.label).join('; ')}`;
    if (await persist({ assertion: { kind: 'hypothesis', statement, rationale: 'Analyst-recorded report, not independently verified account telemetry.', state: 'open', evidenceRelations: [] } }, 'Recorded the reported account actions.')) saved = 'Reported actions recorded. Recovery actions and follow-ups are recorded below.';
  }
</script>

<details class="identity"><summary>Account and device recovery</summary><div class="body">
  <p>Select what the affected person reports doing. Recovery is tracked separately from removing the page or domain.</p>
  <fieldset disabled={mutationBusy}><legend>Reported actions</legend>{#each IDENTITY_ACTIONS as action}<label><input type="checkbox" checked={selected.includes(action.id)} onchange={event => { selected = event.currentTarget.checked ? [...selected, action.id] : selected.filter(id => id !== action.id); saved = ''; }}>{action.label}</label>{/each}</fieldset>
  {#if review.nextSteps.length}<ol>{#each review.nextSteps as step}<li><strong>{step.title}</strong><p>{step.detail}</p></li>{/each}</ol><button type="button" class="btn" disabled={mutationBusy} onclick={() => void recordActions()}>Record reported actions in Case</button>{/if}
  <p role="status">{saved}</p>
</div></details>

<style>.identity{border-block:1px solid var(--border);padding-block:12px;min-width:0}summary{cursor:pointer;padding-block:6px;min-height:32px}.body{display:grid;gap:12px;padding-top:12px;min-width:0}p{margin:0;max-width:85ch}p,li,label{font-size:var(--text-xs);line-height:1.6}fieldset{border:0;padding:0;margin:0}legend{font-size:var(--text-sm);font-weight:600;margin-bottom:6px}label{display:flex;align-items:center;gap:8px;min-height:36px}input{flex:none}ol{display:grid;gap:12px;padding-left:22px;margin:0}button{justify-self:start;white-space:normal;max-width:100%}[role=status]:empty{display:none}</style>
