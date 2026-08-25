<script lang="ts">
  import { tick } from 'svelte';
  import IntelligenceIcon, { type IntelligenceIconName } from '$lib/components/IntelligenceIcon.svelte';
  import BoundedRelationshipMap from '$lib/components/BoundedRelationshipMap.svelte';
  import type {
    ForceGraphLinkInput,
    ForceGraphNodeInput,
  } from '$lib/analysis/visualization-models.ts';
  import {
    buildRelationshipAdmissionPreview,
    type RelationshipAdmissionAction,
    type RelationshipAdmissionPreview,
  } from '$lib/analysis/relationship-admission-preview.ts';

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
    retentionAvailable = true,
    observedAt = '',
    sourceIdentities = [],
  }: {
    groups: RelationshipGroup[];
    truncated: boolean;
    limitations: string[];
    loadDomains: (domains: string[]) => void;
    retainObservation?: (relationship: RelationshipGroup) => void | Promise<void>;
    observationId?: (relationship: RelationshipGroup) => string;
    retainedIds?: ReadonlySet<string>;
    retainStatus?: string;
    retentionAvailable?: boolean;
    observedAt?: string;
    sourceIdentities?: string[];
  } = $props();

  let pendingRelationship = $state<RelationshipGroup | null>(null);
  let pendingAction = $state<RelationshipAdmissionAction | null>(null);
  let preview = $state<RelationshipAdmissionPreview | null>(null);
  let previewElement = $state<HTMLElement>();
  let returnFocusId = $state('');

  async function openAdmissionPreview(relationship: RelationshipGroup, action: RelationshipAdmissionAction, index: number) {
    pendingRelationship = relationship;
    pendingAction = action;
    returnFocusId = `relationship-${action}-${index}`;
    preview = buildRelationshipAdmissionPreview(relationship, {
      action,
      observedAt,
      sourceIdentities,
      truncated,
    });
    await tick();
    previewElement?.focus();
  }

  async function closeAdmissionPreview(restoreFocus = true) {
    const focusId = returnFocusId;
    pendingRelationship = null;
    pendingAction = null;
    preview = null;
    returnFocusId = '';
    await tick();
    if (restoreFocus) document.getElementById(focusId)?.focus();
  }

  async function admitRelationship() {
    const relationship = pendingRelationship;
    const action = pendingAction;
    if (!relationship || !action) return;
    await closeAdmissionPreview(false);
    if (action === 'expand') loadDomains(relationship.domains);
    else await retainObservation?.(relationship);
  }

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

  const relationshipMap = $derived.by(() => {
    const nodes = new Map<string, ForceGraphNodeInput>();
    const links: ForceGraphLinkInput[] = [];
    for (const [groupIndex, group] of groups.entries()) {
      const relationshipId = `relationship-${groupIndex}`;
      nodes.set(relationshipId, {
        id: relationshipId,
        label: group.label,
        kind: 'relationship',
        detail: group.value || group.method,
      });
      for (const [domainIndex, domain] of group.domains.entries()) {
        const domainId = `domain-${domain.toLowerCase()}`;
        nodes.set(domainId, { id: domainId, label: domain, kind: 'domain' });
        links.push({
          id: `${relationshipId}-${domainIndex}`,
          source: relationshipId,
          target: domainId,
          kind: 'observed',
          detail: group.method,
        });
      }
    }
    return { nodes: [...nodes.values()], links };
  });
</script>

{#if groups.length}
  <section class="relationships card" aria-labelledby="relationship-title">
    <header class="section-head">
      <div><p class="eyebrow">Relationship evidence</p><h2 id="relationship-title">{groups.length} observed relationship{groups.length === 1 ? '' : 's'}</h2></div>
      {#if truncated}<span class="partial">Partial result</span>{/if}
    </header>
    <p class="relationship-intro">Compare bounded observations already collected by this scan. These are investigation pivots, not ownership or maliciousness conclusions.</p>
    <BoundedRelationshipMap
      title="Shared evidence relationships"
      description="Relationship nodes connect domains that share the exact bounded value described by the scan."
      nodes={relationshipMap.nodes}
      links={relationshipMap.links}
    />
    <div class="relationship-list">
      {#each groups as relationship, index}
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
            <button id={`relationship-expand-${index}`} class="btn small" onclick={() => void openAdmissionPreview(relationship, 'expand', index)}>Preview related domain{relationship.domains.length === 1 ? '' : 's'}</button>
            {#if retainObservation && observationId}
              <button
                class="btn small"
                disabled={!retentionAvailable || retainedIds.has(observationId(relationship))}
                id={`relationship-retain-${index}`}
                onclick={() => void openAdmissionPreview(relationship, 'retain', index)}
              >{!retentionAvailable ? 'Retention unavailable' : retainedIds.has(observationId(relationship)) ? 'Retained in Monitor' : 'Preview retention'}</button>
            {/if}
          </div>
        </article>
      {/each}
    </div>
    {#if preview}
      <div class="admission-preview" role="dialog" aria-modal="false" aria-labelledby="relationship-admission-title" tabindex="-1" bind:this={previewElement}>
        <header><div><p class="eyebrow">Admission preview</p><h3 id="relationship-admission-title">{preview.action === 'expand' ? 'Load this relationship-derived view?' : 'Retain this relationship observation?'}</h3></div><button class="btn small" type="button" onclick={() => void closeAdmissionPreview()} aria-label="Close relationship admission preview">Close</button></header>
        <dl>
          <div><dt>Relationship type</dt><dd>{preview.relationshipType.replaceAll('_', ' ')}</dd></div>
          <div><dt>Exact observed basis</dt><dd>{preview.observedBasis}</dd></div>
          <div><dt>Connected count and scope</dt><dd>{preview.countScope}</dd></div>
          <div><dt>First retained observation</dt><dd>{preview.firstRetainedObservation ?? 'Unavailable in this transient scan projection'}</dd></div>
          <div><dt>Last retained observation</dt><dd>{preview.lastRetainedObservation ?? 'Unavailable in this transient scan projection'}</dd></div>
          <div><dt>Source identities</dt><dd>{preview.sourceIdentities.join(' · ')}</dd></div>
          <div><dt>Completeness</dt><dd>{preview.completeness}{preview.truncated ? ' · truncated' : ' · not truncated'}</dd></div>
          <div><dt>Estimated admission</dt><dd>{preview.estimatedNewNodes} newly visible or retained nodes · {preview.estimatedNewEdges} edges</dd></div>
          <div><dt>Persistence</dt><dd>{preview.persistence === 'none' ? 'None; only the local scan queue changes.' : 'One bounded browser-local relationship observation.'}</dd></div>
          <div><dt>Network and disclosure</dt><dd>{preview.networkRequests} requests · no external service receives the target</dd></div>
        </dl>
        <p class="shared-warning">{preview.sharedInfrastructureWarning}</p>
        <p><strong>Why this may help:</strong> {preview.usefulness}</p>
        <ul>{#each preview.limitations as limitation}<li>{limitation}</li>{/each}</ul>
        <div class="preview-actions"><button class="primary" type="button" onclick={() => void admitRelationship()}>{preview.action === 'expand' ? 'Load reviewed domains' : 'Retain reviewed observation'}</button><button class="btn" type="button" onclick={() => void closeAdmissionPreview()}>Cancel</button></div>
      </div>
    {/if}
    {#if retainStatus}<p class="retain-status" role="status" aria-live="polite">{retainStatus}</p>{/if}
    <details class="relationship-limitations"><summary>Interpretation limits</summary>{#each limitations as limitation}<p>{limitation}</p>{/each}</details>
  </section>
{/if}

<style>
  .relationships{min-width:0;margin-top:16px;padding:var(--card-pad)}
  .relationships h2{margin:0}
  .relationship-intro,.relationship-limitations p{color:var(--muted);font-size:var(--text-xs)}
  .relationship-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:14px}
  .relationship-list article{min-width:0;padding:13px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
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
  .relationship-actions button{max-width:100%;margin:0;white-space:normal}
  .retain-status{margin:10px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .admission-preview{display:grid;gap:11px;margin-top:14px;padding:14px;border:1px solid color-mix(in srgb,var(--accent) 48%,var(--border));border-radius:var(--radius-md);background:var(--panel-raised)}.admission-preview:focus{outline:none}.admission-preview:focus-visible{outline:2px solid var(--focus);outline-offset:3px}.admission-preview>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.admission-preview h3{margin:3px 0 0;font:700 var(--text-sm) var(--mono)}.admission-preview dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0}.admission-preview dl div{min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.admission-preview dt{color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}.admission-preview dd{margin:4px 0 0;font-size:var(--text-xs);line-height:1.45;overflow-wrap:anywhere}.admission-preview>p,.admission-preview li{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}.admission-preview .shared-warning{padding:8px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .06)}.admission-preview ul{display:grid;gap:4px;margin:0;padding-left:18px}.preview-actions{display:flex;flex-wrap:wrap;gap:7px}
  .relationship-limitations{margin-top:12px}
  .relationship-limitations summary{color:var(--muted);cursor:pointer;font-size:var(--text-xs)}
  @media(max-width:700px){.relationship-list,.admission-preview dl{grid-template-columns:minmax(0,1fr)}}
  @media(max-width:420px){.relationship-list header{grid-template-columns:34px minmax(0,1fr)}.relationship-count{grid-column:2;justify-self:start}}
</style>
