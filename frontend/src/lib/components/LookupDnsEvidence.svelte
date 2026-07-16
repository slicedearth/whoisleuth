<script lang="ts">
  let {
    status,
    complete,
    rows,
    failureDetail,
    truncated,
  }: {
    status: string;
    complete: boolean;
    rows: Array<{ label: string; value: string }>;
    failureDetail: string;
    truncated: boolean;
  } = $props();
</script>

<section class="dns-card evidence-card card" aria-labelledby="dns-title">
  <header class="section-head">
    <div><p class="eyebrow">Deep-scan evidence</p><h4 id="dns-title">DNS intelligence</h4></div>
    <span class:partial={!complete}>{status}</span>
  </header>
  <div class="dns-grid stat-grid">
    {#each rows as row}<article><small>{row.label}</small><strong>{row.value}</strong></article>{/each}
  </div>
  {#if failureDetail}
    <p class="callout warn dns-warning">Partial observation: {failureDetail}. A resolver failure is not evidence that a record is absent.</p>
  {/if}
  <p class="card-note">Point-in-time resolver evidence. Shared DNS infrastructure can connect investigations but does not prove common ownership or maliciousness.{truncated ? ' Some record inventories were capped.' : ''}</p>
</section>

<style>
  .evidence-card{padding:var(--card-pad)}
  .evidence-card .stat-grid{margin-top:14px}
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
</style>
