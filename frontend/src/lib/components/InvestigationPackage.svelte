<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { WORKSPACE_ARCHIVE_SCHEMA, ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA } from '../../../../packages/contracts/case-portability.mts';
  import { MAX_INVESTIGATION_MANIFEST_ARTIFACTS, MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES, MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES, investigationFileMediaType } from '../../../../packages/investigation/investigation-manifest.mts';
  import { MAX_INVESTIGATION_PACKAGE_BYTES } from '../../../../packages/investigation/investigation-package.mts';
  import { runInvestigationPackageWorker } from '$lib/investigation-package-worker.ts';
  import type { BrowserInvestigationPackageReview, SelectedInvestigationFile } from '$lib/investigation-package-worker-model.ts';
  import { downloadLocalFile } from '$lib/download-local-file.ts';
  import ArtifactPreview from './ArtifactPreview.svelte';
  import { supportsArtifactPreview } from '$lib/artifact-preview.ts';
  import { selectedInvestigationFolderFiles } from '$lib/investigation-folder.ts';
  import EvidenceFileExport from './EvidenceFileExport.svelte';

  let { onworkspace }: { onworkspace?: (file: Blob) => Promise<void> } = $props();
  type Selection = SelectedInvestigationFile & { name: string; key: number };
  const PAGE_SIZE = 8;
  let nextKey = 0;
  let selected = $state<Selection[]>([]);
  let selectedPage = $state(0);
  let review = $state.raw<BrowserInvestigationPackageReview | null>(null);
  let reviewPage = $state(0);
  let activeArtifact = $state('');
  let artifactTrigger: HTMLButtonElement | null = null;
  let workflow = $state('Evidence handoff');
  let busy = $state(false);
  let message = $state('');
  let error = $state('');
  let reviewHeading = $state<HTMLHeadingElement>();
  let sourceInput = $state<HTMLInputElement>();
  let packageInput = $state<HTMLInputElement>();
  let folderInput = $state<HTMLInputElement>();
  let reviewKind = $state<'ZIP' | 'folder'>('ZIP');
  let selectedList = $state<HTMLUListElement>();
  let operation = $state<'inspect' | 'inspectFolder' | null>(null);
  let controller = $state.raw<AbortController | null>(null);
  const totalBytes = $derived(selected.reduce((sum, item) => sum + item.file.size, 0));
  const selectedRows = $derived(selected.slice(selectedPage * PAGE_SIZE, (selectedPage + 1) * PAGE_SIZE));
  const reviewRows = $derived(review?.entries.slice(reviewPage * PAGE_SIZE, (reviewPage + 1) * PAGE_SIZE) ?? []);

  async function cancel() {
    const cancelled = operation;
    controller?.abort(); controller = null; busy = false;
    operation = null;
    message = 'Package processing cancelled. No saved records were changed.';
    await tick();
    (cancelled === 'inspectFolder' ? folderInput : packageInput)?.focus();
  }
  function chooseSources(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    error = ''; message = '';
    const candidate = [...selected, ...files.map(file => ({ file, name: file.name, key: nextKey++, mediaType: investigationFileMediaType(file.name), source: { identity: null, observedAt: null } }))];
    if (candidate.length > MAX_INVESTIGATION_MANIFEST_ARTIFACTS) { error = `Select no more than ${MAX_INVESTIGATION_MANIFEST_ARTIFACTS} files.`; return; }
    if (candidate.some(item => !item.file.size || item.file.size > MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES)) { error = `Each file must contain 1 byte to ${MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES / 1024 / 1024} MiB.`; return; }
    if (candidate.reduce((sum, item) => sum + item.file.size, 0) > MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES) { error = `The files exceed ${MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES / 1024 / 1024} MiB in total.`; return; }
    selected = candidate;
  }
  async function removeFile(key: number) {
    selected = selected.filter(item => item.key !== key);
    selectedPage = Math.min(selectedPage, Math.max(0, Math.ceil(selected.length / PAGE_SIZE) - 1));
    await tick();
    (selectedList?.querySelector('button') ?? sourceInput)?.focus();
  }
  function setSource(key: number, field: 'identity' | 'observedAt', value: string) {
    selected = selected.map(item => item.key === key ? { ...item, source: { ...item.source, [field]: value.trim() || null } } : item);
  }
  async function choosePackage(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0]; input.value = '';
    if (!file || busy) return;
    review = null; reviewPage = 0; activeArtifact = ''; error = ''; message = '';
    reviewKind = 'ZIP';
    if (file.size < 22 || file.size > MAX_INVESTIGATION_PACKAGE_BYTES) { error = `The selected ZIP exceeds the ${MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES / 1024 / 1024} MiB payload plus metadata boundary, or is empty.`; return; }
    busy = true;
    operation = 'inspect';
    const current = new AbortController(); controller = current;
    try {
      const result = await runInvestigationPackageWorker('inspect', { file }, { signal: current.signal });
      if (current.signal.aborted) return;
      review = result;
      message = `Reviewed all ${result.entries.length} package ${result.entries.length === 1 ? 'entry' : 'entries'}. Nothing has been imported.`;
      await tick();
      if (!current.signal.aborted) reviewHeading?.focus();
    } catch (cause) { if (!current.signal.aborted) error = cause instanceof Error ? cause.message : 'Package review failed.'; }
    finally { if (controller === current) { controller = null; busy = false; operation = null; } }
  }
  async function chooseFolder(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    if (!input.files?.length || busy) { input.value = ''; return; }
    review = null; reviewPage = 0; activeArtifact = ''; error = ''; message = ''; reviewKind = 'folder';
    busy = true; operation = 'inspectFolder';
    const current = new AbortController(); controller = current;
    try {
      const files = selectedInvestigationFolderFiles(input.files); input.value = '';
      const result = await runInvestigationPackageWorker('inspectFolder', { files }, { signal: current.signal });
      if (current.signal.aborted) return;
      review = result;
      message = `Reviewed all ${result.entries.length} folder entries. Nothing has been imported.`;
      await tick(); if (!current.signal.aborted) reviewHeading?.focus();
    } catch (cause) { if (!current.signal.aborted) error = cause instanceof Error ? cause.message : 'Folder review failed.'; }
    finally { input.value = ''; if (controller === current) { controller = null; busy = false; operation = null; } }
  }
  async function closeReview() {
    review = null;
    activeArtifact = '';
    message = 'Package review closed. No saved records were changed.';
    await tick();
    (reviewKind === 'folder' ? folderInput : packageInput)?.focus();
  }
  async function closeArtifact() {
    activeArtifact = ''; await tick(); artifactTrigger?.focus();
  }
  async function openWorkspace(id: string) {
    const file = review?.contents.get(id);
    if (!file || !onworkspace || busy) return;
    busy = true; error = '';
    try { await onworkspace(file); message = 'Workspace review opened below. Nothing is written until you confirm its selected data.'; }
    catch { error = 'The workspace preview could not be opened. No saved records were changed.'; }
    finally { busy = false; }
  }
  function downloadEntry(id: string, json: boolean) {
    const file = review?.contents.get(id);
    if (!file) return;
    // Download-only, neutral names: an untrusted media declaration cannot make
    // a file executable or open a document in the application origin.
    downloadLocalFile(file, `${id}.${json ? 'json' : 'bin'}`);
    message = `Prepared verified bytes for ${id} for download. Confirm that the download completed; no browser data was imported.`;
  }
  onDestroy(() => controller?.abort());
</script>

<section class="package card" aria-labelledby="investigation-package-title">
  <header><p class="eyebrow">Portable evidence</p><h2 id="investigation-package-title">Package and review evidence files</h2>
    <p>Keep JSON, screenshots and other selected files together with byte digests and source declarations. Processing stays in this browser; files are not uploaded.</p></header>
  <details class="create-package">
    <summary>Create a package from files</summary>
    <div class="package-form">
      <p>Files are included unchanged, without redaction or encryption. Review their contents before sharing. Original filenames are shown here only; the package uses generated entry names.</p>
      <label>Package purpose<input maxlength="160" bind:value={workflow} disabled={busy}></label>
      <label class="file-label">Choose evidence files<input bind:this={sourceInput} type="file" multiple onchange={chooseSources} disabled={busy}></label>
      <p>{selected.length} of {MAX_INVESTIGATION_MANIFEST_ARTIFACTS} files · {totalBytes.toLocaleString()} bytes. Up to {MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES / 1024 / 1024} MiB per file and {MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES / 1024 / 1024} MiB in total.</p>
      {#if selected.length}
        <ul bind:this={selectedList} class="entries selected-entries">
          {#each selectedRows as item (item.key)}
            <li><div class="entry-head"><strong>{item.name}</strong><span>Selection {item.key + 1} · {item.file.size.toLocaleString()} bytes · {item.mediaType}</span></div>
              <div class="source-fields">
                <label>Declared source<input aria-label={`Declared source for ${item.name}, selection ${item.key + 1}`} maxlength="240" value={item.source.identity ?? ''} onchange={event => setSource(item.key, 'identity', event.currentTarget.value)} disabled={busy} placeholder="Unknown unless supplied"></label>
                <label>Source observation time<input aria-label={`Source observation time for ${item.name}, selection ${item.key + 1}`} maxlength="64" value={item.source.observedAt ?? ''} onchange={event => setSource(item.key, 'observedAt', event.currentTarget.value)} disabled={busy} placeholder="YYYY-MM-DDTHH:mm:ss.sssZ"></label>
              </div>
              <button class="btn" type="button" aria-label={`Remove ${item.name}, selection ${item.key + 1}`} onclick={() => removeFile(item.key)} disabled={busy}>Remove</button>
            </li>
          {/each}
        </ul>
        <nav class="paging" aria-label="Selected evidence files"><button class="btn" type="button" onclick={() => selectedPage--} disabled={busy || selectedPage === 0}>Previous files</button><span>Page {selectedPage + 1} of {Math.ceil(selected.length / PAGE_SIZE)}</span><button class="btn" type="button" onclick={() => selectedPage++} disabled={busy || (selectedPage + 1) * PAGE_SIZE >= selected.length}>Next files</button></nav>
        <p>Leave unknown source times blank. Packaging records the local clock, not a trusted timestamp or earlier custody.</p>
        <EvidenceFileExport {workflow} getFiles={async () => selected.map(item => ({ file: item.file, mediaType: item.mediaType, source: { ...item.source } }))}
          disabled={busy || !workflow.trim()} onbusy={value => { busy = value; if (value) { message = ''; error = ''; } }} onmessage={value => message = value} />
      {/if}
    </div>
  </details>
  <label class="file-label review-file">Review evidence package<input bind:this={packageInput} type="file" accept="application/zip,.zip" onchange={choosePackage} disabled={busy}></label>
  <label class="file-label review-file">Review evidence folder<input bind:this={folderInput} type="file" webkitdirectory multiple onchange={chooseFolder} disabled={busy}></label>
  {#if busy && controller}<button class="btn cancel-package" type="button" onclick={cancel}>Cancel package processing</button>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <p class="status" role="status" aria-live="polite">{message}</p>

  {#if review}
    <div class="package-review">
      <h3 bind:this={reviewHeading} tabindex="-1">Evidence {reviewKind === 'folder' ? 'folder' : 'package'} review</h3>
      <p>{review.manifest.artifacts.length} file{review.manifest.artifacts.length === 1 ? '' : 's'} · {review.manifest.summary.totalBytes.toLocaleString()} bytes · Private audience · No storage changes</p>
      <dl class="review-facts"><div><dt>File identity</dt><dd>{review.identityVerified ? 'Every file matches its manifest' : 'Some files were rejected'}</dd></div><div><dt>Packaging event</dt><dd>{review.manifest.generatedAt} (local clock)</dd></div><div><dt>Trusted signatures and timestamps</dt><dd>Not checked</dd></div><div><dt>Factual accuracy</dt><dd>Not established by file identity</dd></div></dl>
      <p>Byte identity is separate from source-format validation. Workspace files open their existing import preview; use <code>verify-artifact --package</code> in the CLI for other supported format checks. Inline review shows JSON as text and PNGs as decoded pixels. Other files remain download-only; no document scripts or links run.</p>
      {#if review.links.length}<ul class="links">{#each review.links as link}<li>Capsule {link.capsuleEntryId}: {link.state === 'linked' ? `exact source identity linked to ${link.sourceEntryId}` : `source identity ${link.state}`}</li>{/each}</ul>{/if}
      {#if review.captureManifests.length}<section aria-label="Capture attachment checks">
        <h4>Capture attachment checks</h4>
        <p>These checks match selected bytes to a manifest declaration; they do not authenticate the capture.</p>
        <ul class="links">{#each review.captureManifests as capture}<li>Manifest {capture.entryId}: {capture.state.replaceAll('_', ' ')}
          {#if capture.artifacts.length}<ul>{#each capture.artifacts as artifact}<li>Capture {artifact.capture} · {artifact.kind === 'screenshot' ? 'Screenshot' : 'DOM digest'}: {artifact.state === 'matched' ? `bytes match ${artifact.matchingIds.join(', ')}` : 'matching bytes not found'}</li>{/each}</ul>{/if}
        </li>{/each}</ul>
      </section>{/if}
      <ul class="entries review-entries">
        {#each reviewRows as item (item.entry.id)}
          {@const workspace = item.entry.schema === WORKSPACE_ARCHIVE_SCHEMA || item.entry.schema === ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA}
          <li class:rejected={item.state === 'rejected'}>
            <div class="entry-head"><h4>{item.entry.id}</h4><strong>{item.state === 'rejected' ? 'Rejected' : 'Bytes verified'}</strong></div>
            <p>{item.entry.byteLength.toLocaleString()} bytes · {item.entry.schema ?? 'Opaque or unversioned file'}{item.entry.version ? ` v${item.entry.version}` : ''}</p>
            {#if 'source' in item.entry}<dl class="source-facts"><div><dt>Declared source</dt><dd>{item.entry.source.identity ?? 'Unknown'}</dd></div><div><dt>Source observation</dt><dd>{item.entry.source.observedAt ?? 'Unknown'}</dd></div></dl>{:else}<p>This historical manifest has no source declaration or custody event.</p>{/if}
            <details><summary>Digests and custody</summary><p class="digest">Raw bytes: {item.entry.contentDigestSha256}</p>{#if item.entry.canonicalDigestSha256}<p class="digest">Canonical JSON: {item.entry.canonicalDigestSha256}</p>{/if}<p>{review.manifest.version === 3 ? `Packaged as entry ${item.entry.sequence} at ${review.manifest.generatedAt}. No earlier custody is established.` : 'The historical manifest records ordering, not a custody time.'}</p></details>
            {#if item.issue}<p class="error">{item.issue}</p>{/if}
            {#if item.state === 'identity_verified'}
              <div class="entry-actions"><button class="btn" type="button" onclick={() => downloadEntry(item.entry.id, item.interpretation !== 'opaque')} disabled={busy}>Download {item.entry.id}</button>{#if workspace && onworkspace}<button class="primary" type="button" onclick={() => void openWorkspace(item.entry.id)} disabled={busy}>Review workspace {item.entry.id}</button>{/if}</div>
              {@const mediaType = 'mediaType' in item.entry ? item.entry.mediaType : 'application/json'}
              {#if supportsArtifactPreview(mediaType) && review.contents.has(item.entry.id)}
                <button class="btn" type="button" aria-expanded={activeArtifact === item.entry.id}
                  onclick={event => { artifactTrigger = event.currentTarget; if (activeArtifact === item.entry.id) void closeArtifact(); else activeArtifact = item.entry.id; }}>{activeArtifact === item.entry.id ? 'Close inline review' : 'View'} {item.entry.id}</button>
                {#if activeArtifact === item.entry.id}<ArtifactPreview file={review.contents.get(item.entry.id)!} {mediaType} label={item.entry.id} />{/if}
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
      <nav class="paging" aria-label="Package entries"><button class="btn" type="button" onclick={() => { activeArtifact = ''; reviewPage--; }} disabled={busy || reviewPage === 0}>Previous entries</button><span>Page {reviewPage + 1} of {Math.ceil(review.entries.length / PAGE_SIZE)}</span><button class="btn" type="button" onclick={() => { activeArtifact = ''; reviewPage++; }} disabled={busy || (reviewPage + 1) * PAGE_SIZE >= review.entries.length}>Next entries</button></nav>
      <button class="btn" type="button" onclick={closeReview} disabled={busy}>Close package review</button>
    </div>
  {/if}
</section>

<style>
  .package{margin-top:28px;padding:21px;min-width:0;overflow-wrap:anywhere}.package h2{margin:3px 0 0;font:700 var(--text-lg) var(--mono)}.package p,.package dd,.package dt{font-size:var(--text-xs);line-height:1.55}.package p{color:var(--muted)}.package summary{font-weight:700}.create-package{margin-top:18px}.package-form{padding-top:8px}.package label{display:grid;gap:5px;min-width:0;font-size:var(--text-xs)}.package input{min-width:0;width:100%}.file-label{margin:14px 0}.entries{list-style:none;display:grid;gap:12px;margin:16px 0;padding:0}.entries>li{min-width:0;padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.entry-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px}.entry-head h4{margin:0}.entry-head span{color:var(--muted);font-size:var(--text-xs)}.source-fields,.review-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.source-fields{margin:12px 0}.review-facts>div,.source-facts>div{min-width:0}.package dt{font-weight:700}.package dd{margin:0;color:var(--muted);overflow-wrap:anywhere}.source-facts{display:grid;gap:8px}.paging,.entry-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0}.paging{justify-content:space-between}.paging span{font-size:var(--text-xs)}.package-review{margin-top:20px;border-top:1px solid var(--border);padding-top:14px}.package-review h3{margin-top:0}.package-review h3:focus{outline:2px solid var(--focus);outline-offset:4px}.digest{font-family:var(--mono);overflow-wrap:anywhere}.links{padding-left:20px;font-size:var(--text-xs);line-height:1.55}.rejected{border-color:var(--danger)}.status:empty{display:none}.cancel-package{margin:8px 0}.package .error{color:var(--danger)}
  @media(max-width:700px){.package{padding:16px}.source-fields,.review-facts{grid-template-columns:minmax(0,1fr)}.entry-actions{align-items:stretch;flex-direction:column}.entry-actions button{width:100%}.paging{display:grid;grid-template-columns:minmax(0,1fr)}.paging span{text-align:center}.entries>li{padding:12px}}
</style>
