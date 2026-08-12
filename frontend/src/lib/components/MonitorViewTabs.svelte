<script lang="ts">
  type View = 'inbox' | 'timeline' | 'watchlists' | 'cases' | 'campaigns' | 'relationships' | 'rules';
  type Counts = Record<View, number | null>;
  const tabs: Array<{ view: View; label: string }> = [
    { view: 'inbox', label: 'Inbox' },
    { view: 'timeline', label: 'Timeline' },
    { view: 'cases', label: 'Cases' },
    { view: 'campaigns', label: 'Campaigns' },
    { view: 'relationships', label: 'Relationships' },
    { view: 'rules', label: 'Custom rules' },
    { view: 'watchlists', label: 'Watchlists' },
  ];

  let {
    view,
    counts,
    setView,
  }: {
    view: View;
    counts: Counts;
    setView: (view: View) => void;
  } = $props();

  function tabKeydown(event: KeyboardEvent) {
    const current = tabs.findIndex((tab) => tab.view === view);
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

<div class="views" role="tablist" aria-label="Monitor views">
  {#each tabs as tab}
    <button role="tab" id={`tab-${tab.view}`} aria-selected={view === tab.view} aria-controls="monitor-view-panel" tabindex={view === tab.view ? 0 : -1} class:active={view === tab.view} onclick={() => setView(tab.view)} onkeydown={tabKeydown}>{tab.label} <span aria-label={counts[tab.view] === null ? 'count unavailable' : `${counts[tab.view]} saved`}>{counts[tab.view] ?? '—'}</span></button>
  {/each}
</div>

<style>
  .views{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;padding:5px;border:1px solid var(--border);border-radius:var(--radius-md);background:rgb(var(--bg-rgb) / .5)}
  .views button{display:flex;gap:7px;align-items:center;min-height:38px;padding:0 14px;border:1px solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--muted);font:600 var(--text-xs) var(--mono)}
  .views button:hover{color:var(--text)}
  .views button.active{color:var(--interface-accent);border-color:rgb(var(--interface-accent-rgb) / .45);background:rgb(var(--interface-accent-rgb) / .08)}
  .views button span{padding:1px 7px;border-radius:99px;background:var(--border);color:var(--text);font-size:var(--text-2xs)}
  @media(max-width:700px){.views button{min-height:44px;padding-inline:10px}}
</style>
