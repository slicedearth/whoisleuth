<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { runInvestigationPackageWorker } from '$lib/investigation-package-worker.ts';
  import type { BrowserCaptureAttachmentReview } from '$lib/investigation-package-worker-model.ts';
  import { MAX_WEB_CAPTURE_MANIFEST_BYTES } from '../../../../packages/contracts/web-capture.mts';
  import { MAX_INVESTIGATION_MANIFEST_ARTIFACTS } from '../../../../packages/contracts/investigation-package-limits.mts';
  import ArtifactPreview from './ArtifactPreview.svelte';
  import ImageChangeReview from './ImageChangeReview.svelte';

  let { left }: { left: BrowserCaptureAttachmentReview } = $props();
  let right = $state.raw<BrowserCaptureAttachmentReview | null>(null), manifest = $state.raw<Blob | null>(null);
  let busy = $state(false), error = $state(''), leftKey = $state(''), rightKey = $state('');
  let manifestInput = $state<HTMLInputElement>(), attachmentsInput = $state<HTMLInputElement>();
  let controller: AbortController | null = null;
  function screenshots(review: BrowserCaptureAttachmentReview | null) {
    if (!review) return [];
    return review.artifacts.flatMap((artifact, index) => artifact.kind === 'screenshot' && artifact.mimeType === 'image/png'
      ? (review.matches[index]?.matchingIds ?? []).map(id => ({ key: `${index}:${id}`, id, artifact, context: review.captures[artifact.capture - 1]!, file: review.contents.get(id)! })) : []);
  }
  const leftChoices = $derived(screenshots(left)), rightChoices = $derived(screenshots(right));
  const selectedLeft = $derived(leftChoices.find(item => item.key === leftKey)), selectedRight = $derived(rightChoices.find(item => item.key === rightKey));
  $effect(() => { left; untrack(() => { controller?.abort(); controller = null; busy = false; right = null; manifest = null; leftKey = ''; rightKey = ''; error = ''; }); });
  $effect(() => { if (leftChoices.length === 1) leftKey = leftChoices[0]!.key; });
  $effect(() => { if (rightChoices.length === 1) rightKey = rightChoices[0]!.key; });
  onDestroy(() => controller?.abort());

  async function select(event: Event, isManifest: boolean) {
    const input = event.currentTarget as HTMLInputElement;
    if (busy || !input.files?.length) { input.value = ''; return; }
    if (input.files.length > MAX_INVESTIGATION_MANIFEST_ARTIFACTS) { input.value = ''; error = 'The attachment selection exceeds the supported file count.'; return; }
    const selected = Array.from(input.files); input.value = ''; error = ''; rightKey = ''; right = null;
    if (isManifest) manifest = null;
    const nextManifest = isManifest ? selected[0]! : manifest;
    if (!nextManifest || nextManifest.size > MAX_WEB_CAPTURE_MANIFEST_BYTES) { error = 'Select one capture manifest within the supported 1 MiB limit.'; return; }
    const current = new AbortController(); controller = current; busy = true;
    try {
      const result = await runInvestigationPackageWorker('capture', { manifest: nextManifest, files: isManifest ? [] : selected }, { signal: current.signal });
      if (!current.signal.aborted && controller === current) { right = result; manifest = nextManifest; }
    } catch (cause) { if (!current.signal.aborted) error = cause instanceof Error ? cause.message : 'The comparison capture could not be read.'; }
    finally { if (controller === current) { controller = null; busy = false; } }
  }
  async function cancel() {
    controller?.abort(); controller = null; busy = false;
    await tick(); (manifest ? attachmentsInput : manifestInput)?.focus();
  }
</script>

<details class="capture-comparison">
  <summary>Compare another capture</summary>
  <div class="body">
    <p>Choose a second manifest and its PNG. Files are checksum-checked locally. This comparison does not import the other capture into the Case or verify the declared collection location.</p>
    <label>Comparison capture manifest<input bind:this={manifestInput} type="file" accept="application/json,.json" disabled={busy} onchange={event => void select(event, true)}></label>
    {#if manifest}<label>Comparison capture attachments<input bind:this={attachmentsInput} type="file" multiple disabled={busy} onchange={event => void select(event, false)}></label>{/if}
    {#if busy}<p role="status">Checking comparison capture…</p><button class="btn" type="button" onclick={cancel}>Cancel comparison capture</button>{/if}
    {#if error}<p role="alert">{error}</p>{/if}
    {#if !leftChoices.length}<p>The current capture has no verified PNG selected.</p>{/if}
    {#if right && !rightChoices.length}<p>No comparison PNG has matching selected bytes yet.</p>{/if}
    {#if leftChoices.length && rightChoices.length}
      <div class="choices"><label>First screenshot<select bind:value={leftKey}><option value="">Select screenshot</option>{#each leftChoices as item}<option value={item.key}>{item.context.domain} · {item.context.observedAt ?? 'time unknown'} · {item.id}</option>{/each}</select></label>
        <label>Second screenshot<select bind:value={rightKey}><option value="">Select screenshot</option>{#each rightChoices as item}<option value={item.key}>{item.context.domain} · {item.context.observedAt ?? 'time unknown'} · {item.id}</option>{/each}</select></label></div>
      {#if selectedLeft && selectedRight}
        <p>Both selected files match their declared SHA-256 and byte count. The manifest declarations themselves are not authenticated.</p>
        <div class="images"><section aria-label="First capture image"><h5>{selectedLeft.context.domain}</h5><ArtifactPreview file={selectedLeft.file} mediaType="image/png" label="First capture" focusOnReady={false} /></section>
          <section aria-label="Second capture image"><h5>{selectedRight.context.domain}</h5><ArtifactPreview file={selectedRight.file} mediaType="image/png" label="Second capture" focusOnReady={false} /></section></div>
        <ImageChangeReview left={selectedLeft.file} right={selectedRight.file} contexts={[selectedLeft.context, selectedRight.context]} />
      {/if}
    {/if}
  </div>
</details>

<style>
  .capture-comparison { min-width: 0; border-top: 1px solid var(--border); }
  summary { cursor: pointer; padding-block: 12px; font-weight: 650; }
  .body { display: grid; gap: 12px; min-width: 0; padding-bottom: 12px; }
  .choices, .images { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  section, label { min-width: 0; }
  label { display: grid; gap: 5px; font-size: var(--text-xs); }
  input, select { max-width: 100%; min-width: 0; width: 100%; }
  p { font-size: var(--text-xs); line-height: 1.6; color: var(--muted); margin: 0; overflow-wrap: anywhere; }
  h5 { margin: 0 0 8px; font-size: var(--text-sm); overflow-wrap: anywhere; }
  button { justify-self: start; max-width: 100%; white-space: normal; }
  [role=alert] { color: var(--danger); }
  @media (max-width: 900px) { .choices, .images { grid-template-columns: minmax(0, 1fr); } }
</style>
