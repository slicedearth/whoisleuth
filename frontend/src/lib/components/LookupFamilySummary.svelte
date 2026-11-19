<script lang="ts">
  import DisclosureToggleIcon from './DisclosureToggleIcon.svelte';

  let {
    label,
    description,
    metrics = [],
    expanded = false,
    onpreload,
    onshow,
    onhide,
  }: {
    label: string;
    description: string;
    metrics?: readonly string[];
    expanded?: boolean;
    onpreload?: () => void;
    onshow: () => void;
    onhide: () => void;
  } = $props();

  const accessibleLabel = $derived(/evidence$/iu.test(label) ? label : `${label} evidence`);
  const actionLabel = $derived(expanded ? 'Collapse details' : 'Expand details');
  const descriptionId = $props.id();
  let pointerIntentHandled = false;

  function preloadFromPointerMovement(): void {
    if (pointerIntentHandled) return;
    pointerIntentHandled = true;
    onpreload?.();
  }
</script>

<div
  class="family-summary card"
  class:expanded
>
  <span class="family-copy">
    <span class="description" id={descriptionId}>{description}</span>
    {#if metrics.length}
      <span class="metrics">
        {#each metrics as metric}<span class="metric">{metric}</span>{/each}
      </span>
    {/if}
  </span>
  <button class="section-toggle" type="button"
    aria-label={`${actionLabel}: ${accessibleLabel}`} aria-describedby={descriptionId}
    onpointermove={preloadFromPointerMovement}
    onpointerleave={() => pointerIntentHandled = false}
    aria-expanded={expanded} onfocus={onpreload} onclick={expanded ? onhide : onshow}>
    <DisclosureToggleIcon {expanded} />
    {actionLabel}
  </button>
</div>

<style>
  .family-summary{position:relative;display:flex;width:100%;align-items:center;justify-content:space-between;gap:18px;min-width:0;padding:13px 14px;border-left:2px solid var(--section-accent,var(--accent));color:var(--text);font:inherit;text-align:left;cursor:pointer}
  .family-summary:hover{border-color:var(--accent);background:var(--panel-raised)}
  .family-summary:has(.section-toggle:focus-visible){outline:2px solid var(--focus);outline-offset:2px}
  .family-summary.expanded{border-bottom-right-radius:0;border-bottom-left-radius:0;background:var(--panel-raised)}
  .family-copy{display:block;min-width:0}
  .description{display:block;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .metrics{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .metric{padding:4px 7px;border:1px solid var(--border);border-radius:999px;background:var(--panel-raised);color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .section-toggle{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;gap:7px;min-height:28px;padding:0;border:0;background:none;white-space:nowrap;color:var(--text);font:700 var(--text-2xs) var(--mono);cursor:pointer}
  .section-toggle::after{content:"";position:absolute;inset:0;border-radius:inherit}
  .section-toggle:focus-visible{outline:none}
  .family-summary:hover .section-toggle{color:var(--accent)}
  @media(max-width:620px){
    .family-summary{align-items:stretch;flex-direction:column;gap:11px}
    .section-toggle{justify-content:flex-start}
  }
</style>
