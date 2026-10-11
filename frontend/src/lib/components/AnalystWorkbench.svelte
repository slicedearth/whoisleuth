<script lang="ts">
  import { onDestroy, tick, type Snippet } from 'svelte';

  let {
    label,
    selected,
    detailTitle,
    queue,
    children,
    inspector,
    onclose,
  }: {
    label: string;
    selected: string | null;
    detailTitle: string;
    queue: Snippet;
    children: Snippet;
    inspector?: Snippet;
    onclose: () => void;
  } = $props();
  let root = $state<HTMLElement>(), queuePane = $state<HTMLElement>(), heading = $state<HTMLHeadingElement>();
  let previous: string | null = null;
  let origin: HTMLElement | null = null;
  let disposed = false;
  let width = $state('balanced');
  $effect(() => {
    const current = selected;
    if (current === previous) return;
    previous = current;
    if (!current) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && queuePane?.contains(focused)) origin = focused;
    void tick().then(() => {
      if (!disposed && selected === current) heading?.focus();
    });
  });
  onDestroy(() => { disposed = true; origin = null; });
  async function close() {
    const destination = origin;
    onclose();
    await tick();
    if (!disposed && selected === null) {
      if (destination?.isConnected) destination.focus();
      else queuePane?.focus();
    }
  }
  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented || !selected
      || !(event.target instanceof HTMLElement) || !root?.contains(event.target)
      || event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
    event.preventDefault();
    void close();
  }
</script>

<svelte:window onkeydown={keydown} />
<section class="workbench" aria-label={label} bind:this={root}>
  <div class="workbench-layout" class:inspecting={selected !== null}>
    <div class="workbench-queue" bind:this={queuePane} tabindex="-1" aria-label={`${label} queue`}>
      {@render queue()}
    </div>
    <div class="workbench-reading" class:empty={selected === null} data-width={width}>
      {#if selected !== null}
        <header>
          <button class="btn" type="button" onclick={() => void close()} aria-keyshortcuts="Escape">Back to queue</button>
          <h3 bind:this={heading} tabindex="-1">{detailTitle}</h3>
          {#if inspector}<label class="reading-width">Reading layout<select bind:value={width}><option value="balanced">Balanced</option><option value="evidence">Wider evidence</option><option value="stacked">Stacked</option></select></label>{/if}
        </header>
        <div class="workbench-detail">{@render children()}</div>
        {#if inspector}<aside aria-label="Retained evidence inspector">{@render inspector()}</aside>{/if}
      {:else}
        <p>Choose <strong>Inspect</strong> beside an item to read its retained evidence. Checkboxes select items for a separate batch action.</p>
      {/if}
    </div>
  </div>
</section>

<style>
  .workbench { container: workbench / inline-size; min-width: 0; }
  .workbench-layout { display: grid; grid-template-columns: minmax(13rem, 1fr) minmax(0, 2fr); gap: 1.25rem; align-items: start; }
  .workbench-queue, .workbench-reading, .workbench-detail, aside { min-width: 0; overflow-wrap: anywhere; }
  .workbench-queue { max-height: 42rem; overflow: auto; scrollbar-gutter: stable; }
  .workbench-reading { border-inline-start: 1px solid var(--border); padding-inline-start: 1.25rem; }
  .workbench-reading.empty { color: var(--muted); }
  header { display: flex; align-items: start; gap: .75rem; flex-wrap: wrap; margin-bottom: 1rem; grid-column: 1 / -1; }
  header h3 { flex: 1 1 15rem; margin: 0; font-size: var(--text-lg); overflow-wrap: anywhere; }
  header button { min-height: 44px; }
  .reading-width { display: none; }
  aside { margin-top: 1.25rem; border-top: 1px solid var(--border); padding-top: 1rem; }
  @container workbench (min-width: 1100px) {
    .workbench-layout { grid-template-columns: minmax(15rem, 1fr) minmax(0, 3fr); }
    .workbench-reading:has(aside) { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 1.5rem; }
    .workbench-reading[data-width='evidence']:has(aside) { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); }
    .workbench-reading[data-width='stacked']:has(aside) { grid-template-columns: minmax(0, 1fr); }
    .reading-width { display: grid; gap: .25rem; color: var(--muted); font-size: var(--text-xs); }
    .reading-width select { min-height: 44px; }
    aside { margin: 0; padding: 0; border: 0; }
  }
  @container workbench (max-width: 700px) {
    .workbench-layout { display: block; }
    .workbench-layout.inspecting .workbench-queue, .workbench-reading.empty { display: none; }
    .workbench-queue { max-height: none; }
    .workbench-reading { border: 0; padding: 0; }
  }
  @media print { header button, .reading-width { display: none; } .workbench-queue { max-height: none; } }
</style>
