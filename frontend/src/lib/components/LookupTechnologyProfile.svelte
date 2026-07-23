<script lang="ts">
  type Evidence = { source: string; description: string };
  type Finding = { id: string; name: string; category: string; confidence: string; evidence: Evidence[] };

  let {
    status,
    complete,
    findings,
    limitations,
    initiallyExpanded = false,
  }: {
    status: string;
    complete: boolean;
    findings: Finding[];
    limitations: string[];
    initiallyExpanded?: boolean;
  } = $props();
</script>

<details class="technology-card evidence-card card" aria-labelledby="technology-profile-title" open={initiallyExpanded}>
  <summary class="evidence-summary">
    <span class="evidence-summary-row">
    <span class="evidence-summary-copy">
      <span class="eyebrow">Derived deep-scan analysis</span>
      <span class="evidence-summary-title" id="technology-profile-title" role="heading" aria-level="4">Technology indicators</span>
      <span class="evidence-summary-detail">{findings.length ? `${findings.length} matched indicator${findings.length === 1 ? '' : 's'}` : 'No curated match'} · Expand for evidence and limitations</span>
    </span>
    <span class:partial={!complete} class="evidence-status">{status}</span>
    </span>
  </summary>

  <div class="evidence-body">
    {#if findings.length}
      <div class="technology-grid">
        {#each findings as finding}
          <article>
            <div class="finding-head">
              <h5>{finding.name}</h5>
              <span class="confidence">{finding.confidence} confidence</span>
            </div>
            <p class="category">{finding.category}</p>
            <ul aria-label={`${finding.name} evidence`}>
              {#each finding.evidence as evidence}
                <li><strong>{evidence.source}</strong><span>{evidence.description}</span></li>
              {/each}
            </ul>
          </article>
        {/each}
      </div>
    {:else}
      <p class="callout info">No curated technology signature matched the captured response. This does not mean that no framework, service, or delivery platform is present.</p>
    {/if}

    {#if limitations.length}<p class="callout warn">{limitations.join(' ')}</p>{/if}
    <p class="card-note">These indicators are derived from the selected HTTP server header, generator metadata, resource origins, and static HTML already collected by this deep lookup. They make no additional request and do not affect availability or Risk scoring.</p>
  </div>
</details>

<style>
  .technology-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:10px}
  .technology-grid article{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface-soft)}
  .finding-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .finding-head h5{min-width:0;margin:0;color:var(--text);font-size:var(--text-sm);overflow-wrap:anywhere}
  .confidence{flex:0 0 auto;color:var(--accent);font-size:var(--text-2xs);text-transform:uppercase;letter-spacing:.05em}
  .category{margin:3px 0 0;color:var(--muted);font-size:var(--text-xs);text-transform:capitalize}
  ul{display:grid;gap:7px;margin:10px 0 0;padding:0;list-style:none}
  li{display:grid;gap:2px;min-width:0;font-size:var(--text-xs);line-height:1.45}
  li strong{color:var(--muted);font-size:var(--text-2xs);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
  li span{overflow-wrap:anywhere}
  .callout{margin-top:12px}
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  @media(max-width:650px){
    .finding-head{display:grid;gap:4px}
    .confidence{justify-self:start}
  }
</style>
