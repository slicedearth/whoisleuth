<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import type { CaseRecord } from '#lib/cases.ts';
  import type { PersistCaseOperation } from '#lib/analysis/case-response-stage.ts';
  import {
    CONTAINMENT_RECIPIENT_ROLES,
    MAX_CONTAINMENT_ASSERTIONS,
    MAX_CONTAINMENT_PINS,
    previewCaseContainmentHandoff,
    buildCaseContainmentHandoff,
    formatCaseContainmentHandoff,
    type ContainmentSelection,
    type CaseContainmentHandoff,
  } from '../../../../packages/cases/case-containment-handoff.mts';
  import { prepareCaseAttachmentFiles, retainCaseAttachments } from '#lib/case-attachments.ts';
  import { downloadLocalFile } from '#lib/download-local-file.ts';
  import { caseEvidenceChoiceName } from '#lib/analysis/case-evidence-presentation.ts';
  import CopyButton from './CopyButton.svelte';
  let {
    record,
    mutationBusy,
    persistOperation,
  }: { record: CaseRecord; mutationBusy: boolean; persistOperation: PersistCaseOperation } =
    $props();
  let assertionIds = $state<string[]>([]),
    evidencePinIds = $state<string[]>([]),
    audience = $state<ContainmentSelection['audience']>('internal'),
    recipientRole = $state<ContainmentSelection['recipientRole']>('security_operations');
  let report = $state.raw<CaseContainmentHandoff | null>(null),
    error = $state(''),
    message = $state(''),
    reviewed = $state(false),
    saving = $state(false);
  let signature = $state(''),
    owner = $state(''),
    heading = $state<HTMLHeadingElement>(),
    disclosureToggle = $state<HTMLElement>();
  let active = true;
  onDestroy(() => {
    active = false;
  });
  const followUps = $derived(record.assertions.filter((item) => item.kind === 'next_step'));
  const linkedIds = $derived(
    new Set(
      followUps
        .filter((item) => assertionIds.includes(item.id))
        .flatMap((item) => item.evidencePinIds),
    ),
  );
  const pins = $derived(record.evidencePins.filter((pin) => linkedIds.has(pin.id)));
  const selection = $derived({ audience, recipientRole, assertionIds, evidencePinIds });
  const currentSignature = $derived(
    JSON.stringify([
      record.id,
      record.updatedAt,
      record.status,
      record.assertions,
      record.evidencePins,
      record.evidenceLinks,
      selection,
    ]),
  );
  $effect(() => {
    if (owner !== record.id) {
      owner = record.id;
      assertionIds = [];
      evidencePinIds = [];
      report = null;
      reviewed = false;
      error = '';
      message = '';
    }
    if (report && signature !== currentSignature) {
      report = null;
      reviewed = false;
      message = 'The Case or selected scope changed. Preview and review the handoff again.';
    }
  });
  function chooseAssertion(id: string, checked: boolean) {
    assertionIds = checked ? [...assertionIds, id] : assertionIds.filter((value) => value !== id);
    const remaining = new Set(
      followUps
        .filter((item) => assertionIds.includes(item.id))
        .flatMap((item) => item.evidencePinIds),
    );
    evidencePinIds = evidencePinIds.filter((value) => remaining.has(value));
  }
  async function preview() {
    error = '';
    message = '';
    reviewed = false;
    try {
      report = previewCaseContainmentHandoff(record, selection, new Date().toISOString());
      signature = currentSignature;
      await tick();
      heading?.focus();
    } catch (cause) {
      report = null;
      error = cause instanceof Error ? cause.message : 'The handoff could not be prepared.';
    }
  }
  function accepted() {
    if (!report || signature !== currentSignature)
      throw new Error('Preview the current selection before export.');
    return buildCaseContainmentHandoff(record, selection, report.generatedAt, reviewed);
  }
  function download() {
    try {
      const value = accepted();
      downloadLocalFile(
        new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
        'internal-containment-handoff.json',
      );
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The handoff could not be downloaded.';
    }
  }
  async function save() {
    if (saving || mutationBusy) return;
    saving = true;
    error = '';
    message = '';
    try {
      const selected = accepted(),
        caseId = record.id,
        expected = currentSignature;
      const files = await prepareCaseAttachmentFiles(
        [
          new File([JSON.stringify(selected, null, 2)], 'internal-containment-handoff.json', {
            type: 'application/json',
          }),
        ],
        'Reviewed internal containment handoff',
        null,
      );
      if (!active || caseId !== record.id || expected !== currentSignature) return;
      const reviewSummary = {
        title: 'Reviewed internal containment handoff',
        reviewedAt: selected.generatedAt,
        reportDigestSha256: files[0]!.attachment.digestSha256,
        completeness:
          selected.state === 'partial' ? ('partial' as const) : ('inconclusive' as const),
        summary: `Selected retained follow-ups: ${selected.assertions.length}; selected supporting pins: ${selected.evidencePins.length}; audience: ${selected.audience}; recipient role: ${selected.recipientRole}. No request state, assignment, control or recovery outcome was changed.`,
        limitations: [
          'The retained file contains an explicitly reviewed audience projection, not verified containment.',
          'Original files are excluded; open requests remain open independently of external outcomes.',
        ],
      };
      if (
        await persistOperation(
          () => retainCaseAttachments(caseId, files, { reviewSummary }),
          'Saved the reviewed containment handoff without changing follow-up states.',
          () => (heading?.isConnected ? heading : (disclosureToggle ?? null)),
        )
      )
        message = 'Handoff saved as a retained Case file. No follow-up state was changed.';
      else message = 'The save was not confirmed. Check retained files before retrying.';
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : 'The handoff save was not confirmed. Check retained files before retrying.';
    } finally {
      saving = false;
    }
  }
</script>

<details class="containment"
  ><summary bind:this={disclosureToggle}>Prepare an internal containment handoff</summary><div
    class="body"
  >
    <p
      >Select retained follow-up requests and their exact supporting pins. This does not create
      tasks, send messages, apply controls or mark recovery complete.</p
    >
    <fieldset disabled={mutationBusy || saving}
      ><legend>Handoff scope</legend>
      <label
        >Disclosure audience<select bind:value={audience}
          ><option value="internal">Internal</option><option value="trusted"
            >Trusted recipient</option
          ><option value="public">Public disclosure preview only</option></select
        ></label
      >
      <label
        >Internal recipient role<select bind:value={recipientRole}
          >{#each CONTAINMENT_RECIPIENT_ROLES as role}<option value={role}
              >{role.replaceAll('_', ' ')}</option
            >{/each}</select
        ></label
      >
      <fieldset
        ><legend>Retained next-step assertions (up to {MAX_CONTAINMENT_ASSERTIONS})</legend
        >{#each followUps as item}<label class="choice"
            ><input
              type="checkbox"
              checked={assertionIds.includes(item.id)}
              disabled={!assertionIds.includes(item.id) &&
                assertionIds.length >= MAX_CONTAINMENT_ASSERTIONS}
              onchange={(event) => chooseAssertion(item.id, event.currentTarget.checked)}
            /><span>{item.statement} · {item.state}<small>{item.id}</small></span></label
          >{/each}{#if !followUps.length}<p
            >No retained next-step assertion is available. Record a follow-up before preparing this
            handoff.</p
          >{/if}</fieldset
      >
      <fieldset
        ><legend>Linked supporting evidence (up to {MAX_CONTAINMENT_PINS})</legend
        >{#each pins as pin, index}<label class="choice"
            ><input
              type="checkbox"
              checked={evidencePinIds.includes(pin.id)}
              disabled={!evidencePinIds.includes(pin.id) &&
                evidencePinIds.length >= MAX_CONTAINMENT_PINS}
              onchange={(event) =>
                (evidencePinIds = event.currentTarget.checked
                  ? [...evidencePinIds, pin.id]
                  : evidencePinIds.filter((id) => id !== pin.id))}
            /><span>{caseEvidenceChoiceName(pin, index)}<small>{pin.value}</small></span></label
          >{/each}{#if !pins.length}<p
            >No retained supporting pins are linked to the selected requests. Missing context
            remains explicit.</p
          >{/if}</fieldset
      >
      <button class="btn" type="button" onclick={() => void preview()}
        >Preview containment disclosure</button
      >
    </fieldset>
    {#if error}<p role="alert">{error}</p>{/if}
    {#if report}
      <section class="preview" aria-label="Containment disclosure preview"
        ><h5 bind:this={heading} tabindex="-1">Containment disclosure preview</h5>
        <p
          >Included requests: {report.assertions.length} · Supporting pins: {report.evidencePins
            .length} · Coverage: {report.state}</p
        >
        <ul
          >{#each report.disclosure.included as value}<li>Includes: {value}</li
            >{/each}{#each report.disclosure.excluded as value}<li>Excludes: {value}</li>{/each}</ul
        ><p>{report.disclosure.caution}</p>
        <pre>{formatCaseContainmentHandoff(report)}</pre>
        <details
          ><summary>Exact JSON disclosure</summary><p
            >The download and retained file contain this complete projection, including any selected
            pin scope, provenance and recheck metadata.</p
          ><pre>{JSON.stringify(report, null, 2)}</pre></details
        >
        {#if report.disclosure.exportAllowed}
          <label class="choice"
            ><input type="checkbox" bind:checked={reviewed} disabled={saving || mutationBusy} />I
            reviewed these exact statements, evidence values and audience disclosures for this
            recipient.</label
          >
          <div class="actions"
            ><button
              class="btn"
              type="button"
              disabled={!reviewed || saving || mutationBusy}
              onclick={download}>Download containment handoff</button
            ><button
              class="btn"
              type="button"
              disabled={!reviewed || saving || mutationBusy}
              onclick={() => void save()}>Save containment handoff in Case</button
            >
            {#if reviewed && signature === currentSignature}<CopyButton
                value={formatCaseContainmentHandoff(report)}
                label="Copy containment handoff"
                description="Copy the reviewed containment handoff"
              />{/if}
          </div>
        {:else}<p
            >Public disclosure excludes internal requests and their pins. Choose an internal or
            trusted audience and at least one request for a containment export.</p
          >{/if}
      </section>
    {/if}
    <p role="status">{message}</p>
  </div></details
>

<style>
  .containment,
  .body,
  fieldset,
  .preview {
    min-width: 0;
  }
  .body,
  fieldset,
  .preview {
    display: grid;
    gap: 10px;
  }
  .body {
    padding-block: 12px;
  }
  summary {
    cursor: pointer;
    min-height: 32px;
    padding-block: 6px;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
  }
  legend {
    font-size: var(--text-sm);
    font-weight: 600;
    margin-bottom: 8px;
  }
  label {
    display: grid;
    gap: 6px;
  }
  .choice {
    display: flex;
    align-items: start;
    gap: 8px;
    min-height: 36px;
  }
  .choice input {
    flex: none;
    margin-top: 4px;
  }
  .choice span {
    min-width: 0;
  }
  small {
    display: block;
    color: var(--muted);
  }
  p,
  h5 {
    margin: 0;
  }
  p,
  li,
  label,
  small {
    font-size: var(--text-xs);
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  select {
    min-width: 0;
    max-width: 100%;
  }
  pre {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: var(--text-xs);
    line-height: 1.6;
    max-height: 480px;
    overflow: auto;
  }
  button {
    justify-self: start;
    white-space: normal;
    max-width: 100%;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  [role='status']:empty {
    display: none;
  }
</style>
