<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import type { CaseRecord } from '../../../../packages/cases/case-record-contracts.mts';
  import type { buildCaseResponseReviewInputs } from '../../../../packages/cases/case-response-packet.mts';
  import { canonicalArtifactJsonV2 } from '../../../../packages/evidence/artifact-integrity.mts';
  import { prepareCaseAttachmentExport } from '#lib/case-attachments.ts';
  import { inspectRetainedCaseOriginals, caseOriginalFileState, assertCaseReviewHandoffCurrent } from '#lib/case-review-package.ts';
  import { captureConsoleReferenceScope, subscribeConsoleReferenceView } from '#lib/console-workflow-state.ts';
  import { evidenceTime } from '#lib/analysis/evidence-time.ts';
  import EvidenceFileExport from './EvidenceFileExport.svelte';
  import Pagination from './Pagination.svelte';

  let { record, material, identity }: {
    record: CaseRecord; material: ReturnType<typeof buildCaseResponseReviewInputs>; identity: string;
  } = $props();
  let root = $state<HTMLDetailsElement>(), expanded = $state(false), busy = $state(false), exporting = $state(false);
  let error = $state(''), selectedIds = $state<string[]>([]), page = $state(1), exportEpoch = $state(0);
  let inspection = $state.raw<Awaited<ReturnType<typeof inspectRetainedCaseOriginals>> | null>(null);
  let controller: AbortController | null = null, generation = 0, disposed = false;
  const references = $derived(record.attachments ?? []);
  const selected = $derived(references.filter(item => selectedIds.includes(item.id)));
  const verifiedSelection = $derived(selected.length > 0 && selected.every(file => caseOriginalFileState(inspection, file) === 'verified'));
  const currentPage = $derived(Math.min(page, Math.max(1, Math.ceil(references.length / 10))));
  const rows = $derived(references.slice((currentPage - 1) * 10, currentPage * 10));
  const unmatched = $derived(material.artefactReferences.filter(reference => !references.some(file =>
    reference.byteLength !== null && file.byteLength === reference.byteLength && file.digestSha256 === `sha256:${reference.digestSha256}`)));

  function cancelPreparation() {
    generation++; exportEpoch = generation; controller?.abort(); controller = null;
    busy = false; exporting = false; error = ''; exportOperation = null;
  }
  function reset() {
    cancelPreparation();
    inspection = null; selectedIds = []; page = 1;
  }
  function selectReference(id: string, checked: boolean) {
    if (exporting) return;
    cancelPreparation();
    selectedIds = checked ? [...selectedIds, id] : selectedIds.filter(value => value !== id);
  }
  $effect(() => { identity; untrack(reset); });
  beforeNavigate(reset);
  onDestroy(() => { disposed = true; reset(); });
  onMount(() => {
    let scope = captureConsoleReferenceScope();
    return subscribeConsoleReferenceView(() => {
      const next = captureConsoleReferenceScope();
      if (scope.workspaceId !== next.workspaceId || scope.generation !== next.generation) reset();
      scope = next;
    });
  });
  const capture = () => ({ generation, identity, scope: captureConsoleReferenceScope() });
  type Operation = ReturnType<typeof capture>;
  function current(operation: Operation) {
    const scope = captureConsoleReferenceScope();
    return !disposed && operation.generation === generation && operation.identity === identity
      && operation.scope.workspaceId !== null && operation.scope.workspaceId === scope.workspaceId
      && operation.scope.generation === scope.generation && expanded && root?.isConnected && root.open
      && !root.closest('[hidden], [inert], details:not([open])');
  }
  function requireCurrent(operation: Operation) {
    if (!current(operation)) throw new DOMException('File preparation cancelled.', 'AbortError');
  }
  async function inspect(all = false) {
    if (busy || exporting || !expanded) return;
    if (!all && !selectedIds.length) return;
    cancelPreparation();
    const ids = all ? undefined : [...selectedIds];
    const operation = capture(), abort = new AbortController();
    if (!current(operation)) return;
    controller = abort; busy = true;
    try {
      const result = await inspectRetainedCaseOriginals(record, abort.signal, ids);
      if (current(operation) && !abort.signal.aborted) inspection = result;
    } catch {
      if (current(operation) && !abort.signal.aborted) error = 'The current Case files could not be checked. Review the Case and try again; nothing was changed.';
    } finally { if (current(operation)) { busy = false; controller = null; } }
  }
  let exportOperation: { operation: Operation; expectedCase: string; caseId: string } | null = null;
  async function exportFiles(signal: AbortSignal) {
    const operation = capture(); requireCurrent(operation);
    if (!verifiedSelection) throw new Error('Check every selected reference before preparing its files.');
    exportOperation = { operation, expectedCase: canonicalArtifactJsonV2(record), caseId: record.id };
    const files = await prepareCaseAttachmentExport(selected, signal);
    requireCurrent(operation); return files;
  }
  async function validateSelection() {
    const captured = exportOperation;
    if (!captured) throw new DOMException('File preparation cancelled.', 'AbortError');
    requireCurrent(captured.operation);
    await assertCaseReviewHandoffCurrent(captured.expectedCase, captured.caseId);
    requireCurrent(captured.operation);
  }
  function exportBusyHandler(epoch: number) {
    // Capture a plain generation value: a disposed keyed block's derived value
    // must not be read by the exporter's asynchronous completion callback.
    return (value: boolean) => { if (epoch === generation && !disposed) exporting = value; };
  }
</script>

<svelte:window onpagehide={reset} />
<details class="packet-files" bind:this={root} bind:open={expanded} ontoggle={() => { if (!expanded) reset(); }}>
  <summary>Prepare original files separately · {references.length} retained references</summary>
  {#if expanded}
    <div class="file-review" role="region" aria-label="Recipient file preparation">
      <p>The response packet contains evidence and capture references, not original file contents. Select candidate references, then check their bytes before preparing a separate package. Nothing is selected or sent automatically.</p>
      <div class="check-actions">
        <button class="btn" type="button" disabled={busy || exporting || !selected.length} onclick={() => void inspect()}>Check selected originals</button>
        <button class="btn" type="button" disabled={busy || exporting || !references.length} onclick={() => void inspect(true)}>Check all Case originals</button>
      </div>
      <p role="status" aria-label="Recipient original-file check" aria-busy={busy}>{#if busy}Checking retained files… {/if}{#if inspection}Last completed check: {inspection.checkedReferences.length} reference{inspection.checkedReferences.length === 1 ? '' : 's'} · {inspection.verified} verified · {inspection.missing} missing · {inspection.unverified} unverified distinct files. Checked against retained size and SHA-256; other references are not checked.{:else}{references.length ? 'File availability has not been checked.' : 'No file references are retained in this Case.'}{/if}</p>
      {#if unmatched.length}<p>{unmatched.length} packet capture reference{unmatched.length === 1 ? '' : 's'} without an exact retained-file match. A match requires both digest and byte length; a filename or unknown length is not enough.</p>{/if}
      {#if references.length}
        <p>{selected.length} selected · {references.length - selected.length} not selected. Selection is not verification. Every selected reference must pass before export.</p>
        <ul class="file-list">{#each rows as file (file.id)}
          {@const state = caseOriginalFileState(inspection, file)}
          {@const packetMatches = material.artefactReferences.filter(reference => reference.byteLength === file.byteLength && `sha256:${reference.digestSha256}` === file.digestSha256)}
          <li>
            <label><input type="checkbox" disabled={exporting} checked={selectedIds.includes(file.id)} onchange={event => selectReference(file.id, event.currentTarget.checked)}><span><strong>{file.fileName}</strong><small>{state === 'not_checked' ? 'Not checked' : state === 'verified' ? 'Verified bytes' : state === 'missing' ? 'Missing bytes' : 'Unverified bytes'} · {file.derivation ? 'Derived image' : 'Retained file'} · {file.byteLength.toLocaleString('en-AU')} bytes</small></span></label>
            <p>{packetMatches.length ? `${packetMatches.length} exact packet capture reference${packetMatches.length === 1 ? '' : 's'}` : 'Not referenced as a capture in this packet'}</p>
            <details><summary>Source and file identity</summary><dl><dt>Source declaration</dt><dd>{file.source ?? 'Unknown'}</dd><dt>Observed</dt><dd>{evidenceTime(file.observedAt)?.readable ?? 'Unknown'}</dd><dt>Reference</dt><dd><code>{file.id}</code></dd><dt>SHA-256</dt><dd><code>{file.digestSha256}</code></dd>{#if file.derivation}<dt>Original image digest</dt><dd><code>{file.derivation.source.digestSha256}</code></dd>{/if}</dl></details>
          </li>
        {/each}</ul>
        <Pagination {currentPage} pageCount={Math.ceil(references.length / 10)} setPage={value => page = value} ariaLabel="Recipient file pages" />
      {/if}
      {#if error}<p role="alert">{error}</p>{/if}
      {#if verifiedSelection}
        <p>Review each selected file for this recipient. Its contents stay unchanged: packet redaction rules do not redact files. This separate export does not include the full Case backup, authorise delivery, or record a submission.</p>
        {#key exportEpoch}
          <EvidenceFileExport getFiles={exportFiles} {validateSelection} workflow="Selected response evidence files" disabled={busy} onbusy={exportBusyHandler(exportEpoch)} />
        {/key}
      {:else if selected.length}<p>Check the selected originals, or remove references that remain missing or unverified, before preparing a package.</p>{/if}
      <small>Changing selection cancels an unfinished check. Changing packet inputs, leaving this phase or closing this review clears its temporary check and selection. Export checks the current bytes again. Existing files and the packet remain unchanged.</small>
    </div>
  {/if}
</details>

<style>
  .check-actions{display:flex;flex-wrap:wrap;gap:8px}
  .packet-files{min-width:0}.file-review{display:grid;gap:12px;padding-block:12px}.file-review p,.file-review small{margin:0;color:var(--muted);font:400 var(--text-sm)/1.55 var(--font-sans);overflow-wrap:anywhere}.file-list{list-style:none;padding:0;margin:0;display:grid;gap:12px}.file-list>li{border:1px solid var(--border);border-radius:8px;padding:12px;min-width:0;display:grid;gap:8px}.file-list label{display:flex;align-items:start;gap:10px;min-width:0}.file-list label>span{min-width:0;display:grid;gap:4px;overflow-wrap:anywhere}.file-list input{flex-shrink:0;margin-top:4px}.file-list details{min-width:0}.file-list dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:8px;margin-block:10px}.file-list dd{margin:0;overflow-wrap:anywhere}.file-list code{overflow-wrap:anywhere;white-space:normal}@media(max-width:500px){.file-list dl{grid-template-columns:minmax(0,1fr)}.file-list dt{font-weight:600}}
</style>
