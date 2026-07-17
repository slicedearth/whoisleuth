<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import { loadProfiles } from '$lib/brand-profiles';
  import { loadCases } from '$lib/cases';
  import { loadWatchlists } from '$lib/watchlists';
  import { workspaces } from '$lib/workspaces';

  const quickActions = [
    { href: '/lookup', label: 'Run a lookup', detail: 'Inspect a domain, IP address, or ASN across separately attributed sources.' },
    { href: '/discover', label: 'Discover candidates', detail: 'Generate brand-related variants and review bounded discovery evidence.' },
    { href: '/bulk', label: 'Start bulk triage', detail: 'Assess a focused candidate set and compare explainable signals.' },
  ];

  let counts = $state({ cases: 0, openCases: 0, watchlists: 0, profiles: 0 });

  function refreshLocalSummary() {
    const cases = loadCases();
    counts = {
      cases: cases.length,
      openCases: cases.filter((record) => record.status !== 'resolved').length,
      watchlists: Object.keys(loadWatchlists()).length,
      profiles: loadProfiles().length,
    };
  }

  onMount(refreshLocalSummary);
</script>

<svelte:head>
  <title>Dashboard · WHOISleuth</title>
  <meta name="description" content="Start or continue a WHOISleuth domain investigation from the protected console dashboard.">
</svelte:head>

<PageHeading eyebrow="Console" title="Investigation dashboard" description="Start a focused task or continue work retained in this browser.">
  <a class="btn" href="/">View public homepage</a>
</PageHeading>

<section class="dashboard-section" aria-labelledby="quick-actions-title">
  <div class="section-intro">
    <p class="eyebrow">Start here</p>
    <h2 id="quick-actions-title">Quick actions</h2>
  </div>
  <div class="quick-grid">
    {#each quickActions as action,index}
      <a class="quick-card card" href={action.href}>
        <span aria-hidden="true">0{index + 1}</span>
        <h3>{action.label}</h3>
        <p>{action.detail}</p>
        <strong>Open <span aria-hidden="true">→</span></strong>
      </a>
    {/each}
  </div>
</section>

<section class="dashboard-section" aria-labelledby="local-summary-title">
  <div class="section-intro">
    <p class="eyebrow">Current browser</p>
    <h2 id="local-summary-title">Browser-local workspace summary</h2>
    <p>Counts are derived from bounded local stores and are not sent to the server.</p>
  </div>
  <div class="local-grid">
    <a class="summary-card card" href="/monitor">
      <span>Open cases</span><strong>{counts.openCases}</strong><p>{counts.cases} total saved case{counts.cases === 1 ? '' : 's'}</p>
    </a>
    <a class="summary-card card" href="/monitor">
      <span>Watchlists</span><strong>{counts.watchlists}</strong><p>Saved change-tracking workspace{counts.watchlists === 1 ? '' : 's'}</p>
    </a>
    <a class="summary-card card" href="/brands">
      <span>Brand profiles</span><strong>{counts.profiles}</strong><p>Saved analysis profile{counts.profiles === 1 ? '' : 's'}</p>
    </a>
  </div>
</section>

<section class="dashboard-section" aria-labelledby="workspaces-title">
  <div class="section-intro">
    <p class="eyebrow">Console map</p>
    <h2 id="workspaces-title">Investigation workspaces</h2>
  </div>
  <div class="workspace-grid">
    {#each workspaces as item,index}
      <a class="workspace-card card" href={item.href}>
        <span aria-hidden="true">0{index + 1}</span>
        <div><h3>{item.label}</h3><p>{item.detail}.</p></div>
        <strong aria-hidden="true">→</strong>
      </a>
    {/each}
  </div>
</section>

<style>
  .dashboard-section{margin-top:34px}
  .section-intro{max-width:760px;margin-bottom:14px}
  .section-intro h2{margin:3px 0 0;font:700 1.15rem var(--mono)}
  .section-intro>p:not(.eyebrow){margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  .quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  .quick-card{display:flex;min-height:210px;flex-direction:column;padding:20px}
  .quick-card>span,.workspace-card>span{color:var(--accent2);font:700 var(--text-2xs) var(--mono)}
  .quick-card h3{margin:22px 0 8px;font:700 var(--text-lg) var(--mono)}
  .quick-card p{margin:0;color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  .quick-card strong{margin-top:auto;padding-top:24px;color:var(--accent);font:700 var(--text-xs) var(--mono)}
  .local-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .summary-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 16px;align-items:start;padding:17px 18px}
  .summary-card>span{color:var(--muted);font:700 var(--text-2xs) var(--mono);letter-spacing:.06em;text-transform:uppercase}
  .summary-card>strong{grid-row:1 / span 2;grid-column:2;color:var(--accent2);font:750 1.7rem var(--mono)}
  .summary-card>p{margin:0;color:var(--text);font-size:var(--text-xs);line-height:1.45}
  .workspace-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .workspace-card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:13px;align-items:center;padding:15px 17px}
  .workspace-card h3{margin:0;font:700 var(--text-md) var(--mono)}
  .workspace-card p{margin:4px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .workspace-card>strong{color:var(--accent);font:700 var(--text-lg) var(--mono)}
  @media(max-width:760px){.quick-grid,.local-grid,.workspace-grid{grid-template-columns:1fr}.quick-card{min-height:180px}}
</style>
