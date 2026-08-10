<script lang="ts">
  import {
    projectProfileListingBars,
    type ProfileListingBarInput,
  } from '$lib/analysis/visualization-models.ts';
  type CoverageSummary = {
    total: number;
    profileListed: number;
    registered: number;
    available: number;
    unknown: number;
    profileListedShare: number;
  };
  type CoverageGroup = {
    label: string;
    profileListed: number;
    registered: number;
    available: number;
    unknown: number;
    actionableDomains: string[];
  };
  type Coverage = {
    summary: CoverageSummary;
    mutationGroups: CoverageGroup[];
    tldGroups: CoverageGroup[];
    limitation: string;
    plan: Array<{
      domain: string;
      status: string;
      profileListed: boolean;
      priority: 'P1' | 'P2';
      actionLabel: string;
      rationale: string;
    }>;
  };

  let {
    coverage,
    exportCoverage,
    loadDomains,
  }: {
    coverage: Coverage | null;
    exportCoverage: () => void;
    loadDomains: (domains: string[]) => void;
  } = $props();

  function profileListingChart(groups: CoverageGroup[]) {
    return projectProfileListingBars(groups.map((group, index): ProfileListingBarInput => ({
      id: `${group.label}-${index}`,
      label: group.label,
      profileListed: group.profileListed,
      registered: group.registered,
      available: group.available,
      unknown: group.unknown,
    })));
  }

  function statusLabel(status: string): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }
</script>

{#if coverage}
  <section class="coverage card">
    <header class="section-head"><div><p class="eyebrow">Defensive registration profile</p><h2>Profile-listed share · {coverage.summary.profileListedShare}%</h2></div><button class="btn" onclick={exportCoverage}>Export profile listing CSV</button></header>
    <p class="listing-limitation">{coverage.limitation}</p>
    <div class="coverage-summary"><span class="chip">Generated {coverage.summary.total}</span><span class="chip">Registered {coverage.summary.registered}</span><span class="chip">Available {coverage.summary.available}</span><span class="chip">Unknown {coverage.summary.unknown}</span><span class="chip">Profile-listed {coverage.summary.profileListed} · overlaps outcomes</span></div>
    <p class="composition-note">Registered, available, and unknown partition the generated candidates. Profile-listed is shown separately and may overlap any outcome.</p>
    <div class="coverage-tables">
      <div><h3>By mutation</h3>{@render ProfileListingChart(coverage.mutationGroups, 'Mutation-family profile listing')}{@render ProfileListingTable(coverage.mutationGroups, loadDomains)}</div>
      <div><h3>By TLD</h3>{@render ProfileListingChart(coverage.tldGroups, 'TLD profile listing')}{@render ProfileListingTable(coverage.tldGroups, loadDomains)}</div>
    </div>
    {#if coverage.plan.length}
      <details class="coverage-plan">
        <summary>Prioritised next actions · {coverage.plan.length}</summary>
        <p>Priority reflects the next defensive review step, not domain risk, intent, or maliciousness.</p>
        <div class="plan-list">
          {#each coverage.plan.slice(0, 20) as row}
            <article>
              <span class:high={row.priority === 'P1'} class="priority">{row.priority}</span>
              <div><strong>{row.domain}</strong><span>{row.actionLabel} · {statusLabel(row.status)}{row.profileListed ? ' · Profile-listed' : ''}</span><small>{row.rationale}</small></div>
              <button class="btn small" onclick={() => loadDomains([row.domain])}>Load</button>
            </article>
          {/each}
        </div>
        {#if coverage.plan.length > 20}<p>Showing the first 20 deterministic actions. The profile-listing export includes the complete bounded plan.</p>{/if}
      </details>
    {/if}
  </section>
{/if}

{#snippet ProfileListingChart(groups: CoverageGroup[], label: string)}
  {@const chart = profileListingChart(groups)}
  {#if chart.groups.length}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable chart must be keyboard reachable -->
    <div class="coverage-chart" role="img" tabindex="0" aria-label={`${label}. Registration outcomes form each stacked bar; the overlapping profile-listed count is shown separately. Exact counts are in the following table.`}>
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} aria-hidden="true">
        {#each chart.groups as group}
          <text x="8" y={group.y + 13}>{group.label}</text>
          <text x="8" y={group.y + 29} class="profile-listed-label">Profile-listed: {group.profileListed} · overlaps outcomes</text>
          <rect x="193" y={group.y + 19} width="8" height="8" rx="1" class="profile-listing-marker"><title>{group.label}: {group.profileListed} profile-listed, overlapping the registration outcomes</title></rect>
          {#each group.segments as segment}
            <rect x={segment.x} y={group.y} width={segment.width} height="18" rx="2" class={`state-${segment.state}`}>
              <title>{group.label}: {segment.value} {segment.state}</title>
            </rect>
          {/each}
        {/each}
      </svg>
    </div>
  {/if}
{/snippet}

{#snippet ProfileListingTable(groups: CoverageGroup[], loadDomains: (domains: string[]) => void)}
  <div class="table-wrap"><table><thead><tr><th>Group</th><th>Registered</th><th>Available</th><th>Unknown</th><th>Profile-listed (overlap)</th><th>Actions</th></tr></thead><tbody>{#each groups as group}<tr><td data-label="Group">{group.label}</td><td data-label="Registered">{group.registered}</td><td data-label="Available">{group.available}</td><td data-label="Unknown">{group.unknown}</td><td data-label="Profile-listed (overlap)">{group.profileListed}</td><td data-label="Actions"><button class="btn small" onclick={() => loadDomains(group.actionableDomains)} disabled={!group.actionableDomains.length}>Load group</button></td></tr>{/each}</tbody></table></div>
{/snippet}

<style>
  .coverage{margin-top:16px;padding:var(--card-pad)}
  .coverage h2{margin:0}
  .listing-limitation{max-width:78ch;margin:10px 0 0;padding:9px 11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .coverage-summary{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
  .composition-note{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .coverage-tables{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
  .coverage-tables>div{min-width:0}
  .coverage-tables h3{font:700 var(--text-sm) var(--mono)}
  .coverage-chart{max-width:100%;margin:8px 0 11px;overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .coverage-chart:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .coverage-chart svg{display:block;width:100%;min-width:560px;height:auto}
  .coverage-chart text{fill:var(--text);font:600 9px var(--mono)}
  .coverage-chart rect{stroke-width:1}
  .coverage-chart .profile-listed-label{fill:var(--source-registry-text);font-size:8px}
  .coverage-chart .profile-listing-marker{fill:var(--panel);stroke:var(--visual-registration-stroke);stroke-width:2}
  .coverage-chart .state-registered{fill:color-mix(in srgb,var(--source-network-stroke) 22%,var(--panel));stroke:var(--source-network-stroke)}
  .coverage-chart .state-available{fill:color-mix(in srgb,var(--visual-dns-stroke) 20%,var(--panel));stroke:var(--visual-dns-stroke)}
  .coverage-chart .state-unknown{fill:var(--panel);stroke:var(--source-role-stroke);stroke-dasharray:3 2}
  .coverage-plan{margin-top:14px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  .coverage-plan>summary{cursor:pointer;font:700 var(--text-sm) var(--mono)}
  .coverage-plan>p{color:var(--muted);font-size:var(--text-xs)}
  .plan-list{display:grid;gap:7px;margin-top:10px}
  .plan-list article{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:9px;align-items:start;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .plan-list article>div{display:grid;gap:3px;min-width:0}
  .plan-list strong{overflow-wrap:anywhere;font-size:var(--text-xs)}
  .plan-list span,.plan-list small{color:var(--muted);font-size:var(--text-2xs)}
  .priority{padding:3px 6px;border:1px solid var(--border);border-radius:99px;color:var(--text)!important;font:700 var(--text-2xs) var(--mono)}
  .priority.high{border-color:rgb(var(--amber-rgb) / .5);color:var(--amber)!important}
  @media(max-width:700px){
    .coverage-tables{grid-template-columns:1fr}
    .coverage-chart{display:none}
    .coverage .table-wrap{max-width:100%;margin-inline:0;padding-inline:0;overflow:visible;border:0}
    .coverage table,.coverage tbody{display:block}
    .coverage thead{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    .coverage tbody{display:grid;gap:8px}
    .coverage tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
    .coverage td{display:block;min-width:0;padding:7px;border:0;overflow-wrap:anywhere}
    .coverage td::before{content:attr(data-label);display:block;margin-bottom:3px;color:var(--muted);font:600 .62rem var(--mono);letter-spacing:.06em;text-transform:uppercase}
    .coverage td:first-child,.coverage td:last-child{grid-column:1 / -1}
    .coverage td:first-child{padding-bottom:9px;border-bottom:1px solid var(--border);font-weight:700}
    .coverage td:last-child .btn{width:100%}
    .plan-list article{grid-template-columns:auto minmax(0,1fr)}
    .plan-list article .btn{grid-column:1 / -1;width:100%}
  }
</style>
