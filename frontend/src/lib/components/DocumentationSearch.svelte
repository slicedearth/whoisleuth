<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { handlesLocalLink } from '$lib/link-activation';
  import { loadDeferredModule, DEFERRED_MODULE_RECOVERY_DETAIL, reloadDeferredModulePage } from '$lib/deferred-module';
  import type { DocumentationResult } from '$lib/documentation-search';

  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;
  let resultsList: HTMLUListElement;
  let opened = $state(false);
  let query = $state('');
  let loading = $state(false);
  let failed = $state(false);
  let search = $state<((query: string) => DocumentationResult[]) | null>(null);
  const controller = new AbortController();
  const results = $derived(search?.(query) ?? []);

  async function open(trigger: HTMLButtonElement) {
    trigger.focus({ preventScroll: true });
    opened = true;
    dialog.showModal();
    await tick();
    input.focus();
    if (search || loading || failed) return;
    loading = true;
    try {
      const module = await loadDeferredModule(() => import('$lib/documentation-search'), { signal: controller.signal });
      if (!controller.signal.aborted) search = module.createDocumentationSearch();
    } catch {
      if (!controller.signal.aborted) failed = true;
    } finally { loading = false; }
  }

  function moveFocus(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); dialog.close(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const links = [...resultsList.querySelectorAll<HTMLAnchorElement>('a')];
    if (!links.length) return;
    const current = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
    event.preventDefault();
    if (next < 0) input.focus();
    else links[Math.min(next, links.length - 1)]?.focus();
  }

  onDestroy(() => { controller.abort(); dialog?.close(); });
</script>

<button class="search-trigger" type="button" aria-label="Search documentation" aria-haspopup="dialog" aria-expanded={opened} onclick={event => void open(event.currentTarget)}><span class="desktop-label">Search documentation</span><span class="mobile-label">Search</span></button>
<dialog class="documentation-search" bind:this={dialog} aria-labelledby="documentation-search-title" onclose={() => { opened = false; query = ''; }} onkeydown={moveFocus}>
  <header><h2 id="documentation-search-title">Search documentation</h2><button class="btn" type="button" onclick={() => dialog.close()}>Close</button></header>
  <form onsubmit={event => { event.preventDefault(); resultsList.querySelector<HTMLAnchorElement>('a')?.click(); }}>
    <label for="documentation-query">Command, task or term</label>
    <input id="documentation-query" bind:this={input} type="search" bind:value={query} maxlength="256" autocomplete="off" placeholder="Try DKIM or verify-artifact">
  </form>
  <p class="search-status" role="status">{loading ? 'Loading documentation index…' : failed ? 'Search is unavailable.' : !query.trim() ? 'Search the public guides, commands and glossary.' : results.length ? `${results.length} matching destination${results.length === 1 ? '' : 's'}.` : 'No matching documentation. Try a shorter term.'}</p>
  {#if failed}<p>{DEFERRED_MODULE_RECOVERY_DETAIL}</p><button class="btn" type="button" onclick={reloadDeferredModulePage}>Reload page</button>{/if}
  <ul bind:this={resultsList}>{#each results as result (result.href)}<li><a href={result.href} onclick={event => { if (handlesLocalLink(event)) dialog.close(); }}><small>{result.category}</small><strong>{result.title}</strong><span>{result.description}</span></a></li>{/each}</ul>
</dialog>

<style>
  .search-trigger { min-height: 44px; width: 100%; padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); text-align: left; font: 600 var(--text-xs)/1.4 var(--font-sans); }
  .mobile-label { display: none; }.search-trigger span { color: inherit; font: inherit; }
  .documentation-search { width: min(720px,calc(100vw - 24px)); max-height: calc(100dvh - 32px); padding: 20px; border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--bg); color: var(--text); }
  .documentation-search::backdrop { background: rgb(0 0 0 / .6); }
  :global(body:has(.documentation-search[open])) { overflow: hidden; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 20px; }
  h2 { margin: 0; font: 700 var(--text-lg)/1.3 var(--font-sans); } header button { min-height: 44px; }
  form { display: grid; gap: 8px; } label { font-size: var(--text-sm); } input { min-height: 48px; width: 100%; padding: 12px; }
  .search-status { color: var(--muted); font-size: var(--text-sm); line-height: 1.5; }
  ul { margin: 0; padding: 0; list-style: none; } li+li { border-top: 1px solid var(--border); }
  a { display: grid; gap: 6px; padding: 14px 8px; border-radius: var(--radius-sm); overflow-wrap: anywhere; } a:hover,a:focus-visible { background: var(--control-hover); }
  small { color: var(--muted); } strong { color: var(--accent); font-family: var(--font-sans); } span { color: var(--muted); font-size: var(--text-sm); line-height: 1.5; }
  @media(max-width:1080px) { .search-trigger { width: auto; max-width: 100%; padding-inline: 8px; font-size: var(--text-xs); }.desktop-label{display:none}.mobile-label{display:inline} }
</style>
