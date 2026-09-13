<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { parseBoundedJson } from '$lib/bounded-json';
  import {
    importExternalFindingsIntoCase,
    type CaseRecord,
    type ExternalFindingsDocument,
  } from '$lib/cases';
  import { externalFindingsCaseTargets } from '$lib/analysis/external-findings-import.ts';
  import { buildLocalRenderedCaptureHandoff } from '$lib/analysis/local-rendered-capture-handoff.ts';
  import {
    WEB_CAPTURE_MANIFEST_SCHEMA,
    parseWebCaptureManifest,
  } from '$lib/analysis/web-capture-import.ts';
  import CopyableCommand from '$lib/components/CopyableCommand.svelte';
  import ArtifactPreview from './ArtifactPreview.svelte';
  import { runInvestigationPackageWorker } from '$lib/investigation-package-worker.ts';
  import type { BrowserCaptureAttachmentReview } from '$lib/investigation-package-worker-model.ts';
  import { supportsArtifactPreview } from '$lib/artifact-preview.ts';
  import { MAX_INVESTIGATION_MANIFEST_ARTIFACTS } from '../../../../packages/investigation/investigation-manifest.mts';
  import { retainCaseAttachments, type SelectedCaseAttachment } from '$lib/case-attachments.ts';
  import { readCaseAttachment } from '../../../../packages/cases/case-attachment-model.mts';
  import { sha256ArtifactBytes } from '../../../../packages/evidence/artifact-integrity.mts';
  import type { PersistCaseOperation } from '$lib/analysis/case-response-stage.ts';
  import { MAX_WEB_CAPTURE_MANIFEST_BYTES } from '../../../../packages/contracts/web-capture.mts';
  import CaptureComparison from './CaptureComparison.svelte';

  let {
    record,
    exactIncidentUrl,
    persistOperation,
    mutationBusy,
    onmessage,
  }: {
    record: CaseRecord;
    exactIncidentUrl: string | null;
    persistOperation: PersistCaseOperation;
    mutationBusy: boolean;
    onmessage: (message: string) => void;
  } = $props();

  let preview = $state<ExternalFindingsDocument | null>(null);
  let previewTargets = $state<readonly string[]>([]);
  let parsing = $state(false);
  let importing = $state(false);
  let retainMatching = $state(false);
  let manifestFile = $state.raw<Blob | null>(null);
  let attachments = $state.raw<BrowserCaptureAttachmentReview | null>(null);
  let checking = $state(false);
  let activeArtifact = $state('');
  let manifestInput = $state<HTMLInputElement>();
  let attachmentInput = $state<HTMLInputElement>();
  let artifactTrigger: HTMLButtonElement | null = null;
  let attachmentController: AbortController | null = null;
  let selectionGeneration = 0;
  let activeCaseId: string | undefined;
  $effect(() => {
    if (record.id === activeCaseId) return;
    activeCaseId = record.id;
    selectionGeneration++; attachmentController?.abort(); attachmentController = null;
    preview = null; previewTargets = []; manifestFile = null; attachments = null; activeArtifact = ''; checking = false; parsing = false; retainMatching = false;
  });
  onDestroy(() => { selectionGeneration++; attachmentController?.abort(); });
  const handoff = $derived.by(() => {
    if (!exactIncidentUrl) return null;
    try {
      return buildLocalRenderedCaptureHandoff(exactIncidentUrl);
    } catch {
      return null;
    }
  });

  function countLabel(count: number, singular: string): string {
    return `${count} ${singular}${count === 1 ? '' : 's'}`;
  }

  async function selectManifest(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    const generation = ++selectionGeneration;
    preview = null;
    previewTargets = [];
    manifestFile = null; attachments = null; activeArtifact = ''; attachmentController?.abort(); checking = false; retainMatching = false;
    parsing = Boolean(file);
    if (!file) return;
    try {
      if (file.size > MAX_WEB_CAPTURE_MANIFEST_BYTES) {
        throw new Error('Rendered-capture manifests are limited to 1 MiB.');
      }
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (generation !== selectionGeneration) return;
      const value = parseBoundedJson(decoded, {
        label: 'Rendered-capture manifest',
        maximumBytes: MAX_WEB_CAPTURE_MANIFEST_BYTES,
      });
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || (value as Record<string, unknown>).schema !== WEB_CAPTURE_MANIFEST_SCHEMA) {
        throw new Error(`Select a ${WEB_CAPTURE_MANIFEST_SCHEMA} manifest produced by the local rendered-capture command.`);
      }
      const document = parseWebCaptureManifest(value);
      const targets = externalFindingsCaseTargets(document, record.domain);
      if (generation !== selectionGeneration) return;
      preview = document;
      previewTargets = targets;
      manifestFile = file;
      onmessage(`Validated ${countLabel(document.findings.length, 'capture finding')} for this Case. Review the manifest summary before importing.`);
    } catch (cause) {
      if (generation === selectionGeneration) {
        onmessage(cause instanceof Error ? cause.message : 'Could not validate the rendered-capture manifest.');
      }
    } finally {
      if (generation === selectionGeneration) parsing = false;
      input.value = '';
    }
  }

  async function selectAttachments(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    if ((input.files?.length ?? 0) > MAX_INVESTIGATION_MANIFEST_ARTIFACTS) {
      input.value = ''; onmessage(`Select no more than ${MAX_INVESTIGATION_MANIFEST_ARTIFACTS} attachment files.`); return;
    }
    const files = Array.from(input.files ?? []); input.value = '';
    if (!files.length || !manifestFile || importing) return;
    attachmentController?.abort();
    const controller = new AbortController(); attachmentController = controller;
    const generation = selectionGeneration, caseId = record.id;
    checking = true; attachments = null; activeArtifact = '';
    try {
      const reviewed = await runInvestigationPackageWorker('capture', { manifest: manifestFile, files }, { signal: controller.signal });
      if (controller.signal.aborted || generation !== selectionGeneration || record.id !== caseId) return;
      externalFindingsCaseTargets(reviewed.document, record.domain);
      attachments = reviewed;
      const matched = reviewed.matches.filter(match => match.state === 'matched').length;
      onmessage(`${matched} of ${reviewed.matches.length} capture attachments match their declared bytes and digest. Nothing was saved.`);
    } catch (cause) {
      if (!controller.signal.aborted && generation === selectionGeneration) onmessage(cause instanceof Error ? cause.message : 'Attachment review failed. Nothing was saved.');
    } finally {
      if (attachmentController === controller) { attachmentController = null; checking = false; }
    }
  }

  async function cancelAttachments() {
    attachmentController?.abort(); checking = false;
    onmessage('Attachment review cancelled. Nothing was saved.');
    await tick(); attachmentInput?.focus();
  }
  async function clearPreview() {
    selectionGeneration++; attachmentController?.abort(); attachmentController = null;
    preview = null; previewTargets = []; manifestFile = null; attachments = null; activeArtifact = ''; checking = false;
    await tick(); manifestInput?.focus();
  }
  async function closeArtifact() { activeArtifact = ''; await tick(); artifactTrigger?.focus(); }

  async function importManifest() {
    if (!preview || importing || mutationBusy) return;
    const document = preview, caseId = record.id, reviewed = attachments, manifest = manifestFile;
    const generation = selectionGeneration, retainFiles = retainMatching;
    importing = true;
    try {
      const files: SelectedCaseAttachment[] = [];
      if (retainFiles) {
        if (!manifest) throw new Error('Select the capture manifest again before retaining its original bytes.');
        const bytes = new Uint8Array(await manifest.arrayBuffer());
        try {
          files.push({ file: manifest, attachment: readCaseAttachment({ id: crypto.randomUUID(), fileName: manifest instanceof File ? manifest.name : 'capture-manifest.json',
            mediaType: 'application/json', source: document.source.name, observedAt: null, retainedAt: new Date().toISOString(), byteLength: bytes.length, digestSha256: await sha256ArtifactBytes(bytes) }) });
        } finally { bytes.fill(0); }
        for (const [index, match] of (reviewed?.matches ?? []).entries()) {
          if (match.state !== 'matched') continue;
          const declaration = reviewed!.artifacts[index]!;
          for (const id of match.matchingIds) {
            const file = reviewed!.contents.get(id);
            if (!file) throw new Error('A reviewed capture file is no longer available. Select the files again.');
            files.push({ file, attachment: readCaseAttachment({ id: crypto.randomUUID(), fileName: declaration.fileName, mediaType: declaration.mimeType,
              source: document.source.name, observedAt: declaration.observedAt, retainedAt: new Date().toISOString(), byteLength: declaration.bytes, digestSha256: `sha256:${declaration.sha256}` }) });
          }
        }
      }
      if (generation !== selectionGeneration || record.id !== caseId) return;
      const success = retainFiles ? 'Imported capture metadata and retained the manifest and matching original files.' : 'Imported capture metadata. Original files were not retained.';
      if (await persistOperation(() => retainFiles ? retainCaseAttachments(caseId, files, document) : importExternalFindingsIntoCase(caseId, document), success, () => manifestInput ?? null)
        && generation === selectionGeneration) await clearPreview();
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'Could not import the rendered-capture manifest.');
    } finally {
      importing = false;
    }
  }
</script>

<details class="capture-workspace">
  <summary>Rendered capture and attachment review</summary>
  <div class="capture-body">
    {#if handoff}
      <p>From the directory where you installed the <a href="/cli#capture-companion">optional capture companion</a>, this command opens the retained URL in a disposable local browser and writes a new private output directory. The browser app does not run it.</p>
      <CopyableCommand command={handoff.command} label="Rendered-capture command" />
      <p class="manifest-path">Then select <code>{handoff.manifestPath}</code>. Review the URL first: its path and query are sent to the target and may contain sensitive values.</p>
    {:else if exactIncidentUrl}
      <p class="notice">The retained Incident URL uses a target form that the bounded local capture tool does not support. Use an HTTP(S) URL without credentials or a non-default port.</p>
    {:else}
      <p>Save an Incident objective and deliberately retain the exact URL from Lookup to prepare a rendered capture. You can still review an existing capture manifest below.</p>
    {/if}
      <label class="file-btn btn" aria-disabled={parsing || importing || checking}>
        {parsing ? 'Checking manifest…' : 'Select capture manifest'}
        <input bind:this={manifestInput} type="file" accept="application/json,.json" onchange={selectManifest} disabled={parsing || importing || checking}>
      </label>
      {#if preview}
        <section class="capture-preview" aria-labelledby={`capture-preview-${record.id}`}>
          <header><div><p class="eyebrow">Local preview</p><h4 id={`capture-preview-${record.id}`}>Manifest evidence</h4></div><span>{countLabel(preview.findings.length, 'finding')}</span></header>
          <dl>
            <div><dt>Case</dt><dd>{record.domain}</dd></div>
            <div><dt>Captured hostname{previewTargets.length === 1 ? '' : 's'}</dt><dd>{previewTargets.join(', ')}</dd></div>
            <div><dt>Source</dt><dd>{preview.source.name}</dd></div>
            <div><dt>Collected</dt><dd>{preview.source.collectedAt ?? 'Not declared'}</dd></div>
          </dl>
          <ol>
            {#each preview.findings as finding}
              <li><strong>{finding.category} · {finding.completeness}</strong><p>{finding.summary}</p><small>{finding.observedAt}{finding.limitations.length ? ` · ${finding.limitations.join('; ')}` : ''}</small></li>
            {/each}
          </ol>
          <label class="file-btn btn" aria-disabled={checking || importing}>
            {checking ? 'Checking attachment bytes…' : 'Select capture attachments to check'}
            <input bind:this={attachmentInput} type="file" multiple onchange={selectAttachments} disabled={checking || importing}>
          </label>
          {#if checking}<button class="btn" type="button" onclick={cancelAttachments}>Cancel attachment check</button>{/if}
          {#if attachments}
            <section aria-label="Selected capture attachment checks">
              <h4>Attachment bytes</h4>
              <ol>{#each attachments.matches as match, index}
                {@const declaration = attachments.artifacts[index]!}
                <li><strong>Capture {match.capture} · {declaration.kind === 'screenshot' ? 'Screenshot' : 'DOM digest'}</strong>
                  <p>{declaration.fileName} · {match.state === 'matched' ? 'Byte count and digest match' : 'Matching bytes not found'}</p>
                  {#each match.matchingIds as id}
                    {@const key = `${index}:${id}`}
                    {#if supportsArtifactPreview(declaration.mimeType)}
                      <button class="btn" type="button" aria-expanded={activeArtifact === key}
                        onclick={event => { artifactTrigger = event.currentTarget; if (activeArtifact === key) void closeArtifact(); else activeArtifact = key; }}>{activeArtifact === key ? 'Close inline review' : 'View'} {id}</button>
                      {#if activeArtifact === key}<ArtifactPreview file={attachments.contents.get(id)!} mediaType={declaration.mimeType} label={id} />{/if}
                    {/if}
                  {/each}
                </li>
              {/each}</ol>
              {#if attachments.unusedIds.length}<p>{attachments.unusedIds.length} selected file{attachments.unusedIds.length === 1 ? '' : 's'} did not match a declared attachment.</p>{/if}
            </section>
            <CaptureComparison left={attachments} />
          {/if}
          <label class="retain-files"><input type="checkbox" bind:checked={retainMatching} disabled={importing || checking || mutationBusy}> Retain this manifest and verified matching files in this workspace</label>
          <p>{retainMatching ? 'The selected originals are stored unchanged using this workspace’s storage and encryption. Unmatched files are not included; you can retain them separately under Retained files.' : 'Only sanitised metadata and declared digests enter the Case; original files stay in page memory.'} Matching bytes do not authenticate the capture or establish its accuracy.</p>
          <div class="actions"><button class="primary" type="button" onclick={() => void importManifest()} disabled={importing || checking || mutationBusy}>{importing ? 'Importing…' : 'Import into this Case'}</button><button class="btn" type="button" onclick={clearPreview} disabled={importing}>Cancel</button></div>
        </section>
      {/if}
  </div>
</details>

<style>
  .capture-workspace{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  summary{padding:11px 12px;cursor:pointer;font:700 var(--text-xs) var(--mono)}details[open]>summary{border-bottom:1px solid var(--border)}
  .capture-body{display:grid;gap:10px;padding:12px}.capture-body>p{max-width:880px;margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.manifest-path code{overflow-wrap:anywhere;color:var(--accent)}
  .capture-body a{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
  .retain-files{display:flex;align-items:center;gap:9px;min-height:44px;font-size:var(--text-xs)}.retain-files input{flex:none;width:18px;height:18px}
  .file-btn{justify-self:start}.file-btn input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.file-btn:focus-within{outline:2px solid var(--focus);outline-offset:3px}
  .capture-preview{display:grid;gap:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.capture-preview header{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px}.capture-preview h4{margin:0}.capture-preview header>span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:0;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--border)}dl>div{min-width:0;padding:8px;background:var(--panel)}dt{color:var(--muted);font:650 var(--text-2xs) var(--mono)}dd{margin:3px 0 0;overflow-wrap:anywhere;font-size:var(--text-xs)}
  ol{display:grid;gap:7px;margin:0;padding:0;list-style:none}li{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}li strong,li small{display:block}li p{margin:5px 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--text-xs)}li small{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}.capture-preview>p{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .actions{display:flex;flex-wrap:wrap;gap:8px}.notice{padding:9px 10px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .06)}
  @media(max-width:620px){dl{grid-template-columns:1fr}.file-btn,.actions button{width:100%}}
</style>
