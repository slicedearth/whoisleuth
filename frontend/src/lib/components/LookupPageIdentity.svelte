<script lang="ts">
  type Row = { label: string; value: string; danger?: boolean };
  type FingerprintRow = Row & { detail?: string | null };

  let {
    status,
    complete,
    facts,
    externalFormOrigins,
    resourceCount,
    resourceSummary,
    embeddedOrigins,
    contactDomains,
    downloadCount,
    downloadSummary,
    trackingIdentifiers,
    fingerprints,
    limitations,
  }: {
    status: string;
    complete: boolean;
    facts: Row[];
    externalFormOrigins: string[];
    resourceCount: number;
    resourceSummary: Row[];
    embeddedOrigins: string[];
    contactDomains: string[];
    downloadCount: number;
    downloadSummary: Row[];
    trackingIdentifiers: Row[];
    fingerprints: FingerprintRow[];
    limitations: string[];
  } = $props();
</script>

<section class="page-card evidence-card card" aria-labelledby="page-identity-title">
  <header class="section-head">
    <div><p class="eyebrow">Deep-scan evidence</p><h4 id="page-identity-title">Page identity</h4></div>
    <span class:partial={!complete}>{status}</span>
  </header>
  <div class="page-grid stat-grid">
    {#each facts as row}<article><small>{row.label}</small><strong class:danger-text={row.danger}>{row.value}</strong></article>{/each}
  </div>
  {#if externalFormOrigins.length}
    <details class="page-detail disclosure"><summary>External form destinations · {externalFormOrigins.length}</summary><ul>{#each externalFormOrigins as origin}<li>{origin}</li>{/each}</ul></details>
  {/if}
  {#if resourceCount > 0}
    <details class="page-detail disclosure"><summary>Resource summary · {resourceCount}</summary><dl>{#each resourceSummary as row}<dt>{row.label}</dt><dd>{row.value}</dd>{/each}</dl></details>
  {/if}
  {#if embeddedOrigins.length}
    <details class="page-detail disclosure"><summary>Embedded origins · {embeddedOrigins.length}</summary><ul>{#each embeddedOrigins as origin}<li>{origin}</li>{/each}</ul></details>
  {/if}
  {#if contactDomains.length}
    <details class="page-detail disclosure"><summary>Contact domains · {contactDomains.length}</summary><ul>{#each contactDomains as domain}<li>{domain}</li>{/each}</ul></details>
  {/if}
  {#if downloadCount > 0}
    <details class="page-detail disclosure"><summary>Download context · {downloadCount}</summary><dl>{#each downloadSummary as row}<dt>{row.label}</dt><dd>{row.value}</dd>{/each}</dl></details>
  {/if}
  {#if trackingIdentifiers.length}
    <details class="page-detail disclosure"><summary>Tracking identifiers · {trackingIdentifiers.length}</summary><ul>{#each trackingIdentifiers as identifier}<li><strong>{identifier.label}</strong><span>{identifier.value}</span></li>{/each}</ul></details>
  {/if}
  {#if fingerprints.length}
    <details class="page-detail page-fingerprints disclosure"><summary>Page fingerprints · {fingerprints.length}</summary><dl>{#each fingerprints as row}<dt>{row.label}</dt><dd><code>{row.value}</code>{#if row.detail}<small>{row.detail}</small>{/if}</dd>{/each}</dl><p>SHA-256 components support exact equality checks. Visible-text SimHash is fuzzy comparison data, not a cryptographic digest or proof of common ownership.</p></details>
  {/if}
  {#if limitations.length}<p class="callout warn">{limitations.join(' ')}</p>{/if}
  <p class="card-note">Bounded metadata and versioned fingerprints from the static HTML already captured for this lookup. Resource and embedded locations retain origins only; contact links retain domains only; download paths, URL queries, normalized markup, and visible text are not retained. These fields provide comparison and review context rather than proof of ownership or maliciousness.</p>
</section>

<style>
  .evidence-card{padding:var(--card-pad)}
  .evidence-card .stat-grid{margin-top:14px}
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .page-grid .danger-text{color:var(--danger)}
  .disclosure ul{display:grid;gap:7px;margin:10px 12px;padding-left:18px}
  .disclosure li{font-size:var(--text-xs);overflow-wrap:anywhere}
  .disclosure li strong,.disclosure li span{display:block;margin-top:2px;font-weight:400}
  .disclosure dl{display:grid;grid-template-columns:minmax(130px,190px) 1fr;gap:8px;margin:10px 12px;padding:0;font-size:var(--text-xs)}
  .disclosure dd{min-width:0;margin:0;overflow-wrap:anywhere}
  .page-fingerprints code{display:block;overflow-wrap:anywhere;color:var(--accent);font-size:var(--text-2xs)}
  .page-fingerprints dd small{display:block;margin-top:3px;color:var(--muted)}
  .page-fingerprints>p{margin:10px 12px;color:var(--muted);font-size:var(--text-xs)}
  @media(max-width:650px){
    .disclosure dl{grid-template-columns:1fr;gap:4px}
    .disclosure dt{margin-top:6px}
  }
</style>
