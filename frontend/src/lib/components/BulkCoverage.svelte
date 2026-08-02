<script lang="ts">
  import {
    projectCoverageBars,
    type CoverageBarInput,
  } from '$lib/analysis/visualization-models.ts';
  type CoverageSummary = {
    total: number;
    protected: number;
    registered: number;
    available: number;
    unknown: number;
    coveragePercent: number;
  };
  type CoverageGroup = {
    label: string;
    protected: number;
    registered: number;
    available: number;
    unknown: number;
    actionableDomains: string[];
  };
  type Coverage = {
    summary: CoverageSummary;
    mutationGroups: CoverageGroup[];
    tldGroups: CoverageGroup[];
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

  function coverageChart(groups: CoverageGroup[]) {
    return projectCoverageBars(groups.map((group, index): CoverageBarInput => ({
      id: `${group.label}-${index}`,
      label: group.label,
      protected: group.protected,
      registered: group.registered,
      available: group.available,
      unknown: group.unknown,
    })));
  }
</script>

{#if coverage}
  <section class="coverage card">
    <header class="section-head"><div><p class="eyebrow">Defensive registration</p><h2>Coverage · {coverage.summary.coveragePercent}%</h2></div><button class="btn" onclick={exportCoverage}>Export coverage CSV</button></header>
    <div class="coverage-summary"><span class="chip">Generated {coverage.summary.total}</span><span class="chip good">Protected {coverage.summary.protected}</span><span class="chip danger">Registered {coverage.summary.registered}</span><span class="chip warn">Available {coverage.summary.available}</span><span class="chip">Unknown {coverage.summary.unknown}</span></div>
    <div class="coverage-tables">
      <div><h3>By mutation</h3>{@render CoverageChart(coverage.mutationGroups, 'Mutation-family coverage')}{@render CoverageTable(coverage.mutationGroups, loadDomains)}</div>
      <div><h3>By TLD</h3>{@render CoverageChart(coverage.tldGroups, 'TLD coverage')}{@render CoverageTable(coverage.tldGroups, loadDomains)}</div>
    </div>
  </section>
{/if}

{#snippet CoverageChart(groups: CoverageGroup[], label: string)}
  {@const chart = coverageChart(groups)}
  {#if chart.groups.length}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable chart must be keyboard reachable -->
    <div class="coverage-chart" role="img" tabindex="0" aria-label={`${label}. Exact counts are in the following table.`}>
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} aria-hidden="true">
        {#each chart.groups as group}
          <text x="8" y={group.y + 13}>{group.label}</text>
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

{#snippet CoverageTable(groups: CoverageGroup[], loadDomains: (domains: string[]) => void)}
  <div class="table-wrap"><table><thead><tr><th>Group</th><th>Protected</th><th>Registered</th><th>Available</th><th>Unknown</th><th>Actions</th></tr></thead><tbody>{#each groups as group}<tr><td data-label="Group">{group.label}</td><td data-label="Protected">{group.protected}</td><td data-label="Registered">{group.registered}</td><td data-label="Available">{group.available}</td><td data-label="Unknown">{group.unknown}</td><td data-label="Actions"><button class="btn small" onclick={() => loadDomains(group.actionableDomains)} disabled={!group.actionableDomains.length}>Load gaps</button></td></tr>{/each}</tbody></table></div>
{/snippet}

<style>
  .coverage{margin-top:16px;padding:var(--card-pad)}
  .coverage h2{margin:0}
  .coverage-summary{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
  .coverage-tables{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
  .coverage-tables>div{min-width:0}
  .coverage-tables h3{font:700 var(--text-sm) var(--mono)}
  .coverage-chart{max-width:100%;margin:8px 0 11px;overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .coverage-chart:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .coverage-chart svg{display:block;width:100%;min-width:560px;height:auto}
  .coverage-chart text{fill:var(--text);font:600 9px var(--mono)}
  .coverage-chart rect{stroke-width:1}
  .coverage-chart .state-protected{fill:color-mix(in srgb,var(--success) 30%,var(--panel));stroke:var(--success)}
  .coverage-chart .state-registered{fill:rgb(var(--danger-rgb) / .22);stroke:var(--danger)}
  .coverage-chart .state-available{fill:rgb(var(--amber-rgb) / .23);stroke:var(--amber)}
  .coverage-chart .state-unknown{fill:var(--panel);stroke:var(--muted);stroke-dasharray:3 2}
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
  }
</style>
