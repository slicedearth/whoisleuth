<script lang="ts">
  import { evidenceStatusTone } from '$lib/analysis/evidence-status-tone.ts';
  type StructuredEntity = {
    types: string;
    name: string;
    declaredOrigin: string;
    sameAsHosts: string;
  };

  let {
    status,
    complete,
    entities,
    limitations,
    initiallyExpanded = false,
  }: {
    status: string;
    complete: boolean;
    entities: StructuredEntity[];
    limitations: string[];
    initiallyExpanded?: boolean;
  } = $props();

  const noMatches = $derived(status === 'success' && complete && entities.length === 0);
</script>

<details class="structured-card evidence-card card" aria-labelledby="structured-data-title" open={initiallyExpanded}>
  <summary class="evidence-summary">
    <span class="evidence-summary-row">
      <span class="evidence-summary-copy">
        <span class="eyebrow">Publisher-declared deep-scan evidence</span>
        <span class="evidence-summary-title" id="structured-data-title" role="heading" aria-level="4">Structured identity metadata</span>
        <span class="evidence-summary-detail">
          {entities.length
            ? `${entities.length} curated entit${entities.length === 1 ? 'y' : 'ies'}`
            : noMatches
              ? 'Analysis complete; no curated identity entity was published'
              : 'No conclusive metadata'}
          · Expand for retained fields and limitations
        </span>
      </span>
      <span class="evidence-status {evidenceStatusTone(status, { complete, neutral: noMatches })}">
        {noMatches ? 'No recognised entities' : status}
      </span>
    </span>
  </summary>

  <div class="evidence-body">
    {#if entities.length}
      <div class="entity-grid">
        {#each entities as entity}
          <article>
            <div class="entity-head">
              <h5>{entity.name || 'Unnamed publisher declaration'}</h5>
              <span>{entity.types}</span>
            </div>
            <dl>
              <div><dt>Declared origin</dt><dd>{entity.declaredOrigin || 'Not published'}</dd></div>
              <div><dt>sameAs hosts</dt><dd>{entity.sameAsHosts || 'None retained'}</dd></div>
            </dl>
          </article>
        {/each}
      </div>
    {:else}
      <p class="callout info">No curated Organisation, Brand, WebSite, WebPage, or related identity declaration was retained. This does not mean the page publishes no structured data.</p>
    {/if}

    {#if limitations.length}<p class="callout warn">{limitations.join(' ')}</p>{/if}
    <p class="card-note">WHOISleuth reads capped JSON-LD already present in the captured homepage. It retains only curated types, labels, origins, and hostnames, makes no additional request, and does not use this evidence for availability or Risk scoring.</p>
  </div>
</details>

<style>
  .entity-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:10px}
  article{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface-soft)}
  .entity-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  h5{min-width:0;margin:0;color:var(--text);font-size:var(--text-sm);overflow-wrap:anywhere}
  .entity-head span{flex:0 0 auto;color:var(--accent);font-size:var(--text-2xs);text-align:right;text-transform:none;letter-spacing:.04em}
  dl{display:grid;gap:6px;margin:10px 0 0}
  dl div{display:grid;grid-template-columns:minmax(100px,.35fr) minmax(0,1fr);gap:8px;font-size:var(--text-xs);line-height:1.45}
  dt{color:var(--muted)}
  dd{min-width:0;margin:0;overflow-wrap:anywhere}
  .callout{margin-top:12px}
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  @media(max-width:650px){
    .entity-head{display:grid;gap:4px}
    .entity-head span{justify-self:start;text-align:left}
    dl div{grid-template-columns:1fr}
  }
</style>
