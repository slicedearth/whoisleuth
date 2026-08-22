<script lang="ts">
  import { onDestroy, onMount, tick, type Component } from 'svelte';

  type DeferredModule = Readonly<{ default: Component<any> }>;

  let {
    load,
    props = {},
    loadingLabel,
    unavailableLabel,
    retryLabel = 'Try again',
    onready,
  }: {
    load: () => Promise<DeferredModule>;
    props?: Record<string, unknown>;
    loadingLabel: string;
    unavailableLabel: string;
    retryLabel?: string;
    onready?: () => void | Promise<void>;
  } = $props();

  let View = $state<Component<any> | null>(null);
  let loadState = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let showLoadingState = $state(false);
  let resolvedProps = $state.raw<Record<string, unknown>>({});
  let generation = 0;
  let active = true;
  let firstLoadingFrame = 0;
  let secondLoadingFrame = 0;

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
    loadState = 'loading';
    scheduleLoadingState(request);
    try {
      const module = await load();
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
    }
  }

  onMount(() => {
    void open();
  });

  onDestroy(() => {
    active = false;
    generation += 1;
    cancelLoadingState();
  });
</script>

<div class="deferred-surface" data-deferred-state={loadState} aria-busy={loadState === 'loading'}>
  {#if loadState === 'loading' && showLoadingState}
    <p class="deferred-state" role="status" aria-live="polite">{loadingLabel}</p>
  {:else if loadState === 'unavailable'}
    <div class="deferred-state unavailable" role="alert">
      <p>{unavailableLabel}</p>
      <button class="btn" type="button" onclick={() => void open()}>{retryLabel}</button>
    </div>
  {:else if View}
    <View {...resolvedProps} />
  {/if}
</div>

<style>
  .deferred-surface{min-width:0;max-width:100%;overflow-wrap:anywhere}
  .deferred-state{margin:0;padding:12px;border-left:2px solid var(--accent);background:var(--panel-raised);color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .deferred-state.unavailable{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:12px;border-left-color:var(--muted);border-left-style:dotted}
  .deferred-state.unavailable p{min-width:0;margin:0}
  .deferred-state button{flex:0 0 auto}
  @media(max-width:560px){.deferred-state.unavailable{align-items:stretch;flex-direction:column}.deferred-state button{width:100%}}
</style>
