<script lang="ts">
  import { onDestroy, type Component } from 'svelte';
  import {
    DEFERRED_MODULE_RECOVERY_DETAIL,
    loadDeferredModule,
    reloadDeferredModulePage,
  } from '$lib/deferred-module';

  let { query } = $props<{ query: string }>();
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

<section class="saved-context card" aria-labelledby="saved-context-title">
  <div>
    <p class="eyebrow">Optional local context</p>
    <h2 id="saved-context-title">Preview saved context for this target</h2>
    <p>Open a bounded preview of matching cases, campaigns, brand profiles, and retained relationships already saved in this browser. This does not start a check.</p>
  </div>
  <button
    class="btn"
    type="button"
    aria-expanded={open}
    aria-controls="lookup-saved-context-results"
    disabled={!open && !canOpen}
    onclick={() => void togglePreview()}
  >{open ? 'Close saved context' : 'Open saved context'}</button>

  {#if !canOpen}<p class="query-note">Enter a target above before opening saved context.</p>{/if}
  <div id="lookup-saved-context-results" class="preview-results" hidden={!open}>
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
  .saved-context{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:start;margin-top:18px;padding:var(--card-pad);min-width:0}
  h2{margin:4px 0 6px;font:700 var(--text-lg) var(--mono)}
  .saved-context>div>p:not(.eyebrow),.query-note,.state{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .saved-context>button{align-self:center}
  .query-note,.preview-results{grid-column:1/-1}
  .query-note{margin-top:-6px}
  .state{padding:9px;border-left:2px solid var(--accent);background:var(--panel-raised)}
  .unavailable{border-color:var(--muted);border-left-style:dotted}
  .unavailable p,.unavailable small{display:block;margin:0;overflow-wrap:anywhere}.unavailable small{margin-top:3px}.unavailable button{margin-top:9px}
  @media(max-width:560px){.saved-context{grid-template-columns:minmax(0,1fr)}.saved-context>button{width:100%}.query-note,.preview-results{grid-column:1}}
</style>
