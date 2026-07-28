<script lang="ts">
  import {
    CASE_ACTION_STATES,
    CASE_ACTION_TYPES,
    CASE_ASSERTION_KINDS,
    CASE_ASSERTION_STATES,
    CASE_MANUAL_TRAIL_KINDS,
    CASE_PIN_COMPLETENESS,
    editCase,
    type CaseActionRecord,
    type CaseRecord,
  } from '$lib/cases';
  import { buildCaseInvestigationTrail } from '$lib/analysis/case-response-model.ts';
  import {
    buildCaseResponsePacket,
    caseResponsePacketFilename,
    RESPONSE_CONTACT_KINDS,
    type ResponseContactKind,
  } from '$lib/analysis/case-response-packet.ts';

  let {
    record,
    onsaved,
    onmessage,
  }: {
    record: CaseRecord;
    onsaved: () => void | Promise<void>;
    onmessage: (message: string) => void;
  } = $props();

  let pinLabel = $state('');
  let pinValue = $state('');
  let pinSource = $state('lookup evidence');
  let pinObservedAt = $state('');
  let pinCompleteness = $state('complete');
  let pinLimitations = $state('');
  let decisionSummary = $state('');
  let decisionRationale = $state('');
  let decisionPinIds = $state<string[]>([]);
  let actionType = $state('internal_review');
  let actionRecipient = $state('');
  let actionContactSource = $state('analyst supplied');
  let actionLimitations = $state('');
  let actionDueAt = $state('');
  let actionState = $state('planned');
  let actionReference = $state('');
  let actionFollowUpAt = $state('');
  let actionOutcome = $state('');
  let selectedActionId = $state('');
  let assertionKind = $state('hypothesis');
  let assertionStatement = $state('');
  let assertionRationale = $state('');
  let assertionPinIds = $state<string[]>([]);
  let assertionState = $state('open');
  let trailKind = $state('pivot');
  let trailSummary = $state('');
  let trailTarget = $state('');
  const investigationTrail = $derived(buildCaseInvestigationTrail(record));

  let packetCategory = $state('');
  let packetAffectedParty = $state('');
  let packetUrls = $state('');
  let packetHarm = $state('');
  let packetObservedAt = $state('');
  let packetContacts = $state<Record<ResponseContactKind, string>>({
    registrar: '',
    registry: '',
    network_hosting: '',
    security_txt: '',
  });
  let packetContactSources = $state<Record<ResponseContactKind, string>>({
    registrar: 'RDAP or WHOIS',
    registry: 'registry evidence',
    network_hosting: 'network or hosting evidence',
    security_txt: 'security.txt',
  });
  let packetContactLimitations = $state<Record<ResponseContactKind, string>>({
    registrar: '',
    registry: '',
    network_hosting: '',
    security_txt: '',
  });
  let packetBusy = $state(false);

  function isoFromLocal(value: string): string | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  function localFromIso(value: string | null): string {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    const adjusted = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
    return adjusted.toISOString().slice(0, 16);
  }

  function list(value: string): string[] {
    return value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
  }

  function countLabel(count: number, singular: string): string {
    return `${count} ${singular}${count === 1 ? '' : 's'}`;
  }

  async function persist(patch: Parameters<typeof editCase>[1], success: string) {
    try {
      const { pruned } = await editCase(record.id, patch);
      await onsaved();
      onmessage(`${success}${pruned ? ` Pruned ${pruned} old evidence snapshot${pruned === 1 ? '' : 's'} to stay within storage.` : ''}`);
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'Could not update the case response record.');
    }
  }

  async function addPin() {
    await persist({
      evidencePin: {
        label: pinLabel,
        value: pinValue,
        source: pinSource,
        observedAt: isoFromLocal(pinObservedAt) || new Date().toISOString(),
        completeness: pinCompleteness,
        limitations: list(pinLimitations),
      },
    }, `Pinned analyst-selected evidence for ${record.domain}.`);
    pinLabel = '';
    pinValue = '';
    pinLimitations = '';
  }

  async function addDecision() {
    await persist({
      decision: {
        summary: decisionSummary,
        rationale: decisionRationale,
        evidencePinIds: decisionPinIds,
      },
    }, `Recorded an analyst decision for ${record.domain}.`);
    decisionSummary = '';
    decisionRationale = '';
    decisionPinIds = [];
  }

  async function addAssertion() {
    await persist({
      assertion: {
        kind: assertionKind,
        statement: assertionStatement,
        rationale: assertionRationale,
        evidencePinIds: assertionPinIds,
        state: assertionState,
      },
    }, `Recorded a structured analyst assertion for ${record.domain}.`);
    assertionKind = 'hypothesis';
    assertionStatement = '';
    assertionRationale = '';
    assertionPinIds = [];
    assertionState = 'open';
  }

  async function setAssertionState(id: string, state: string) {
    await persist({ assertionUpdate: { id, state } }, `Updated the analyst assertion for ${record.domain}.`);
  }

  async function addTrailEvent() {
    await persist({
      trailEvent: {
        kind: trailKind,
        summary: trailSummary,
        target: trailTarget,
      },
    }, `Recorded a manual investigation step for ${record.domain}.`);
    trailKind = 'pivot';
    trailSummary = '';
    trailTarget = '';
  }

  function actionInput() {
    return {
      type: actionType,
      recipient: actionRecipient,
      contactSource: actionContactSource,
      contactLimitations: list(actionLimitations),
      dueAt: isoFromLocal(actionDueAt),
      state: actionState,
      reference: actionReference,
      followUpAt: isoFromLocal(actionFollowUpAt),
      outcome: actionOutcome,
    };
  }

  function clearAction() {
    selectedActionId = '';
    actionType = 'internal_review';
    actionRecipient = '';
    actionContactSource = 'analyst supplied';
    actionLimitations = '';
    actionDueAt = '';
    actionState = 'planned';
    actionReference = '';
    actionFollowUpAt = '';
    actionOutcome = '';
  }

  function selectAction(id: string) {
    selectedActionId = id;
    const action = record.actions.find((item) => item.id === id);
    if (!action) {
      clearAction();
      return;
    }
    actionType = action.type;
    actionRecipient = action.recipient;
    actionContactSource = action.contactSource;
    actionLimitations = action.contactLimitations.join('\n');
    actionDueAt = localFromIso(action.dueAt);
    actionState = action.state;
    actionReference = action.reference || '';
    actionFollowUpAt = localFromIso(action.followUpAt);
    actionOutcome = action.outcome || '';
  }

  async function saveAction() {
    const patch = selectedActionId
      ? { actionUpdate: { id: selectedActionId, ...actionInput() } }
      : { action: actionInput() };
    await persist(patch, `${selectedActionId ? 'Updated' : 'Recorded'} a case action for ${record.domain}.`);
    clearAction();
  }

  function packetContactsInput() {
    return RESPONSE_CONTACT_KINDS.flatMap((kind) => packetContacts[kind].trim()
      ? [{
          kind,
          contact: packetContacts[kind],
          source: packetContactSources[kind],
          limitations: list(packetContactLimitations[kind]),
        }]
      : []);
  }

  function packet(generatedAt: string = new Date().toISOString()) {
    return buildCaseResponsePacket(record, {
      category: packetCategory,
      affectedParty: packetAffectedParty,
      abusiveUrls: packetUrls,
      observedHarm: packetHarm,
      observedAt: isoFromLocal(packetObservedAt),
      contacts: packetContactsInput(),
    }, generatedAt);
  }

  async function downloadPacket(format: 'json' | 'md' | 'txt') {
    if (packetBusy) return;
    packetBusy = true;
    try {
      const generatedAt = new Date().toISOString();
      const built = await packet(generatedAt);
      const content = format === 'json'
        ? JSON.stringify(built.json, null, 2)
        : format === 'md'
          ? built.markdown
          : built.email;
      const url = URL.createObjectURL(new Blob([content], {
        type: format === 'json' ? 'application/json' : format === 'md' ? 'text/markdown' : 'text/plain',
      }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = caseResponsePacketFilename(record.domain, format, generatedAt);
      anchor.click();
      URL.revokeObjectURL(url);
      onmessage(`Exported a ${format === 'txt' ? 'plain-text email draft' : format.toUpperCase()} response packet for review. Nothing was submitted.`);
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'Could not prepare the response packet.');
    } finally {
      packetBusy = false;
    }
  }

  async function copyEmail() {
    if (packetBusy) return;
    packetBusy = true;
    try {
      await navigator.clipboard.writeText((await packet()).email);
      onmessage('Copied the response email draft. Nothing was submitted.');
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'Clipboard access was unavailable.');
    } finally {
      packetBusy = false;
    }
  }
</script>

<section class="response-workspace" aria-labelledby={`response-title-${record.id}`}>
  <header>
    <div><p class="eyebrow">Reviewed response</p><h3 id={`response-title-${record.id}`}>Evidence, reasoning, and actions</h3></div>
    <span>{countLabel(record.evidencePins.length, 'pin')} · {countLabel(record.decisions.length, 'decision')} · {countLabel(record.assertions.length, 'assertion')} · {countLabel(record.actions.length, 'action')}</span>
  </header>

  <details>
    <summary>Pin an observed fact</summary>
    <form class="response-form" onsubmit={(event) => { event.preventDefault(); void addPin(); }}>
      <div class="two-columns">
        <label class="field">Label<input bind:value={pinLabel} maxlength="80" required placeholder="Observed login form"></label>
        <label class="field">Source<input bind:value={pinSource} maxlength="80" required placeholder="Lookup evidence"></label>
        <label class="field">Observed at<input type="datetime-local" bind:value={pinObservedAt}></label>
        <label class="field">Completeness<select bind:value={pinCompleteness}>{#each CASE_PIN_COMPLETENESS as value}<option {value}>{value}</option>{/each}</select></label>
      </div>
      <label class="field">Fact<textarea bind:value={pinValue} maxlength="1000" rows="2" required></textarea></label>
      <label class="field">Limitations <small>one per line</small><textarea bind:value={pinLimitations} maxlength="2000" rows="2"></textarea></label>
      <button class="btn" type="submit">Pin evidence</button>
    </form>
    {#if record.evidencePins.length}
      <ol class="records">{#each [...record.evidencePins].reverse() as pin}<li><strong>{pin.label}</strong><p>{pin.value}</p><small>{pin.source} · {pin.completeness} · {pin.observedAt}</small>{#if pin.limitations.length}<small>Limits: {pin.limitations.join('; ')}</small>{/if}</li>{/each}</ol>
    {/if}
  </details>

  <details>
    <summary>Record an analyst decision</summary>
    <form class="response-form" onsubmit={(event) => { event.preventDefault(); void addDecision(); }}>
      <label class="field">Decision summary<input bind:value={decisionSummary} maxlength="80" required></label>
      <label class="field">Rationale<textarea bind:value={decisionRationale} maxlength="2000" rows="3" required></textarea></label>
      {#if record.evidencePins.length}
        <fieldset class="pin-references"><legend>Supporting evidence pins</legend>{#each record.evidencePins as pin}<label class="choice"><input type="checkbox" checked={decisionPinIds.includes(pin.id)} onchange={(event) => decisionPinIds = event.currentTarget.checked ? [...decisionPinIds, pin.id] : decisionPinIds.filter((id) => id !== pin.id)}><span>{pin.label}</span></label>{/each}</fieldset>
      {/if}
      <button class="btn" type="submit">Record decision</button>
    </form>
    {#if record.decisions.length}
      <ol class="records">{#each [...record.decisions].reverse() as decision}<li><strong>{decision.summary}</strong><p>{decision.rationale}</p><small>{decision.createdAt}{decision.evidencePinIds.length ? ` · ${decision.evidencePinIds.length} supporting pin${decision.evidencePinIds.length === 1 ? '' : 's'}` : ''}</small></li>{/each}</ol>
    {/if}
  </details>

  <details>
    <summary>Structure facts, hypotheses, unknowns, and next steps</summary>
    <form class="stack" onsubmit={(event) => { event.preventDefault(); void addAssertion(); }}>
      <div class="two-columns">
        <label class="field">Assertion type<select bind:value={assertionKind}>{#each CASE_ASSERTION_KINDS as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
        <label class="field">State<select bind:value={assertionState}>{#each CASE_ASSERTION_STATES as value}<option {value}>{value}</option>{/each}</select></label>
      </div>
      <label class="field">Statement<textarea bind:value={assertionStatement} maxlength="2000" rows="3" required></textarea></label>
      <label class="field">Reasoning or limitation<textarea bind:value={assertionRationale} maxlength="2000" rows="2"></textarea></label>
      {#if record.evidencePins.length}
        <fieldset class="pin-references"><legend>Supporting evidence pins</legend>{#each record.evidencePins as pin}<label class="choice"><input type="checkbox" checked={assertionPinIds.includes(pin.id)} onchange={(event) => assertionPinIds = event.currentTarget.checked ? [...assertionPinIds, pin.id] : assertionPinIds.filter((id) => id !== pin.id)}><span>{pin.label}</span></label>{/each}</fieldset>
      {/if}
      <button class="btn" type="submit">Record assertion</button>
    </form>
    {#if record.assertions.length}
      <ol class="records">{#each [...record.assertions].reverse() as assertion}<li><strong>{assertion.kind.replaceAll('_', ' ')} · {assertion.state}</strong><p>{assertion.statement}</p>{#if assertion.rationale}<p>{assertion.rationale}</p>{/if}<small>updated {assertion.updatedAt}{assertion.evidencePinIds.length ? ` · ${assertion.evidencePinIds.length} supporting pin${assertion.evidencePinIds.length === 1 ? '' : 's'}` : ''}</small>{#if assertion.state === 'open'}<button class="btn small" type="button" onclick={() => void setAssertionState(assertion.id, 'resolved')}>Mark resolved</button>{/if}</li>{/each}</ol>
    {/if}
  </details>

  <details>
    <summary>Record and review the investigation trail</summary>
    <form class="stack" onsubmit={(event) => { event.preventDefault(); void addTrailEvent(); }}>
      <label class="field">Manual step type<select bind:value={trailKind}>{#each CASE_MANUAL_TRAIL_KINDS as value}<option {value}>{value}</option>{/each}</select></label>
      <label class="field">What did you do or decide?<textarea bind:value={trailSummary} maxlength="2000" rows="2" required></textarea></label>
      <label class="field">Target or destination <small>optional; do not paste credentials or sensitive query strings</small><input bind:value={trailTarget} maxlength="500"></label>
      <button class="btn" type="submit">Record manual step</button>
    </form>
    {#if investigationTrail.length}
      <ol class="records trail">{#each investigationTrail as item}<li><strong>{item.label}</strong><p>{item.detail}</p><small>{item.createdAt}</small></li>{/each}</ol>
    {:else}
      <p class="notice">No explicit case reasoning, actions, or manual pivots have been recorded. Browser navigation is not tracked.</p>
    {/if}
  </details>

  <details>
    <summary>Track a reviewed action or outcome</summary>
    <form class="response-form" onsubmit={(event) => { event.preventDefault(); void saveAction(); }}>
      {#if record.actions.length}
        <label class="field">Edit existing action<select value={selectedActionId} onchange={(event) => selectAction(event.currentTarget.value)}><option value="">Create a new action</option>{#each record.actions as action}<option value={action.id}>{action.type.replaceAll('_', ' ')} · {action.recipient}</option>{/each}</select></label>
      {/if}
      <div class="two-columns">
        <label class="field">Action type<select bind:value={actionType}>{#each CASE_ACTION_TYPES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
        <label class="field">State<select bind:value={actionState}>{#each CASE_ACTION_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
        <label class="field">Recipient or internal owner<input bind:value={actionRecipient} maxlength="320" required></label>
        <label class="field">Contact source<input bind:value={actionContactSource} maxlength="80" required></label>
        <label class="field">Due at<input type="datetime-local" bind:value={actionDueAt}></label>
        <label class="field">Follow-up at<input type="datetime-local" bind:value={actionFollowUpAt}></label>
      </div>
      <label class="field">Reference<input bind:value={actionReference} maxlength="500" placeholder="Ticket or provider reference"></label>
      <label class="field">Contact limitations <small>one per line</small><textarea bind:value={actionLimitations} maxlength="2000" rows="2"></textarea></label>
      <label class="field">Outcome<textarea bind:value={actionOutcome} maxlength="2000" rows="2"></textarea></label>
      <div class="actions"><button class="btn" type="submit">{selectedActionId ? 'Update action' : 'Record action'}</button>{#if selectedActionId}<button class="btn" type="button" onclick={clearAction}>Cancel edit</button>{/if}</div>
    </form>
    {#if record.actions.length}
      <ol class="records">{#each [...record.actions].reverse() as action}<li><strong>{action.type.replaceAll('_', ' ')} · {action.state.replaceAll('_', ' ')}</strong><p>{action.recipient}</p><small>{action.contactSource} · updated {action.updatedAt}</small>{#if action.outcome}<p>Outcome: {action.outcome}</p>{/if}</li>{/each}</ol>
    {/if}
  </details>

  <details>
    <summary>Prepare a reviewed abuse evidence packet</summary>
    <form class="response-form packet-form" onsubmit={(event) => event.preventDefault()}>
      <p class="notice">This prepares local JSON, Markdown, or plain-text drafts only. WHOISleuth does not send reports. JSON and Markdown include observation-age context, reviewed action history, and a canonical SHA-256 digest for later integrity checks.</p>
      <div class="two-columns">
        <label class="field">Abuse category<input bind:value={packetCategory} maxlength="80" required placeholder="Credential phishing"></label>
        <label class="field">Affected party<input bind:value={packetAffectedParty} maxlength="200" required></label>
        <label class="field">Observed at<input type="datetime-local" bind:value={packetObservedAt} required></label>
      </div>
      <label class="field">Exact abusive HTTP(S) URLs <small>one per line</small><textarea bind:value={packetUrls} maxlength="42000" rows="3" required></textarea></label>
      <label class="field">Observed harm<textarea bind:value={packetHarm} maxlength="2000" rows="3" required></textarea></label>
      <fieldset class="contacts"><legend>Separately routed escalation contacts</legend>
        {#each RESPONSE_CONTACT_KINDS as kind}
          <div class="contact-row">
            <strong>{kind.replaceAll('_', ' ')}</strong>
            <label class="field">Contact<input bind:value={packetContacts[kind]} maxlength="320"></label>
            <label class="field">Source<input bind:value={packetContactSources[kind]} maxlength="120"></label>
            <label class="field">Limitations<input bind:value={packetContactLimitations[kind]} maxlength="240"></label>
          </div>
        {/each}
      </fieldset>
      <div class="actions"><button class="btn" type="button" onclick={() => void downloadPacket('json')} disabled={packetBusy}>Export JSON</button><button class="btn" type="button" onclick={() => void downloadPacket('md')} disabled={packetBusy}>Export Markdown</button><button class="btn" type="button" onclick={() => void downloadPacket('txt')} disabled={packetBusy}>Export email draft</button><button class="btn" type="button" onclick={() => void copyEmail()} disabled={packetBusy}>Copy email draft</button></div>
    </form>
  </details>
</section>

<style>
  .response-workspace{display:grid;gap:10px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  header{display:flex;flex-wrap:wrap;align-items:start;justify-content:space-between;gap:10px}h3{margin:0}header>span{color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  details{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  summary{padding:11px 12px;cursor:pointer;font:700 var(--text-xs) var(--mono)}details[open]>summary{border-bottom:1px solid var(--border)}
  .response-form{display:grid;gap:10px;padding:12px}.two-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  textarea,input,select{width:100%}.field small{color:var(--muted)}
  .records{display:grid;gap:8px;margin:0;padding:0 12px 12px;list-style:none}.records li{padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .records strong,.records small{display:block}.records p{margin:5px 0;white-space:pre-wrap;overflow-wrap:anywhere}.records small{color:var(--muted);font-size:var(--text-2xs)}
  .pin-references,.contacts{display:grid;gap:8px;margin:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm)}legend{padding:0 5px;font:700 var(--text-xs) var(--mono)}
  .actions{display:flex;flex-wrap:wrap;gap:8px}.notice{margin:0;padding:9px 10px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .06);color:var(--muted);font-size:var(--text-xs)}
  .contact-row{display:grid;grid-template-columns:130px repeat(3,minmax(0,1fr));gap:8px;align-items:end}.contact-row>strong{padding-bottom:10px;font:700 var(--text-xs) var(--mono);text-transform:capitalize}
  @media(max-width:800px){.two-columns,.contact-row{grid-template-columns:1fr}.contact-row>strong{padding:4px 0 0}.actions .btn{flex:1 1 150px}}
</style>
