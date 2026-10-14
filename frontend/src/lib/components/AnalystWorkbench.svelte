<script lang="ts">
  import { getContext, onDestroy, tick, type Snippet } from 'svelte';
  import { restoreSubmittedFocus } from '../controllers/submitted-draft.ts';
  import { CONSOLE_PRESENTATION_CONTEXT, type ConsolePresentationContext } from '../appearance.ts';

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
  let root = $state<HTMLElement>(), queuePane = $state<HTMLElement>(), readingPane = $state<HTMLElement>(), heading = $state<HTMLHeadingElement>();
  let previous: string | null = null;
  let origin: HTMLElement | null = null;
  let disposed = false;
  const presentation = getContext<ConsolePresentationContext | undefined>(CONSOLE_PRESENTATION_CONTEXT);
  $effect.pre(() => {
    const current = selected;
    if (current === previous) return;
    const wasSelected = previous !== null;
    previous = current;
    const focused = document.activeElement;
    if (current === null) {
      if (wasSelected && focused instanceof HTMLElement && readingPane?.contains(focused)) {
        const destination = origin;
        void tick().then(() => {
          if (!disposed && selected === null) restoreSubmittedFocus(focused, destination?.isConnected ? destination : queuePane, root);
        });
      }
      return;
    }
    if (!(focused instanceof HTMLElement) || !queuePane?.contains(focused)) return;
    origin = focused;
    void tick().then(() => {
      if (!disposed && selected === current) restoreSubmittedFocus(focused, heading, root);
    });
  });
  onDestroy(() => { disposed = true; origin = null; });
  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented || !selected
      || !(event.target instanceof HTMLElement) || !root?.contains(event.target)
      || event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
    event.preventDefault();
    onclose();
  }
</script>

<svelte:window onkeydown={keydown} />
<section class="workbench" aria-label={label} bind:this={root}>
  <div class="workbench-layout" class:inspecting={selected !== null}>
    <div class="workbench-queue" bind:this={queuePane} tabindex="-1" aria-label={`${label} queue`}>
      {@render queue()}
    </div>
    <div class="workbench-reading" class:empty={selected === null} data-presentation={presentation?.current ?? 'desk'} bind:this={readingPane}>
      {#if selected !== null}
        <header>
          <button class="btn" type="button" onclick={onclose} aria-keyshortcuts="Escape">Back to queue</button>
          <h3 bind:this={heading} tabindex="-1">{detailTitle}</h3>
        </header>
      {:else}
        <p>Choose <strong>Inspect</strong> beside an item to read its retained evidence.</p>
      {/if}
      <div class="workbench-detail" hidden={selected === null}>{@render children()}</div>
      {#if inspector}<aside aria-label="Retained evidence inspector" hidden={selected === null}>{@render inspector()}</aside>{/if}
    </div>
  </div>
</section>

<style>
  .workbench { container: workbench / inline-size; min-width: 0; }
  .workbench-layout { display: grid; grid-template-columns: minmax(13rem, 1fr) minmax(0, 2fr); gap: 1.25rem; align-items: start; }
  .workbench-layout:not(.inspecting) { grid-template-columns: minmax(0, 1fr); }
  .workbench-queue, .workbench-reading, .workbench-detail, aside { min-width: 0; overflow-wrap: anywhere; }
  .workbench-queue { max-height: 42rem; overflow: auto; scrollbar-gutter: stable; }
  .workbench-queue :global(.inspected) { background: var(--panel-raised); box-shadow: inset 3px 0 var(--text); }
  .workbench-queue :global(.inspected .btn[aria-pressed='true']) { color: var(--text); border-color: var(--border-strong); background: var(--panel-raised); }
  .workbench-reading { border-inline-start: 1px solid var(--border); padding-inline-start: 1.25rem; }
  .workbench-reading.empty { color: var(--muted); border: 0; padding: 0; }
  header { display: flex; align-items: start; gap: .75rem; flex-wrap: wrap; margin-bottom: 1rem; grid-column: 1 / -1; }
  header h3 { flex: 1 1 15rem; margin: 0; font-size: var(--text-lg); overflow-wrap: anywhere; }
  header button { min-height: 44px; }
  aside { margin-top: 1.25rem; border-top: 1px solid var(--border); padding-top: 1rem; }
  @container workbench (min-width: 1100px) {
    .workbench-layout { grid-template-columns: minmax(15rem, 1fr) minmax(0, 3fr); }
    .workbench-reading:has(aside) { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 1.5rem; }
    .workbench-reading[data-presentation='bench']:has(aside) { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); }
    .workbench-reading[data-presentation='journal']:has(aside) { grid-template-columns: minmax(0, 1fr); }
    aside { margin: 0; padding: 0; border: 0; }
  }
  @container workbench (max-width: 700px) {
    .workbench-layout { display: block; }
    .workbench-layout.inspecting .workbench-queue, .workbench-reading.empty { display: none; }
    .workbench-queue { max-height: none; }
    .workbench-reading { border: 0; padding: 0; }
  }
  @media print { header button { display: none; } .workbench-queue { max-height: none; } }
  @media (forced-colors: active) { .workbench-queue :global(.inspected) { outline: 1px solid CanvasText; outline-offset: -1px; } }
</style>
