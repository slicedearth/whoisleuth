<script lang="ts">
  import { onDestroy, type Component } from 'svelte';
  import {
    DEFERRED_MODULE_RECOVERY_DETAIL,
    loadDeferredModule,
    reloadDeferredModulePage,
  } from '$lib/deferred-module';

  let { query }: { query: string } = $props();
  let open = $state(false);
  let activated = $state(false);
  let opening = $state(false);
  let loadError = $state('');
  let ResultsView = $state<Component<{ query: string }> | null>(null);
  let active = true;
  let generation = 0;
  const moduleController = new AbortController();
  const canOpen = $derived(query.trim().length > 0);

  async function togglePreview(): Promise<void> {
    if (open) {
      open = false;
      return;
    }
    if (!canOpen) return;
    open = true;
    activated = true;
    if (loadError) return;
    if (ResultsView || opening) return;
    const request = ++generation;
    opening = true;
    loadError = '';
    try {
      const module = await loadDeferredModule(
        () => import('$lib/components/LookupSavedContextResults.svelte'),
        { signal: moduleController.signal },
      );
      if (!active || request !== generation) return;
      ResultsView = module.default;
    } catch {
      if (!active || request !== generation) return;
      loadError = 'Saved context could not be opened. Reload the page and try again.';
    } finally {
      if (active && request === generation) opening = false;
    }
  }

  onDestroy(() => {
    active = false;
    generation += 1;
    moduleController.abort();
  });
</script>

<section class="saved-context" aria-labelledby="saved-context-title">
  <h2 id="saved-context-title">Saved context</h2>
  <button
    class="btn"
    type="button"
    aria-expanded={open}
    aria-controls="lookup-saved-context-results"
    disabled={!open && !canOpen}
    onclick={() => void togglePreview()}
  >{open ? 'Close saved context' : 'Open saved context'}</button>

  <div id="lookup-saved-context-results" class="preview-results" hidden={!open}>
    <p class="query-note">Matching Cases, campaigns, Brand Profiles and relationships already saved in this workspace. No collection request is made.</p>
    {#if activated}
      {#if opening}
        <p class="state" role="status">Opening the bounded saved-context preview…</p>
      {:else if loadError}
        <div class="state unavailable" role="alert"><p>{loadError}</p><small>{DEFERRED_MODULE_RECOVERY_DETAIL}</small><button class="btn" type="button" onclick={reloadDeferredModulePage}>Reload page</button></div>
      {:else if ResultsView}
        <ResultsView {query} />
      {/if}
    {/if}
  </div>
</section>

<style>
  .saved-context{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;align-items:center;margin-top:12px;padding-block:8px;border-bottom:1px solid var(--border);min-width:0}
  h2{margin:0;font:650 var(--text-sm) var(--font-sans)}
  .query-note,.state{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .preview-results{grid-column:1/-1;min-width:0}
  .preview-results[hidden]{display:none}
  .query-note{margin-bottom:12px}
  .state{padding:9px;border-left:2px solid var(--accent);background:var(--panel-raised)}
  .unavailable{border-color:var(--muted);border-left-style:dotted}
  .unavailable p,.unavailable small{display:block;margin:0;overflow-wrap:anywhere}.unavailable small{margin-top:3px}.unavailable button{margin-top:9px}
  @media(max-width:340px){.saved-context{grid-template-columns:minmax(0,1fr)}.saved-context>button{justify-self:start}}
</style>
