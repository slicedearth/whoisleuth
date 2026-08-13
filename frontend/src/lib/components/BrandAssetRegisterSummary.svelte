<script lang="ts">
  import type { BrandAssetRegisterProjection, BrandAssetSourceSummary } from '$lib/analysis/brand-asset-register.ts';

  let { projection }: { projection: BrandAssetRegisterProjection } = $props();

  const directCount = $derived(
    projection.counts.authored_official
      + projection.counts.authored_partner
      + projection.counts.authored_allowlisted
      + projection.counts.retained_case_scope,
  );

  function sourceMetric(source: BrandAssetSourceSummary): string {
    if (source.state === 'loading') return 'Loading';
    if (source.state === 'unavailable') return 'Unavailable';
    return String(source.matchedCount ?? 0);
  }
</script>

<section class="asset-summary card" aria-labelledby="brand-asset-summary-title" aria-busy={projection.state === 'loading'}>
  <header>
    <div>
      <p class="eyebrow">Transient local projection</p>
      <h2 id="brand-asset-summary-title">Brand asset register</h2>
      <p>Review direct profile roles, explicitly associated Cases, and one-hop retained relationship leads without making a Lookup request.</p>
    </div>
    <a class="btn" href="/brands?view=assets">Open asset register</a>
  </header>

  {#if projection.state === 'unavailable'}
    <p class="source-state" role="alert">Brand assets are unavailable because Brand Profiles or the active-profile preference could not be read. No empty register has been inferred.</p>
  {:else if projection.state === 'no_active_profile'}
    <p class="source-state">Set a Brand Profile active to build its transient asset register.</p>
  {:else if projection.state === 'unresolved_active_profile'}
    <p class="source-state">The active-profile preference does not resolve to a readable local Brand Profile. The unresolved reference is preserved and no replacement profile is inferred.</p>
  {:else}
    {#if projection.state === 'loading'}
      <p class="source-state" role="status" aria-live="polite">Loading browser-local asset sources…</p>
    {/if}
    {#if projection.sources.cases.state === 'unavailable'}
      <p class="source-state" role="alert">Cases could not be read. The register remains partial and the associated-Case count is unavailable.</p>
    {/if}
    {#if projection.sources.relationships.state === 'unavailable'}
      <p class="source-state" role="alert">Retained relationship observations could not be read. The register remains partial and the relationship count is unavailable.</p>
    {/if}
    <div class="metrics" role="group" aria-label="Brand asset register summary">
      <article><span>Rows</span><strong>{projection.rows.length}</strong></article>
      <article><span>Direct scope</span><strong>{directCount}</strong></article>
      <article><span>Associated Cases</span><strong class:numeric={projection.sources.cases.matchedCount !== null}>{sourceMetric(projection.sources.cases)}</strong></article>
      <article><span>Qualifying relationships</span><strong class:numeric={projection.sources.relationships.matchedCount !== null}>{sourceMetric(projection.sources.relationships)}</strong></article>
    </div>
    {#if projection.state === 'partial'}
      <p class="partial">Coverage is partial. Open the register for source states and exact omission counts.</p>
    {/if}
  {/if}
</section>

<style>
  .asset-summary{display:grid;gap:14px;min-width:0;margin-top:16px;padding:var(--card-pad)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
  header>div{min-width:0}
  h2,p{margin:0}
  h2{margin-top:3px;font:700 var(--text-lg) var(--mono)}
  header p:last-child{max-width:72ch;margin-top:7px;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  header p,.source-state,.partial{overflow-wrap:anywhere}
  .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
  .metrics article{display:grid;min-width:0;gap:4px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .metrics span{color:var(--muted);font-size:var(--text-2xs);text-transform:uppercase;letter-spacing:.05em;overflow-wrap:anywhere}
  .metrics strong{color:var(--muted);font:700 var(--text-xs) var(--mono);overflow-wrap:anywhere}
  .metrics strong.numeric,.metrics article:first-child strong,.metrics article:nth-child(2) strong{color:var(--accent2);font-size:var(--text-xl)}
  .source-state{padding:9px 11px;border:1px dotted var(--muted);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font-size:var(--text-sm)}
  .partial{color:var(--amber);font-size:var(--text-xs)}
  @media(max-width:760px){header{display:grid}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:360px){.metrics{grid-template-columns:1fr}}
</style>
