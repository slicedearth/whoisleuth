<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { handlesLocalLink } from '$lib/link-activation';
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
  let mobileView = $state<'pages' | 'contents'>('pages');
  let navigatorOpen = $state(false);

  async function openNavigator(view: 'pages' | 'contents', trigger: HTMLButtonElement) {
    // Pointer activation does not focus buttons in every browser. The native
    // dialog restores this focus when it closes without following a link.
    trigger.focus({ preventScroll: true });
    mobileView = view;
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
    let next = currentSections[0]?.href ?? '';
    for (const item of currentSections) {
      const target = document.getElementById(item.href.slice(1));
      if (target && target.getBoundingClientRect().top <= 56) next = item.href;
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
      <section>
        <h2>{group.label}</h2>
        {#each group.items as item}
          <a class:active={item.href === currentPath} aria-current={item.href === currentPath ? 'page' : undefined} href={item.href} onclick={mobile ? (event) => followLink(event, item.href) : undefined}>{item.label}</a>
        {/each}
      </section>
    {/each}
  </nav>
{/snippet}

{#snippet contents(mobile = false)}
  <nav class="page-sections" aria-label={`${currentLabel} sections`}>
    {#each currentSections as section}
      <a class:active={section.href === activeSectionHref} aria-current={section.href === activeSectionHref ? 'location' : undefined} href={section.href} onclick={mobile ? (event) => followLink(event, section.href) : undefined}>{section.label}</a>
    {/each}
  </nav>
{/snippet}

<aside class="reference-sidebar">
  <div class="desktop-navigation">
    <a class="reference-title" href="/resources">Documentation</a>
    {#if currentSections.length}
      <section class="desktop-contents"><h2>On this page</h2>{@render contents()}</section>
    {/if}
    {@render pages()}
  </div>
  <div class="reference-browser">
    <button type="button" aria-haspopup="dialog" aria-expanded={navigatorOpen && mobileView === 'pages'} onclick={(event) => openNavigator('pages', event.currentTarget)}>Browse documentation</button>
    {#if currentSections.length}<button type="button" aria-haspopup="dialog" aria-expanded={navigatorOpen && mobileView === 'contents'} onclick={(event) => openNavigator('contents', event.currentTarget)}>On this page</button>{/if}
  </div>
</aside>

<dialog class="reference-navigator" bind:this={navigator} aria-labelledby="reference-navigator-title" onclose={() => navigatorOpen = false}>
  <header><h2 id="reference-navigator-title">{mobileView === 'pages' ? 'Documentation' : currentLabel}</h2><button type="button" onclick={() => navigator.close()}>Close</button></header>
  {#if navigatorOpen}
    {#if mobileView === 'pages'}{@render pages(true)}{:else}{@render contents(true)}{/if}
  {/if}
</dialog>

<style>
  .reference-sidebar{position:sticky;top:18px;min-width:0;max-height:calc(100vh - 36px);overflow-y:auto;scrollbar-width:thin}
  .desktop-navigation{padding-right:20px}
  .reference-title{display:block;margin-bottom:24px;padding:0 8px;color:var(--text);font:700 var(--text-sm) var(--font-sans)}
  .reference-tree section+section{margin-top:20px}
  h2{margin:0 8px 7px;color:var(--muted);font:700 var(--text-2xs) var(--mono);letter-spacing:.08em;text-transform:uppercase}
  .reference-tree section>a{display:block;padding:8px;border-radius:var(--radius-sm);color:var(--muted);font:500 var(--text-sm)/1.4 var(--font-sans);overflow-wrap:anywhere}
  .reference-tree section>a:hover,.reference-tree section>a:focus-visible{color:var(--text);background:rgb(var(--accent-rgb) / .07)}
  .reference-tree section>a.active{color:var(--accent);background:rgb(var(--accent-rgb) / .09);box-shadow:inset 2px 0 var(--accent)}
  .desktop-contents{margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid var(--border)}
  .page-sections{display:grid;gap:2px}
  .page-sections a{display:flex;min-height:32px;align-items:center;padding:6px 8px;color:var(--muted);font:500 var(--text-xs)/1.4 var(--font-sans);overflow-wrap:anywhere}
  .page-sections a:hover,.page-sections a:focus-visible,.page-sections a.active{color:var(--accent)}
  .reference-browser{display:none}
  .reference-navigator{width:min(420px,calc(100vw - 24px));max-height:calc(100dvh - 32px);padding:0 20px 20px;border:1px solid var(--border-strong);border-radius:var(--radius-md);background:var(--bg);color:var(--text);overscroll-behavior:contain}
  .reference-navigator::backdrop{background:rgb(0 0 0 / .55)}
  :global(body:has(.reference-navigator[open])){overflow:hidden}
  .reference-navigator header{display:flex;position:sticky;top:0;z-index:1;gap:16px;align-items:center;justify-content:space-between;padding:16px 0;margin-bottom:16px;border-bottom:1px solid var(--border);background:var(--bg)}
  .reference-navigator header h2{margin:0;color:var(--text);font:700 var(--text-md)/1.4 var(--font-sans);letter-spacing:normal;text-transform:none;overflow-wrap:anywhere}
  .reference-navigator button{flex:none;min-height:44px;padding:8px 12px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font:600 var(--text-sm) var(--font-sans)}
  .reference-navigator .page-sections a,.reference-navigator .reference-tree section>a{min-height:44px}
  @media(max-width:1080px){
    .reference-sidebar{top:0;z-index:20;max-height:none;overflow:visible;margin-bottom:22px;background:var(--bg);border-bottom:1px solid var(--border)}
    .desktop-navigation{display:none}
    .reference-browser{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0}
    .reference-browser button{min-height:44px;padding:8px 4px;border:0;border-radius:0;background:transparent;color:var(--text);font:600 var(--text-xs)/1.4 var(--font-sans);text-align:left}
    .reference-browser button:hover,.reference-browser button:focus-visible{color:var(--accent)}
  }
</style>
