<script lang="ts">
  import { goto } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import DocumentationSearchContent from './DocumentationSearchContent.svelte';

  let { initialQuery = '', label = 'Search documentation' }: { initialQuery?: string; label?: string } = $props();
  const id = $props.id();
  let dialog: HTMLDialogElement;
  let opened = $state(false);

  function open(trigger: HTMLButtonElement) {
    trigger.focus({ preventScroll: true });
    opened = true;
    dialog.showModal();
  }
  async function navigate(href: string) { dialog.close(); await goto(href); }
  onDestroy(() => dialog?.close());
</script>

<button class="search-trigger" type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={opened} onclick={event => open(event.currentTarget)}><span class="desktop-label">{label}</span><span class="mobile-label">{label === 'Search documentation' ? 'Search' : label}</span></button>
<dialog class="documentation-search" bind:this={dialog} aria-labelledby={`${id}-title`} onclose={() => { opened = false; }} onkeydown={event => {
  // Search inputs consume Escape to clear their value before the dialog's
  // default cancellation. The containing interaction owns closing instead.
  if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
}}>
  <header><h2 id={`${id}-title`}>{label}</h2><button class="btn" type="button" onclick={() => dialog.close()}>Close</button></header>
  {#if opened}<DocumentationSearchContent {initialQuery} onopen={navigate} />{/if}
</dialog>

<style>
  .search-trigger{min-height:44px;width:100%;padding:10px 12px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);text-align:left;font:600 var(--text-xs)/1.4 var(--font-sans)}
  .mobile-label{display:none}.search-trigger span{color:inherit;font:inherit}
  .documentation-search{width:min(720px,calc(100vw - 24px));max-height:calc(100dvh - 32px);padding:20px;border:1px solid var(--border-strong);border-radius:var(--radius-md);background:var(--bg);color:var(--text)}
  .documentation-search::backdrop{background:rgb(0 0 0 / .6)}:global(body:has(.documentation-search[open])){overflow:hidden}
  header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px}h2{margin:0;font:700 var(--text-lg)/1.3 var(--font-sans)}header button{min-height:44px}
  @media(max-width:1080px){.search-trigger{width:auto;max-width:100%;padding-inline:8px;font-size:var(--text-xs)}.desktop-label{display:none}.mobile-label{display:inline}}
</style>
