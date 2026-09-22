<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CaseRecord } from '$lib/cases';
  import type { PersistCaseOperation } from '$lib/analysis/case-response-stage.ts';
  import { MAX_CONTEXT_INPUT_BYTES, type ContextReview } from '../../../../packages/contracts/context-review.mts';
  import { runConnectorProvenanceWorker } from '$lib/connector-provenance-worker.ts';
  import { readContextFile } from '$lib/context-review-input.ts';
  import CaseContextReport from './CaseContextReport.svelte';
  import LocalFileInput from './LocalFileInput.svelte';
  import type { ContextReviewPresentation } from '$lib/analysis/context-review-presentation.ts';
  import './context-review.css';
  let { record, mutationBusy, persistOperation }: { record: CaseRecord; mutationBusy: boolean; persistOperation: PersistCaseOperation } = $props();
  let current = $state(''), previous = $state(''), report = $state.raw<ContextReview | null>(null), error = $state(''), loading = $state(false), generation = 0;
  let processing = $state(false), controller: AbortController | null = null;
  let currentFile = $state.raw<File | null>(null), previousFile = $state.raw<File | null>(null);
  let presentation = $state.raw<ContextReviewPresentation | null>(null);
  onDestroy(() => { generation++; controller?.abort(); current = ''; previous = ''; });
  async function load(file: File | null, earlier: boolean) {
    if (!file) { generation++; loading = false; return; }
    const request = ++generation; loading = true; error = '';
    try { const value = await readContextFile(file); if (request === generation) { if (earlier) previous = value; else current = value; report = null; } }
    catch { if (request === generation) error = 'The selected configuration could not be read. Existing text was preserved.'; }
    finally { if (request === generation) loading = false; }
  }
  async function review(event: SubmitEvent) {
    event.preventDefault(); if (processing || loading) return;
    error = ''; report = null; controller = new AbortController(); processing = true;
    const request = ++generation;
    try { const next = await runConnectorProvenanceWorker({ current, previous, reviewedAt: new Date().toISOString() }, controller.signal); if (request === generation) { report = next.report; presentation = { kind: 'connector', connectors: next.connectors }; } }
    catch (cause) { if (request === generation) error = cause instanceof Error ? cause.message : 'The configuration could not be reviewed.'; }
    finally { if (request === generation) { processing = false; controller = null; } }
  }
</script>
<section class="context-review" aria-label="Connector and MCP configuration provenance"><h3>Connector and MCP configuration provenance</h3><div class="body">
  <p>Review the <code>mcpServers</code> or <code>servers</code> section locally. Commands are not executed and endpoints are not contacted.</p>
  <form onsubmit={event => void review(event)}><fieldset disabled={loading || processing || mutationBusy}><legend>Selected configurations</legend>
    <LocalFileInput label="Current configuration file" accept=".json,application/json" maximumBytes={MAX_CONTEXT_INPUT_BYTES} disabled={loading || processing || mutationBusy} bind:file={currentFile} onselect={file => load(file, false)} />
    <label>Current configuration<textarea required rows="5" maxlength={MAX_CONTEXT_INPUT_BYTES} bind:value={current} spellcheck="false" oninput={() => report = null}></textarea></label>
    <details><summary>Compare with an earlier configuration</summary><div class="body"><LocalFileInput label="Earlier configuration file" accept=".json,application/json" maximumBytes={MAX_CONTEXT_INPUT_BYTES} disabled={loading || processing || mutationBusy} bind:file={previousFile} onselect={file => load(file, true)} /><label>Earlier configuration<textarea rows="4" maxlength={MAX_CONTEXT_INPUT_BYTES} bind:value={previous} spellcheck="false" oninput={() => report = null}></textarea></label></div></details>
    <button class="btn" type="submit">Review connector provenance</button><button class="btn" type="button" onclick={() => { current = ''; previous = ''; currentFile = null; previousFile = null; report = null; error = ''; }}>Clear configuration text</button>
  </fieldset></form>
  {#if processing}<p role="status">Reviewing locally…</p><button class="btn" type="button" onclick={() => controller?.abort()}>Cancel connector review</button>{/if}
  {#if error}<p role="alert">{error}</p>{/if}{#if report}<CaseContextReport {report} {presentation} {record} {mutationBusy} {persistOperation} />{/if}
</div></section>
