<script lang="ts">
  import { onMount } from 'svelte';

  let {
    items,
    ariaLabel,
    layout = 'rail',
  }: {
    items: readonly Readonly<{ href: string; label: string }>[];
    ariaLabel: string;
    layout?: 'rail' | 'inline';
  } = $props();

  let activeHref = $state('');

  onMount(() => {
    let frame = 0;
    function updateActiveSection() {
      frame = 0;
      const threshold = layout === 'inline' ? 104 : 48;
      let next = items[0]?.href ?? '';
      for (const item of items) {
        const target = document.getElementById(item.href.slice(1));
        if (target && target.getBoundingClientRect().top <= threshold) next = item.href;
      }
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
        next = items.at(-1)?.href ?? next;
      }
      activeHref = next;
    }
    function scheduleUpdate() {
      if (!frame) frame = requestAnimationFrame(updateActiveSection);
    }
    updateActiveSection();
    addEventListener('scroll', scheduleUpdate, { passive: true });
    addEventListener('resize', scheduleUpdate);
    addEventListener('hashchange', scheduleUpdate);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      removeEventListener('scroll', scheduleUpdate);
      removeEventListener('resize', scheduleUpdate);
      removeEventListener('hashchange', scheduleUpdate);
    };
  });
</script>

<aside class="public-section-navigation" class:inline={layout === 'inline'}>
  <nav class="section-navigation" aria-label={ariaLabel}>
    <strong>On this page</strong>
    {#each items as item}<a class:active={activeHref === item.href} aria-current={activeHref === item.href ? 'location' : undefined} href={item.href}>{item.label}</a>{/each}
  </nav>
  <details class="section-navigation-mobile">
    <summary>On this page</summary>
    <nav aria-label={ariaLabel}>{#each items as item}<a class:active={activeHref === item.href} aria-current={activeHref === item.href ? 'location' : undefined} href={item.href}>{item.label}</a>{/each}</nav>
  </details>
</aside>

<style>
  .public-section-navigation{min-width:0}
  .section-navigation{display:grid;position:sticky;top:18px;gap:2px;padding-left:18px;border-left:1px solid var(--border)}
  .section-navigation strong{margin-bottom:7px;color:var(--text);font:700 var(--text-2xs) var(--mono)}
  .section-navigation a{padding:5px 0;color:var(--muted);font:650 var(--text-2xs) var(--mono);line-height:1.4;overflow-wrap:anywhere}
  .section-navigation a:hover,.section-navigation a:focus-visible{color:var(--accent)}
  .section-navigation a.active{color:var(--accent)}
  .section-navigation-mobile{display:none}
  .public-section-navigation.inline{position:sticky;z-index:10;top:8px;margin:0 0 10px}
  .inline .section-navigation{display:flex;position:static;align-items:center;flex-wrap:wrap;gap:3px;padding:7px;border:1px solid var(--border);border-radius:var(--radius-md);background:rgb(var(--bg-rgb) / .94);backdrop-filter:blur(7px)}
  .inline .section-navigation strong{margin:0 7px;color:var(--muted)}
  .inline .section-navigation a{padding:7px 9px;border-radius:var(--radius-sm);white-space:nowrap}
  .inline .section-navigation a:hover,.inline .section-navigation a:focus-visible{background:rgb(var(--accent-rgb) / .07)}
  .inline .section-navigation a.active{background:rgb(var(--accent-rgb) / .1);color:var(--accent)}
  @media(max-width:1040px){
    .public-section-navigation:not(.inline) .section-navigation{display:none}
    .public-section-navigation:not(.inline) .section-navigation-mobile{display:block}
  }
  @media(max-width:760px){
    .public-section-navigation.inline{position:static}
    .section-navigation{display:none!important}
    .section-navigation-mobile{display:block;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
    .section-navigation-mobile summary{padding:12px 14px;font:700 var(--text-xs) var(--mono)}
    .section-navigation-mobile nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 14px;padding:0 14px 12px}
    .section-navigation-mobile a{padding:6px 0;color:var(--muted);font:650 var(--text-2xs) var(--mono);line-height:1.4}
    .section-navigation-mobile a:hover,.section-navigation-mobile a:focus-visible{color:var(--accent)}
    .section-navigation-mobile a.active{color:var(--accent)}
  }
  @media(max-width:520px){.section-navigation-mobile nav{grid-template-columns:1fr}}
</style>
