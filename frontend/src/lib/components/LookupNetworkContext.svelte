<script lang="ts">
  type Row = { label: string; value: string; datetime?: string };

  let {
    status,
    detail,
    address,
    addressSource,
    rdapEndpoint,
    httpStatus,
    fetchedAt,
    rows,
    limitations,
    initiallyExpanded = false,
    provenance = 'This maps one point-in-time public endpoint address to its registered network. CDNs, reverse proxies, load balancers, shared hosting, and location-dependent DNS can mean this is not the origin host. Network registration does not prove hosting control, ownership, intent, or maliciousness.',
  }: {
    status: string;
    detail: string;
    address: string;
    addressSource: string;
    rdapEndpoint: string;
    httpStatus: string;
    fetchedAt: string;
    rows: Row[];
    limitations: string[];
    initiallyExpanded?: boolean;
    provenance?: string;
  } = $props();
</script>

<details class="network-context evidence-card card" aria-labelledby="network-context-title" open={initiallyExpanded}>
  <summary class="evidence-summary">
    <span class="evidence-summary-row">
    <span class="evidence-summary-copy">
      <span class="eyebrow">IP RDAP enrichment</span>
      <span class="evidence-summary-title" id="network-context-title" role="heading" aria-level="4">Observed network context</span>
      <span class="evidence-summary-detail">{detail}</span>
    </span>
    <span class:partial={status === 'partial'} class:error={status === 'error'} class="evidence-status">{status}</span>
    </span>
  </summary>

  <div class="evidence-body">
    {#if address}
      <div class="endpoint-summary">
        <article><small>Selected address</small><strong>{address}</strong></article>
        <article><small>Selected from</small><strong>{addressSource}</strong></article>
      </div>
    {/if}

    {#if rows.length}
      <dl>
        {#each rows as row}
          <dt>{row.label}</dt>
          <dd>{#if row.datetime}<time datetime={row.datetime}>{row.value}</time>{:else}{row.value}{/if}</dd>
        {/each}
      </dl>
    {/if}

    {#if rdapEndpoint || httpStatus || fetchedAt}
      <details class="source-details">
        <summary>IP RDAP source</summary>
        <dl>
          {#if rdapEndpoint}<dt>Endpoint</dt><dd>{rdapEndpoint}</dd>{/if}
          {#if httpStatus}<dt>HTTP status</dt><dd>{httpStatus}</dd>{/if}
          {#if fetchedAt}<dt>Fetched</dt><dd><time datetime={fetchedAt}>{fetchedAt}</time></dd>{/if}
        </dl>
      </details>
    {/if}

    <p class="provenance">{provenance}</p>

    {#if limitations.length}
      <details class="limitations">
        <summary>Limitations · {limitations.length}</summary>
        <ul>{#each limitations as limitation}<li>{limitation}</li>{/each}</ul>
      </details>
    {/if}
  </div>
</details>

<style>
  .endpoint-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .endpoint-summary article{min-width:0;padding:11px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .endpoint-summary small,.endpoint-summary strong{display:block}
  .endpoint-summary small{color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:uppercase;letter-spacing:.04em}
  .endpoint-summary strong{margin-top:5px;font:650 var(--text-xs) var(--mono);overflow-wrap:anywhere}
  dl{display:grid;grid-template-columns:150px minmax(0,1fr);gap:8px 14px;margin:14px 0 0;padding:13px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:var(--text-xs)}
  dt{color:var(--muted)}
  dd{min-width:0;margin:0;overflow-wrap:anywhere}
  .source-details,.limitations{margin-top:12px}
  .source-details dl{margin:10px 0 0}
  .provenance{margin:14px 0 0;padding:11px 12px;border-left:3px solid var(--accent2);background:rgb(var(--accent2-rgb) / .05);color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .limitations ul{display:grid;gap:6px;margin:10px 0 0;padding-left:20px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  @media(max-width:650px){
    .endpoint-summary{grid-template-columns:1fr}
    dl{grid-template-columns:1fr;gap:3px}
    dt:not(:first-child){margin-top:6px}
  }
</style>
