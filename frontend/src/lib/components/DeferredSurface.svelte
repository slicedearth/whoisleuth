<script lang="ts">
  import { onDestroy, onMount, tick, type Component } from 'svelte';
  import {
    DEFERRED_MODULE_RECOVERY_DETAIL,
    loadDeferredModule,
    reloadDeferredModulePage,
  } from '$lib/deferred-module';

  type DeferredModule = Readonly<{ default: Component<any> }>;

  let {
    load,
    props = {},
    loadingLabel,
    unavailableLabel,
    onready,
    placeholder = 'none',
  }: {
    load: () => Promise<DeferredModule>;
    props?: Record<string, unknown>;
    loadingLabel: string;
    unavailableLabel: string;
    onready?: () => void | Promise<void>;
    placeholder?: 'none' | 'panel' | 'workspace';
  } = $props();

  let View = $state<Component<any> | null>(null);
  let loadState = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let showLoadingState = $state(false);
  let resolvedProps = $state.raw<Record<string, unknown>>({});
  let generation = 0;
  let active = true;
  let firstLoadingFrame = 0;
  let secondLoadingFrame = 0;
  let loadController: AbortController | null = null;

  $effect.pre(() => {
    resolvedProps = { ...props };
  });

  function cancelLoadingState(): void {
    if (firstLoadingFrame) cancelAnimationFrame(firstLoadingFrame);
    if (secondLoadingFrame) cancelAnimationFrame(secondLoadingFrame);
    firstLoadingFrame = 0;
    secondLoadingFrame = 0;
    showLoadingState = false;
  }

  function scheduleLoadingState(request: number): void {
    cancelLoadingState();
    firstLoadingFrame = requestAnimationFrame(() => {
      firstLoadingFrame = 0;
      secondLoadingFrame = requestAnimationFrame(() => {
        secondLoadingFrame = 0;
        if (active && request === generation && loadState === 'loading') showLoadingState = true;
      });
    });
  }

  async function open(): Promise<void> {
    const request = ++generation;
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    loadState = 'loading';
    scheduleLoadingState(request);
    try {
      const module = await loadDeferredModule(load, { signal: controller.signal });
      if (!active || request !== generation) return;
      cancelLoadingState();
      View = module.default;
      loadState = 'ready';
      await tick();
      if (active && request === generation) await onready?.();
    } catch {
      if (!active || request !== generation) return;
      cancelLoadingState();
      View = null;
      loadState = 'unavailable';
    } finally {
      if (loadController === controller) loadController = null;
    }
  }

  onMount(() => {
    void open();
  });

  onDestroy(() => {
    active = false;
    generation += 1;
    loadController?.abort();
    loadController = null;
    cancelLoadingState();
  });
</script>

<div
  class="deferred-surface"
  class:reserved={loadState === 'loading' && placeholder !== 'none'}
  class:workspace-placeholder={loadState === 'loading' && placeholder === 'workspace'}
  data-deferred-state={loadState}
  data-deferred-placeholder={loadState === 'loading' ? placeholder : undefined}
  aria-busy={loadState === 'loading'}
>
  {#if loadState === 'loading'}
    {#if placeholder !== 'none'}
      <div class="placeholder-shape" aria-hidden="true"><span></span><span></span><span></span></div>
    {/if}
    {#if showLoadingState}<p class="deferred-state" role="status" aria-live="polite">{loadingLabel}</p>{/if}
  {:else if loadState === 'unavailable'}
    <div class="deferred-state unavailable" role="alert">
      <p>{unavailableLabel}</p>
      <small>{DEFERRED_MODULE_RECOVERY_DETAIL}</small>
      <button class="btn" type="button" data-deferred-recovery="reload" onclick={reloadDeferredModulePage}>Reload page</button>
    </div>
  {:else if View}
    <View {...resolvedProps} />
  {/if}
</div>

<style>
  .deferred-surface{min-width:0;max-width:100%;overflow-wrap:anywhere}
  .deferred-surface.reserved{position:relative;min-block-size:132px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel);overflow:hidden}
  .deferred-surface.reserved.workspace-placeholder{min-block-size:220px}
  .placeholder-shape{display:grid;gap:12px;padding:20px}
  .placeholder-shape span{display:block;width:min(100%,560px);height:12px;border-radius:4px;background:color-mix(in srgb,var(--border) 68%,transparent)}
  .placeholder-shape span:nth-child(2){width:min(72%,420px)}
  .placeholder-shape span:nth-child(3){width:min(44%,260px)}
  .reserved>.deferred-state{position:absolute;right:12px;bottom:12px;left:12px}
  .deferred-state{margin:0;padding:12px;border-left:2px solid var(--accent);background:var(--panel-raised);color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .deferred-state.unavailable{display:grid;min-width:0;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:3px 12px;border-left-color:var(--muted);border-left-style:dotted}
  .deferred-state.unavailable p{min-width:0;margin:0}
  .deferred-state.unavailable small{min-width:0;grid-column:1;color:var(--muted);overflow-wrap:anywhere}
  .deferred-state.unavailable button{grid-column:2;grid-row:1/3}
  .deferred-state button{flex:0 0 auto}
  @media(max-width:560px){.deferred-state.unavailable{grid-template-columns:minmax(0,1fr);align-items:stretch}.deferred-state.unavailable button{width:100%;grid-column:1;grid-row:auto}}
</style>
