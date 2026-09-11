<script lang="ts">
  import { tick } from 'svelte';
  import { monitorViewNavigation } from '$lib/workspaces';
  type View = 'inbox' | 'timeline' | 'watchlists' | 'cases' | 'campaigns' | 'relationships' | 'rules' | 'certificates';
  type Counts = Record<View, number | null>;
  type CountStates = Record<View, 'loading' | 'ready' | 'unavailable'>;


  let {
    view,
    counts,
    countStates,
    preloadView,
    setView,
  }: {
    view: View;
    counts: Counts;
    countStates: CountStates;
    preloadView: (view: View) => void;
    setView: (view: View) => void;
  } = $props();
  const group = $derived(monitorViewNavigation.find(group => group.views.some(tab => tab.view === view)) ?? monitorViewNavigation[0]);
  const tabs = $derived(group.views);

  let navigation = $state<HTMLDivElement>();

  function keepSelectedVisible() {
    const selected = navigation?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    const row = selected?.parentElement;
    if (!selected || !row || !selected.isConnected || row.scrollWidth <= row.clientWidth) return;
    const target = selected.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    if (target.left < bounds.left + 4) row.scrollLeft += target.left - bounds.left - 4;
    else if (target.right > bounds.right - 4) row.scrollLeft += target.right - bounds.right + 4;
  }

  $effect(() => {
    const selectedView = view;
    void tick().then(() => { if (view === selectedView) keepSelectedVisible(); });
  });

  $effect(() => {
    group;
    const element = navigation;
    let current = true;
    let observer: ResizeObserver | null = null;
    void tick().then(() => {
      if (!current || !element) return;
      observer = new ResizeObserver(keepSelectedVisible);
      observer.observe(element);
      for (const button of element.querySelectorAll('button')) observer.observe(button);
      keepSelectedVisible();
    });
    return () => { current = false; observer?.disconnect(); };
  });

  function tabKeydown(event: KeyboardEvent) {
    const current = tabs.findIndex((tab) => event.currentTarget === document.getElementById(`tab-${tab.view}`));
    let index = -1;
    if (event.key === 'ArrowRight') index = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') index = (current + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    const next = tabs[index];
    if (!next) return;
    event.preventDefault();
    setView(next.view);
    const tablist = (event.currentTarget as HTMLButtonElement).closest('[role="tablist"]');
    requestAnimationFrame(() => tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus());
  }

</script>

<div class="view-groups" role="tablist" aria-label="Monitor views" bind:this={navigation}>
    <div class="view-group" role="presentation">
      <div class="views workspace-view-nav" role="presentation">
        {#each group.views as tab}
          <button role="tab" id={`tab-${tab.view}`} aria-selected={view === tab.view} aria-controls="monitor-view-panel" tabindex={view === tab.view ? 0 : -1} class:active={view === tab.view} onpointerenter={() => preloadView(tab.view)} onfocus={() => preloadView(tab.view)} onclick={() => setView(tab.view)} onkeydown={tabKeydown}>{tab.label} <span aria-label={counts[tab.view] === null ? countStates[tab.view] === 'loading' ? 'count loading' : 'count unavailable' : `${counts[tab.view]} saved`}>{counts[tab.view] ?? '—'}</span></button>
        {/each}
      </div>
    </div>
</div>

<style>
  .view-groups{margin-bottom:16px}
  .view-group{min-width:0}
  .views{margin:0}
  .views button span{padding:1px 7px;border-radius:99px;background:var(--border);color:var(--text);font-size:var(--text-2xs)}
  @media(max-width:760px){.view-groups{grid-template-columns:minmax(0,1fr)}.views{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:thin;padding:4px}.views button{flex:none;min-height:44px;padding-inline:10px}}
</style>
