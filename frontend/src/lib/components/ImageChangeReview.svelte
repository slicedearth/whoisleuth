<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { runInvestigationPackageWorker } from '$lib/investigation-package-worker.ts';
  import { compareObservationContexts, type ObservationContext } from '../../../../packages/comparison/capture-context.mts';
  import type { ImageChange } from '../../../../packages/comparison/image-change.mts';
  import { MAX_EVIDENCE_IMAGE_REGIONS, readImageRegionPlan, type ImageDimensions, type ImageRegion } from '../../../../packages/evidence/image-regions.mts';

  let { left, right, contexts }: { left: Blob; right: Blob; contexts: readonly ObservationContext[] } = $props();
  const id = $props.id();
  const context = $derived(compareObservationContexts(contexts));
  let result = $state.raw<ImageChange | null>(null), dimensions = $state<ImageDimensions | null>(null);
  let masks = $state.raw<readonly ImageRegion[]>([]);
  let x = $state<number | undefined>(0), y = $state<number | undefined>(0);
  let width = $state<number | undefined>(1), height = $state<number | undefined>(1);
  let busy = $state(false), error = $state(''), page = $state(0);
  let heading = $state<HTMLHeadingElement>(), button = $state<HTMLButtonElement>();
  let controller: AbortController | null = null;
  $effect(() => { left; right; untrack(() => { controller?.abort(); controller = null; result = null; masks = []; dimensions = null; busy = false; error = ''; page = 0; }); });
  onDestroy(() => controller?.abort());

  async function compare() {
    if (busy) return;
    const current = new AbortController(); controller = current; busy = true; error = ''; result = null; page = 0;
    try {
      const next = await runInvestigationPackageWorker('imageCompare', { left, right, masks }, { signal: current.signal });
      if (current.signal.aborted || controller !== current) return;
      result = next; dimensions = next.left;
      await tick(); if (controller === current) heading?.focus();
    } catch (cause) { if (!current.signal.aborted) error = cause instanceof Error ? cause.message : 'The selected images could not be compared.'; }
    finally { if (controller === current) { busy = false; controller = null; } }
  }
  async function cancel() { controller?.abort(); controller = null; busy = false; result = null; await tick(); button?.focus(); }
  function addMask(event: SubmitEvent) {
    event.preventDefault(); if (!dimensions || busy) return;
    try { masks = readImageRegionPlan({ ...dimensions, regions: [...masks, { kind: 'redact', x, y, width, height }] }).regions; result = null; error = ''; }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Choose an excluded rectangle inside the image.'; }
  }
</script>

<details class="image-change-review">
  <summary>Compare image regions</summary>
  <div class="comparison-body">
    <p>Compare every pixel on a white background. The map groups changed pixels; it does not resize the sources or assign a risk score.</p>
    <details class="context"><summary>Observation times and capture conditions</summary>
      <p>{context.observations.map(value => value.observedAt ?? 'Time not declared').join(' → ')}{context.time.spanMilliseconds === null ? '' : ` · ${context.time.spanMilliseconds / 1000} seconds apart`}</p>
      <dl>{#each context.rows as row}<div><dt>{row.label} · {row.state}</dt><dd>{row.values.map(value => value ?? 'Not declared').join(' → ')}</dd></div>{/each}</dl>
      <p>Labels are {context.labels}; collection independence is not verified. Timing, shared caches and different capture conditions can explain a difference. This does not establish worldwide removal or takedown.</p>
    </details>
    <div class="actions"><button bind:this={button} class="btn" type="button" disabled={busy} onclick={() => void compare()}>{busy ? 'Comparing image pixels…' : 'Calculate image changes'}</button>
      {#if busy}<button class="btn" type="button" onclick={cancel}>Cancel image comparison</button>{/if}</div>
    {#if error}<p role="alert">{error}</p>{/if}
    {#if dimensions}<details class="mask-controls"><summary>Exclude rectangular regions ({masks.length})</summary>
      <p>Exclusions apply to both images. They do not redact the original files. Changing exclusions clears the previous result until you calculate again.</p>
      <form onsubmit={addMask}><fieldset disabled={busy || masks.length >= MAX_EVIDENCE_IMAGE_REGIONS}>
        <legend>Add an excluded rectangle</legend>
        <div class="coordinates">
          <label>Left<input type="number" min="0" max={dimensions.width - 1} step="1" required bind:value={x}></label>
          <label>Top<input type="number" min="0" max={dimensions.height - 1} step="1" required bind:value={y}></label>
          <label>Width<input type="number" min="1" max={dimensions.width} step="1" required bind:value={width}></label>
          <label>Height<input type="number" min="1" max={dimensions.height} step="1" required bind:value={height}></label>
        </div><button class="btn" type="submit">Add exclusion</button>
      </fieldset></form>
      <ol>{#each masks as mask, index}<li>{mask.x}, {mask.y} · {mask.width} × {mask.height}<button class="btn" type="button" disabled={busy} aria-label={`Remove exclusion ${index + 1}`} onclick={() => { masks = masks.filter((_, position) => position !== index); result = null; }}>Remove</button></li>{/each}</ol>
    </details>{/if}
    {#if result}
      <h5 bind:this={heading} tabindex="-1">Image comparison: {result.state.replaceAll('_', ' ')}</h5>
      <p role="status">{result.state === 'dimensions_differ' ? 'The dimensions differ; pixels were not resized or compared.' : result.state === 'all_excluded' ? 'Every pixel was excluded. No agreement can be assessed.' : `${result.changedPixels.toLocaleString('en-AU')} of ${result.comparedPixels.toLocaleString('en-AU')} compared pixels differ (${result.changedPercent!.toFixed(2)}%). ${result.excludedPixels.toLocaleString('en-AU')} pixels excluded.`}</p>
      {#if result.state !== 'dimensions_differ' && (result.tiles.length || result.masks.length)}
        <svg class="change-map" viewBox={`0 0 ${result.left.width} ${result.left.height}`} role="img" aria-labelledby={`${id}-map-title`}>
          <title id={`${id}-map-title`}>Changed-pixel regions: {result.tiles.length}. Coordinates are listed below; outlined regions are excluded.</title>
          <rect width={result.left.width} height={result.left.height} class="map-background" />
          {#each result.tiles as tile}<rect x={tile.x} y={tile.y} width={tile.width} height={tile.height} class="changed-tile" />{/each}
          {#each result.masks as mask}<rect x={mask.x} y={mask.y} width={mask.width} height={mask.height} class="excluded-region" vector-effect="non-scaling-stroke" />{/each}
        </svg>
        <p>Filled cells contain a change; outlined rectangles are excluded. A filled cell is not necessarily changed throughout.</p>
      {/if}
      {#if result.tiles.length}<details><summary>Changed-region coordinates ({result.tiles.length})</summary>
        <ol start={page * 16 + 1}>{#each result.tiles.slice(page * 16, (page + 1) * 16) as tile}<li>Left {tile.x}, top {tile.y}, {tile.width} × {tile.height}: {tile.changedPixels} of {tile.comparedPixels} compared pixels changed.</li>{/each}</ol>
        {#if result.tiles.length > 16}<nav aria-label="Changed regions"><button class="btn" disabled={page === 0} onclick={() => page--}>Previous regions</button><span>{page + 1} / {Math.ceil(result.tiles.length / 16)}</span><button class="btn" disabled={(page + 1) * 16 >= result.tiles.length} onclick={() => page++}>Next regions</button></nav>{/if}
      </details>{/if}
    {/if}
  </div>
</details>

<style>
  .image-change-review { min-width: 0; border-top: 1px solid var(--border); margin-top: 12px; }
  summary { cursor: pointer; font-weight: 650; padding-block: 10px; }
  .comparison-body { display: grid; gap: 12px; min-width: 0; padding-bottom: 12px; }
  p, li, dl { font-size: var(--text-xs); line-height: 1.6; margin: 0; overflow-wrap: anywhere; color: var(--muted); }
  h5 { font-size: var(--text-sm); margin: 0; }
  h5:focus { outline: 2px solid var(--focus); outline-offset: 4px; }
  .actions, nav { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .coordinates, dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  label { display: grid; gap: 4px; min-width: 0; font-size: var(--text-xs); }
  input { width: 100%; min-width: 0; }
  fieldset { border: 0; padding: 0; display: grid; gap: 10px; min-width: 0; }
  legend { font-size: var(--text-xs); margin-bottom: 8px; }
  dd { margin: 0; }
  dt { font-weight: 650; color: var(--text); }
  .change-map { width: 100%; max-width: 40rem; max-height: 22rem; border: 1px solid var(--border); background: var(--panel-raised); }
  .map-background { fill: var(--panel-raised); }
  .changed-tile { fill: var(--accent); }
  .excluded-region { fill: none; stroke: var(--text); stroke-width: 2; stroke-dasharray: 4 3; }
  button { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
  ol { padding-left: 20px; display: grid; gap: 8px; }
  li button { margin-left: 8px; }
  [role=alert] { color: var(--danger); }
  @media (max-width: 500px) { dl { grid-template-columns: minmax(0, 1fr); } }
</style>
