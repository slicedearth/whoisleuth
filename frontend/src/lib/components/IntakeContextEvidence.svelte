<script lang="ts">
  import type {
    MessageIntakeReport,
    IntakeDistributionContext,
    IntakePhoneReview,
    CurrentMessageIntakeReport,
  } from '../../../../packages/contracts/message-intake.mts';
  import { INTAKE_DISTRIBUTION_CHANNELS } from '../../../../packages/contracts/message-intake.mts';
  import {
    intakeIndicators,
    intakeIndicatorSource,
  } from '../../../../packages/investigation/intake-indicators.mts';
  import { readIntakeDistributionContext } from '../../../../packages/investigation/intake-context.mts';
  import CopyButton from './CopyButton.svelte';
  import Pagination from './Pagination.svelte';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';
  import IntakeSelectedEvidence from './IntakeSelectedEvidence.svelte';
  let {
    report,
    disabled = false,
    onchange,
    onpending,
    phoneReview,
    onreviewchange,
  }: {
    report: MessageIntakeReport;
    disabled?: boolean;
    onchange: (context: IntakeDistributionContext | null) => void;
    onpending: (pending: boolean) => void;
    phoneReview?: IntakePhoneReview | undefined;
    onreviewchange: (report: CurrentMessageIntakeReport) => void;
  } = $props();
  let page = $state(1),
    channel = $state<IntakeDistributionContext['channel']>('unknown');
  let sourceLabel = $state(''),
    observedAt = $state(''),
    reference = $state(''),
    observerLabel = $state(''),
    vantageLabel = $state('');
  let error = $state(''),
    pending = $state(false);
  let selectionPending = $state(false);
  const indicators = $derived(intakeIndicators(report));
  const context = $derived(report.schemaVersion === 2 ? report.distributionContext : null);
  function changed() {
    pending = true;
    onpending(true);
    error = '';
  }
  function apply(event: SubmitEvent) {
    event.preventDefault();
    try {
      const value = readIntakeDistributionContext({
        channel,
        sourceLabel: sourceLabel.trim(),
        observedAt: observedAt.trim() || null,
        reference: reference.trim() || null,
        observerLabel: observerLabel.trim() || null,
        vantageLabel: vantageLabel.trim() || null,
      });
      onchange(value);
      pending = false;
      onpending(selectionPending);
      error = '';
    } catch (cause) {
      error =
        cause instanceof Error ? cause.message : 'The supplied context could not be accepted.';
    }
  }
  function remove() {
    onchange(null);
    pending = false;
    onpending(selectionPending);
    error = '';
    sourceLabel = '';
    observedAt = '';
    reference = '';
    observerLabel = '';
    vantageLabel = '';
    channel = 'unknown';
  }
</script>

<section class="intake-context" aria-label="Source-linked indicators and distribution context">
  <h4>Literal IPs and labelled hashes · {indicators.length}</h4>
  <p
    >These values were found in selected text, not resolved or reputation-checked. Hashes require an
    algorithm label. A matching hash-like string does not identify a file or establish
    maliciousness.</p
  >
  {#if report.schemaVersion === 2}<p
      >Indicator coverage: {report.indicatorCoverage.state.replaceAll('_', ' ')}. URL contents,
      message headers, QR payloads, HAR and identity-event fields are not scanned for these
      indicators.</p
    >{:else}<p>This historical report did not review indicators.</p>{/if}
  <ol start={(page - 1) * 10 + 1}
    >{#each indicators.slice((page - 1) * 10, page * 10) as indicator (indicator.id)}
      <li
        ><strong>{indicator.kind.toUpperCase()}</strong> <code>{indicator.value}</code>
        <p
          >{indicator.source.replaceAll('_', ' ')} · {indicator.location.partId}{indicator.location
            .page
            ? ` · page ${indicator.location.page}`
            : ''}</p
        >
        <details
          ><summary>Linked source identity</summary><p
            >This source part belongs to the selected input. Its digest identifies bytes, not their
            author.</p
          ><code>{intakeIndicatorSource(report, indicator)}</code></details
        >
        <CopyButton
          value={`${indicator.kind.toUpperCase()} ${indicator.value}\nSource: ${intakeIndicatorSource(report, indicator)}\nPart: ${indicator.location.partId}${indicator.location.page ? `; page ${indicator.location.page}` : ''}\nBasis: literal analyst-selected text; not independently verified`}
          label="Copy indicator citation"
          description={`Copy source citation for ${indicator.id}`}
        />
      </li>
    {/each}</ol
  >
  {#if indicators.length > 10}<Pagination
      currentPage={page}
      pageCount={Math.ceil(indicators.length / 10)}
      setPage={(next) => (page = next)}
      ariaLabel="Extracted indicator pages"
    />{/if}
  <details
    ><summary>Declare distribution context</summary>
    <p
      >Optional analyst declarations, not verified delivery, network location or capture conditions.
      Use non-sensitive labels; do not enter recipients, account identifiers, credentials or exact
      URLs.</p
    >
    <form onsubmit={apply}
      ><fieldset {disabled}>
        <label
          >Declared distribution channel<select bind:value={channel} onchange={changed}
            >{#each INTAKE_DISTRIBUTION_CHANNELS as item}<option value={item}>{item}</option
              >{/each}</select
          ></label
        >
        <label
          >Context source label<input
            required
            maxlength="160"
            bind:value={sourceLabel}
            oninput={changed}
            placeholder="Analyst report"
          /></label
        >
        <label
          >Declared observation time (ISO with timezone)<input
            maxlength="40"
            bind:value={observedAt}
            oninput={changed}
            placeholder="2026-01-02T03:04:05Z"
          /></label
        >
        <label
          >Non-sensitive reference<input
            maxlength="160"
            bind:value={reference}
            oninput={changed}
            placeholder="CASE-17"
          /></label
        >
        <label
          >Declared observer label<input
            maxlength="80"
            bind:value={observerLabel}
            oninput={changed}
          /></label
        >
        <label
          >Declared vantage label<input
            maxlength="80"
            bind:value={vantageLabel}
            oninput={changed}
          /></label
        >
        <button class="btn" type="submit">Apply distribution declaration</button><button
          class="btn"
          type="button"
          onclick={remove}>Clear distribution declaration</button
        >
      </fieldset></form
    >
    {#if pending}<p role="status"
        >Apply or clear these declarations before saving or downloading this review.</p
      >{/if}
    {#if error}<p role="alert">{error}</p>{/if}
  </details>
  {#if context}<section aria-label="Applied distribution declaration"
      ><h5>Analyst-declared distribution</h5><p>{context.channel} · {context.sourceLabel}</p><p
        ><EvidenceTimestamp value={context.observedAt} label="declared observation time" /></p
      ><p
        >Reference: {context.reference ?? 'Not supplied'} · Observer: {context.observerLabel ??
          'Unknown'} · Vantage: {context.vantageLabel ?? 'Unknown'}</p
      ><p
        >These declarations are included in the review download and retained review. They do not
        establish independent collection.</p
      ></section
    >{/if}
  <IntakeSelectedEvidence {report} {phoneReview} {disabled} onchange={onreviewchange} onpending={value => { selectionPending = value; onpending(pending || value); }} />
</section>

<style>
  .intake-context,
  fieldset,
  form,
  section {
    display: grid;
    gap: 10px;
    min-width: 0;
  }
  h4,
  h5,
  p {
    margin: 0;
  }
  h4 {
    font-size: var(--text-sm);
  }
  h5 {
    font-size: var(--text-xs);
  }
  p,
  li,
  label {
    font-size: var(--text-xs);
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  ol {
    display: grid;
    gap: 12px;
    margin: 0;
    padding-left: 22px;
  }
  code {
    overflow-wrap: anywhere;
    font-size: inherit;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 8px 0;
  }
  label {
    display: grid;
    gap: 4px;
  }
  input,
  select {
    min-width: 0;
    max-width: 100%;
  }
  button {
    justify-self: start;
    white-space: normal;
    max-width: 100%;
  }
  summary {
    cursor: pointer;
    min-height: 32px;
    padding-block: 6px;
  }
</style>
