<script lang="ts">
  import {
    CASE_ACTION_STATES,
    CASE_ACTION_TYPES,
    CASE_ASSERTION_KINDS,
    CASE_ASSERTION_STATES,
    CASE_EVIDENCE_RELATION_STANCES,
    CASE_MANUAL_TRAIL_KINDS,
    CASE_PIN_COMPLETENESS,
    CASE_SIGHTING_CATEGORIES,
    CASE_SIGHTING_STATES,
    editCase,
    type CaseActionRecord,
    type CaseEvidenceRelationStance,
    type CaseRecord,
  } from '$lib/cases';
  import {
    buildCaseActionOutcomeSummary,
    buildCaseInvestigationTrail,
  } from '$lib/analysis/case-response-model.ts';
  import { buildCaseSightingChronology } from '$lib/analysis/case-sighting-chronology.ts';
  import {
    buildCaseResponsePacket,
    buildCaseResponsePreflight,
    buildResponsePacketProfilePreview,
    caseResponsePacketFilename,
    RESPONSE_CONTACT_KINDS,
    RESPONSE_PACKET_PROFILES,
    type CaseResponsePacketInput,
    type ResponseContactKind,
    type ResponsePacketProfileId,
  } from '$lib/analysis/case-response-packet.ts';
  import CaseInvestigationBranches from '$lib/components/CaseInvestigationBranches.svelte';

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
  let assertionEvidenceRelations = $state<Array<{ evidencePinId: string; stance: CaseEvidenceRelationStance }>>([]);
  let assertionState = $state('open');
  let trailKind = $state('pivot');
  let trailSummary = $state('');
  let trailTarget = $state('');
  let sightingState = $state('observed_by_deployment');
  let sightingCategory = $state('website');
  let sightingSource = $state('WHOISleuth deep lookup');
  let sightingObservedAt = $state('');
  let sightingCompleteness = $state('complete');
  let sightingEvidencePinId = $state('');
  let sightingLimitations = $state('');
  const investigationTrail = $derived(buildCaseInvestigationTrail(record));
  const sightingChronology = $derived(buildCaseSightingChronology(record.sightings));
  const sightingReviewConclusionCount = $derived(
    record.sightings.filter((sighting) =>
      sighting.state === 'not_reproduced' || sighting.state === 'expired').length,
  );

  let packetCategory = $state('');
  let packetProfile = $state<ResponsePacketProfileId>('internal_soc');
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
  const reviewNow = new Date().toISOString();
  const actionSummary = $derived(buildCaseActionOutcomeSummary(record.actions, reviewNow));
  const packetPreflight = $derived(buildCaseResponsePreflight(record, packetInput(), reviewNow));
  const packetProfilePreview = $derived(buildResponsePacketProfilePreview(record, packetInput()));

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
        evidenceRelations: assertionEvidenceRelations,
        state: assertionState,
      },
    }, `Recorded a structured analyst assertion for ${record.domain}.`);
    assertionKind = 'hypothesis';
    assertionStatement = '';
    assertionRationale = '';
    assertionEvidenceRelations = [];
    assertionState = 'open';
  }

  function assertionEvidenceStance(evidencePinId: string): string {
    return assertionEvidenceRelations.find((item) => item.evidencePinId === evidencePinId)?.stance ?? '';
  }

  function setAssertionEvidenceStance(evidencePinId: string, stance: string) {
    assertionEvidenceRelations = assertionEvidenceRelations.filter((item) => item.evidencePinId !== evidencePinId);
    if (CASE_EVIDENCE_RELATION_STANCES.includes(stance as CaseEvidenceRelationStance)) {
      assertionEvidenceRelations = [...assertionEvidenceRelations, { evidencePinId, stance: stance as CaseEvidenceRelationStance }];
    }
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

  async function addSighting() {
    await persist({
      sighting: {
        state: sightingState,
        category: sightingCategory,
        source: sightingSource,
        observedAt: isoFromLocal(sightingObservedAt) || new Date().toISOString(),
        completeness: sightingCompleteness,
        evidencePinId: sightingEvidencePinId || null,
        limitations: list(sightingLimitations),
      },
    }, `Recorded a source-qualified sighting for ${record.domain}.`);
    sightingLimitations = '';
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

  function packetInput(): CaseResponsePacketInput {
    return {
      profile: packetProfile,
      category: packetCategory,
      affectedParty: packetAffectedParty,
      abusiveUrls: packetUrls,
      observedHarm: packetHarm,
      observedAt: isoFromLocal(packetObservedAt),
      contacts: packetContactsInput(),
    };
  }

  function packet(generatedAt: string = new Date().toISOString()) {
    return buildCaseResponsePacket(record, packetInput(), generatedAt);
  }

  function contactKind(action: CaseActionRecord): ResponseContactKind | null {
    if (action.type === 'registrar_report') return 'registrar';
    if (action.type === 'registry_report') return 'registry';
    if (action.type === 'network_hosting_report') return 'network_hosting';
    if (action.type === 'security_contact_report') return 'security_txt';
    return null;
  }

  function useRecordedActionRoutes() {
    let added = 0;
    const contacts = { ...packetContacts };
    const sources = { ...packetContactSources };
    const limitations = { ...packetContactLimitations };
    for (const action of [...record.actions].reverse()) {
      const kind = contactKind(action);
      if (!kind || contacts[kind]) continue;
      contacts[kind] = action.recipient;
      sources[kind] = action.contactSource;
      limitations[kind] = action.contactLimitations.join('\n');
      added += 1;
    }
    packetContacts = contacts;
    packetContactSources = sources;
    packetContactLimitations = limitations;
    onmessage(added
      ? `Loaded ${added} recorded case contact route${added === 1 ? '' : 's'} into the local packet draft.`
      : 'No unused external contact route was available in the recorded case actions.');
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

<section id={`case-response-${record.id}`} class="response-workspace" aria-labelledby={`response-title-${record.id}`} tabindex="-1">
  <header>
    <div><p class="eyebrow">Reviewed response</p><h3 id={`response-title-${record.id}`}>Evidence, reasoning, and actions</h3></div>
    <span>{countLabel(record.evidencePins.length, 'pin')} · {countLabel(record.sightings.length, 'sighting')} · {countLabel(record.decisions.length, 'decision')} · {countLabel(record.assertions.length, 'assertion')} · {countLabel(record.actions.length, 'action')} · {countLabel(record.branches?.length ?? 0, 'branch')}</span>
  </header>
  {#if actionSummary.total}
    <div class="action-summary" role="group" aria-label="Case action outcome summary">
      <span><strong>{actionSummary.active}</strong> active</span>
      <span><strong>{actionSummary.submitted}</strong> submitted</span>
      <span><strong>{actionSummary.acknowledged}</strong> acknowledged</span>
      <span><strong>{actionSummary.resolved}</strong> resolved</span>
      <span><strong>{actionSummary.closed}</strong> closed</span>
      <span class:attention={actionSummary.overdue > 0}><strong>{actionSummary.overdue}</strong> overdue</span>
      <span class:attention={actionSummary.followUpDue > 0}><strong>{actionSummary.followUpDue}</strong> follow-up due</span>
    </div>
  {/if}

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
    <summary>Record a source-qualified sighting</summary>
    <form class="response-form" onsubmit={(event) => { event.preventDefault(); void addSighting(); }}>
      <p class="notice">Use observed or reported states for source evidence. Analyst confirmed, not reproduced, and expired are review conclusions and do not alter the original observation.</p>
      <div class="two-columns">
        <label class="field">Sighting state<select bind:value={sightingState}>{#each CASE_SIGHTING_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label>
        <label class="field">Evidence category<select bind:value={sightingCategory}>{#each CASE_SIGHTING_CATEGORIES as value}<option {value}>{value}</option>{/each}</select></label>
        <label class="field">Source<input bind:value={sightingSource} maxlength="80" required></label>
        <label class="field">Observed or reviewed at<input type="datetime-local" bind:value={sightingObservedAt}></label>
        <label class="field">Completeness<select bind:value={sightingCompleteness}>{#each CASE_PIN_COMPLETENESS as value}<option {value}>{value}</option>{/each}</select></label>
        {#if record.evidencePins.length}<label class="field">Supporting evidence pin<select bind:value={sightingEvidencePinId}><option value="">No pin selected</option>{#each record.evidencePins as pin}<option value={pin.id}>{pin.label}</option>{/each}</select></label>{/if}
      </div>
      <label class="field">Limitations <small>one per line</small><textarea bind:value={sightingLimitations} maxlength="2000" rows="2"></textarea></label>
      <button class="btn" type="submit">Record sighting</button>
    </form>
    {#if record.sightings.length}
      <ol class="records">{#each [...record.sightings].reverse() as sighting}<li><strong>{sighting.state.replaceAll('_', ' ')} · {sighting.category}</strong><p>{sighting.source}</p><small>{sighting.sourceClass} source · {sighting.completeness} · {sighting.observedAt}</small>{#if sighting.limitations.length}<small>Limits: {sighting.limitations.join('; ')}</small>{/if}</li>{/each}</ol>
    {/if}
    {#if sightingChronology.length}
      <section class="chronology" aria-labelledby={`sighting-chronology-${record.id}`}>
        <div>
          <strong id={`sighting-chronology-${record.id}`}>Observation chronology</strong>
          <span>{countLabel(sightingChronology.length, 'source sequence')}</span>
        </div>
        <p>First and last observed describe retained evidence, not domain creation, activation, or removal. Review conclusions remain outside these ranges.</p>
        <ol>
          {#each sightingChronology as entry}
            <li>
              <div><strong>{entry.category}</strong><span>{entry.sourceClass} · {entry.completeness}</span></div>
              <p>{entry.source}</p>
              <dl>
                <div><dt>First observed</dt><dd>{entry.firstObservedAt}</dd></div>
                <div><dt>Last observed</dt><dd>{entry.lastObservedAt}</dd></div>
                <div><dt>Observations</dt><dd>{entry.observationCount}</dd></div>
              </dl>
              {#if entry.limitations.length}<small>Limits: {entry.limitations.join('; ')}</small>{/if}
            </li>
          {/each}
        </ol>
        {#if sightingReviewConclusionCount}
          <small>{countLabel(sightingReviewConclusionCount, 'review conclusion')} retained separately and excluded from observed ranges.</small>
        {/if}
      </section>
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
        <fieldset class="pin-references"><legend>Evidence relationship matrix</legend><p class="notice">Classify how each selected observation relates to this assertion. Unlinked evidence remains available in the case.</p>{#each record.evidencePins as pin}<label class="field"><span>{pin.label}</span><select value={assertionEvidenceStance(pin.id)} onchange={(event) => setAssertionEvidenceStance(pin.id, event.currentTarget.value)}><option value="">Not linked</option>{#each CASE_EVIDENCE_RELATION_STANCES as value}<option {value}>{value}</option>{/each}</select></label>{/each}</fieldset>
      {/if}
      <button class="btn" type="submit">Record assertion</button>
    </form>
    {#if record.assertions.length}
      <ol class="records">{#each [...record.assertions].reverse() as assertion}<li><strong>{assertion.provenance ? 'external import' : assertion.kind.replaceAll('_', ' ')} · {assertion.state}</strong><p>{assertion.statement}</p>{#if assertion.rationale}<p>{assertion.rationale}</p>{/if}{#if assertion.provenance}<small>{assertion.provenance.format.toUpperCase()} · {assertion.provenance.sourceName}{assertion.provenance.publisher ? ` · ${assertion.provenance.publisher}` : ''}{assertion.provenance.externalId ? ` · ${assertion.provenance.externalId}` : ''}</small><small>File SHA-256 {assertion.provenance.sourceDigestSha256}{assertion.provenance.observedAt ? ` · observed ${assertion.provenance.observedAt}` : ''}</small>{#if assertion.provenance.labels.length || assertion.provenance.markings.length}<small>{[...assertion.provenance.labels, ...assertion.provenance.markings].join(' · ')}</small>{/if}{/if}{#if assertion.evidenceRelations?.length}<small>{assertion.evidenceRelations.filter((item) => item.stance === 'supports').length} supporting · {assertion.evidenceRelations.filter((item) => item.stance === 'contradicts').length} contradicting · {assertion.evidenceRelations.filter((item) => item.stance === 'unresolved').length} unresolved evidence relationship{assertion.evidenceRelations.length === 1 ? '' : 's'}</small>{:else}<small>updated {assertion.updatedAt}{assertion.evidencePinIds.length ? ` · ${assertion.evidencePinIds.length} linked pin${assertion.evidencePinIds.length === 1 ? '' : 's'}` : ''}</small>{/if}{#if assertion.state === 'open'}<button class="btn small" type="button" onclick={() => void setAssertionState(assertion.id, 'resolved')}>Mark resolved</button>{/if}</li>{/each}</ol>
    {/if}
  </details>

  <CaseInvestigationBranches {record} {onsaved} {onmessage} />

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
      <label class="field">Audience profile<select bind:value={packetProfile}>{#each RESPONSE_PACKET_PROFILES as profile}<option value={profile.id}>{profile.label}</option>{/each}</select></label>
      <section class="profile-preview" aria-labelledby={`profile-preview-title-${record.id}`}>
        <div>
          <strong id={`profile-preview-title-${record.id}`}>{packetProfilePreview.label}</strong>
          <span>{packetProfilePreview.audience}</span>
        </div>
        <p><strong>Suggested subject:</strong> {packetProfilePreview.subject}</p>
        <div class="profile-columns">
          <section><strong>Included</strong><ul>{#each packetProfilePreview.includedEvidence as item}<li>{item}</li>{/each}</ul></section>
          <section><strong>Excluded</strong><ul>{#each packetProfilePreview.excludedEvidence as item}<li>{item}</li>{/each}</ul></section>
          <section><strong>Redactions</strong><ul>{#each packetProfilePreview.redactions as item}<li>{item}</li>{/each}</ul></section>
          <section><strong>Attachments and follow-up</strong><ul>{#each packetProfilePreview.attachments as item}<li>{item}</li>{/each}{#each packetProfilePreview.followUpFields as item}<li>{item}</li>{/each}</ul></section>
        </div>
        {#if packetProfilePreview.missingEvidence.length}
          <p class="profile-missing"><strong>Still needed:</strong> {packetProfilePreview.missingEvidence.join('; ')}</p>
        {/if}
      </section>
      <section class="preflight" aria-labelledby={`preflight-title-${record.id}`}>
        <div><strong id={`preflight-title-${record.id}`}>Response preflight</strong><span class={`preflight-state state-${packetPreflight.status}`}>{packetPreflight.status.replaceAll('_', ' ')}</span></div>
        <p>{packetPreflight.counts.pass} pass · {packetPreflight.counts.caution} caution · {packetPreflight.counts.block} block</p>
        <ul>{#each packetPreflight.checks as check}<li data-state={check.state}><strong>{check.label}</strong><span>{check.detail}</span></li>{/each}</ul>
      </section>
      <div class="two-columns">
        <label class="field">Abuse category<input bind:value={packetCategory} maxlength="80" required placeholder="Credential phishing"></label>
        <label class="field">Affected party<input bind:value={packetAffectedParty} maxlength="200" required></label>
        <label class="field">Observed at<input type="datetime-local" bind:value={packetObservedAt} required></label>
      </div>
      <label class="field">Exact abusive HTTP(S) URLs <small>one per line</small><textarea bind:value={packetUrls} maxlength="42000" rows="3" required></textarea></label>
      <label class="field">Observed harm<textarea bind:value={packetHarm} maxlength="2000" rows="3" required></textarea></label>
      <fieldset class="contacts"><legend>Separately routed escalation contacts</legend>
        {#if record.actions.some((action) => contactKind(action))}
          <button class="btn small" type="button" onclick={useRecordedActionRoutes}>Use recorded case routes</button>
        {/if}
        {#each RESPONSE_CONTACT_KINDS as kind}
          <div class="contact-row">
            <strong>{kind.replaceAll('_', ' ')}</strong>
            <label class="field">Contact<input aria-label={`${kind.replaceAll('_', ' ')} contact`} bind:value={packetContacts[kind]} maxlength="320"></label>
            <label class="field">Source<input aria-label={`${kind.replaceAll('_', ' ')} source`} bind:value={packetContactSources[kind]} maxlength="120"></label>
            <label class="field">Limitations<input aria-label={`${kind.replaceAll('_', ' ')} limitations`} bind:value={packetContactLimitations[kind]} maxlength="240"></label>
          </div>
        {/each}
      </fieldset>
      <div class="actions"><button class="btn" type="button" onclick={() => void downloadPacket('json')} disabled={packetBusy || !packetPreflight.canExport}>Export JSON</button><button class="btn" type="button" onclick={() => void downloadPacket('md')} disabled={packetBusy || !packetPreflight.canExport}>Export Markdown</button><button class="btn" type="button" onclick={() => void downloadPacket('txt')} disabled={packetBusy || !packetPreflight.canExport}>Export email draft</button><button class="btn" type="button" onclick={() => void copyEmail()} disabled={packetBusy || !packetPreflight.canExport}>Copy email draft</button></div>
    </form>
  </details>
</section>

<style>
  .response-workspace{display:grid;gap:10px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  header{display:flex;flex-wrap:wrap;align-items:start;justify-content:space-between;gap:10px}h3{margin:0}header>span{color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  details{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  summary{padding:11px 12px;cursor:pointer;font:700 var(--text-xs) var(--mono)}details[open]>summary{border-bottom:1px solid var(--border)}
  .response-form{display:grid;gap:10px;padding:12px}.two-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .action-summary{display:flex;flex-wrap:wrap;gap:6px}.action-summary span{padding:5px 7px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font:var(--text-2xs) var(--mono)}.action-summary strong{color:var(--accent)}.action-summary .attention{border-color:rgb(var(--amber-rgb) / .45);color:var(--amber)}.action-summary .attention strong{color:var(--amber)}
  textarea,input,select{width:100%}.field small{color:var(--muted)}
  .records{display:grid;gap:8px;margin:0;padding:0 12px 12px;list-style:none}.records li{padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .records strong,.records small{display:block}.records p{margin:5px 0;white-space:pre-wrap;overflow-wrap:anywhere}.records small{color:var(--muted);font-size:var(--text-2xs)}
  .chronology{display:grid;gap:8px;margin:0 12px 12px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.chronology>div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px}.chronology>div>span,.chronology>p,.chronology>small{color:var(--muted);font-size:var(--text-2xs)}.chronology>p{margin:0;line-height:1.5}.chronology ol{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:7px;margin:0;padding:0;list-style:none}.chronology li{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.chronology li>div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px}.chronology li>div>strong{font:700 var(--text-xs) var(--mono);text-transform:capitalize}.chronology li>div>span,.chronology li>small{color:var(--muted);font-size:var(--text-2xs)}.chronology li>p{margin:6px 0;overflow-wrap:anywhere}.chronology dl{display:grid;gap:3px;margin:0}.chronology dl div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 8px}.chronology dt,.chronology dd{margin:0;font-size:var(--text-2xs)}.chronology dt{color:var(--muted)}.chronology dd{font-family:var(--mono);overflow-wrap:anywhere}
  .pin-references,.contacts{display:grid;gap:8px;margin:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm)}legend{padding:0 5px;font:700 var(--text-xs) var(--mono)}
  .actions{display:flex;flex-wrap:wrap;gap:8px}.notice{margin:0;padding:9px 10px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .06);color:var(--muted);font-size:var(--text-xs)}
  .preflight{display:grid;gap:8px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.preflight>div{display:flex;align-items:center;justify-content:space-between;gap:8px}.preflight>p{margin:0;color:var(--muted);font-size:var(--text-2xs)}.preflight-state{padding:4px 7px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}.preflight .state-ready_for_review{color:var(--accent);border-color:rgb(var(--accent-rgb) / .4)}.preflight .state-review_cautions{color:var(--amber);border-color:rgb(var(--amber-rgb) / .4)}.preflight .state-needs_input{color:var(--danger);border-color:rgb(var(--danger-rgb) / .4)}.preflight ul{display:grid;gap:5px;margin:0;padding:0;list-style:none}.preflight li{display:grid;grid-template-columns:minmax(110px,.35fr) minmax(0,1fr);gap:8px;padding:7px;border-left:3px solid var(--border);font-size:var(--text-2xs)}.preflight li[data-state="pass"]{border-color:var(--accent)}.preflight li[data-state="caution"]{border-color:var(--amber)}.preflight li[data-state="block"]{border-color:var(--danger)}.preflight li span{color:var(--muted);line-height:1.45}
  .profile-preview{display:grid;gap:9px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.profile-preview>div:first-child{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:5px 12px}.profile-preview>div:first-child>strong{font:700 var(--text-sm) var(--mono)}.profile-preview>div:first-child>span,.profile-preview>p{color:var(--muted);font-size:var(--text-2xs)}.profile-preview>p{margin:0;overflow-wrap:anywhere}.profile-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.profile-columns section{padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}.profile-columns strong{font:700 var(--text-2xs) var(--mono)}.profile-columns ul{margin:6px 0 0;padding-left:17px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}.profile-missing{padding:7px 8px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .06)}
  .contact-row{display:grid;grid-template-columns:130px repeat(3,minmax(0,1fr));gap:8px;align-items:end}.contact-row>strong{padding-bottom:10px;font:700 var(--text-xs) var(--mono);text-transform:capitalize}
  @media(max-width:800px){.two-columns,.contact-row,.preflight li,.profile-columns{grid-template-columns:1fr}.contact-row>strong{padding:4px 0 0}.actions .btn{flex:1 1 150px}}
</style>
