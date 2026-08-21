import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { buildExtractedLifecycleFamilyV4 } from './extracted-domain-lifecycle.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';

export const RELATIONSHIP_CONTRACT_OWNER = 'packages/contracts/relationship-portability.mts';
export const RELATIONSHIP_GRAPH_EXPORT_SCHEMA = 'whoisleuth.relationship-graph';
export const RELATIONSHIP_GRAPH_EXPORT_VERSION = 3;
export const MAX_RELATIONSHIP_GRAPH_EXPORT_BYTES = 512 * 1024;
export const CASE_RELATIONSHIP_CLUSTER_VERSION = 2;
export const REVIEWED_RELATIONSHIP_CLUSTERS_SCHEMA = 'whoisleuth.reviewed-relationship-clusters';

const RELATIONSHIP_GRAPH_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.relationship-graph', kind: 'export', schema: RELATIONSHIP_GRAPH_EXPORT_SCHEMA,
  currentVersion: RELATIONSHIP_GRAPH_EXPORT_VERSION, supportedVersions: [1, 2, RELATIONSHIP_GRAPH_EXPORT_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: MAX_RELATIONSHIP_GRAPH_EXPORT_BYTES,
  owner: RELATIONSHIP_CONTRACT_OWNER,
  note: 'One canonical bounded relationship document serialised as WHOISleuth JSON, GraphML, or GEXF; version 3 adds browser-local commonality context while transient graph view state remains excluded.',
});
const RELATIONSHIP_CLUSTERS_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.reviewed-relationship-clusters', kind: 'export', schema: REVIEWED_RELATIONSHIP_CLUSTERS_SCHEMA,
  currentVersion: CASE_RELATIONSHIP_CLUSTER_VERSION, supportedVersions: [CASE_RELATIONSHIP_CLUSTER_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: null, owner: RELATIONSHIP_CONTRACT_OWNER,
  note: 'Output-only bounded reviewed relationship clusters; version 2 is the only contract represented by the current producer.',
});

export function serialiseRelationshipPortableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export const RELATIONSHIP_PORTABILITY_LIFECYCLE_FAMILY = defineSchemaLifecycleFamily(buildExtractedLifecycleFamilyV4({
  id: 'relationship-portability',
  owner: RELATIONSHIP_CONTRACT_OWNER,
  serializerExportName: 'serialiseRelationshipPortableJson',
  plane: 'shared',
  projection: 'review_output',
  retention: 'operator_controlled_output',
  includedCategories: ['source-identity', 'provenance', 'completeness', 'omitted-counts', 'relationship-commonality'],
  excludedCategories: ['ownership-claims', 'coordination-claims', 'intent-claims', 'maliciousness-claims', 'raw-upstream-responses'],
  formats: [
    {
      descriptor: RELATIONSHIP_GRAPH_COMPATIBILITY,
      lifecycleSchema: RELATIONSHIP_GRAPH_EXPORT_SCHEMA,
      requiredKeys: ['schema', 'version', 'generatedAt', 'source', 'graph', 'limitations'], optionalKeys: [],
      hook: { module: 'packages/relationships/case-relationship-graph-export.mts', exportName: 'buildRelationshipGraphDocument', role: 'builder', runtime: 'shared' },
      fixtures: [
        { id: 'relationship-graph-v1', path: 'test/fixtures/extracted-domain-lifecycle/relationship-graph-v1.json', bytes: 283, sha256: 'ddc5420ca4c89959f604566b89f80d98cfa8f53c37a264f00abb7d20fdac45db', version: 1 },
        { id: 'relationship-graph-v2', path: 'test/fixtures/extracted-domain-lifecycle/relationship-graph-v2.json', bytes: 283, sha256: 'a3e6dcb99c5d3d49cf01dd715e255236d4e21c7ba13e70613923abb2c22645a3', version: 2 },
        { id: 'relationship-graph-v3', path: 'test/fixtures/extracted-domain-lifecycle/relationship-graph-v3.json', bytes: 283, sha256: '4cef26648fc6901357274b6b4e4efe630549b0b61d6720a98bf25b5829c4a7db', version: RELATIONSHIP_GRAPH_EXPORT_VERSION },
      ],
    },
    {
      descriptor: RELATIONSHIP_CLUSTERS_COMPATIBILITY,
      lifecycleSchema: REVIEWED_RELATIONSHIP_CLUSTERS_SCHEMA,
      requiredKeys: ['schema', 'version', 'generatedAt', 'sourceRelationshipCount', 'review', 'limitations'], optionalKeys: [],
      hook: { module: 'packages/relationships/case-relationship-clusters.mts', exportName: 'buildCaseRelationshipClusterExport', role: 'builder', runtime: 'shared' },
      fixtures: [{ id: 'reviewed-relationship-clusters-v2', path: 'test/fixtures/extracted-domain-lifecycle/reviewed-relationship-clusters-v2.json', bytes: 200, sha256: '6a33b0f06f7b927659b4c32182a609d70b8ec2b14ccc9bf34778b75354f448ce', version: CASE_RELATIONSHIP_CLUSTER_VERSION }],
    },
  ],
}));
