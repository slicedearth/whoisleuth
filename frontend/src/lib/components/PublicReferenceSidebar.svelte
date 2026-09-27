<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { handlesLocalLink } from '$lib/link-activation';
  import DocumentationSearch from '$lib/components/DocumentationSearch.svelte';
  import { revealDocumentationTarget } from '$lib/documentation-anchors';
  import {
    PUBLIC_REFERENCE_GROUPS,
    publicReferenceDestination,
  } from '$lib/public-reference-navigation';
  let {
    currentPath,
    currentTitle,
    currentSections = [],
  }: {
    currentPath: string;
    currentTitle: string;
    currentSections?: readonly Readonly<{ href: string; label: string }>[];
  } = $props();
  const currentLabel = $derived(publicReferenceDestination(currentPath)?.label ?? currentTitle);
  let activeSectionHref = $state('');
  let navigator: HTMLDialogElement;
  let sidebar: HTMLElement;
  let navigatorOpen = $state(false);

  async function openNavigator(trigger: HTMLButtonElement) {
    // Pointer activation does not focus buttons in every browser. The native
    // dialog restores this focus when it closes without following a link.
    trigger.focus({ preventScroll: true });
    navigatorOpen = true;
    await tick();
    navigator.showModal();
  }

  function followLink(event: MouseEvent, href: string) {
    if (!handlesLocalLink(event)) return;
    navigator.close();
    if (!href.startsWith('#')) return;
    const target = document.getElementById(href.slice(1));
    if (!target) return;
    revealDocumentationTarget(target);
    // Let the anchor own scrolling; move keyboard focus out of the closed dialog.
    const focusTarget = target;
    const previous = focusTarget.getAttribute('tabindex');
    focusTarget.setAttribute('tabindex', '-1');
    focusTarget.focus({ preventScroll: true });
    focusTarget.addEventListener('blur', () => {
      if (previous === null) focusTarget.removeAttribute('tabindex');
      else focusTarget.setAttribute('tabindex', previous);
    }, { once: true });
  }

  function updateActiveSection() {
    const anchorOffset = Number.parseFloat(getComputedStyle(sidebar).getPropertyValue('--reference-anchor-offset')) || 0;
    let next = currentSections[0]?.href ?? '';
    for (const item of currentSections) {
      const target = document.getElementById(item.href.slice(1));
      if (target && target.getBoundingClientRect().top <= anchorOffset + 8) next = item.href;
    }
    if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
      next = currentSections.at(-1)?.href ?? next;
    }
    activeSectionHref = next;
  }

  onMount(() => {
    let frame = 0;
    const scheduleUpdate = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateActiveSection();
      });
    };
    scheduleUpdate();
    addEventListener('scroll', scheduleUpdate, { passive: true });
    addEventListener('resize', scheduleUpdate);
    addEventListener('hashchange', scheduleUpdate);
    const desktop = matchMedia('(min-width: 1081px)');
    const closeOnDesktop = () => { if (desktop.matches) navigator.close(); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      removeEventListener('scroll', scheduleUpdate);
      removeEventListener('resize', scheduleUpdate);
      removeEventListener('hashchange', scheduleUpdate);
      desktop.removeEventListener('change', closeOnDesktop);
      navigator.close();
    };
  });

  $effect(() => {
    currentPath;
    currentSections;
    activeSectionHref = currentSections[0]?.href ?? '';
    if (typeof window === 'undefined') return;
    const frame = requestAnimationFrame(updateActiveSection);
    return () => cancelAnimationFrame(frame);
  });
</script>

{#snippet pages(mobile = false)}
  <nav class="reference-tree" aria-label="Documentation">
    {#each PUBLIC_REFERENCE_GROUPS as group}
      <section class="reference-group">
        <h2>{group.label}</h2>
        <ul>
        {#each group.items as item}
          <li class:current-page={item.href === currentPath}>
            <a class="page-link" aria-current={item.href === currentPath ? 'page' : undefined} href={item.href} onclick={mobile ? (event) => followLink(event, item.href) : undefined}>{item.label}</a>
            {#if item.href === currentPath && currentSections.length}
              <nav class="page-sections" aria-label={`${currentLabel} sections`}>
                <p>On this page</p>
                <ul>
                  {#each currentSections as section}
                    <li><a aria-current={section.href === activeSectionHref ? 'location' : undefined} href={section.href} onclick={mobile ? (event) => followLink(event, section.href) : undefined}>{section.label}</a></li>
                  {/each}
                </ul>
              </nav>
            {/if}
          </li>
        {/each}
        </ul>
      </section>
    {/each}
  </nav>
{/snippet}

<aside class="reference-sidebar" bind:this={sidebar}>
  <div class="reference-search"><DocumentationSearch /></div>
  <div class="desktop-navigation">
    {@render pages()}
  </div>
  <div class="reference-browser">
    <button type="button" aria-label="Browse documentation" aria-haspopup="dialog" aria-expanded={navigatorOpen} onclick={(event) => openNavigator(event.currentTarget)}>Documentation</button>
  </div>
</aside>

<dialog class="reference-navigator" bind:this={navigator} aria-labelledby="reference-navigator-title" onclose={() => navigatorOpen = false}>
  <header><h2 id="reference-navigator-title">Documentation</h2><button type="button" onclick={() => navigator.close()}>Close</button></header>
  {#if navigatorOpen}{@render pages(true)}{/if}
</dialog>

<style>
  .reference-sidebar{position:sticky;top:18px;min-width:0;max-height:calc(100dvh - 36px);overflow-y:auto;scrollbar-width:thin;padding-right:18px;border-right:1px solid var(--border)}
  .reference-search{position:sticky;top:0;z-index:1;padding-bottom:16px;background:var(--reading-surface,var(--bg))}
  .reference-group+.reference-group{margin-top:24px}
  .reference-group h2{margin:0 10px 8px;color:var(--text);font:700 var(--text-sm)/1.4 var(--font-sans)}
  ul{margin:0;padding:0;list-style:none}
  .page-link{display:block;padding:9px 10px;border-radius:var(--radius-sm);color:var(--muted);font:500 var(--text-sm)/1.45 var(--font-sans);overflow-wrap:anywhere}
  .page-link:hover,.page-link:focus-visible{color:var(--text);background:var(--control-hover)}
  .page-link[aria-current='page']{color:var(--accent);background:rgb(var(--accent-rgb) / .08);font-weight:700}
  .page-sections{margin:8px 0 14px 18px;padding-left:12px;border-left:1px solid var(--border-strong)}
  .page-sections p{margin:0;padding:4px 8px;color:var(--muted);font:600 var(--text-2xs)/1.5 var(--font-sans)}
  .page-sections a{display:flex;min-height:32px;align-items:center;padding:6px 8px;color:var(--muted);font:400 var(--text-xs)/1.45 var(--font-sans);overflow-wrap:anywhere}
  .page-sections a:hover,.page-sections a:focus-visible{color:var(--text);text-decoration:underline;text-underline-offset:3px}
  .page-sections a[aria-current='location']{color:var(--accent);font-weight:650}
  .reference-browser{display:none}
  .reference-navigator{width:min(420px,calc(100vw - 24px));max-height:calc(100dvh - 32px);padding:0 20px 20px;border:1px solid var(--border-strong);border-radius:var(--radius-md);background:var(--bg);color:var(--text);overscroll-behavior:contain}
  .reference-navigator::backdrop{background:rgb(0 0 0 / .55)}
  :global(body:has(.reference-navigator[open])){overflow:hidden}
  .reference-navigator header{display:flex;position:sticky;top:0;z-index:1;gap:16px;align-items:center;justify-content:space-between;padding:16px 0;margin-bottom:16px;border-bottom:1px solid var(--border);background:var(--bg)}
  .reference-navigator header h2{margin:0;color:var(--text);font:700 var(--text-md)/1.4 var(--font-sans);letter-spacing:normal;text-transform:none;overflow-wrap:anywhere}
  .reference-navigator button{flex:none;min-height:44px;padding:8px 12px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font:600 var(--text-sm) var(--font-sans)}
  .reference-navigator .page-sections a,.reference-navigator .page-link{min-height:44px}
  @media(max-width:1080px){
    .reference-sidebar{display:flex;align-items:center;justify-content:space-between;gap:12px;top:0;z-index:20;max-height:none;overflow:visible;margin-bottom:22px;padding:8px 0;background:var(--reading-surface,var(--bg));border:0;border-bottom:1px solid var(--border)}
    .reference-search{position:static;padding:0;order:2}
    .desktop-navigation{display:none}
    .reference-browser{display:block}
    .reference-browser button{min-height:44px;padding:10px 12px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font:600 var(--text-sm)/1.4 var(--font-sans);text-align:left}
    .reference-browser button:hover,.reference-browser button:focus-visible{color:var(--accent);border-color:var(--accent)}
  }
</style>
