<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { handlesLocalLink } from '$lib/link-activation';
  import { loadDeferredModule, DEFERRED_MODULE_RECOVERY_DETAIL, reloadDeferredModulePage } from '$lib/deferred-module';
  import type { DocumentationResult } from '$lib/documentation-search';

  let { initialQuery = '', onopen }: { initialQuery?: string; onopen: (href: string) => void | Promise<void> } = $props();
  const id = $props.id();
  let input: HTMLInputElement;
  let resultsList: HTMLUListElement;
  let query = $state('');
  let loading = $state(true);
  let failed = $state(false);
  let search = $state<((query: string) => DocumentationResult[]) | null>(null);
  const results = $derived(search?.(query) ?? []);

  onMount(() => {
    query = initialQuery.slice(0, 256);
    const controller = new AbortController();
    void tick().then(() => { if (!controller.signal.aborted) input.focus(); });
    void loadDeferredModule(() => import('$lib/documentation-search'), { signal: controller.signal }).then(module => {
      if (!controller.signal.aborted) search = module.createDocumentationSearch();
    }).catch(() => { if (!controller.signal.aborted) failed = true; })
      .finally(() => { if (!controller.signal.aborted) loading = false; });
    return () => controller.abort();
  });

  function moveFocus(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const links = [...resultsList.querySelectorAll<HTMLAnchorElement>('a')];
    if (!links.length) return;
    const current = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
    event.preventDefault();
    if (next < 0) input.focus();
    else links[Math.min(next, links.length - 1)]?.focus();
  }
</script>

<div class="documentation-search-content" role="group" aria-label="Documentation search">
  <form onsubmit={event => { event.preventDefault(); resultsList.querySelector<HTMLAnchorElement>('a')?.click(); }}>
    <label for={`${id}-query`}>Command, task or term</label>
    <input id={`${id}-query`} bind:this={input} type="search" bind:value={query} onkeydown={moveFocus} maxlength="256" autocomplete="off" placeholder="Try DKIM or verify-artifact">
  </form>
  <p class="search-status" role="status">{loading ? 'Loading documentation index…' : failed ? 'Search is unavailable.' : !query.trim() ? 'Search the public guides, commands and glossary.' : results.length ? `${results.length} matching destination${results.length === 1 ? '' : 's'}.` : 'No matching documentation. Try a shorter term.'}</p>
  {#if failed}<p>{DEFERRED_MODULE_RECOVERY_DETAIL}</p><button class="btn" type="button" onclick={reloadDeferredModulePage}>Reload page</button>{/if}
  <ul bind:this={resultsList}>{#each results as result (result.href)}<li><a href={result.href} onkeydown={moveFocus} onclick={event => { if (handlesLocalLink(event)) { event.preventDefault(); void onopen(result.href); } }}><small>{result.category}</small><strong>{result.title}</strong><span>{result.description}</span></a></li>{/each}</ul>
</div>

<style>
  .documentation-search-content{min-width:0}form{display:grid;gap:8px}label{font-size:var(--text-sm)}input{min-height:48px;width:100%;padding:12px}
  .search-status{color:var(--muted);font-size:var(--text-sm);line-height:1.5}ul{margin:0;padding:0;list-style:none}li+li{border-top:1px solid var(--border)}
  a{display:grid;gap:6px;padding:14px 8px;border-radius:var(--radius-sm);overflow-wrap:anywhere}a:hover,a:focus-visible{background:var(--control-hover)}
  small{color:var(--muted)}strong{color:var(--accent);font-family:var(--font-sans)}span{color:var(--muted);font-size:var(--text-sm);line-height:1.5}
</style>
