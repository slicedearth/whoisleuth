// Pure, bounded discovery-path projection over the existing local
// investigation graph. Domain roots come only from explicit case, campaign,
// or Brand Profile relationships. The projection performs no requests and
// does not turn graph distance into an ownership or attribution claim.

import {
  MAX_PROJECTION_LIMITATIONS,
  type InvestigationRelationshipClassification,
} from './investigation-projection.ts';
import { readBoundedInvestigationProjection } from './investigation-projection-reader.ts';

export const INVESTIGATION_LINEAGE_VERSION = 1;
export const MAX_INVESTIGATION_LINEAGE_PATHS = 10_000;
export const MAX_INVESTIGATION_LINEAGE_PATHS_PER_SEED = 100;
export const MAX_INVESTIGATION_LINEAGE_STEPS = 8;
export const MAX_INVESTIGATION_LINEAGE_LABEL = 300;

const CONTROL_RE = /[\x00-\x1f\x7f]/;
const ROOT_RELATIONSHIP_TYPES = new Set([
  'case_documents_domain',
  'brand_declares_official_domain',
  'campaign_contains_domain',
]);
const CLASSIFICATIONS = new Set<InvestigationRelationshipClassification>([
  'direct',
  'normalized',
  'derived',
]);

type UnknownRecord = Record<string, unknown>;

export interface InvestigationLineageEntity {
  id: string;
  type: string;
  label: string;
}

export interface InvestigationLineageStep {
  position: number;
  relationshipId: string;
  relationshipType: string;
  method: string;
  classification: InvestigationRelationshipClassification;
  from: InvestigationLineageEntity;
  to: InvestigationLineageEntity;
}

export interface InvestigationLineagePath {
  id: string;
  seed: InvestigationLineageEntity;
  seedMethods: string[];
  immediateParent: InvestigationLineageEntity;
  target: InvestigationLineageEntity;
  hopCount: number;
  scopeDistance: number;
  discoveryMethod: string;
  classification: InvestigationRelationshipClassification;
  steps: InvestigationLineageStep[];
  complete: boolean | null;
  truncated: boolean;
  limitations: string[];
}

export interface InvestigationLineageProjection {
  version: typeof INVESTIGATION_LINEAGE_VERSION;
  projectionVersion: number | null;
  state: string;
  paths: InvestigationLineagePath[];
  truncated: boolean;
  limitations: string[];
}

interface ParsedRelationship {
  id: string;
  type: string;
  from: string;
  to: string;
  method: string;
  classification: InvestigationRelationshipClassification;
  complete: boolean | null;
  truncated: boolean;
  limitations: string[];
}

interface PendingPath {
  seed: InvestigationLineageEntity;
  seedMethods: string[];
  current: InvestigationLineageEntity;
  steps: InvestigationLineageStep[];
  visitedEntityIds: Set<string>;
  complete: boolean | null;
  truncated: boolean;
  limitations: string[];
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown, maximum = MAX_INVESTIGATION_LINEAGE_LABEL): string {
  if (typeof value !== 'string' || value.length > maximum * 8 || CONTROL_RE.test(value)) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maximum).trim();
}

function entity(value: unknown): InvestigationLineageEntity | null {
  const item = record(value);
  const id = text(item?.id, 100);
  const type = text(item?.type, 40);
  const label = text(item?.label ?? item?.canonical);
  return id && type && label ? { id, type, label } : null;
}

function limitations(value: unknown): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const candidate of (Array.isArray(value) ? value : []).slice(0, MAX_PROJECTION_LIMITATIONS * 4)) {
    const normalized = text(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= MAX_PROJECTION_LIMITATIONS) break;
  }
  return output;
}

function classification(value: unknown): InvestigationRelationshipClassification {
  return typeof value === 'string' && CLASSIFICATIONS.has(value as InvestigationRelationshipClassification)
    ? value as InvestigationRelationshipClassification
    : 'derived';
}

function mergeComplete(
  left: boolean | null,
  right: boolean | null,
): boolean | null {
  if (left === false || right === false) return false;
  if (left === true && right === true) return true;
  return null;
}

function strongestClassification(
  steps: InvestigationLineageStep[],
): InvestigationRelationshipClassification {
  if (steps.some((step) => step.classification === 'derived')) return 'derived';
  if (steps.some((step) => step.classification === 'normalized')) return 'normalized';
  return 'direct';
}

function digest(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function parseRelationship(value: unknown): ParsedRelationship | null {
  const item = record(value);
  const id = text(item?.id, 100);
  const type = text(item?.type, 80);
  const from = text(item?.from, 100);
  const to = text(item?.to, 100);
  if (!id || !type || !from || !to) return null;
  return {
    id,
    type,
    from,
    to,
    method: text(item?.method, 200),
    classification: classification(item?.classification),
    complete: typeof item?.complete === 'boolean' ? item.complete : null,
    truncated: item?.truncated === true || item?.sourceObservationsTruncated === true,
    limitations: limitations(item?.limitations),
  };
}

function unavailable(
  state: string,
  projectionVersion: number | null,
  detail: string,
): InvestigationLineageProjection {
  return {
    version: INVESTIGATION_LINEAGE_VERSION,
    projectionVersion,
    state,
    paths: [],
    truncated: false,
    limitations: detail ? [detail] : [],
  };
}

/**
 * Derives deterministic paths outward from explicitly retained domain roots.
 * One shortest path per seed and target is retained. Further equal-length paths
 * remain represented by their source relationships, but are not duplicated in
 * this compact lineage projection.
 */
export function buildInvestigationLineage(
  rawProjection: unknown,
): InvestigationLineageProjection {
  const projection = readBoundedInvestigationProjection(rawProjection);
  if (projection.state !== 'ready') {
    return unavailable(projection.state, projection.version, projection.detail);
  }

  const entities = new Map<string, InvestigationLineageEntity>();
  let truncated = projection.truncated;
  for (const value of projection.entities) {
    const parsed = entity(value);
    if (!parsed || entities.has(parsed.id)) {
      if (value !== null && value !== undefined) truncated = true;
      continue;
    }
    entities.set(parsed.id, parsed);
  }

  const relationships = projection.relationships
    .map(parseRelationship)
    .filter((value): value is ParsedRelationship => value !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (relationships.length < projection.relationships.length) truncated = true;

  const seedMethods = new Map<string, Set<string>>();
  const adjacency = new Map<string, ParsedRelationship[]>();
  for (const relationship of relationships) {
    const from = entities.get(relationship.from);
    const to = entities.get(relationship.to);
    if (!from || !to) {
      truncated = true;
      continue;
    }
    if (ROOT_RELATIONSHIP_TYPES.has(relationship.type) && to.type === 'domain') {
      if (!seedMethods.has(to.id)) seedMethods.set(to.id, new Set());
      seedMethods.get(to.id)?.add(relationship.type);
      continue;
    }
    if (!adjacency.has(from.id)) adjacency.set(from.id, []);
    adjacency.get(from.id)?.push(relationship);
  }
  for (const outgoing of adjacency.values()) outgoing.sort((left, right) => left.id.localeCompare(right.id));

  const paths: InvestigationLineagePath[] = [];
  const seeds = [...seedMethods.keys()]
    .map((id) => entities.get(id))
    .filter((value): value is InvestigationLineageEntity => value !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const seed of seeds) {
    const retainedTargets = new Set<string>();
    const queue: PendingPath[] = [{
      seed,
      seedMethods: [...(seedMethods.get(seed.id) ?? [])].sort(),
      current: seed,
      steps: [],
      visitedEntityIds: new Set([seed.id]),
      complete: true,
      truncated: false,
      limitations: [],
    }];
    let seedPathCount = 0;
    while (queue.length) {
      const pending = queue.shift();
      if (!pending) break;
      const outgoing = adjacency.get(pending.current.id) ?? [];
      for (const relationship of outgoing) {
        const target = entities.get(relationship.to);
        if (!target || pending.visitedEntityIds.has(target.id)) continue;
        if (pending.steps.length >= MAX_INVESTIGATION_LINEAGE_STEPS) {
          truncated = true;
          continue;
        }
        const step: InvestigationLineageStep = {
          position: pending.steps.length + 1,
          relationshipId: relationship.id,
          relationshipType: relationship.type,
          method: relationship.method,
          classification: relationship.classification,
          from: pending.current,
          to: target,
        };
        const steps = [...pending.steps, step];
        const pathLimitations = limitations([
          ...pending.limitations,
          ...relationship.limitations,
        ]);
        const pathTruncated = pending.truncated || relationship.truncated;
        const pathComplete = mergeComplete(pending.complete, relationship.complete);
        if (!retainedTargets.has(target.id)) {
          if (seedPathCount >= MAX_INVESTIGATION_LINEAGE_PATHS_PER_SEED
            || paths.length >= MAX_INVESTIGATION_LINEAGE_PATHS) {
            truncated = true;
            break;
          }
          retainedTargets.add(target.id);
          seedPathCount += 1;
          const semantic = `${seed.id}\u0000${steps.map((item) => item.relationshipId).join('\u0000')}`;
          paths.push({
            id: `lineage:${digest(semantic)}`,
            seed,
            seedMethods: pending.seedMethods,
            immediateParent: pending.current,
            target,
            hopCount: steps.length,
            scopeDistance: steps.length,
            discoveryMethod: relationship.method,
            classification: strongestClassification(steps),
            steps,
            complete: pathComplete,
            truncated: pathTruncated,
            limitations: pathLimitations,
          });
        }
        if (steps.length < MAX_INVESTIGATION_LINEAGE_STEPS
          && seedPathCount < MAX_INVESTIGATION_LINEAGE_PATHS_PER_SEED
          && paths.length < MAX_INVESTIGATION_LINEAGE_PATHS) {
          queue.push({
            seed,
            seedMethods: pending.seedMethods,
            current: target,
            steps,
            visitedEntityIds: new Set([...pending.visitedEntityIds, target.id]),
            complete: pathComplete,
            truncated: pathTruncated,
            limitations: pathLimitations,
          });
        }
      }
      if (paths.length >= MAX_INVESTIGATION_LINEAGE_PATHS
        || seedPathCount >= MAX_INVESTIGATION_LINEAGE_PATHS_PER_SEED) break;
    }
  }

  paths.sort((left, right) => left.seed.label.localeCompare(right.seed.label)
    || left.scopeDistance - right.scopeDistance
    || left.target.label.localeCompare(right.target.label)
    || left.id.localeCompare(right.id));
  return {
    version: INVESTIGATION_LINEAGE_VERSION,
    projectionVersion: projection.version,
    state: 'ready',
    paths,
    truncated,
    limitations: limitations([
      ...(Array.isArray(projection.limitations) ? projection.limitations : []),
      'Discovery paths are bounded local explanations. Scope distance does not establish ownership, coordination, intent, maliciousness, or safety.',
      ...(truncated ? ['Some discovery paths or path details were omitted by projection safety limits.'] : []),
    ]),
  };
}
