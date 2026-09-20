<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';

  let { label, activeKey, children }: { label: string; activeKey: string; children: Snippet } = $props();
  let viewport: HTMLDivElement;
  let content: HTMLDivElement;
  let overflow = $state(false);
  let hiddenLeft = $state(false);
  let hiddenRight = $state(false);

  function measure() {
    if (!viewport || !content) return;
    const bounds = viewport.getBoundingClientRect();
    const items = content.getBoundingClientRect();
    overflow = viewport.clientWidth > 0 && content.scrollWidth > viewport.clientWidth + 1;
    // Physical edges work with either sign convention for RTL scrollLeft.
    hiddenLeft = overflow && items.left < bounds.left - 1;
    hiddenRight = overflow && items.right > bounds.right + 1;
  }

  function revealSelection() {
    const selected = content?.querySelector<HTMLElement>('[aria-selected="true"], [aria-current="page"]');
    if (!selected || !viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const target = selected.getBoundingClientRect();
    if (target.left < bounds.left + 4) viewport.scrollLeft += target.left - bounds.left - 4;
    else if (target.right > bounds.right - 4) viewport.scrollLeft += target.right - bounds.right + 4;
    measure();
  }

  $effect(() => {
    activeKey;
    let current = true;
    void tick().then(() => { if (current) revealSelection(); });
    return () => { current = false; };
  });

  onMount(() => {
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };
    const observer = new ResizeObserver(revealSelection);
    observer.observe(viewport);
    observer.observe(content);
    viewport.addEventListener('scroll', schedule, { passive: true });
    revealSelection();
    return () => {
      observer.disconnect();
      viewport.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  });

  function scroll(direction: -1 | 1) {
    viewport.scrollBy({ left: direction * viewport.clientWidth * .8, behavior: 'instant' });
    measure();
  }
</script>

<div class="horizontal-navigation" role="presentation">
  <div class="viewport" bind:this={viewport} role="presentation">
    <div class="items workspace-view-nav" bind:this={content} role="tablist" aria-label={label}>{@render children()}</div>
  </div>
  {#if overflow}
    <div class="scroll-controls" role="group" aria-label={`Scroll ${label}`}>
      <button type="button" aria-label={`Scroll ${label} left`} disabled={!hiddenLeft} onclick={() => scroll(-1)}><span aria-hidden="true">←</span></button>
      <span>More views</span>
      <button type="button" aria-label={`Scroll ${label} right`} disabled={!hiddenRight} onclick={() => scroll(1)}><span aria-hidden="true">→</span></button>
    </div>
  {/if}
</div>

<style>
  .horizontal-navigation{min-width:0}
  .viewport{min-width:0;overflow-x:auto;scrollbar-width:thin;padding:4px}
  .items{width:max-content;min-width:100%;flex-wrap:nowrap;margin:0;border:0}
  .items :global(button){flex:none}
  .scroll-controls{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid var(--border);color:var(--muted);font-size:var(--text-xs)}
  .scroll-controls button{min-width:44px;min-height:32px;padding:4px 12px;border:0;background:transparent;color:var(--text)}
  .scroll-controls button:disabled{color:var(--muted);opacity:.45;cursor:default}
</style>
