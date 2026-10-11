<script lang="ts">
  import type { CaseRecord } from '#lib/cases.ts';
  import type { PersistCaseResponse } from '#lib/analysis/case-response-stage.ts';
  import { createCaseDraft } from '#lib/controllers/case-draft.svelte.ts';
  import { caseEvidenceLinkIssues, caseEvidenceSharedContext, traceCaseEvidenceSources, type CaseEvidenceLink } from '../../../../packages/cases/case-evidence-links.mts';
  import { MAX_RESPONSE_RATIONALE_LENGTH } from '../../../../packages/contracts/case-portability.mts';
  import CaseDraftRecovery from './CaseDraftRecovery.svelte';
  import CaseEvidencePinSelect from './CaseEvidencePinSelect.svelte';
  import CaseLinkedEvidence from './CaseLinkedEvidence.svelte';
  import Pagination from './Pagination.svelte';

  let { record, persist, mutationBusy }: { record: CaseRecord; persist: PersistCaseResponse; mutationBusy: boolean } = $props();
  const id = $props.id();
  const draft = createCaseDraft(() => record.id, 'evidence-relationship', { fromPinId: '', toPinId: '', kind: 'derived_from' as CaseEvidenceLink['kind'], basis: '' });
  const withdrawal = createCaseDraft(() => record.id, 'evidence-relationship-withdrawal', { id: '', reason: '' });
  const rows = $derived(caseEvidenceLinkIssues(record.evidenceLinks ?? [], record.evidencePins));
  const choices = $derived([
    ...record.assertions.map(item => ({ id: `claim:${item.id}`, group: 'Assessment claims', label: item.statement,
      detail: `${item.kind} · ${item.state}`, pinIds: item.evidencePinIds, relations: item.evidenceRelations ?? [] })),
    ...record.decisions.map(item => ({ id: `decision:${item.id}`, group: 'Recorded decisions', label: item.summary,
      detail: `Decision recorded ${item.createdAt}`, pinIds: item.evidencePinIds, relations: [] })),
    ...record.evidencePins.map((item, index) => ({ id: `pin:${item.id}`, group: 'Evidence pins', label: `${index + 1} · ${item.label}`,
      detail: 'Retained evidence pin', pinIds: [item.id], relations: [] })),
  ]);
  let focus = $state(''), relationshipPage = $state(1), activeCaseId = $state('');
  const selected = $derived(choices.find(choice => choice.id === focus));
  const trace = $derived(selected ? traceCaseEvidenceSources(record.evidenceLinks ?? [], selected.pinIds) : null);
  const shared = $derived(caseEvidenceSharedContext(record.evidencePins).filter(group => !trace || group.pinIds.some(id => trace.pinIds.includes(id))));
  const missing = $derived(trace?.pinIds.filter(id => !record.evidencePins.some(pin => pin.id === id)) ?? []);
  let showHistory = $state(false);
  let historyControl: HTMLInputElement | undefined = $state();
  const displayed = $derived(rows.filter(row => (!row.link.withdrawal || showHistory)
    && (!trace || trace.linkIds.includes(row.link.id) || (showHistory && trace.withdrawnLinkIds.includes(row.link.id)))));
  $effect(() => { if (activeCaseId !== record.id) { activeCaseId = record.id; focus = ''; showHistory = false; } });
  $effect(() => { if (focus && !choices.some(choice => choice.id === focus)) focus = ''; });
  $effect(() => { displayed; relationshipPage = 1; });
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
  <p>A later result may reuse your submitted report. Record known reuse and separately documented observations; otherwise leave independence unknown. Who submitted material alone proves neither. Missing provider results do not prevent a qualified draft.</p>
  {#if choices.length}
    <label class="field source-focus">Trace sources for<select bind:value={focus}>
      <option value="">All evidence relationships</option>
      {#each ['Assessment claims', 'Recorded decisions', 'Evidence pins'] as group}
        {#if choices.some(choice => choice.group === group)}<optgroup label={group}>{#each choices.filter(choice => choice.group === group) as choice (choice.id)}<option value={choice.id}>{choice.label}</option>{/each}</optgroup>{/if}
      {/each}
    </select></label>
  {/if}
  {#if selected && trace}
    <section class="source-trace" aria-label="Selected evidence source trace">
      <h4>{selected.label}</h4><p>{selected.detail}</p>
      <p>Follows active derivations towards their declared sources and shared-source links in either direction. Matching context groups and withdrawn links are not followed.</p>
      {#if selected.pinIds.length}<CaseLinkedEvidence pins={record.evidencePins} ids={selected.pinIds} relations={selected.relations} />
      {:else}<p>This record cites no evidence pins. Its source dependence cannot be traced.</p>{/if}
      {#if missing.length}<p>{missing.length} referenced evidence {missing.length === 1 ? 'pin is' : 'pins are'} not retained. Linked evidence and relationship entries identify the missing references; their content is not reconstructed.</p>{/if}
      {#if displayed.some(row => row.cyclic)}<p>Active derivations contain a cycle. No source order is inferred from those conflicting links.</p>{/if}
      {#if !trace.linkIds.length}<p>No active source relationships are retained for this selection. This does not establish independence.</p>{/if}
      <p role="status">Active relationships in trace: {trace.linkIds.length} · Related withdrawn relationships: {trace.withdrawnLinkIds.length}</p>
    </section>
  {/if}
  {#if shared.length}
    <details><summary>Shared retained context · {shared.length} {shared.length === 1 ? 'group' : 'groups'}</summary>
      <p>Matching source labels, checkpoints or imported content are shown separately. These are overlapping context groups, not counts of independent sources. They do not establish dependence or independent corroboration by themselves.</p>
      {#each shared as group}<p><strong>{group.label}</strong></p><CaseLinkedEvidence pins={record.evidencePins} ids={group.pinIds} />{/each}
    </details>
  {/if}
  {#if rows.length}
    <label class="history-toggle"><input type="checkbox" bind:this={historyControl} bind:checked={showHistory}>Include withdrawn relationships</label>
    <ul class="relationships" aria-label="Analyst-declared evidence relationships">
      {#each displayed.slice((relationshipPage - 1) * 12, relationshipPage * 12) as { link, missingPinIds, cyclic } (link.id)}
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
    <Pagination currentPage={relationshipPage} pageCount={Math.ceil(displayed.length / 12)} setPage={next => relationshipPage = next} ariaLabel="Evidence relationships" />
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
  .source-focus{max-width:760px;margin:16px 0}.source-trace{min-width:0;margin:12px 0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm)}.source-trace h4{margin:0}.source-trace p{margin:8px 0}
</style>
