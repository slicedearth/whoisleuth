<script lang="ts">
  import { tick } from 'svelte';
  import { type CaseRecord } from '$lib/cases';
  import {
    buildCaseResponsePacket,
    buildCaseResponsePreflight,
    buildCaseResponseReadiness,
    buildCaseResponseReviewDigest,
    buildResponsePacketProfilePreview,
    CASE_RESPONSE_PREFLIGHT_EVIDENCE_SCOPE,
    caseResponsePacketFilename,
    RESPONSE_AUTHORISATION_CONFIRMATION_IDS,
    RESPONSE_PACKET_PROFILES,
    RESPONSE_READINESS_STATES,
    type CaseResponsePacketInput,
    type ResponseAuthorisationConfirmationId,
    type ResponsePacketProfileId,
    type ResponseReadinessState,
  } from '$lib/analysis/case-response-packet.ts';
  import type { CaseResponseStage } from '$lib/components/CaseResponseStageGuide.svelte';

  let {
    record,
    visible,
    onmessage,
    onstagechange,
    onpacketexported,
  }: {
    record: CaseRecord;
    visible: boolean;
    onmessage: (message: string) => void;
    onstagechange: (stage: CaseResponseStage) => void;
    onpacketexported: (exported: Readonly<{ actionId: string; exportedAt: string; digestSha256: string }>) => void | Promise<void>;
  } = $props();

  let packetCategory = $state('');
  let packetProfile = $state<ResponsePacketProfileId>('internal_soc');
  let packetAffectedParty = $state('');
  let packetUrls = $state('');
  let packetHarm = $state('');
  let packetObservedAt = $state('');
  let packetActionId = $state('');
  let packetSelectedEvidenceIds = $state<string[]>([]);
  let packetInfrastructureState = $state<ResponseReadinessState>('not_provided');
  let packetInfrastructureDetail = $state('');
  let packetInfrastructureLimitations = $state('');
  let packetAuthorityState = $state<ResponseReadinessState>('not_provided');
  let packetAuthorityDetail = $state('');
  let packetAuthorityLimitations = $state('');
  let packetContradictionsState = $state<ResponseReadinessState>('not_provided');
  let packetContradictionsDetail = $state('');
  let packetContradictionsLimitations = $state('');
  let packetSourceLimitationsState = $state<ResponseReadinessState>('not_provided');
  let packetSourceLimitationsDetail = $state('');
  let packetSourceLimitations = $state('');
  let packetArtefactLabel = $state('');
  let packetArtefactMediaType = $state('image/png');
  let packetArtefactCapturedAt = $state('');
  let packetArtefactSource = $state('Analyst-supplied capture metadata');
  let packetArtefactDigest = $state('');
  let packetArtefactByteLength = $state('');
  let packetArtefactLimitations = $state('');
  let packetReviewDigest = $state('');
  let packetReviewSignature = $state('');
  let packetAuthorisationConfirmedAt = $state('');
  let packetConfirmations = $state<Record<ResponseAuthorisationConfirmationId, boolean>>({
    selectedEvidence: false,
    recipientScope: false,
    privacyRedactions: false,
    analystAuthority: false,
    evidenceFreshness: false,
  });
  const packetWizardSteps = Object.freeze([
    'Recipient and scope',
    'Evidence selection',
    'Source and contact provenance',
    'Privacy and redaction',
    'Readiness limitations',
    'Exact-input digest',
    'Explicit authorisation',
    'Local export',
  ] as const);
  let packetWizardStep = $state(1);
  let packetBusy = $state(false);
  let lastPacketExport = $state<Readonly<{ actionId: string; exportedAt: string; digestSha256: string }> | null>(null);
  const reviewNow = new Date().toISOString();

  const packetPreflight = $derived(buildCaseResponsePreflight(record, packetInput(), reviewNow));
  const packetProfilePreview = $derived(buildResponsePacketProfilePreview(record, packetInput()));
  const packetReadiness = $derived(buildCaseResponseReadiness(record, packetInput(), reviewNow));
  const packetReviewIsCurrent = $derived(Boolean(packetReviewDigest) && packetReviewSignature === packetMaterialSignature());
  const selectedPacketAction = $derived(record.actions.find((action) => action.id === packetActionId) ?? null);
  const packetConfirmationsComplete = $derived(RESPONSE_AUTHORISATION_CONFIRMATION_IDS.every((id) => packetConfirmations[id]));
  const packetAuthorisationReadinessComplete = $derived(
    packetReadiness.rows.every((row) => !row.requiredForAuthorisation || !['not_provided', 'unavailable'].includes(row.state))
      && packetReadiness.rows.find((row) => row.id === 'authority_review')?.state === 'complete',
  );
  const stage = $derived<CaseResponseStage>({
    id: 'evidence_handoff',
    number: 4,
    label: 'Evidence handoff',
    status: packetAuthorisationConfirmedAt && packetReviewIsCurrent
      ? 'complete'
      : packetReviewDigest && !packetReviewIsCurrent
        ? 'attention'
        : packetPreflight.canExport
          ? 'in_progress'
          : 'not_started',
    summary: `${packetPreflight.counts.pass} preflight pass, ${packetPreflight.counts.caution} caution, and ${packetPreflight.counts.block} block.`,
    nextRequirement: !packetPreflight.canExport
      ? 'Complete the next blocked packet input.'
      : !packetReviewDigest
        ? 'Review the exact packet inputs and bind their digest.'
        : !packetReviewIsCurrent
          ? 'Material inputs changed; bind and review the current inputs again.'
          : !packetAuthorisationConfirmedAt
            ? 'Complete explicit confirmations and authorise the exact bound inputs.'
            : 'Export locally only when the intended recipient and scope remain correct.',
  });

  $effect(() => onstagechange(stage));

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

  function packetInput(includeAuthorisation = true): CaseResponsePacketInput {
    const artefactReferences = packetArtefactDigest.trim() ? [{
      label: packetArtefactLabel,
      mediaType: packetArtefactMediaType,
      capturedAt: isoFromLocal(packetArtefactCapturedAt),
      source: packetArtefactSource,
      digestSha256: packetArtefactDigest,
      byteLength: packetArtefactByteLength ? Number(packetArtefactByteLength) : null,
      limitations: list(packetArtefactLimitations),
    }] : [];
    return {
      profile: packetProfile,
      category: packetCategory,
      affectedParty: packetAffectedParty,
      abusiveUrls: packetUrls,
      observedHarm: packetHarm,
      observedAt: isoFromLocal(packetObservedAt),
      actionId: packetActionId || null,
      selectedEvidencePinIds: packetSelectedEvidenceIds,
      readiness: {
        infrastructureResponsibility: {
          state: packetInfrastructureState,
          detail: packetInfrastructureDetail,
          limitations: list(packetInfrastructureLimitations),
        },
        authorityReview: {
          state: packetAuthorityState,
          detail: packetAuthorityDetail,
          limitations: list(packetAuthorityLimitations),
        },
        contradictionsReview: {
          state: packetContradictionsState,
          detail: packetContradictionsDetail,
          limitations: list(packetContradictionsLimitations),
        },
        sourceLimitations: {
          state: packetSourceLimitationsState,
          detail: packetSourceLimitationsDetail,
          limitations: list(packetSourceLimitations),
        },
      },
      artefactReferences,
      ...(includeAuthorisation ? {
        authorisation: {
          reviewedInputDigestSha256: packetReviewDigest,
          confirmedAt: isoFromLocal(packetAuthorisationConfirmedAt),
          confirmations: packetConfirmations,
        },
      } : {}),
    };
  }

  function packetMaterialSignature(): string {
    return JSON.stringify({ record, input: packetInput(false) });
  }

  async function reviewPacketInputs() {
    if (packetBusy) return;
    packetBusy = true;
    try {
      const signature = packetMaterialSignature();
      const digest = await buildCaseResponseReviewDigest(record, packetInput(false), new Date().toISOString());
      if (signature !== packetMaterialSignature()) {
        packetAuthorisationConfirmedAt = '';
        onmessage('The local packet inputs changed while the review digest was being prepared. Review and bind the current inputs again.');
        return;
      }
      packetReviewDigest = digest;
      packetReviewSignature = signature;
      packetConfirmations = {
        selectedEvidence: false,
        recipientScope: false,
        privacyRedactions: false,
        analystAuthority: false,
        evidenceFreshness: false,
      };
      packetAuthorisationConfirmedAt = '';
      onmessage('Bound the current local draft inputs to a review digest. Confirm each authorisation statement after completing the review.');
      await setPacketWizardStep(7);
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'Could not bind the current packet inputs for review.');
    } finally {
      packetBusy = false;
    }
  }

  function setPacketConfirmation(id: ResponseAuthorisationConfirmationId, checked: boolean) {
    packetConfirmations = { ...packetConfirmations, [id]: checked };
    packetAuthorisationConfirmedAt = '';
  }

  async function authorisePacketInputs() {
    if (!packetReviewIsCurrent || !packetConfirmationsComplete || !packetAuthorisationReadinessComplete || packetBusy) return;
    packetBusy = true;
    try {
      const signature = packetMaterialSignature();
      const currentDigest = await buildCaseResponseReviewDigest(record, packetInput(false), new Date().toISOString());
      if (signature !== packetMaterialSignature() || signature !== packetReviewSignature || currentDigest !== packetReviewDigest) {
        packetAuthorisationConfirmedAt = '';
        onmessage('The reviewed inputs or their freshness state changed. Review and bind the current packet again before authorisation.');
        return;
      }
      packetAuthorisationConfirmedAt = localFromIso(new Date().toISOString());
      onmessage('Authorised the exact browser-local inputs bound to the retained review digest. Nothing was submitted.');
      await setPacketWizardStep(8);
    } catch (cause) {
      packetAuthorisationConfirmedAt = '';
      onmessage(cause instanceof Error ? cause.message : 'Could not verify the exact packet review before authorisation.');
    } finally {
      packetBusy = false;
    }
  }

  function packet(generatedAt: string = new Date().toISOString()) {
    return buildCaseResponsePacket(record, packetInput(), generatedAt);
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
      lastPacketExport = packetActionId ? {
        actionId: packetActionId,
        exportedAt: generatedAt,
        digestSha256: built.json.integrity.digestSha256,
      } : null;
      onmessage(`Exported a ${built.json.authorisation.status} ${format === 'txt' ? 'plain-text email draft' : format.toUpperCase()} response packet. Nothing was submitted.`);
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
      const built = await packet();
      await navigator.clipboard.writeText(built.email);
      onmessage(`Copied the ${built.json.authorisation.status} response email draft. Nothing was submitted.`);
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'Clipboard access was unavailable.');
    } finally {
      packetBusy = false;
    }
  }

  async function continueToDeliveryRecord() {
    if (lastPacketExport) await onpacketexported(lastPacketExport);
  }

  async function setPacketWizardStep(value: number) {
    packetWizardStep = Math.max(1, Math.min(packetWizardSteps.length, Math.trunc(value)));
    await tick();
    document.getElementById(`packet-wizard-step-${record.id}-${packetWizardStep}`)?.focus({ preventScroll: true });
  }
</script>

{#if visible}
  <details id={`case-response-preflight-${record.id}`}>
    <summary>Prepare a reviewed abuse evidence packet</summary>
    <form class="response-form packet-form" onsubmit={(event) => event.preventDefault()}>
      <p class="notice">This prepares local drafts only; nothing is sent. Contact selection, review, authorisation and export remain explicit.</p>
      <p class="notice preflight-scope">{CASE_RESPONSE_PREFLIGHT_EVIDENCE_SCOPE.limitation}</p>
      <nav class="packet-wizard-nav" aria-label="Response-packet handoff steps">
        <ol>{#each packetWizardSteps as label, index}<li><button type="button" aria-current={packetWizardStep === index + 1 ? 'step' : undefined} onclick={() => void setPacketWizardStep(index + 1)}><span>{index + 1}</span>{label}</button></li>{/each}</ol>
      </nav>

      {#if packetWizardStep === 1}
        <section id={`packet-wizard-step-${record.id}-1`} class="wizard-panel" tabindex="-1" aria-labelledby={`packet-wizard-title-${record.id}-1`}>
          <header><div><p class="eyebrow">Purpose and audience</p><h4 id={`packet-wizard-title-${record.id}-1`}>Intended recipient and scope</h4></div><span>1 of 8</span></header>
          <label class="field">Audience profile<select bind:value={packetProfile}>{#each RESPONSE_PACKET_PROFILES as profile}<option value={profile.id}>{profile.label}</option>{/each}</select></label>
          <section class="profile-preview" aria-labelledby={`profile-preview-title-${record.id}`}>
            <div><strong id={`profile-preview-title-${record.id}`}>{packetProfilePreview.label}</strong><span>{packetProfilePreview.audience}</span></div>
            <p><strong>Suggested subject:</strong> {packetProfilePreview.subject}</p>
            <div class="profile-columns">
              <section><strong>Included</strong><ul>{#each packetProfilePreview.includedEvidence as item}<li>{item}</li>{/each}</ul></section>
              <section><strong>Excluded</strong><ul>{#each packetProfilePreview.excludedEvidence as item}<li>{item}</li>{/each}</ul></section>
              <section><strong>Redactions</strong><ul>{#each packetProfilePreview.redactions as item}<li>{item}</li>{/each}</ul></section>
              <section><strong>Attachments and follow-up</strong><ul>{#each packetProfilePreview.attachments as item}<li>{item}</li>{/each}{#each packetProfilePreview.followUpFields as item}<li>{item}</li>{/each}</ul></section>
            </div>
            {#if packetProfilePreview.missingEvidence.length}<p class="profile-missing"><strong>Still needed:</strong> {packetProfilePreview.missingEvidence.join('; ')}</p>{/if}
          </section>
          <div class="two-columns"><label class="field">Abuse category<input bind:value={packetCategory} maxlength="80" required placeholder="Credential phishing"></label><label class="field">Affected party<input bind:value={packetAffectedParty} maxlength="200" required></label><label class="field">Observed at<input type="datetime-local" bind:value={packetObservedAt} required></label></div>
          <label class="field">Exact abusive HTTP(S) URLs <small>one per line</small><textarea bind:value={packetUrls} maxlength="42000" rows="3" required></textarea></label>
          <label class="field">Observed harm<textarea bind:value={packetHarm} maxlength="2000" rows="3" required></textarea></label>
        </section>
      {:else if packetWizardStep === 2}
        <section id={`packet-wizard-step-${record.id}-2`} class="wizard-panel" tabindex="-1" aria-labelledby={`packet-wizard-title-${record.id}-2`}>
          <header><div><p class="eyebrow">Exact selection</p><h4 id={`packet-wizard-title-${record.id}-2`}>Evidence selection</h4></div><span>2 of 8</span></header>
          <fieldset class="pin-references"><legend>Evidence selected for this exact packet</legend>{#if record.evidencePins.length}{#each record.evidencePins as pin}<label class="choice"><input type="checkbox" checked={packetSelectedEvidenceIds.includes(pin.id)} onchange={(event) => packetSelectedEvidenceIds = event.currentTarget.checked ? [...packetSelectedEvidenceIds, pin.id] : packetSelectedEvidenceIds.filter((id) => id !== pin.id)}><span>{pin.label} · {pin.source} · {pin.observedAt}</span></label>{/each}{:else}<p class="notice">No evidence pins are retained in this Case. The draft will keep this unavailable.</p>{/if}</fieldset>
          <p class="notice">Selection includes only retained Case pins supported by response-packet v8. It does not collect, upload, or infer new evidence.</p>
        </section>
      {:else if packetWizardStep === 3}
        <section id={`packet-wizard-step-${record.id}-3`} class="wizard-panel" tabindex="-1" aria-labelledby={`packet-wizard-title-${record.id}-3`}>
          <header><div><p class="eyebrow">Action-bound route</p><h4 id={`packet-wizard-title-${record.id}-3`}>Action and recipient provenance</h4></div><span>3 of 8</span></header>
          <label class="field">Case action for this packet<select bind:value={packetActionId}><option value="">Select a retained Case action</option>{#each record.actions as action}<option value={action.id}>{action.type.replaceAll('_', ' ')} · {action.recipient} · {action.state.replaceAll('_', ' ')}</option>{/each}</select></label>
          {#if selectedPacketAction}<section class="profile-preview"><div><strong>{selectedPacketAction.recipient}</strong><span>{selectedPacketAction.type.replaceAll('_', ' ')}</span></div><p><strong>Source:</strong> {selectedPacketAction.contactSource}</p><p><strong>Route observed:</strong> {selectedPacketAction.routeObservedAt ?? 'Time unavailable'}</p>{#if selectedPacketAction.originActionId}<p><strong>Originating action:</strong> {selectedPacketAction.originActionId}</p>{/if}{#if selectedPacketAction.contactLimitations.length}<p><strong>Limitations:</strong> {selectedPacketAction.contactLimitations.join('; ')}</p>{/if}</section>{:else}<p class="notice">Create and review a Case action first. Browser and blocklist destinations use a manually entered internal-review action; other profiles require the matching typed route.</p>{/if}
          <p class="notice">Only the selected action, its bounded origin lineage and its route are included. A published or analyst-supplied route does not establish ownership, authority, successful delivery, or recipient action.</p>
        </section>
      {:else if packetWizardStep === 4}
        <section id={`packet-wizard-step-${record.id}-4`} class="wizard-panel" tabindex="-1" aria-labelledby={`packet-wizard-title-${record.id}-4`}>
          <header><div><p class="eyebrow">Minimise disclosure</p><h4 id={`packet-wizard-title-${record.id}-4`}>Privacy and redaction review</h4></div><span>4 of 8</span></header>
          <div class="privacy-review"><section><strong>Profile redactions</strong><ul>{#each packetProfilePreview.redactions as item}<li>{item}</li>{/each}</ul></section><section><strong>Profile exclusions</strong><ul>{#each packetProfilePreview.excludedEvidence as item}<li>{item}</li>{/each}</ul></section></div>
          <fieldset class="artefact-reference"><legend>Optional integrity-checked capture reference</legend><p class="notice">Retain metadata and SHA-256 only. Do not paste raw payloads, bodies, credentials, cookies, secrets, complete query-bearing URLs, or unnecessary personal data.</p><div class="two-columns"><label class="field">Label<input bind:value={packetArtefactLabel} maxlength="120"></label><label class="field">Media type<input bind:value={packetArtefactMediaType} maxlength="120"></label><label class="field">Captured at<input type="datetime-local" bind:value={packetArtefactCapturedAt}></label><label class="field">Source<input bind:value={packetArtefactSource} maxlength="120"></label><label class="field">SHA-256 digest<input bind:value={packetArtefactDigest} maxlength="64" pattern="[a-fA-F0-9]{64}"></label><label class="field">Byte length<input type="number" min="0" max="104857600" bind:value={packetArtefactByteLength}></label></div><label class="field">Limitations<textarea bind:value={packetArtefactLimitations} maxlength="2000" rows="2"></textarea></label></fieldset>
        </section>
      {:else if packetWizardStep === 5}
        <section id={`packet-wizard-step-${record.id}-5`} class="wizard-panel" tabindex="-1" aria-labelledby={`packet-wizard-title-${record.id}-5`}>
          <header><div><p class="eyebrow">Preflight</p><h4 id={`packet-wizard-title-${record.id}-5`}>Readiness limitations</h4></div><span>5 of 8</span></header>
          <section class="preflight" aria-labelledby={`preflight-title-${record.id}`}><div><strong id={`preflight-title-${record.id}`}>Response preflight</strong><span class={`preflight-state state-${packetPreflight.status}`}>{packetPreflight.status.replaceAll('_', ' ')}</span></div><p>{packetPreflight.counts.pass} pass · {packetPreflight.counts.caution} caution · {packetPreflight.counts.block} block</p><ul>{#each packetPreflight.checks as check}<li data-state={check.state}><strong>{check.label}</strong><span>{check.detail}</span></li>{/each}</ul></section>
          <fieldset class="readiness-inputs"><legend>Explicit review inputs</legend><div class="readiness-editor"><section><strong>Infrastructure responsibility</strong><label class="field">State<select bind:value={packetInfrastructureState}>{#each RESPONSE_READINESS_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label><label class="field">Detail<input bind:value={packetInfrastructureDetail} maxlength="500"></label><label class="field">Limitations<textarea bind:value={packetInfrastructureLimitations} maxlength="2000" rows="2"></textarea></label></section><section><strong>Analyst authority</strong><label class="field">State<select bind:value={packetAuthorityState}>{#each RESPONSE_READINESS_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label><label class="field">Detail<input bind:value={packetAuthorityDetail} maxlength="500"></label><label class="field">Limitations<textarea bind:value={packetAuthorityLimitations} maxlength="2000" rows="2"></textarea></label></section><section><strong>Contradiction review</strong><label class="field">State<select bind:value={packetContradictionsState}>{#each RESPONSE_READINESS_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label><label class="field">Detail<input bind:value={packetContradictionsDetail} maxlength="500"></label><label class="field">Limitations<textarea bind:value={packetContradictionsLimitations} maxlength="2000" rows="2"></textarea></label></section><section><strong>Source limitations review</strong><label class="field">State<select bind:value={packetSourceLimitationsState}>{#each RESPONSE_READINESS_STATES as value}<option {value}>{value.replaceAll('_', ' ')}</option>{/each}</select></label><label class="field">Detail<input bind:value={packetSourceLimitationsDetail} maxlength="500"></label><label class="field">Limitations<textarea bind:value={packetSourceLimitations} maxlength="2000" rows="2"></textarea></label></section></div></fieldset>
          <section class="readiness-matrix" aria-labelledby={`readiness-title-${record.id}`}><div><strong id={`readiness-title-${record.id}`}>Profile-specific readiness matrix</strong><span>{packetReadiness.counts.complete} complete · {packetReadiness.counts.partial} partial · {packetReadiness.counts.stale} stale · {packetReadiness.counts.unavailable} unavailable · {packetReadiness.counts.not_provided} not provided</span></div><div class="table-wrap"><table><thead><tr><th scope="col">Review input</th><th scope="col">State</th><th scope="col">Detail and limitations</th></tr></thead><tbody>{#each packetReadiness.rows as row}<tr><th scope="row">{row.label}{row.requiredForAuthorisation ? ' *' : ''}</th><td><span class={`readiness-state state-${row.state}`}>{row.state.replaceAll('_', ' ')}</span></td><td>{row.detail}{#if row.limitations.length}<small>{row.limitations.join('; ')}</small>{/if}</td></tr>{/each}</tbody></table></div><small>* Required for authorisation. Partial and stale states remain visible and require deliberate freshness and limitation confirmation.</small></section>
        </section>
      {:else if packetWizardStep === 6}
        <section id={`packet-wizard-step-${record.id}-6`} class="wizard-panel authorisation" tabindex="-1" aria-labelledby={`packet-wizard-title-${record.id}-6`}>
          <header><div><p class="eyebrow">Bind current material</p><h4 id={`packet-wizard-title-${record.id}-6`}>Exact-input digest review</h4></div><span class:attention={!packetReviewIsCurrent}>{packetReviewIsCurrent ? 'current review' : packetReviewDigest ? 'review stale' : 'not reviewed'}</span></header>
          <p>Review the selected evidence, action-bound recipient scope, provenance, privacy and redactions, readiness, freshness, contradictions, and limitations. Then bind these exact current inputs to a response-packet v8 review digest.</p>
          <button class="btn" type="button" onclick={() => void reviewPacketInputs()} disabled={packetBusy || !packetPreflight.canExport}>Review and bind exact inputs</button>
          {#if packetReviewDigest}<code>{packetReviewDigest}</code>{/if}
          {#if packetReviewDigest && !packetReviewIsCurrent}<p class="history-warning">Material inputs changed after review. The retained digest is stale; re-review before authorisation.</p>{/if}
        </section>
      {:else if packetWizardStep === 7}
        <section id={`packet-wizard-step-${record.id}-7`} class="wizard-panel authorisation" tabindex="-1" aria-labelledby={`authorisation-title-${record.id}`}>
          <header><div><p class="eyebrow">Explicit decision</p><h4 id={`authorisation-title-${record.id}`}>Authorise exact bound inputs</h4></div><span class:attention={!packetReviewIsCurrent || !packetConfirmationsComplete || !packetAuthorisationReadinessComplete || !packetAuthorisationConfirmedAt}>{packetReviewIsCurrent && packetConfirmationsComplete && packetAuthorisationReadinessComplete && packetAuthorisationConfirmedAt ? 'authorised inputs' : 'draft · authorisation incomplete'}</span></header>
          {#if !packetReviewIsCurrent}<p class="history-warning">The exact current inputs do not have a current digest. Return to step 6 before confirming authorisation.</p>{/if}
          <fieldset class="confirmations" disabled={!packetReviewIsCurrent}><legend>Explicit confirmations</legend>{#each RESPONSE_AUTHORISATION_CONFIRMATION_IDS as id}<label class="choice"><input type="checkbox" checked={packetConfirmations[id]} onchange={(event) => setPacketConfirmation(id, event.currentTarget.checked)}><span>{id === 'selectedEvidence' ? 'I reviewed the exact selected evidence.' : id === 'recipientScope' ? 'I reviewed the recipient and scope.' : id === 'privacyRedactions' ? 'I reviewed privacy and redactions.' : id === 'analystAuthority' ? 'I confirm analyst authority for this scope.' : 'I reviewed evidence freshness and retained cautions.'}</span></label>{/each}</fieldset>
          <button class="btn" type="button" onclick={() => void authorisePacketInputs()} disabled={packetBusy || !packetReviewIsCurrent || !packetConfirmationsComplete || !packetAuthorisationReadinessComplete}>Authorise exact bound inputs</button>
          <label class="field">Confirmation time<input type="datetime-local" bind:value={packetAuthorisationConfirmedAt} readonly disabled={!packetReviewIsCurrent || !packetConfirmationsComplete}></label>
          <p class="notice">Authorisation applies only to the exact inputs bound to the current digest. It does not submit the packet or establish a provider outcome.</p>
        </section>
      {:else}
        <section id={`packet-wizard-step-${record.id}-8`} class="wizard-panel" tabindex="-1" aria-labelledby={`packet-wizard-title-${record.id}-8`}>
          <header><div><p class="eyebrow">Deliberate handoff</p><h4 id={`packet-wizard-title-${record.id}-8`}>Local export</h4></div><span>8 of 8</span></header>
          <p class="notice">Export stays local. WHOISleuth does not submit a packet, send mail, test the recipient, promise removal or remediation, or treat provider action as an independently observed effect.</p>
          <div class="actions"><button class="btn" type="button" onclick={() => void downloadPacket('json')} disabled={packetBusy || !packetPreflight.canExport}>Export JSON draft or authorised packet</button><button class="btn" type="button" onclick={() => void downloadPacket('md')} disabled={packetBusy || !packetPreflight.canExport}>Export Markdown</button><button class="btn" type="button" onclick={() => void downloadPacket('txt')} disabled={packetBusy || !packetPreflight.canExport}>Export email draft</button><button class="btn" type="button" onclick={() => void copyEmail()} disabled={packetBusy || !packetPreflight.canExport}>Copy email draft</button></div>
          {#if lastPacketExport}
            <div class="delivery-handoff">
              <p>The exported packet digest can be carried into the selected Case action. This prepares a record only; append a submitted event after actual delivery.</p>
              <button class="btn" type="button" onclick={() => void continueToDeliveryRecord()}>Continue to record delivery</button>
            </div>
          {/if}
          <p class="wizard-status">{packetAuthorisationConfirmedAt && packetReviewIsCurrent ? 'The current exact inputs are authorised for deliberate local export.' : 'The current packet remains a draft. Draft export retains that status explicitly.'}</p>
        </section>
      {/if}

      <div class="wizard-controls"><button class="btn" type="button" onclick={() => void setPacketWizardStep(packetWizardStep - 1)} disabled={packetWizardStep === 1}>Previous step</button><span>Step {packetWizardStep} of {packetWizardSteps.length}</span><button class="btn" type="button" onclick={() => void setPacketWizardStep(packetWizardStep + 1)} disabled={packetWizardStep === packetWizardSteps.length}>Next step</button></div>
    </form>
  </details>
{/if}

<style>
  details{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  summary{padding:11px 12px;cursor:pointer;font:700 var(--text-xs) var(--mono)}
  details[open]>summary{border-bottom:1px solid var(--border)}
  header{display:flex;flex-wrap:wrap;align-items:start;justify-content:space-between;gap:10px}
  header>span{color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .response-form{display:grid;gap:10px;padding:12px}
  .two-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  textarea,input,select{width:100%}
  .field small{color:var(--muted)}
  .pin-references,.contacts,.readiness-inputs,.artefact-reference,.confirmations{display:grid;gap:8px;margin:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  legend{padding:0 5px;font:700 var(--text-xs) var(--mono)}
  .actions{display:flex;flex-wrap:wrap;gap:8px}
  .notice{margin:0;padding:9px 10px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .06);color:var(--muted);font-size:var(--text-xs)}
  .history-warning{margin:7px 0;padding:8px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .06);color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .preflight{display:grid;gap:8px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .preflight>div{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .preflight>p{margin:0;color:var(--muted);font-size:var(--text-2xs)}
  .preflight-state{padding:4px 7px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  .preflight .state-ready_for_review{color:var(--success);border-color:rgb(var(--accent2-rgb) / .4)}
  .preflight .state-review_cautions{color:var(--amber);border-color:rgb(var(--amber-rgb) / .4)}
  .preflight .state-needs_input{color:var(--danger);border-color:rgb(var(--danger-rgb) / .4)}
  .preflight ul{display:grid;gap:5px;margin:0;padding:0;list-style:none}
  .preflight li{display:grid;grid-template-columns:minmax(110px,.35fr) minmax(0,1fr);gap:8px;padding:7px;border-left:3px solid var(--border);font-size:var(--text-2xs)}
  .preflight li[data-state="pass"]{border-color:var(--success)}
  .preflight li[data-state="caution"]{border-color:var(--amber)}
  .preflight li[data-state="block"]{border-color:var(--danger)}
  .preflight li span{color:var(--muted);line-height:1.45}
  .profile-preview{display:grid;gap:9px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .profile-preview>div:first-child{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:5px 12px}
  .profile-preview>div:first-child>strong{font:700 var(--text-sm) var(--mono)}
  .profile-preview>div:first-child>span,.profile-preview>p{color:var(--muted);font-size:var(--text-2xs)}
  .profile-preview>p{margin:0;overflow-wrap:anywhere}
  .profile-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .profile-columns section{padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .profile-columns strong{font:700 var(--text-2xs) var(--mono)}
  .profile-columns ul{margin:6px 0 0;padding-left:17px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .profile-missing{padding:7px 8px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .06)}
  .readiness-editor{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .readiness-editor section{display:grid;min-width:0;gap:7px;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .readiness-editor strong{font:700 var(--text-2xs) var(--mono)}
  .readiness-matrix{display:grid;gap:8px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .readiness-matrix>div:first-child{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px}
  .readiness-matrix>div:first-child span{color:var(--muted);font-size:var(--text-2xs)}
  .table-wrap{max-width:100%;overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:var(--text-2xs)}
  th,td{min-width:0;padding:7px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top;overflow-wrap:anywhere}
  td small{display:block;margin-top:4px;color:var(--muted)}
  .readiness-state{display:inline-block;padding:3px 5px;border:1px solid var(--border);border-radius:999px;font:650 var(--text-2xs) var(--mono);white-space:nowrap}
  .readiness-state.state-complete{color:var(--success)}
  .readiness-state.state-partial,.readiness-state.state-stale{color:var(--amber)}
  .readiness-state.state-unavailable,.readiness-state.state-not_provided{color:var(--muted)}
  .packet-wizard-nav{max-width:100%;overflow-x:auto;padding-bottom:3px}
  .packet-wizard-nav ol{display:grid;grid-template-columns:repeat(8,minmax(118px,1fr));gap:5px;margin:0;padding:0;list-style:none}
  .packet-wizard-nav button{display:grid;width:100%;min-height:58px;gap:3px;padding:7px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);color:var(--muted);text-align:left;font:650 var(--text-2xs) var(--mono);cursor:pointer}
  .packet-wizard-nav button span{color:var(--accent)}
  .packet-wizard-nav button[aria-current='step']{border-color:var(--accent);background:rgb(var(--accent-rgb) / .08);color:var(--text)}
  .wizard-panel{display:grid;min-width:0;gap:10px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);scroll-margin-top:20px}
  .wizard-panel:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .wizard-panel header h4,.wizard-panel header p{margin:0}
  .wizard-panel header>span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .wizard-panel header>span.attention{color:var(--amber)}
  .privacy-review{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .privacy-review section{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .privacy-review ul{margin:6px 0 0;padding-left:18px;color:var(--muted);font-size:var(--text-2xs)}
  .wizard-controls{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
  .wizard-controls span,.wizard-status{color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .delivery-handoff{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .delivery-handoff p{flex:1 1 280px;margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .authorisation>p{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .authorisation code{display:block;max-width:100%;padding:7px;background:var(--panel);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .choice{display:flex;align-items:flex-start;gap:7px;min-width:0}
  .choice input{width:auto;margin-top:2px}
  .choice span{min-width:0;overflow-wrap:anywhere}
  @media(max-width:800px){.two-columns,.preflight li,.profile-columns,.readiness-editor,.privacy-review{grid-template-columns:1fr}.actions .btn{flex:1 1 150px}th,td{min-width:135px}.packet-wizard-nav ol{grid-template-columns:repeat(8,minmax(108px,1fr))}.wizard-controls .btn{flex:1 1 120px}.wizard-controls span{order:-1;flex:1 0 100%;text-align:center}}
</style>
