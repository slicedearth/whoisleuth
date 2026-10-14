<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import type { CaseRecord } from '#lib/cases.ts';
  import type { WebsiteProfileCluster, WebsiteProfileClusterSummary } from '#lib/analysis/website-profile-clusters.ts';
  import { filterGalleryFiles, galleryObservationContext, gallerySelectionSignature, retainedGalleryInventory,
    resolveGalleryFile, galleryComparisonUnavailableReason, type GalleryFile } from '#lib/analysis/retained-evidence-gallery.ts';
  import { readRetainedCaseFiles } from '#lib/case-attachments.ts';
  import { caseWorkspaceHref } from '#lib/analysis/case-response-stage.ts';
  import { captureConsoleReferenceScope, subscribeConsoleReferenceView } from '#lib/console-workflow-state.ts';
  import { runInvestigationPackageWorker } from '#lib/investigation-package-worker.ts';
  import type { TextPassageComparison } from '../../../../packages/comparison/text-passages.mts';
  import WebsiteProfileClusters from './WebsiteProfileClusters.svelte';
  import LocalCollectionState from './LocalCollectionState.svelte';
  import Pagination from './Pagination.svelte';
  import ComparisonFrame from './ComparisonFrame.svelte';
  import DeferredSurface from './DeferredSurface.svelte';
  import TextPassageResults from './TextPassageResults.svelte';
  import CopyButton from './CopyButton.svelte';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';

  let { summary, cases, profilesState, casesState, onpin = null }: {
    summary: WebsiteProfileClusterSummary; cases: readonly CaseRecord[];
    profilesState: 'loading' | 'ready' | 'unavailable'; casesState: 'loading' | 'ready' | 'unavailable';
    onpin?: ((cluster: WebsiteProfileCluster, domain: string, caseId?: string) => void | Promise<void>) | null;
  } = $props();
  let query = $state(''), facet = $state<'profiles' | 'png' | 'text'>('profiles'), page = $state(1);
  let leftKey = $state(''), rightKey = $state(''), error = $state(''), busy = $state(false);
  let prepared = $state.raw<{ signature: string; files: readonly Blob[] } | null>(null);
  let textResult = $state.raw<TextPassageComparison | null>(null);
  let controller: AbortController | null = null;
  let heading = $state<HTMLHeadingElement>(), results = $state<HTMLOListElement>(), trigger = $state<HTMLButtonElement>();
  const comparisonHelpId = $props.id();
  const inventory = $derived(retainedGalleryInventory(casesState === 'ready' ? cases : []));
  const files = $derived(facet === 'profiles' ? [] : filterGalleryFiles(inventory.files, facet, query));
  const pageCount = $derived(Math.max(1, Math.ceil(files.length / 20)));
  const currentPage = $derived(Math.min(page, pageCount));
  const left = $derived(inventory.files.find(file => file.key === leftKey));
  const right = $derived(inventory.files.find(file => file.key === rightKey));
  const visibleFiles = $derived(files.slice((currentPage - 1) * 20, currentPage * 20));
  const choices = $derived([...new Map([...visibleFiles, ...(left ? [left] : []), ...(right ? [right] : [])].map(file => [file.key, file])).values()]);
  const selectedSignature = $derived(left && right ? gallerySelectionSignature(cases, [left.reference, right.reference]) : null);
  const pairIssue = $derived(facet === 'profiles' ? null : galleryComparisonUnavailableReason(facet, left, right));
  const eligiblePair = $derived(casesState === 'ready' && facet !== 'profiles' && pairIssue === null);
  const comparison = $derived(prepared && prepared.signature === selectedSignature && left && right
    ? { left, right, files: prepared.files } : null);

  function invalidate() { controller?.abort(); controller = null; prepared = null; textResult = null; error = ''; busy = false; }
  $effect(() => { facet; untrack(() => { leftKey = ''; rightKey = ''; page = 1; invalidate(); }); });
  $effect(() => { query; untrack(() => { page = 1; }); });
  $effect(() => { selectedSignature; casesState; untrack(invalidate); });
  $effect(() => { const lastPage = pageCount; untrack(() => { page = Math.min(page, lastPage); }); });
  onDestroy(invalidate);
  onMount(() => {
    let scope = captureConsoleReferenceScope();
    return subscribeConsoleReferenceView(() => {
      const next = captureConsoleReferenceScope();
      if (next.workspaceId !== scope.workspaceId || next.generation !== scope.generation) {
        leftKey = ''; rightKey = ''; invalidate();
      }
      scope = next;
    });
  });
  function swap() { [leftKey, rightKey] = [rightKey, leftKey]; }
  async function setPage(next: number) { page = Math.max(1, Math.min(pageCount, next)); await tick(); results?.focus(); }
  async function close() { invalidate(); await tick(); trigger?.focus(); }
  async function openComparison() {
    if (busy || !eligiblePair || !left || !right || !selectedSignature) return;
    const selectedLeft = resolveGalleryFile(cases, left.reference), selectedRight = resolveGalleryFile(cases, right.reference);
    if (!selectedLeft || !selectedRight) return;
    const expected = { signature: selectedSignature, facet, scope: captureConsoleReferenceScope() }, current = new AbortController();
    if (expected.scope.workspaceId === null) return;
    controller = current; busy = true; error = ''; prepared = null; textResult = null;
    const owns = () => {
      const scope = captureConsoleReferenceScope();
      return controller === current && !current.signal.aborted && casesState === 'ready'
        && selectedSignature === expected.signature && facet === expected.facet
        && scope.workspaceId === expected.scope.workspaceId && scope.generation === expected.scope.generation;
    };
    try {
      const unavailable = galleryComparisonUnavailableReason(facet === 'text' ? 'text' : 'png', selectedLeft, selectedRight);
      if (unavailable) throw new Error(unavailable);
      const selected = await readRetainedCaseFiles([selectedLeft.attachment, selectedRight.attachment]);
      if (!owns()) return;
      const bodies = selected.map(file => file.file);
      if (facet === 'text') {
        const next = await runInvestigationPackageWorker('textCompare', { left: bodies[0]!, right: bodies[1]! }, { signal: current.signal });
        if (!owns()) return;
        textResult = next;
      }
      prepared = { signature: expected.signature, files: bodies };
      await tick(); if (owns()) heading?.focus();
    } catch (cause) { if (owns()) error = cause instanceof Error ? cause.message : 'Selected retained files could not be opened. Saved evidence is unchanged.'; }
    finally { if (controller === current) { controller = null; busy = false; } }
  }
</script>

{#snippet fileMetadata(file: GalleryFile, label: string)}
  <dl class="file-metadata">
    <div><dt>Attachment ID</dt><dd><code>{file.reference.attachmentId}</code><CopyButton value={file.reference.attachmentId} label="Copy ID" description={`Copy ${label} attachment ID`} /></dd></div>
    <div><dt>SHA-256</dt><dd><code>{file.attachment.digestSha256}</code><CopyButton value={file.attachment.digestSha256} label="Copy hash" description={`Copy ${label} SHA-256`} /></dd></div>
    <div><dt>Observed</dt><dd><EvidenceTimestamp value={file.attachment.observedAt} label={`${label} observation time`} unavailable="Unknown" /></dd></div>
    <div><dt>Retained</dt><dd><EvidenceTimestamp value={file.attachment.retainedAt} label={`${label} retention time`} /></dd></div>
  </dl>
{/snippet}

{#snippet selectedSource(file: GalleryFile, original: Blob, side: 'Reference' | 'Candidate')}
  <section aria-label={`${side} gallery source`}>
    <h4>{file.caseTitle} · {file.caseNumber}</h4>
    <p>{file.attachment.fileName} · {file.attachment.source ?? 'Source not declared'}</p>
    {@render fileMetadata(file, `${side} comparison`)}
    {#if file.attachment.derivation}<p>Derived image · declared immediate-parent digest <code>{file.attachment.derivation.source.digestSha256}</code></p>{/if}
    {#if facet === 'png'}<DeferredSurface load={() => import('./ArtifactPreview.svelte')}
      props={{ file: original, mediaType: 'image/png', label: `${side}: ${file.attachment.fileName}`, focusOnReady: false }}
      loadingLabel="Preparing selected PNG view…" unavailableLabel="The local PNG viewer could not be loaded. The original is unchanged." />{/if}
  </section>
{/snippet}

{#snippet selectionDetails(file: GalleryFile | undefined, key: string, side: 'Reference' | 'Candidate')}
  {#if file}
    <p class="selected-label"><strong>{file.attachment.fileName}</strong><span>{file.caseTitle} · {file.caseNumber}</span></p>
    {#if !files.some(item => item.key === key)}<p class="selection-location">Outside the current filter · still selected</p>
    {:else if !visibleFiles.some(item => item.key === key)}<p class="selection-location">On another results page · still selected</p>{/if}
    <details><summary>{side} file details</summary>{@render fileMetadata(file, `${side} selected file`)}</details>
  {:else if key}<p role="status">The selected {side.toLowerCase()} reference is no longer available. Choose a current file or clear this selection.</p>{/if}
{/snippet}

<section class="retained-gallery card" aria-labelledby="retained-gallery-title">
  <h2 id="retained-gallery-title">Retained evidence gallery</h2>
  <p>Search saved profile relationships or compare two deliberately selected files across Cases.</p>
  <div class="filters">
    <label>Evidence component<select bind:value={facet}><option value="profiles">Website profiles</option><option value="png">PNG images</option><option value="text">Text passages</option></select></label>
    <label>Search retained metadata<input type="search" maxlength="200" bind:value={query} placeholder={facet === 'profiles' ? 'Domain, technology or evidence type' : 'Case, domain, filename or source'} /></label>
  </div>
  <details class="scope"><summary>Search scope and comparison methods</summary><p>Profile contributions use their own similarity model. Image and text search covers currently read Case metadata, not file contents; a filename does not establish valid text. Each comparison reads exactly two selected originals.</p></details>
  {#if facet === 'profiles'}
    {#if profilesState === 'ready'}<WebsiteProfileClusters {summary} {cases} {onpin} bind:query showSearch={false} embedded />
    {:else}<LocalCollectionState state={profilesState} loadingTitle="Opening website relationships" loadingDetail="Reading saved website snapshots for this review." title="Website-profile relationships unavailable" detail="Saved profiles could not be read; no missing match is inferred." />{/if}
  {:else if casesState !== 'ready'}
    <LocalCollectionState state={casesState} loadingTitle="Opening retained file metadata" loadingDetail="Reading Case references without opening originals." title="Case references unavailable" detail="The collection could not be read. Missing files or matches are not inferred." />
  {:else}
    <section class="selection-shelf" aria-label="Selected comparison files">
      <h3>Comparison pair</h3>
      <div class="filters">
        <div class="selected-file">
          <label>Reference file<select bind:value={leftKey}><option value="">Choose a reference</option>{#if leftKey && !left}<option value={leftKey} disabled>Selected reference unavailable</option>{/if}{#each choices as file (file.key)}<option value={file.key}>{file.caseTitle} · {file.attachment.fileName} · {file.caseNumber} · Attachment {file.reference.attachmentId}</option>{/each}</select></label>
          {@render selectionDetails(left, leftKey, 'Reference')}
          <button class="btn small" type="button" disabled={!leftKey} onclick={() => { leftKey = ''; }}>Clear reference</button>
        </div>
        <div class="selected-file">
          <label>Candidate file<select bind:value={rightKey}><option value="">Choose a candidate</option>{#if rightKey && !right}<option value={rightKey} disabled>Selected candidate unavailable</option>{/if}{#each choices as file (file.key)}<option value={file.key}>{file.caseTitle} · {file.attachment.fileName} · {file.caseNumber} · Attachment {file.reference.attachmentId}</option>{/each}</select></label>
          {@render selectionDetails(right, rightKey, 'Candidate')}
          <button class="btn small" type="button" disabled={!rightKey} onclick={() => { rightKey = ''; }}>Clear candidate</button>
        </div>
      </div>
      <p>Search for each side separately. Selected files stay here across searches and pages; originals open only when you start the comparison.</p>
      <p id={comparisonHelpId}>{pairIssue ?? 'Two references selected. Availability, integrity and format are checked when you start.'}</p>
      <div class="actions"><button class="btn" bind:this={trigger} aria-describedby={comparisonHelpId} disabled={busy || !eligiblePair} onclick={() => void openComparison()}>{facet === 'text' ? 'Compare selected text' : 'Open selected PNGs'}</button><button class="btn small" type="button" disabled={!left || !right || left.key === right.key} onclick={swap}>Swap reference and candidate</button>{#if busy}<button class="btn" onclick={close}>Cancel file review</button><span role="status">Reading the selected verified originals…</span>{/if}</div>
      {#if error}<p role="alert">{error}</p>
        {#if left && right}<div class="recovery">
          <p>Check the source Cases for retained originals or recover them from a backup. Use the recorded hashes; a matching filename alone cannot restore missing evidence.</p>
          <div class="actions"><a class="btn small" href={caseWorkspaceHref(left.reference.caseId, 'evidence')}>Reference Case files</a><a class="btn small" href={caseWorkspaceHref(right.reference.caseId, 'evidence')}>Candidate Case files</a></div>
        </div>{/if}
      {/if}
    </section>
    <p role="status">{files.length} matching {facet === 'png' ? 'PNG' : 'text'} references. {inventory.files.length} eligible file references across {cases.length} currently read Cases; showing page {currentPage} of {pageCount}.</p>
    {#if inventory.ambiguous}<p>{inventory.ambiguous} ambiguous references are unavailable. Open the relevant Case to review those identities.</p>{/if}
    <ol class="file-list" aria-label="Retained gallery file references" tabindex="-1" bind:this={results}>
      {#each visibleFiles as file (file.key)}
        <li><strong>{file.attachment.fileName}</strong><a href={`/cases?case=${encodeURIComponent(file.reference.caseId)}`}>{file.caseTitle} · {file.caseNumber}</a>
          <small>Case domain: {file.caseDomain} · Declared source: {file.attachment.source ?? 'Not declared'}</small>
          <small>Observed: <EvidenceTimestamp value={file.attachment.observedAt} unavailable="Unknown" copyable={false} /> · Retained: <EvidenceTimestamp value={file.attachment.retainedAt} copyable={false} /></small>
          <div class="actions">
            <button class="btn small" type="button" aria-label={`Use as reference: ${file.attachment.fileName} · ${file.caseNumber} · ${file.reference.attachmentId}`} aria-pressed={leftKey === file.key} onclick={() => { leftKey = leftKey === file.key ? '' : file.key; }}>Use as reference</button>
            <button class="btn small" type="button" aria-label={`Use as candidate: ${file.attachment.fileName} · ${file.caseNumber} · ${file.reference.attachmentId}`} aria-pressed={rightKey === file.key} onclick={() => { rightKey = rightKey === file.key ? '' : file.key; }}>Use as candidate</button>
          </div>
          <details><summary>Recorded file identity</summary>{@render fileMetadata(file, `${file.caseNumber} ${file.reference.attachmentId}`)}<p>{file.attachment.byteLength} bytes. Listing this reference has not read or verified the original pixels or text.</p>{#if file.attachment.derivation}<p>Derived image; its edit declaration remains attached to this file. The enclosing Case domain is not an observed image hostname.</p>{/if}</details>
        </li>
      {:else}<li>No matching retained file reference is available in the currently read Case metadata.</li>{/each}
    </ol>
    <Pagination {currentPage} {pageCount} setPage={value => void setPage(value)} ariaLabel="Retained gallery pages" pageInputLabel="Retained gallery page" />
    {#if comparison}
      {@const pair = comparison}
      <div class="prepared" role="region" aria-label="Selected retained file comparison">
        <h3 bind:this={heading} tabindex="-1">Two selected retained sources</h3>
        <details><summary>Selected-pair scope</summary><p>Only this pair was examined. Shared passages or pixels do not establish identity, maliciousness, legitimacy or independent collection.</p></details>
        <ComparisonFrame>
          {#snippet header()}<h4>Selected file provenance</h4>{/snippet}
          {#snippet children()}<p>Case identity and file-source declarations remain separate. Capture conditions are unknown unless recorded with the observation.</p>{/snippet}
          {#snippet left()}{@render selectedSource(pair.left, pair.files[0]!, 'Reference')}{/snippet}
          {#snippet right()}{@render selectedSource(pair.right, pair.files[1]!, 'Candidate')}{/snippet}
        </ComparisonFrame>
        {#if facet === 'png'}<DeferredSurface load={() => import('./ImageChangeReview.svelte')}
          props={{ left: pair.files[0]!, right: pair.files[1]!, contexts: [galleryObservationContext(pair.left), galleryObservationContext(pair.right)] }}
          loadingLabel="Opening selected image comparison…" unavailableLabel="The image comparison could not be loaded. Saved evidence is unchanged." />
        {:else if textResult}<TextPassageResults result={textResult} reference={pair.left.attachment} candidate={pair.right.attachment} referenceScope={pair.left.caseNumber} candidateScope={pair.right.caseNumber} />{/if}
        <button class="btn" onclick={close}>Close selected comparison</button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .retained-gallery{padding:var(--card-pad);margin-bottom:16px;min-width:0}h2,h3,h4{margin:0;overflow-wrap:anywhere}p,small{color:var(--muted);font-size:var(--text-xs);line-height:1.6;overflow-wrap:anywhere}
  .filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-block:12px}label{display:grid;gap:6px;font-size:var(--text-xs);min-width:0}input,select{width:100%;min-width:0}
  .file-list{display:grid;gap:12px;padding-left:20px}.file-list li{min-width:0}.file-list strong,.file-list a,.file-list small{display:block;overflow-wrap:anywhere}
  summary{min-height:44px;align-content:center;cursor:pointer;font-size:var(--text-xs)}code{overflow-wrap:anywhere;font-size:var(--text-2xs)}.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}button{white-space:normal;max-width:100%}
  .prepared{display:grid;gap:12px;margin-top:16px;min-width:0}[role='alert']{color:var(--danger)}h3:focus,.file-list:focus{outline:2px solid var(--focus);outline-offset:3px}
  .selection-shelf{border-block:1px solid var(--border);padding-block:12px;margin-block:16px;min-width:0}.selected-file{min-width:0;align-self:start}.selected-label{display:grid;gap:4px}.selected-label strong{color:var(--text)}.selection-location{font-style:italic}.file-metadata{display:grid;gap:8px;margin:8px 0;font-size:var(--text-xs)}.file-metadata dt{color:var(--muted)}.file-metadata dd{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;min-width:0;margin:0}.file-metadata code{min-width:0;max-width:100%}
  @media(max-width:640px){.filters{grid-template-columns:minmax(0,1fr)}}@media print{.retained-gallery{display:none}}
</style>
