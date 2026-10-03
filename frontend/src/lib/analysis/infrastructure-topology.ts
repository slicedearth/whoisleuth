// Disposable diagram presentation over one already-admitted source page.
import type { InvestigationInfrastructureRelationship, InvestigationInfrastructureRelationships } from './investigation-infrastructure.ts';
import { MAX_INVESTIGATION_SEARCH_RESULTS } from './investigation-search.ts';
import type { ForceGraphLinkInput, ForceGraphNodeInput } from './visualization-models.ts';
import { MAX_FORCE_GRAPH_NODES } from './visualization-models.ts';

export const INFRASTRUCTURE_RELATIONSHIP_LABELS: Readonly<Record<InvestigationInfrastructureRelationship['type'], string>> = Object.freeze({
  domain_uses_nameserver_set: 'Nameserver relationship', domain_reached_http_origin: 'Observed HTTP origin',
  case_documents_domain: 'Case documents domain', brand_declares_official_domain: 'Declared official domain',
  brand_declares_official_favicon: 'Declared official favicon', domain_observed_favicon: 'Observed favicon',
  campaign_contains_domain: 'Campaign includes domain', campaign_contains_case: 'Campaign includes Case',
  domain_presented_certificate: 'Certificate relationship', domain_resolved_to_ip: 'Retained DNS address',
  domain_aliases_to_domain: 'Retained DNS alias', domain_uses_mail_server: 'Mail-server relationship',
  domain_exposed_tracking_identifier: 'Tracking identifier', domain_related_by_favicon: 'Derived favicon relationship',
  domain_loaded_official_asset: 'Official-asset observation',
});

export function projectInfrastructureTopology(response: InvestigationInfrastructureRelationships, query = '', focusedEntityId = response.entityId) {
  const search = query.slice(0, 200).trim().toLowerCase();
  const rows = response.state === 'ready' ? response.rows.slice(0, MAX_INVESTIGATION_SEARCH_RESULTS).filter(row => !search || [
    row.from.canonical, row.to.canonical, row.type, INFRASTRUCTURE_RELATIONSHIP_LABELS[row.type], row.classification,
    row.method, row.source?.source, row.source?.recordId, row.source?.observedAt,
  ].some(value => value?.toLowerCase().includes(search))) : [];
  const identities = new Map<string, InvestigationInfrastructureRelationship['from']>();
  for (const row of rows) for (const entity of [row.from, row.to]) identities.set(entity.id, entity);
  const entities = [...identities.values()].sort((a, b) => Number(b.id === response.entityId) - Number(a.id === response.entityId)
    || a.type.localeCompare(b.type) || a.canonical.localeCompare(b.canonical) || a.id.localeCompare(b.id))
    .map((entity, index) => ({ ...entity, diagramReference: index + 1 }));
  const diagramEntities = entities.slice(0, MAX_FORCE_GRAPH_NODES);
  const focusEntity = diagramEntities.find(entity => entity.id === focusedEntityId)
    ?? diagramEntities.find(entity => entity.id === response.entityId) ?? diagramEntities[0] ?? null;
  // Exact identities remain in entities/rows. Short, injective page-local aliases
  // avoid the existing visual normaliser truncating long IDs into collisions.
  const aliases = new Map(entities.map((entity, index) => [entity.id, `retained-${String(index).padStart(3, '0')}`]));
  const nodes: ForceGraphNodeInput[] = entities.map(entity => ({
    id: aliases.get(entity.id)!, label: `${entity.canonical.length > 54 ? `${entity.canonical.slice(0, 50)}…` : entity.canonical} [${entity.diagramReference}]`,
    kind: entity.id === focusEntity?.id ? 'target' : 'relationship', detail: entity.type.replaceAll('_', ' '),
    group: entity.type, groupLabel: `${entity.type.replaceAll('_', ' ')} identities`,
  }));
  const links: ForceGraphLinkInput[] = rows.map((row, index) => ({
    id: `source-row-${String(index).padStart(3, '0')}`, source: aliases.get(row.from.id)!, target: aliases.get(row.to.id)!,
    kind: !row.source ? 'unknown' : row.partial ? 'partial' : row.classification === 'derived' ? 'derived' : 'observed',
    detail: `${INFRASTRUCTURE_RELATIONSHIP_LABELS[row.type]} · ${row.classification} · ${row.source?.source ?? 'source unavailable'}`,
  }));
  return { rows, entities, diagramEntities, focusEntity, aliases, nodes, links, focusNodeId: focusEntity ? aliases.get(focusEntity.id)! : '' };
}
