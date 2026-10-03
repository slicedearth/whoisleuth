<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import type { PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { identityRecoveryFollowUp, reviewIdentityIncident } from '../../../../packages/investigation/identity-incident-review.mts';
  import { createDraftRevision } from '$lib/controllers/submitted-draft.ts';
  import { trackTransientCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import { caseEvidenceChoiceName } from '$lib/analysis/case-evidence-presentation.ts';
  import { IDENTITY_ACTIONS, type IdentityAction } from '../../../../packages/contracts/message-intake.mts';
  let { record, mutationBusy, persist }: { record: CaseRecord; mutationBusy: boolean; persist: PersistCaseResponse } = $props();
  let selected = $state<IdentityAction[]>([]), saved = $state('');
  let pinIds = $state<string[]>([]), saving = $state(false), owner = $state('');
  const draft = createDraftRevision(() => record.id);
  trackTransientCaseDraft(() => selected.length > 0 || pinIds.length > 0);
  $effect(() => { if (owner !== record.id) { owner = record.id; selected = []; pinIds = []; saved = ''; draft.changed(); } });
  const review = $derived(reviewIdentityIncident({ reportedActions: selected }));
  const followUps = $derived(record.assertions.filter(item => item.kind === 'next_step' && item.state === 'open'));
  const internalActions = $derived(record.actions.filter(item => item.type === 'internal_review' || item.type === 'defensive_control'));
  async function recordFollowUp(stepId: string) {
    if (saving || mutationBusy) return;
    const unchanged = draft.capture();
    const request = identityRecoveryFollowUp([...selected], stepId);
    const relations = pinIds.filter(id => record.evidencePins.some(pin => pin.id === id)).map(evidencePinId => ({ evidencePinId, stance: 'unresolved' as const }));
    saving = true;
    try {
      if (await persist({ assertion: { kind: 'next_step', ...request, state: 'open', evidenceRelations: relations } }, 'Recorded an open internal recovery follow-up.') && unchanged()) saved = 'Open follow-up recorded. No recovery action was marked complete.';
    } finally { saving = false; }
  }
  async function recordActions() {
    if (saving || mutationBusy) return;
    const unchanged = draft.capture();
    const submitted = [...selected];
    const statement = `Reported identity actions: ${IDENTITY_ACTIONS.filter(action => submitted.includes(action.id)).map(action => action.label).join('; ')}`;
    saving = true;
    try {
      if (await persist({ assertion: { kind: 'hypothesis', statement, rationale: 'Analyst-recorded report, not independently verified account telemetry.', state: 'open', evidenceRelations: [] } }, 'Recorded the reported account actions.') && unchanged()) saved = 'Reported actions recorded. Recovery actions and follow-ups are recorded below.';
    } finally { saving = false; }
  }
</script>

<details class="identity"><summary>Account and device recovery</summary><div class="body">
  <p>Select what the affected person reports doing. Recovery is tracked separately from removing the page or domain.</p>
  <p>Recommendations are conditional. Recording an open follow-up does not assign a team, revoke a session, reset a credential or establish an independent result. Do not enter credentials or personal account identifiers.</p>
  <fieldset disabled={mutationBusy || saving}><legend>Reported actions</legend>{#each IDENTITY_ACTIONS as action}<label><input type="checkbox" checked={selected.includes(action.id)} onchange={event => { draft.changed(); selected = event.currentTarget.checked ? [...selected, action.id] : selected.filter(id => id !== action.id); saved = ''; }}>{action.label}</label>{/each}</fieldset>
  {#if review.nextSteps.length}
    <button type="button" class="btn" disabled={mutationBusy || saving} onclick={() => { draft.changed(); selected = []; pinIds = []; saved = ''; }}>Clear local recovery selections</button>
    {#if record.evidencePins.length}<fieldset disabled={mutationBusy || saving}><legend>Selected supporting context (relationship remains unresolved)</legend>{#each record.evidencePins as pin, index}<label><input type="checkbox" checked={pinIds.includes(pin.id)} onchange={event => { draft.changed(); pinIds = event.currentTarget.checked ? [...pinIds, pin.id] : pinIds.filter(id => id !== pin.id); saved = ''; }}>{caseEvidenceChoiceName(pin, index)}</label>{/each}</fieldset>{:else}<p>No evidence pins selected or retained; the follow-up remains an unsupported analyst request.</p>{/if}
    <ol>{#each review.nextSteps as step}<li><strong>{step.title}</strong><p>{step.detail}</p><button type="button" class="btn" disabled={mutationBusy || saving} onclick={() => void recordFollowUp(step.id)}>Record as open follow-up: {step.title}</button></li>{/each}</ol><button type="button" class="btn" disabled={mutationBusy || saving} onclick={() => void recordActions()}>Record reported actions in Case</button>
  {/if}
  {#if followUps.length}<details><summary>Retained open follow-ups · {followUps.length}</summary><ul>{#each followUps as item (item.id)}<li>{item.statement}<small>Recorded {item.createdAt}; {item.evidencePinIds.length} linked context pins. Not an assigned or completed action.</small></li>{/each}</ul></details>{/if}
  {#if internalActions.length}<details><summary>Recorded internal and defensive actions · {internalActions.length}</summary><ul>{#each internalActions as item (item.id)}<li>{item.type.replaceAll('_', ' ')} · {item.state}<small>Use the existing action editor for assignment and tracking. State is analyst/provider-recorded, not independent account telemetry.</small></li>{/each}</ul></details>{/if}
  <p>For handoff, use the existing report disclosure preview or full private Case review copy. Response packets do not include these follow-up statements; original files require explicit selection. Independent effects remain in outcome tracking.</p>
  <p role="status">{saved}</p>
</div></details>

<style>.identity{border-block:1px solid var(--border);padding-block:12px;min-width:0}summary{cursor:pointer;padding-block:6px;min-height:32px}.body{display:grid;gap:12px;padding-top:12px;min-width:0}p{margin:0;max-width:85ch}p,li,label,small{font-size:var(--text-xs);line-height:1.6;overflow-wrap:anywhere}small{display:block;color:var(--muted)}fieldset{border:0;padding:0;margin:0}legend{font-size:var(--text-sm);font-weight:600;margin-bottom:6px}label{display:flex;align-items:center;gap:8px;min-height:36px}input{flex:none}ol{display:grid;gap:12px;padding-left:22px;margin:0}button{justify-self:start;white-space:normal;max-width:100%}[role=status]:empty{display:none}</style>
