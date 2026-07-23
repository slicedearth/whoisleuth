<script lang="ts">
  type Row = { label: string; value: string; hash?: boolean };
  type Redirect = { status: string; from: string; to: string; queryOmitted: boolean };
  type Attempt = { url: string; detail: string };

  let {
    status,
    complete,
    rows,
    crossOriginRedirect,
    httpsDowngrade,
    redirects,
    attempts,
    metadata,
    limitations,
    initiallyExpanded = false,
  }: {
    status: string;
    complete: boolean;
    rows: Row[];
    crossOriginRedirect: boolean;
    httpsDowngrade: boolean;
    redirects: Redirect[];
    attempts: Attempt[];
    metadata: Row[];
    limitations: string[];
    initiallyExpanded?: boolean;
  } = $props();
</script>

<details class="http-card evidence-card card" aria-labelledby="http-title" open={initiallyExpanded}>
  <summary class="evidence-summary">
    <span class="evidence-summary-row">
      <span class="evidence-summary-copy"><span class="eyebrow">Deep-scan evidence</span><span class="evidence-summary-title" id="http-title" role="heading" aria-level="4">HTTP intelligence</span><span class="evidence-summary-detail">Expand for response, redirect, provenance, and limitation detail</span></span>
      <span class:partial={!complete} class="evidence-status">{status}</span>
    </span>
  </summary>
  <div class="evidence-body">
    <div class="http-grid stat-grid">
      {#each rows as row}<article><small>{row.label}</small><strong>{row.value}</strong></article>{/each}
    </div>
    {#if crossOriginRedirect || httpsDowngrade}
      <div class="http-findings">
        {#if crossOriginRedirect}<span class="chip warn">Cross-origin redirect</span>{/if}
        {#if httpsDowngrade}<span class="chip danger">HTTPS downgrade</span>{/if}
      </div>
    {/if}
    {#if redirects.length}
      <details class="http-detail disclosure">
        <summary>Redirect chain · {redirects.length} hop{redirects.length === 1 ? '' : 's'}</summary>
        <ol>{#each redirects as redirect}<li><span>HTTP {redirect.status}</span><strong>{redirect.from}</strong><b>→ {redirect.to}</b>{#if redirect.queryOmitted}<small>Query omitted from retained provenance</small>{/if}</li>{/each}</ol>
      </details>
    {/if}
    {#if attempts.length}
      <details class="http-detail disclosure"><summary>Connection attempts</summary><ul>{#each attempts as attempt}<li><strong>{attempt.url}</strong><span>{attempt.detail}</span></li>{/each}</ul></details>
    {/if}
    {#if metadata.length}
      <details class="http-detail disclosure"><summary>Selected response metadata</summary><dl>{#each metadata as row}<dt>{row.label}</dt><dd class:http-hash={row.hash}>{row.value}</dd>{/each}</dl></details>
    {/if}
    {#if limitations.length}<p class="callout warn">{limitations.join(' ')}</p>{/if}
    <p class="card-note">Point-in-time response metadata from the homepage request already used for deep analysis. Redirects and headers provide context; missing security headers do not establish maliciousness.</p>
  </div>
</details>

<style>
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .http-findings{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .disclosure ol,.disclosure ul{display:grid;gap:7px;margin:10px 12px;padding-left:18px}
  .disclosure li{font-size:var(--text-xs);overflow-wrap:anywhere}
  .disclosure li strong,.disclosure li b,.disclosure li small{display:block;margin-top:2px;font-weight:400}
  .disclosure li b,.disclosure li small{color:var(--muted)}
  .disclosure dl{display:grid;grid-template-columns:minmax(130px,190px) 1fr;gap:8px;margin:10px 12px;padding:0;font-size:var(--text-xs)}
  .disclosure dd{min-width:0;margin:0;overflow-wrap:anywhere}
  .http-hash{overflow-wrap:anywhere;font-family:var(--mono)}
  @media(max-width:650px){
    .disclosure dl{grid-template-columns:1fr;gap:4px}
    .disclosure dt{margin-top:6px}
  }
</style>
