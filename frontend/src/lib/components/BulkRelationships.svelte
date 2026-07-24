<script lang="ts">
  import IntelligenceIcon, { type IntelligenceIconName } from '$lib/components/IntelligenceIcon.svelte';

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

  function relationshipIcon(type: string): IntelligenceIconName {
    return ({
      nameserver_set: 'nameserver',
      http_final_origin: 'origin',
      ip_address: 'ip',
      certificate: 'tls',
      tracking_identifier: 'tracker',
      favicon: 'favicon',
      official_asset: 'asset',
    } as Record<string, IntelligenceIconName>)[type] || 'network';
  }
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
          <header>
            <span class="relationship-glyph" aria-hidden="true"><IntelligenceIcon name={relationshipIcon(relationship.type)} /></span>
            <span class="relationship-heading"><strong>{relationship.label}</strong><small>{relationship.method}</small></span>
            <span class="relationship-count">{relationship.domains.length} domain{relationship.domains.length === 1 ? '' : 's'}</span>
          </header>
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
  .relationship-list header{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:9px;align-items:center}
  .relationship-list .relationship-glyph{display:grid;width:32px;height:32px;place-items:center;border:1px solid color-mix(in srgb,var(--accent) 45%,var(--border));border-radius:50%;background:rgb(var(--accent-rgb) / .07);color:var(--accent)}
  .relationship-heading{min-width:0}
  .relationship-heading strong,.relationship-heading small{display:block}
  .relationship-heading strong{overflow:hidden;color:var(--text);font-size:var(--text-sm);text-overflow:ellipsis;white-space:nowrap}
  .relationship-heading small{margin-top:2px}
  .relationship-count{align-self:start;white-space:nowrap}
  .relationship-list span,.relationship-list p,.relationship-list small{color:var(--muted);font-size:var(--text-xs)}
  .relationship-list code{display:block;margin-top:9px;overflow-wrap:anywhere}
  .relationship-list code{color:var(--accent);font-size:var(--text-xs);font-family:var(--mono)}
  .relationship-list p{overflow-wrap:anywhere}
  .relationship-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .relationship-actions button{margin:0}
  .retain-status{margin:10px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .relationship-limitations{margin-top:12px}
  .relationship-limitations summary{color:var(--muted);cursor:pointer;font-size:var(--text-xs)}
  @media(max-width:700px){.relationship-list{grid-template-columns:1fr}}
  @media(max-width:420px){.relationship-list header{grid-template-columns:34px minmax(0,1fr)}.relationship-count{grid-column:2;justify-self:start}}
</style>
