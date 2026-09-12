<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { CaseRecord } from '$lib/cases';
  import { buildCaseExport } from '../../../../packages/cases/case-storage-model.mts';
  import { MAX_CASE_IMPORT_BYTES } from '../../../../packages/contracts/case-portability.mts';
  import { canonicalArtifactJsonV2, sha256ArtifactBytes } from '../../../../packages/evidence/artifact-integrity.mts';
  import { CASE_REVIEW_KINDS, previewCaseReviewReturn, selectedCaseReviewRows, type CaseReviewReturn, type CaseReviewRow } from '../../../../packages/cases/case-review-return.mts';
  import { parseBoundedJson, boundedJsonLimitsForBytes } from '$lib/bounded-json';

  let { record, mutationBusy, persist }: {
    record: CaseRecord;
    mutationBusy: boolean;
    persist: (preview: CaseReviewReturn, keys: readonly string[], focus: () => HTMLElement | null) => Promise<boolean>;
  } = $props();
  let preview = $state.raw<CaseReviewReturn | null>(null);
  let selected = $state<string[]>([]);
  let parsing = $state(false);
  let message = $state('');
  let page = $state(1);
  let filter = $state<'changed' | 'all'>('changed');
  let heading: HTMLHeadingElement;
  let generation = 0;
  const stale = $derived(preview !== null && canonicalArtifactJsonV2(record) !== preview.expectedCase);
  const rows = $derived(preview?.rows.filter(row => filter === 'all' || row.state !== 'unchanged') ?? []);
  const pages = $derived(Math.max(1, Math.ceil(rows.length / 10)));
  const visibleRows = $derived(rows.slice((Math.min(page, pages) - 1) * 10, Math.min(page, pages) * 10));
  const selectionError = $derived.by(() => {
    if (!preview || !selected.length) return '';
    try { selectedCaseReviewRows(preview, selected); return ''; }
    catch (cause) { return cause instanceof Error ? cause.message : 'Review this selection.'; }
  });
  onDestroy(() => { generation++; });

  function title(row: CaseReviewRow): string {
    const entry = row.returned;
    return 'body' in entry ? entry.body : 'label' in entry ? `${entry.label}: ${entry.value}` : 'summary' in entry ? entry.summary : entry.statement;
  }
  function select(key: string, checked: boolean) {
    selected = checked ? [...selected, key] : selected.filter(value => value !== key);
  }
  async function selectFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    const revision = ++generation;
    preview = null; selected = []; page = 1; message = ''; parsing = Boolean(file);
    if (!file) return;
    // The Case baseline belongs to this selection, not to the later read result.
    const baseline = JSON.parse(JSON.stringify(record)) as CaseRecord;
    try {
      if (file.size > MAX_CASE_IMPORT_BYTES) throw new Error('Review files are limited to 2 MiB. Select an export containing one Case.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const value = parseBoundedJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), {
        label: 'Case review return', maximumBytes: MAX_CASE_IMPORT_BYTES, limits: boundedJsonLimitsForBytes(MAX_CASE_IMPORT_BYTES),
      });
      const checked = previewCaseReviewReturn(baseline, value, await sha256ArtifactBytes(bytes));
      if (revision !== generation) return;
      preview = checked;
      const additions = checked.rows.filter(row => row.state === 'new').length;
      const conflicts = checked.rows.filter(row => row.state === 'conflict').length;
      message = `Review ${additions} new ${additions === 1 ? 'entry' : 'entries'} and ${conflicts} ${conflicts === 1 ? 'conflict' : 'conflicts'}. Nothing has been saved.`;
    } catch (cause) {
      if (revision === generation) message = cause instanceof Error ? cause.message : 'Could not read the review file.';
    } finally {
      if (revision === generation) { parsing = false; input.value = ''; }
    }
  }
  function exportCopy() {
    try {
      const text = JSON.stringify(buildCaseExport([record]), null, 2);
      if (new TextEncoder().encode(text).length > MAX_CASE_IMPORT_BYTES) throw new Error('This Case exceeds the 2 MiB review-file limit. Use a workspace backup for its complete contents; no shortened review copy was created.');
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `case-review-${record.id}.json`; anchor.click();
      URL.revokeObjectURL(url);
      message = 'Downloaded a full review copy of this Case. Share it only with the intended reviewer.';
    } catch (cause) { message = cause instanceof Error ? cause.message : 'Could not export the review copy.'; }
  }
  async function apply() {
    if (!preview || stale || !selected.length || selectionError || mutationBusy) return;
    const source = document.activeElement;
    const saved = await persist(preview, [...selected], () => heading ?? null);
    if (saved) {
      preview = null; selected = [];
      message = 'Selected review entries were saved. The handoff trail records the file and selected-entry identities.';
      await tick();
      if (document.activeElement === source || document.activeElement === document.body) heading?.focus({ preventScroll: true });
    }
  }
</script>

<section class="case-response-stage review-return" aria-labelledby={`case-review-heading-${record.id}`}>
  <h3 id={`case-review-heading-${record.id}`} tabindex="-1" bind:this={heading}>Review with another analyst</h3>
  <details>
    <summary>Share a copy or review returned entries</summary>
    <div class="stack">
      <p>Export this Case, have the reviewer import it into a separate workspace and return its Case export. A full copy includes retained notes, incident links and evidence; it is not redacted or encrypted.</p>
      <button class="btn" type="button" onclick={exportCopy} disabled={mutationBusy || parsing}>Export this Case for review</button>
      <label for={`case-review-file-${record.id}`}>Returned Case file (JSON)</label>
      <input id={`case-review-file-${record.id}`} type="file" accept="application/json,.json" onchange={selectFile} disabled={mutationBusy || parsing}>
      <p class="muted">Review stays in page memory. Only selected new notes, pins, decisions and assertions are added. Status, authorisations, actions, closures and observations are not inherited. Matching IDs do not authenticate the reviewer.</p>
      <p role="status" aria-label="Case review return status">{parsing ? 'Reading the selected review file…' : message}</p>
      {#if preview}
        <p class="digest">File: <code>{preview.fileDigest}</code></p>
        {#if preview.isCliPack}<p>This preview checks Case data, not the CLI pack's checksum or report binding. Verify the pack separately before relying on those claims.</p>{/if}
        {#if stale}<p role="alert">This Case changed after the preview. Reload it and select the returned file again before applying entries.</p>{/if}
        <div class="toolbar">
          <label><input type="checkbox" checked={filter === 'all'} onchange={(event) => { filter = event.currentTarget.checked ? 'all' : 'changed'; page = 1; }}> Show unchanged entries</label>
          <button class="btn" type="button" disabled={!selected.length || mutationBusy} onclick={() => { selected = []; }}>Clear selection</button>
        </div>
        <p>{rows.length} displayed entries · {selected.length} selected across all pages</p>
        <ul class="records">
          {#each visibleRows as row (row.key)}
            <li>
              {#if row.state === 'new'}
                <label class="entry-heading">
                  <input type="checkbox" aria-label={`Select ${CASE_REVIEW_KINDS[row.kind].label.toLowerCase()} ${title(row)}`} checked={selected.includes(row.key)} disabled={mutationBusy || stale} onchange={(event) => select(row.key, event.currentTarget.checked)}>
                  <strong>{CASE_REVIEW_KINDS[row.kind].label} · New entry</strong>
                </label>
              {:else}<strong>{CASE_REVIEW_KINDS[row.kind].label} · {row.state === 'conflict' ? 'Conflicting content — not selectable' : 'Already retained'}</strong>{/if}
              <p class="entry-title">{title(row)}</p>
              <p class="muted">Recorded: {row.returned.createdAt} · ID: {row.returned.id}</p>
              {#if row.evidencePinIds.length}<p>Linked pins: {row.evidencePinIds.join(', ')}. Select each new linked pin; conflicting pins cannot support an imported claim.</p>{/if}
              <details><summary>Full returned entry{row.local ? ' and local comparison' : ''}</summary>
                {#if row.local}<h4>Retained locally</h4><pre>{JSON.stringify(row.local, null, 2)}</pre>{/if}
                <h4>Returned entry</h4><pre>{JSON.stringify(row.returned, null, 2)}</pre>
              </details>
            </li>
          {/each}
        </ul>
        {#if pages > 1}<nav class="toolbar" aria-label="Review entry pages">
          <button class="btn" type="button" disabled={page <= 1} onclick={() => { page--; }}>Previous entries</button>
          <span>Page {page} of {pages}</span>
          <button class="btn" type="button" disabled={page >= pages} onclick={() => { page++; }}>Next entries</button>
        </nav>{/if}
        {#if selectionError}<p role="alert">{selectionError}</p>{/if}
        <button class="btn" type="button" disabled={!selected.length || !!selectionError || stale || mutationBusy} onclick={() => void apply()}>Add selected review entries</button>
      {/if}
    </div>
  </details>
</section>

<style>
  .review-return { border-top: 1px solid var(--border); padding-top: 16px; }
  h3, h4, p { margin: 0; overflow-wrap: anywhere; }
  p { max-width: 75ch; }
  .muted { color: var(--muted); font-size: var(--text-xs); }
  .toolbar, .entry-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .toolbar label { min-height: var(--control-h); cursor: pointer; }
  .entry-heading { flex-wrap: nowrap; min-height: var(--control-h); cursor: pointer; }
  .entry-heading strong { min-width: 0; }
  .entry-heading input { flex: 0 0 auto; }
  .records > li { display: grid; gap: 10px; }
  .entry-title { white-space: pre-wrap; }
  label { display: flex; align-items: center; gap: 8px; }
  input[type='file'], .digest { min-width: 0; max-width: 100%; }
  input[type='file'] { min-height: var(--control-h); font: inherit; color: var(--text); }
  input[type='file']::file-selector-button { min-height: var(--control-h); padding: 8px 12px; margin-right: 8px; font: 650 var(--text-xs) var(--mono); color: var(--text); background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }
  code { overflow-wrap: anywhere; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; max-width: 100%; font-size: var(--text-xs); line-height: 1.6; }
  button { justify-self: start; }
</style>
