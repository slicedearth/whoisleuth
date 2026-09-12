<script lang="ts">
  import { untrack, tick } from 'svelte';
  import { decodeArtifactPng, readArtifactTextPage } from '$lib/artifact-preview.ts';

  let { file, mediaType, label }: { file: Blob; mediaType: string; label: string } = $props();
  let busy = $state(false);
  let error = $state('');
  let page = $state<Awaited<ReturnType<typeof readArtifactTextPage>> | null>(null);
  let dimensions = $state<{ width: number; height: number } | null>(null);
  let canvas = $state<HTMLCanvasElement>();
  let body = $state<HTMLDivElement>();
  let generation = 0;
  let controller = new AbortController();

  $effect(() => {
    file;
    untrack(() => {
      controller = new AbortController(); page = null; dimensions = null; busy = false; error = '';
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
        } finally { bitmap.close(); }
      }
      await tick();
      if (current === generation) body?.focus();
    } catch {
      if (current === generation) error = 'This file could not be shown safely in the inline viewer. The original file is unchanged.';
    } finally {
      if (current === generation) { busy = false; await tick(); if (current === generation) body?.focus(); }
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
          <div role="img" aria-label={`Selected screenshot ${label}, ${dimensions.width} by ${dimensions.height} pixels`}><canvas bind:this={canvas} aria-hidden="true"></canvas></div>
        {/if}
      </div>
  </div>

<style>
  .artifact-preview{min-width:0;margin-top:10px}.preview-body{min-width:0;margin-top:10px;padding:12px;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius-sm)}
  .preview-body:focus{outline:2px solid var(--focus);outline-offset:3px}p{color:var(--muted);font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}
  .text-scroll{max-height:28rem;overflow:auto}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:plaintext;font:var(--text-xs)/1.5 var(--mono)}
  canvas{display:block;width:auto;max-width:100%;height:auto;background:#fff}nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
</style>
