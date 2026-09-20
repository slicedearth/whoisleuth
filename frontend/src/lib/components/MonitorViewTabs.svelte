<script lang="ts">
  import HorizontalNavigation from '$lib/components/HorizontalNavigation.svelte';
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

<div class="view-groups">
    <div class="view-group" role="presentation">
      <HorizontalNavigation label="Monitor views" activeKey={view}>
        {#each group.views as tab}
          <button role="tab" id={`tab-${tab.view}`} aria-selected={view === tab.view} aria-controls="monitor-view-panel" tabindex={view === tab.view ? 0 : -1} class:active={view === tab.view} onpointerenter={() => preloadView(tab.view)} onfocus={() => preloadView(tab.view)} onclick={() => setView(tab.view)} onkeydown={tabKeydown}>{tab.label} <span aria-label={counts[tab.view] === null ? countStates[tab.view] === 'loading' ? 'count loading' : 'count unavailable' : `${counts[tab.view]} saved`}>{counts[tab.view] ?? '—'}</span></button>
        {/each}
      </HorizontalNavigation>
    </div>
</div>

<style>
  .view-groups{margin-bottom:16px}
  .view-group{min-width:0}
  button span{padding:1px 7px;border-radius:99px;background:var(--border);color:var(--text);font-size:var(--text-2xs)}
  @media(max-width:760px){.view-groups{grid-template-columns:minmax(0,1fr)}button{min-height:44px;padding-inline:10px}}
</style>
