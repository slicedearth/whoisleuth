<script lang="ts">
  import { untrack, tick } from 'svelte';
  import { decodeArtifactPng, readArtifactTextPage } from '$lib/artifact-preview.ts';
  import type { ImageDimensions, ImageRegion } from '../../../../packages/evidence/image-regions.mts';

  let { file, mediaType, label, focusOnReady = true, onready, onselect, regions = [] }: {
    file: Blob; mediaType: string; label: string; focusOnReady?: boolean;
    onready?: (dimensions: ImageDimensions) => void;
    onselect?: ((region: Omit<ImageRegion, 'kind'>) => void) | undefined;
    regions?: readonly ImageRegion[];
  } = $props();
  let busy = $state(false);
  let error = $state('');
  let page = $state<Awaited<ReturnType<typeof readArtifactTextPage>> | null>(null);
  let dimensions = $state<{ width: number; height: number } | null>(null);
  let canvas = $state<HTMLCanvasElement>();
  let body = $state<HTMLDivElement>();
  let generation = 0;
  let controller = new AbortController();
  let selection = $state<{ pointer: number; x: number; y: number; endX: number; endY: number } | null>(null);
  const selectedRectangle = $derived(selection ? {
    x: Math.min(selection.x, selection.endX), y: Math.min(selection.y, selection.endY),
    width: Math.abs(selection.endX - selection.x) + 1, height: Math.abs(selection.endY - selection.y) + 1,
  } : null);

  function point(event: PointerEvent, button: HTMLButtonElement) {
    if (!dimensions) return null;
    const bounds = button.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(dimensions.width - 1, Math.floor((event.clientX - bounds.left) * dimensions.width / bounds.width))),
      y: Math.max(0, Math.min(dimensions.height - 1, Math.floor((event.clientY - bounds.top) * dimensions.height / bounds.height))),
    };
  }
  function startSelection(event: PointerEvent) {
    if (event.button !== 0 || !onselect || selection) return;
    const button = event.currentTarget as HTMLButtonElement, position = point(event, button);
    if (!position) return;
    button.setPointerCapture(event.pointerId);
    selection = { pointer: event.pointerId, ...position, endX: position.x, endY: position.y };
  }
  function moveSelection(event: PointerEvent) {
    if (selection?.pointer !== event.pointerId) return;
    const position = point(event, event.currentTarget as HTMLButtonElement);
    if (position) selection = { ...selection, endX: position.x, endY: position.y };
  }
  function finishSelection(event: PointerEvent) {
    if (selection?.pointer !== event.pointerId) return;
    moveSelection(event);
    const rectangle = selectedRectangle;
    selection = null;
    if (rectangle) onselect?.(rectangle);
  }

  $effect(() => {
    file;
    untrack(() => {
      controller = new AbortController(); page = null; dimensions = null; busy = false; error = ''; selection = null;
      void show();
    });
    return () => { generation++; controller.abort(); };
  });

  async function show(part = 0) {
    if (busy) return;
    const current = ++generation, selected = file;
    busy = true; error = '';
    try {
      if (mediaType === 'application/json') {
        const next = await readArtifactTextPage(selected, part);
        if (current !== generation) return;
        page = next;
      } else {
        const bitmap = await decodeArtifactPng(selected, controller.signal);
        try {
          if (current !== generation) return;
          const size = { width: bitmap.width, height: bitmap.height };
          dimensions = size;
          await tick();
          if (current !== generation) return;
          const context = canvas?.getContext('2d');
          if (!context || !canvas) throw new Error('Image review is unavailable in this browser.');
          canvas.width = size.width; canvas.height = size.height;
          context.drawImage(bitmap, 0, 0);
          onready?.(size);
        } finally { bitmap.close(); }
      }
      await tick();
      if (current === generation && focusOnReady) body?.focus();
    } catch {
      if (current === generation) error = 'This file could not be shown safely in the inline viewer. The original file is unchanged.';
    } finally {
      if (current === generation) { busy = false; await tick(); if (current === generation && focusOnReady) body?.focus(); }
    }
  }
</script>

  <div class="artifact-preview">
      <div bind:this={body} class="preview-body" tabindex="-1" role="region" aria-label={`Inline review of ${label}`} aria-busy={busy}>
        {#if busy}<p role="status">Preparing local view…</p>{/if}
        {#if error}<p role="alert">{error}</p>{/if}
        {#if page && !error}
          <p>Text part {page.page + 1} of {page.pages} · bytes {page.startByte + 1}–{page.endByte} of {file.size}</p>
          {#if page.escapedControls}<p>Control and directional-formatting characters are escaped for display; the file is unchanged.</p>{/if}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -- the named scroll region provides keyboard access to every text page -->
          <div class="text-scroll" role="region" tabindex="0" aria-label={`${label} text`}><pre>{page.text}</pre></div>
          {#if page.pages > 1}<nav aria-label={`${label} text parts`}>
            <button class="btn" type="button" disabled={busy || page.page === 0} onclick={() => show(page!.page - 1)}>Previous text part</button>
            <button class="btn" type="button" disabled={busy || page.page + 1 === page.pages} onclick={() => show(page!.page + 1)}>Next text part</button>
          </nav>{/if}
        {:else if dimensions && !error}
          <p>{dimensions.width} × {dimensions.height} pixels · Decoded locally</p>
          <div class="image-surface">
            <div role="img" aria-label={`Selected screenshot ${label}, ${dimensions.width} by ${dimensions.height} pixels`}><canvas bind:this={canvas} aria-hidden="true"></canvas></div>
            {#if regions.length || selectedRectangle}
              <svg class="region-overlay" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} aria-hidden="true">
                {#each regions as region, index}<rect x={region.x} y={region.y} width={region.width} height={region.height} fill="none" stroke={region.kind === 'redact' ? '#ff5959' : '#ffbf00'} stroke-width="2" vector-effect="non-scaling-stroke"><title>Region {index + 1}</title></rect>{/each}
                {#if selectedRectangle}<rect {...selectedRectangle} fill="#ffbf0033" stroke="#ffbf00" stroke-width="2" vector-effect="non-scaling-stroke" />{/if}
              </svg>
            {/if}
            {#if onselect}
              <button class="region-picker" type="button" aria-label="Select an image region: drag a rectangle, or press Enter to select the whole image"
                onpointerdown={startSelection} onpointermove={moveSelection} onpointerup={finishSelection}
                onpointercancel={() => selection = null} onlostpointercapture={() => selection = null}
                onclick={event => { if (event.detail === 0 && dimensions) onselect?.({ x: 0, y: 0, ...dimensions }); }}></button>
            {/if}
          </div>
        {/if}
      </div>
  </div>

<style>
  .artifact-preview{min-width:0;margin-top:10px}.preview-body{min-width:0;margin-top:10px;padding:12px;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius-sm)}
  .preview-body:focus{outline:2px solid var(--focus);outline-offset:3px}p{color:var(--muted);font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}
  .text-scroll{max-height:28rem;overflow:auto}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:plaintext;font:var(--text-xs)/1.5 var(--mono)}
  canvas{display:block;width:auto;max-width:100%;height:auto;background:#fff}nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .image-surface{position:relative;width:fit-content;max-width:100%}.region-overlay,.region-picker{position:absolute;inset:0;width:100%;height:100%}.region-overlay{pointer-events:none}.region-picker{min-height:0;border:0;border-radius:0;margin:0;padding:0;background:transparent;cursor:crosshair;touch-action:none}.region-picker:hover{background:transparent}.region-picker:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
</style>
