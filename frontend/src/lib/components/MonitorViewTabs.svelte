<script lang="ts">
  type View = 'inbox' | 'timeline' | 'watchlists' | 'cases' | 'campaigns' | 'relationships' | 'rules';
  type Counts = Record<View, number | null>;
  const groups: Array<{
    id: 'respond' | 'assure';
    label: string;
    detail: string;
    tabs: Array<{ view: View; label: string }>;
  }> = [
    {
      id: 'respond',
      label: 'Respond',
      detail: 'Cases, response preparation, campaigns, and follow-up.',
      tabs: [
        { view: 'inbox', label: 'Inbox' },
        { view: 'cases', label: 'Cases' },
        { view: 'campaigns', label: 'Campaigns' },
        { view: 'relationships', label: 'Relationships' },
      ],
    },
    {
      id: 'assure',
      label: 'Assure',
      detail: 'Monitoring history, watchlists, and local control rules.',
      tabs: [
        { view: 'timeline', label: 'Timeline' },
        { view: 'watchlists', label: 'Watchlists' },
        { view: 'rules', label: 'Custom rules' },
      ],
    },
  ];
  const tabs = groups.flatMap((group) => group.tabs);

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

<div class="view-groups" role="tablist" aria-label="Monitor views">
  {#each groups as group}
    <div class="view-group" role="presentation">
      <header role="presentation">
        <strong id={`monitor-${group.id}-views-title`}>{group.label}</strong>
        <small id={`monitor-${group.id}-views-detail`}>{group.detail}</small>
      </header>
      <div class="views" role="presentation">
        {#each group.tabs as tab}
          <button role="tab" id={`tab-${tab.view}`} aria-selected={view === tab.view} aria-controls="monitor-view-panel" aria-describedby={`monitor-${group.id}-views-detail`} tabindex={view === tab.view ? 0 : -1} class:active={view === tab.view} onclick={() => setView(tab.view)} onkeydown={tabKeydown}>{tab.label} <span aria-label={counts[tab.view] === null ? 'count unavailable' : `${counts[tab.view]} saved`}>{counts[tab.view] ?? '—'}</span></button>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .view-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:16px}
  .view-group{min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-md);background:rgb(var(--bg-rgb) / .5)}
  .view-group header{display:grid;gap:2px;padding:2px 5px 8px}
  .view-group header strong{font:700 var(--text-xs) var(--mono)}
  .view-group header small{color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .views{display:flex;flex-wrap:wrap;gap:6px}
  .views button{display:flex;gap:7px;align-items:center;min-height:38px;padding:0 14px;border:1px solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--muted);font:600 var(--text-xs) var(--mono)}
  .views button:hover{color:var(--text)}
  .views button.active{color:var(--interface-accent);border-color:rgb(var(--interface-accent-rgb) / .45);background:rgb(var(--interface-accent-rgb) / .08)}
  .views button span{padding:1px 7px;border-radius:99px;background:var(--border);color:var(--text);font-size:var(--text-2xs)}
  @media(max-width:760px){.view-groups{grid-template-columns:minmax(0,1fr)}.views button{min-height:44px;padding-inline:10px}}
</style>
