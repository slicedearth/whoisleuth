<script lang="ts">
  type View = 'watchlists' | 'cases' | 'campaigns' | 'relationships' | 'rules';
  type Counts = Record<View, number>;
  const tabs: Array<{ view: View; label: string }> = [
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
</script>

<div class="views" role="tablist" aria-label="Monitor views">
  {#each tabs as tab}
    <button role="tab" id={`tab-${tab.view}`} aria-selected={view === tab.view} aria-controls={`panel-${tab.view}`} class:active={view === tab.view} onclick={() => setView(tab.view)}>{tab.label} <span>{counts[tab.view]}</span></button>
  {/each}
</div>

<style>
  .views{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;padding:5px;border:1px solid var(--border);border-radius:var(--radius-md);background:rgb(var(--bg-rgb) / .5)}
  .views button{display:flex;gap:7px;align-items:center;min-height:38px;padding:0 14px;border:1px solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--muted);font:600 var(--text-xs) var(--mono)}
  .views button:hover{color:var(--text)}
  .views button.active{color:var(--accent2);border-color:rgb(var(--accent2-rgb) / .45);background:rgb(var(--accent2-rgb) / .08)}
  .views button span{padding:1px 7px;border-radius:99px;background:var(--border);color:var(--text);font-size:var(--text-2xs)}
</style>
