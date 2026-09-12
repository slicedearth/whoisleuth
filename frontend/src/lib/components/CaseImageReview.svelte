<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { CaseRecord } from '$lib/cases';
  import { CaseAttachmentSourceChangedError, type CaseAttachment } from '../../../../packages/cases/case-attachment-model.mts';
  import { MAX_EVIDENCE_IMAGE_REGIONS, readImageRegionPlan, type ImageDimensions, type ImageRegion } from '../../../../packages/evidence/image-regions.mts';
  import type { PersistCaseOperation } from '$lib/analysis/case-response-stage.ts';
  import { prepareCaseImageDerivative } from '$lib/case-image-edit.ts';
  import { readRetainedCaseFile, retainCaseAttachments, type SelectedCaseAttachment } from '$lib/case-attachments.ts';
  import { trackTransientCaseDraft } from '$lib/controllers/case-draft.svelte.ts';
  import { failedLocalMutationOutcome } from '$lib/local-mutation-outcome.ts';
  import ArtifactPreview from './ArtifactPreview.svelte';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';

  let { record, attachment, file, mutationBusy, persistOperation, onbusy }: {
    record: CaseRecord; attachment: CaseAttachment; file: Blob; mutationBusy: boolean;
    persistOperation: PersistCaseOperation; onbusy: (value: boolean) => void;
  } = $props();
  let root = $state<HTMLElement>();
  let addButton = $state<HTMLButtonElement>();
  let saveButton = $state<HTMLButtonElement>();
  let dimensions = $state<ImageDimensions | null>(null);
  let comparison = $state.raw<SelectedCaseAttachment | null>(null);
  let comparisonId = $state('');
  let loadingComparison = $state(false);
  let editing = $state(false);
  let picking = $state(false);
  let kind = $state<'redact' | 'outline'>('redact');
  let x = $state<number | undefined>(0), y = $state<number | undefined>(0);
  let width = $state<number | undefined>(1), height = $state<number | undefined>(1);
  let candidateDirty = $state(false);
  let regions = $state.raw<readonly ImageRegion[]>([]);
  let filename = $state('');
  let prepared = $state.raw<SelectedCaseAttachment | null>(null);
  let reviewed = $state(false);
  let preparing = $state(false);
  let uncertain = $state(false);
  let sourceRejected = $state(false);
  let error = $state('');
  let comparisonGeneration = 0;
  let controller = new AbortController();
  const otherImages = $derived((record.attachments ?? []).filter(item => item.id !== attachment.id && item.mediaType === 'image/png'));
  const right = $derived(prepared ?? comparison);
  const dirty = $derived(candidateDirty || regions.length > 0 || prepared !== null || preparing);
  const busy = $derived(preparing || loadingComparison || mutationBusy);
  const sourcePresent = $derived(!sourceRejected && (record.attachments?.some(item => item.id === attachment.id && item.digestSha256 === attachment.digestSha256
    && item.byteLength === attachment.byteLength && item.source === attachment.source && item.observedAt === attachment.observedAt) ?? false));

  trackTransientCaseDraft(() => dirty);
  $effect(() => { onbusy(preparing || loadingComparison); });
  onMount(() => {
    filename = `${attachment.fileName.replace(/\.png$/iu, '').slice(0, 228)}.edited.png`;
    root?.focus();
  });
  onDestroy(() => { comparisonGeneration++; controller.abort(); onbusy(false); });

  export function confirmDiscard(): boolean {
    return !busy && (!dirty || window.confirm('Discard these unsaved image edits? The retained source will not change.'));
  }

  function imageReady(size: ImageDimensions) {
    dimensions = size;
    if (!candidateDirty && !regions.length) { width = size.width; height = size.height; }
  }
  async function chooseComparison(event: Event) {
    const selected = (event.currentTarget as HTMLSelectElement).value;
    comparisonId = selected; comparison = null; error = '';
    const current = ++comparisonGeneration;
    if (!selected) return;
    const target = otherImages.find(item => item.id === selected);
    if (!target) { error = 'The selected comparison is no longer retained.'; return; }
    loadingComparison = true;
    try {
      const bytes = await readRetainedCaseFile(target);
      if (current === comparisonGeneration) comparison = { attachment: target, file: bytes };
    } catch (cause) { if (current === comparisonGeneration) error = cause instanceof Error ? cause.message : 'The comparison could not be read.'; }
    finally { if (current === comparisonGeneration) loadingComparison = false; }
  }
  async function chooseRegion(region: Omit<ImageRegion, 'kind'>) {
    x = region.x; y = region.y; width = region.width; height = region.height;
    candidateDirty = true; prepared = null; reviewed = false; picking = false;
    await tick(); addButton?.focus();
  }
  async function togglePicker() {
    picking = !picking;
    if (picking) { await tick(); root?.querySelector<HTMLButtonElement>('.region-picker')?.focus(); }
  }
  function changed() { candidateDirty = true; prepared = null; reviewed = false; error = ''; }
  function addRegion(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !dimensions || uncertain) return;
    try {
      regions = readImageRegionPlan({ ...dimensions, regions: [...regions, { kind, x, y, width, height }] }).regions;
      candidateDirty = false; prepared = null; reviewed = false; error = ''; picking = false;
    } catch (cause) { error = cause instanceof Error ? cause.message : 'The region is not valid.'; }
  }
  function removeRegion(index: number) {
    regions = regions.filter((_, position) => position !== index); prepared = null; reviewed = false;
  }
  function clearEdits() {
    if (!confirmDiscard()) return;
    controller.abort(); controller = new AbortController();
    regions = []; prepared = null; reviewed = false; candidateDirty = false; picking = false; error = ''; editing = false;
  }
  async function prepare() {
    if (busy || uncertain || !sourcePresent || !dimensions || candidateDirty || !regions.length) return;
    preparing = true; error = ''; prepared = null; reviewed = false; picking = false;
    controller = new AbortController();
    const signal = controller.signal;
    try {
      prepared = await prepareCaseImageDerivative(attachment, file, { ...dimensions, regions }, filename.trim(), signal);
    } catch (cause) {
      if (!signal.aborted) error = cause instanceof Error ? cause.message : 'The edited PNG could not be prepared.';
    } finally { preparing = false; }
  }
  async function retain() {
    const selected = prepared;
    if (!selected || !reviewed || busy || uncertain || !sourcePresent) return;
    const origin = document.activeElement;
    error = '';
    const saved = await persistOperation(async () => {
      try { return await retainCaseAttachments(record.id, [selected]); }
      catch (cause) {
        uncertain = failedLocalMutationOutcome(cause) === 'unknown';
        sourceRejected = cause instanceof CaseAttachmentSourceChangedError;
        error = sourceRejected ? '' : cause instanceof Error ? cause.message : 'The edited image could not be retained.';
        throw cause;
      }
    }, 'Retained the edited PNG as a separate file. Its source image is unchanged.', () => saveButton ?? root ?? null);
    if (saved && prepared === selected) {
      prepared = null; reviewed = false; regions = []; candidateDirty = false; editing = false;
      await tick();
      if (document.activeElement === origin || document.activeElement === document.body) root?.focus();
    }
  }
</script>

<section class="image-review" bind:this={root} tabindex="-1" aria-label={`Image review: ${attachment.fileName}`}>
  <h4>Compare and edit retained images</h4>
  <p>Compare images with their source context. Browser, locale and capture viewport are not recorded with these file references.</p>
  <label class="comparison-select">Compare with another retained PNG
    <select value={comparisonId} disabled={busy || prepared !== null} onchange={event => void chooseComparison(event)}>
      <option value="">No comparison</option>
      {#each otherImages as image}<option value={image.id}>{image.fileName} · {image.observedAt ?? 'time unknown'}</option>{/each}
    </select>
  </label>
  {#if loadingComparison}<p role="status">Verifying comparison bytes…</p>{/if}
  {#if comparison && !prepared}<p>{attachment.digestSha256 === comparison.attachment.digestSha256 ? 'The two references contain identical bytes. Their source observations remain separate.' : 'The file digests differ. Review the images and their source context before drawing a conclusion.'}</p>{/if}
  {#if !sourcePresent}<p role="alert">The source reference changed or was removed. Unsaved edits remain here, but cannot be retained against that source.</p>{/if}
  <div class="image-pair" class:paired={right !== null}>
    <section class="image-column" aria-label="Selected source image">
      <h5>{attachment.derivation ? 'Retained derivative' : 'Retained original'} · {attachment.fileName}</h5>
      <p>{attachment.source ?? 'Source not declared'} · <EvidenceTimestamp value={attachment.observedAt} label="source observation time" unavailable="Observation time unknown" /></p>
      <ArtifactPreview {file} mediaType="image/png" label={attachment.fileName} focusOnReady={false} onready={imageReady}
        {regions} onselect={picking && !busy ? chooseRegion : undefined} />
      {#if regions.length}<p>Marked rectangles are edit instructions; this preview still shows the source pixels.</p>{/if}
    </section>
    {#if right}<section class="image-column" aria-label={prepared ? 'Prepared edited image' : 'Comparison image'}>
      <h5>{prepared ? 'Edited PNG · not saved' : right.attachment.derivation ? 'Retained derivative' : 'Retained original'} · {right.attachment.fileName}</h5>
      <p>{right.attachment.source ?? 'Source not declared'} · <EvidenceTimestamp value={right.attachment.observedAt} label="comparison observation time" unavailable="Observation time unknown" /></p>
      <ArtifactPreview file={right.file} mediaType="image/png" label={right.attachment.fileName} focusOnReady={false} />
    </section>{/if}
  </div>
  {#if !editing}<button class="btn" type="button" disabled={busy || !dimensions || !sourcePresent || uncertain} onclick={() => editing = true}>Create edited PNG</button>{/if}
  {#if editing}
    <div class="image-edit">
      <h5>Image regions</h5>
      <p>Redactions replace pixels with solid black; outlines mark a region without obscuring it. The output is a separate PNG with no copied source metadata.</p>
      <form class="region-form" onsubmit={addRegion}>
        <fieldset disabled={busy || uncertain || !sourcePresent || prepared !== null}>
          <legend>Add a region in source-image pixels</legend>
          <div class="region-fields">
            <label>Action <select bind:value={kind} onchange={changed}><option value="redact">Redact</option><option value="outline">Outline</option></select></label>
            <label>Left <input type="number" min="0" max={(dimensions?.width ?? 1) - 1} step="1" required bind:value={x} oninput={changed}></label>
            <label>Top <input type="number" min="0" max={(dimensions?.height ?? 1) - 1} step="1" required bind:value={y} oninput={changed}></label>
            <label>Width <input type="number" min="1" max={dimensions?.width} step="1" required bind:value={width} oninput={changed}></label>
            <label>Height <input type="number" min="1" max={dimensions?.height} step="1" required bind:value={height} oninput={changed}></label>
          </div>
          <div class="image-actions"><button class="btn" type="button" aria-pressed={picking} onclick={() => void togglePicker()}>{picking ? 'Cancel image selection' : 'Select a region on image'}</button><button bind:this={addButton} class="btn" type="submit" disabled={regions.length >= MAX_EVIDENCE_IMAGE_REGIONS}>Add region</button></div>
        </fieldset>
      </form>
      {#if picking}<p role="status">Drag a rectangle on the source image. Press Enter there to select the whole image, or enter exact coordinates above.</p>{/if}
      {#if regions.length}<ol class="region-list">{#each regions as region, index}<li><span>{region.kind === 'redact' ? 'Redact' : 'Outline'}: left {region.x}, top {region.y}, {region.width} × {region.height}</span><button class="btn" type="button" aria-label={`Remove region ${index + 1}`} disabled={busy || uncertain} onclick={() => removeRegion(index)}>Remove</button></li>{/each}</ol>{/if}
      <label>Edited filename <input bind:value={filename} maxlength="240" disabled={busy || uncertain || prepared !== null}></label>
      {#if candidateDirty}<p>Add the current region before preparing the image.</p>{/if}
      {#if error}<p class="image-error" role="alert">{error}</p>{/if}
      {#if uncertain}<p role="alert">The save outcome could not be confirmed. Reload the workspace and inspect the retained files before another save.</p>{/if}
      <div class="image-actions"><button class="btn" type="button" disabled={busy || uncertain || !sourcePresent || candidateDirty || !regions.length || prepared !== null} onclick={() => void prepare()}>{preparing ? 'Preparing edited PNG…' : 'Prepare edited PNG'}</button>{#if preparing}<button class="btn" type="button" onclick={() => controller.abort()}>Cancel preparation</button>{/if}<button class="btn" type="button" disabled={busy} onclick={clearEdits}>Discard image edits</button></div>
      {#if prepared}
        <label class="review-confirm"><input type="checkbox" bind:checked={reviewed} disabled={busy || uncertain}>I reviewed the edited image</label>
        <button class="primary" bind:this={saveButton} type="button" disabled={!reviewed || busy || uncertain || !sourcePresent} onclick={() => void retain()}>Retain edited PNG</button>
      {/if}
    </div>
  {:else if error}<p class="image-error" role="alert">{error}</p>{/if}
</section>

<style>
  .image-review,.image-edit{display:grid;gap:12px;min-width:0}.image-review:focus{outline:2px solid var(--focus);outline-offset:3px}h4,h5,p{margin:0;overflow-wrap:anywhere}h4,h5{font:650 var(--text-sm)/1.5 var(--font-sans)}p{color:var(--muted);font:400 var(--text-xs)/1.55 var(--font-sans)}
  label{display:grid;gap:5px;min-width:0;font-size:var(--text-xs)}input,select{min-width:0;width:100%}.image-pair{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start}.image-pair.paired{grid-template-columns:repeat(auto-fit,minmax(min(100%,24rem),1fr))}.image-column{min-width:0;display:grid;gap:5px}
  .image-edit{border-top:1px solid var(--border);padding-top:14px}fieldset{min-width:0;padding:0;border:0;display:grid;gap:12px}legend{font-size:var(--text-xs);padding:0 0 8px}.region-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,8rem),1fr));gap:10px}.image-actions{display:flex;flex-wrap:wrap;gap:8px}.image-actions button{max-width:100%;white-space:normal}.region-list{padding-left:1.5em;margin:0;font-size:var(--text-xs)}.region-list li{margin:6px 0;overflow-wrap:anywhere}.region-list button{margin-left:10px}
  .review-confirm{display:flex;gap:8px;align-items:center;min-height:44px}.review-confirm input{width:auto;flex:none}.image-error{color:var(--danger)}.image-review>button,.primary{justify-self:start}
</style>
