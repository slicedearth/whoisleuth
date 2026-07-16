<script lang="ts">
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
</script>

{#if coverage}
  <section class="coverage card">
    <header class="section-head"><div><p class="eyebrow">Defensive registration</p><h2>Coverage · {coverage.summary.coveragePercent}%</h2></div><button class="btn" onclick={exportCoverage}>Export coverage CSV</button></header>
    <div class="coverage-summary"><span class="chip">Generated {coverage.summary.total}</span><span class="chip good">Protected {coverage.summary.protected}</span><span class="chip danger">Registered {coverage.summary.registered}</span><span class="chip warn">Available {coverage.summary.available}</span><span class="chip">Unknown {coverage.summary.unknown}</span></div>
    <div class="coverage-tables">
      <div><h3>By mutation</h3>{@render CoverageTable(coverage.mutationGroups, loadDomains)}</div>
      <div><h3>By TLD</h3>{@render CoverageTable(coverage.tldGroups, loadDomains)}</div>
    </div>
  </section>
{/if}

{#snippet CoverageTable(groups: CoverageGroup[], loadDomains: (domains: string[]) => void)}
  <div class="table-wrap"><table><thead><tr><th>Group</th><th>Protected</th><th>Registered</th><th>Available</th><th>Unknown</th><th>Actions</th></tr></thead><tbody>{#each groups as group}<tr><td>{group.label}</td><td>{group.protected}</td><td>{group.registered}</td><td>{group.available}</td><td>{group.unknown}</td><td><button class="btn small" onclick={() => loadDomains(group.actionableDomains)} disabled={!group.actionableDomains.length}>Load gaps</button></td></tr>{/each}</tbody></table></div>
{/snippet}

<style>
  .coverage{margin-top:16px;padding:var(--card-pad)}
  .coverage h2{margin:0}
  .coverage-summary{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
  .coverage-tables{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
  .coverage-tables>div{min-width:0}
  .coverage-tables h3{font:700 var(--text-sm) var(--mono)}
  @media(max-width:700px){
    .coverage-tables{grid-template-columns:1fr}
    .coverage .table-wrap{max-width:100%;margin-inline:0;padding-inline:0;overflow-x:auto}
  }
</style>
