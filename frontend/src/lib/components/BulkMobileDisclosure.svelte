<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    description,
    children,
    onopen,
    onpreload,
  }: {
    title: string;
    description: string;
    children: Snippet;
    onopen?: () => void | Promise<void>;
    onpreload?: () => void;
  } = $props();

  let expanded = $state(false);
  function toggle(){
    expanded=!expanded;
    if(expanded)void onopen?.();
  }
</script>

<section class="mobile-disclosure">
  <button
    class="mobile-disclosure-toggle"
    type="button"
    aria-expanded={expanded}
    onpointerenter={onpreload}
    onfocus={onpreload}
    onclick={toggle}
  >
    <span><strong>{title}</strong><small>{description}</small></span>
    <span aria-hidden="true">{expanded ? '−' : '+'}</span>
  </button>
  {#if expanded}<div class="mobile-disclosure-content">{@render children()}</div>{/if}
</section>

<style>
  .mobile-disclosure{display:block;margin-top:10px}
  .mobile-disclosure-toggle{display:flex;width:100%;min-width:0;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised);color:var(--text);text-align:left}
  .mobile-disclosure-toggle span:first-child{display:grid;min-width:0;gap:3px}
  .mobile-disclosure-toggle strong{font:700 var(--text-sm) var(--mono)}
  .mobile-disclosure-toggle small{color:var(--muted);font-size:var(--text-xs);font-weight:400;line-height:1.4}
  .mobile-disclosure-toggle span:last-child{flex:0 0 auto;color:var(--accent);font:700 var(--text-lg) var(--mono)}
  .mobile-disclosure-content{min-width:0}
</style>
