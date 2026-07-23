<script lang="ts">
  let {
    status,
    complete,
    rows,
    failureDetail,
    truncated,
    initiallyExpanded = false,
  }: {
    status: string;
    complete: boolean;
    rows: Array<{ label: string; value: string }>;
    failureDetail: string;
    truncated: boolean;
    initiallyExpanded?: boolean;
  } = $props();
</script>

<details class="dns-card evidence-card card" aria-labelledby="dns-title" open={initiallyExpanded}>
  <summary class="evidence-summary">
    <span class="evidence-summary-row">
      <span class="evidence-summary-copy"><span class="eyebrow">Deep-scan evidence</span><span class="evidence-summary-title" id="dns-title" role="heading" aria-level="4">DNS intelligence</span><span class="evidence-summary-detail">Expand for observed records, provenance, and limitations</span></span>
      <span class:partial={!complete} class="evidence-status">{status}</span>
    </span>
  </summary>
  <div class="evidence-body">
    <div class="dns-grid stat-grid">
      {#each rows as row}<article><small>{row.label}</small><strong>{row.value}</strong></article>{/each}
    </div>
    {#if failureDetail}
      <p class="callout warn dns-warning">Partial observation: {failureDetail}. A resolver failure is not evidence that a record is absent.</p>
    {/if}
    <p class="card-note">Point-in-time resolver evidence. Shared DNS infrastructure can connect investigations but does not prove common ownership or maliciousness.{truncated ? ' Some record inventories were capped.' : ''}</p>
  </div>
</details>

<style>
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
</style>
