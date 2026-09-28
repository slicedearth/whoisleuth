<script lang="ts">
  import type { CaseRecord } from '$lib/cases';
  import type { PersistCaseResponse } from '$lib/analysis/case-response-stage.ts';
  import { createCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import { caseEvidenceLinkIssues, caseEvidenceSharedContext, type CaseEvidenceLink } from '../../../../packages/cases/case-evidence-links.mts';
  import { MAX_RESPONSE_RATIONALE_LENGTH } from '../../../../packages/contracts/case-portability.mts';
  import CaseDraftRecovery from './CaseDraftRecovery.svelte';
  import CaseEvidencePinSelect from './CaseEvidencePinSelect.svelte';
  import CaseLinkedEvidence from './CaseLinkedEvidence.svelte';

  let { record, persist, mutationBusy }: { record: CaseRecord; persist: PersistCaseResponse; mutationBusy: boolean } = $props();
  const id = $props.id();
  const draft = createCaseDraft(() => record.id, 'evidence-relationship', { fromPinId: '', toPinId: '', kind: 'derived_from' as CaseEvidenceLink['kind'], basis: '' });
  const withdrawal = createCaseDraft(() => record.id, 'evidence-relationship-withdrawal', { id: '', reason: '' });
  const rows = $derived(caseEvidenceLinkIssues(record.evidenceLinks ?? [], record.evidencePins));
  const shared = $derived(caseEvidenceSharedContext(record.evidencePins));
  let showHistory = $state(false);
  let historyControl: HTMLInputElement | undefined = $state();
  const displayed = $derived(rows.filter(row => showHistory || !row.link.withdrawal));
  async function save() {
    const unchanged = draft.capture();
    if (await draft.persist(persist, { evidenceLink: { ...draft.value } }, 'Recorded the analyst-declared evidence relationship.') && unchanged()) {
      draft.value.fromPinId = ''; draft.value.toPinId = ''; draft.value.basis = '';
    }
  }
  async function withdraw() {
    const unchanged = withdrawal.capture();
    if (await withdrawal.persist(persist, { evidenceLinkWithdrawal: { ...withdrawal.value } }, 'Withdrew the relationship; its original basis remains in history.', () => historyControl ?? null) && unchanged()) {
      withdrawal.value.id = ''; withdrawal.value.reason = '';
    }
  }
</script>

<details class="evidence-relationships">
  <summary>Evidence relationships and shared sources</summary>
  {#if shared.length}
    <details><summary>Shared retained context · {shared.length} {shared.length === 1 ? 'group' : 'groups'}</summary>
      <p>Matching source labels, checkpoints or imported content are shown separately. They do not establish independent corroboration.</p>
      {#each shared as group}<p><strong>{group.label}</strong></p><CaseLinkedEvidence pins={record.evidencePins} ids={group.pinIds} />{/each}
    </details>
  {/if}
  {#if rows.length}
    <label class="history-toggle"><input type="checkbox" bind:this={historyControl} bind:checked={showHistory}>Include withdrawn relationships</label>
    <ul class="relationships" aria-label="Analyst-declared evidence relationships">
      {#each displayed as { link, missingPinIds, cyclic }}
        <li><strong>{record.evidencePins.find(pin => pin.id === link.fromPinId)?.label ?? link.fromPinId}</strong>
          {link.kind === 'derived_from' ? 'derived from' : 'shares a source with'}
          <strong>{record.evidencePins.find(pin => pin.id === link.toPinId)?.label ?? link.toPinId}</strong>
          <p>{link.basis}</p><small>Analyst declaration · recorded {link.createdAt}</small>
          {#if missingPinIds.length}<p>Referenced evidence is not retained: {missingPinIds.join(', ')}.</p>{/if}
          {#if cyclic}<p>Imported derivations contain a cycle. Review these conflicting links; no order is inferred.</p>{/if}
          <details><summary>Referenced evidence</summary><CaseLinkedEvidence pins={record.evidencePins} ids={[link.fromPinId, link.toPinId]} /></details>
          {#if link.withdrawal}<p>Withdrawn {link.withdrawal.at}: {link.withdrawal.reason}</p>{/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if record.evidencePins.length > 1}
    <form class="relationship-form" aria-label="Record evidence relationship" data-recovery-form={draft.form} oninput={draft.changed} onsubmit={event => { event.preventDefault(); void save(); }}>
      <CaseEvidencePinSelect label="Evidence pin" pins={record.evidencePins} bind:value={draft.value.fromPinId} required />
      <div class="field"><label for={`${id}-kind`}>Relationship</label><select id={`${id}-kind`} bind:value={draft.value.kind}><option value="derived_from">Derived from</option><option value="shared_source">Shares a source with</option></select></div>
      <CaseEvidencePinSelect label="Source evidence pin" pins={record.evidencePins} bind:value={draft.value.toPinId} required />
      <label class="field">Attribution basis<textarea bind:value={draft.value.basis} rows="2" maxlength={MAX_RESPONSE_RATIONALE_LENGTH} required></textarea></label>
      <button class="btn" type="submit" disabled={mutationBusy || draft.state.busy}>Record relationship</button>
      <CaseDraftRecovery {draft} />
    </form>
  {:else}<p>Retain two evidence pins to record their relationship.</p>{/if}
  {#if rows.some(row => !row.link.withdrawal)}
    <details><summary>Withdraw a relationship</summary>
      <form class="relationship-form" aria-label="Withdraw evidence relationship" data-recovery-form={withdrawal.form} oninput={withdrawal.changed} onsubmit={event => { event.preventDefault(); void withdraw(); }}>
        <div class="field"><label for={`${id}-withdraw`}>Relationship to withdraw</label><select id={`${id}-withdraw`} bind:value={withdrawal.value.id} required><option value="">Select a relationship</option>{#each rows.filter(row => !row.link.withdrawal) as { link }}<option value={link.id}>{record.evidencePins.find(pin => pin.id === link.fromPinId)?.label ?? link.fromPinId} · {link.kind.replaceAll('_', ' ')} · {record.evidencePins.find(pin => pin.id === link.toPinId)?.label ?? link.toPinId}</option>{/each}</select></div>
        <label class="field">Withdrawal reason<textarea bind:value={withdrawal.value.reason} rows="2" maxlength={MAX_RESPONSE_RATIONALE_LENGTH} required></textarea></label>
        <button class="btn" type="submit" disabled={mutationBusy || withdrawal.state.busy}>Withdraw relationship</button>
        <CaseDraftRecovery draft={withdrawal} />
      </form>
    </details>
  {/if}
</details>

<style>
  .evidence-relationships{min-width:0;overflow-wrap:anywhere}.evidence-relationships summary{padding:12px 0}
  .relationship-form{display:grid;gap:12px;margin:16px 0;max-width:760px}.field{display:grid;gap:5px}select,textarea{width:100%;min-width:0;max-width:100%}
  .relationships{padding:0;list-style:none;display:grid;gap:12px}.relationships li{padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);min-width:0}
  .history-toggle{display:flex;align-items:center;gap:8px;padding:12px 0}.relationships p{margin:8px 0}
</style>
