<script lang="ts">
  type RelationshipGroup = {
    type: string;
    label: string;
    method: string;
    value: string;
    normalizedValue: string;
    domains: string[];
    description: string;
  };

  let {
    groups,
    truncated,
    limitations,
    loadDomains,
    retainObservation = undefined,
    observationId = undefined,
    retainedIds = new Set<string>(),
    retainStatus = '',
  }: {
    groups: RelationshipGroup[];
    truncated: boolean;
    limitations: string[];
    loadDomains: (domains: string[]) => void;
    retainObservation?: (relationship: RelationshipGroup) => void | Promise<void>;
    observationId?: (relationship: RelationshipGroup) => string;
    retainedIds?: ReadonlySet<string>;
    retainStatus?: string;
  } = $props();
</script>

{#if groups.length}
  <section class="relationships card" aria-labelledby="relationship-title">
    <header class="section-head">
      <div><p class="eyebrow">Relationship evidence</p><h2 id="relationship-title">{groups.length} observed relationship{groups.length === 1 ? '' : 's'}</h2></div>
      {#if truncated}<span class="partial">Partial result</span>{/if}
    </header>
    <p class="relationship-intro">Compare bounded observations already collected by this scan. These are investigation pivots, not ownership or maliciousness conclusions.</p>
    <div class="relationship-list">
      {#each groups as relationship}
        <article>
          <div><strong>{relationship.label}</strong><span>{relationship.domains.length} domain{relationship.domains.length === 1 ? '' : 's'}</span></div>
          <small>{relationship.method}</small>
          {#if relationship.value}<code>{relationship.value}</code>{/if}
          <p>{relationship.description}</p>
          <p>{relationship.domains.join(' · ')}</p>
          <div class="relationship-actions">
            <button class="btn small" onclick={() => loadDomains(relationship.domains)}>Load related domain{relationship.domains.length === 1 ? '' : 's'}</button>
            {#if retainObservation && observationId}
              <button
                class="btn small"
                disabled={retainedIds.has(observationId(relationship))}
                onclick={() => retainObservation?.(relationship)}
              >{retainedIds.has(observationId(relationship)) ? 'Retained in Monitor' : 'Retain observation'}</button>
            {/if}
          </div>
        </article>
      {/each}
    </div>
    {#if retainStatus}<p class="retain-status" role="status" aria-live="polite">{retainStatus}</p>{/if}
    <details class="relationship-limitations"><summary>Interpretation limits</summary>{#each limitations as limitation}<p>{limitation}</p>{/each}</details>
  </section>
{/if}

<style>
  .relationships{margin-top:16px;padding:var(--card-pad)}
  .relationships h2{margin:0}
  .relationship-intro,.relationship-limitations p{color:var(--muted);font-size:var(--text-xs)}
  .relationship-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:14px}
  .relationship-list article{padding:13px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .relationship-list article>div{display:flex;justify-content:space-between;gap:8px}
  .relationship-list article>div strong{font-size:var(--text-sm)}
  .relationship-list span,.relationship-list p,.relationship-list small{color:var(--muted);font-size:var(--text-xs)}
  .relationship-list small,.relationship-list code{display:block;margin-top:5px;overflow-wrap:anywhere}
  .relationship-list code{color:var(--accent);font-size:var(--text-xs);font-family:var(--mono)}
  .relationship-list p{overflow-wrap:anywhere}
  .relationship-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .relationship-actions button{margin:0}
  .retain-status{margin:10px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .relationship-limitations{margin-top:12px}
  .relationship-limitations summary{color:var(--muted);cursor:pointer;font-size:var(--text-xs)}
  @media(max-width:700px){.relationship-list{grid-template-columns:1fr}}
</style>
