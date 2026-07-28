// Shared fail-closed reader for the versioned investigation projection.
// Consumers receive bounded, non-mutating collection views so search and
// relationship analysis cannot drift on schema checks or traversal limits.

import {
  INVESTIGATION_PROJECTION_SCHEMA,
  INVESTIGATION_PROJECTION_VERSION,
  MAX_PROJECTION_ENTITIES,
  MAX_PROJECTION_OBSERVATIONS,
  MAX_PROJECTION_RELATIONSHIPS,
} from './investigation-projection.ts';

export type InvestigationProjectionReadState = 'absent' | 'invalid' | 'unsupported' | 'ready';

export interface BoundedInvestigationProjection {
  state: InvestigationProjectionReadState;
  version: number | null;
  generatedAt: unknown;
  sources: unknown;
  entities: unknown[];
  observations: unknown[];
  relationships: unknown[];
  limitations: unknown;
  truncated: boolean;
  detail: string;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function positiveVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function unavailable(
  state: Exclude<InvestigationProjectionReadState, 'ready'>,
  version: number | null,
  detail: string,
): BoundedInvestigationProjection {
  return {
    state,
    version,
    generatedAt: null,
    sources: null,
    entities: [],
    observations: [],
    relationships: [],
    limitations: [],
    truncated: false,
    detail,
  };
}

/**
 * Validates the current projection envelope once and returns bounded collection
 * slices. Item-level normalizers remain owned by each consumer.
 */
export function readBoundedInvestigationProjection(value: unknown): BoundedInvestigationProjection {
  if (value === null || value === undefined) {
    return unavailable('absent', null, 'The local investigation projection was not available.');
  }
  const projection = record(value);
  const version = positiveVersion(projection?.version);
  if (!projection || projection.schema !== INVESTIGATION_PROJECTION_SCHEMA || version === null) {
    return unavailable('invalid', version, 'The local investigation projection was malformed and was not interpreted.');
  }
  if (version > INVESTIGATION_PROJECTION_VERSION) {
    return unavailable(
      'unsupported',
      version,
      `Investigation projection schema ${version} is newer than supported schema ${INVESTIGATION_PROJECTION_VERSION}; it was not interpreted.`,
    );
  }
  if (version !== INVESTIGATION_PROJECTION_VERSION
    || !Array.isArray(projection.entities)
    || !Array.isArray(projection.observations)
    || !Array.isArray(projection.relationships)) {
    return unavailable('invalid', version, 'The local investigation projection did not match the current collection contract.');
  }
  return {
    state: 'ready',
    version,
    generatedAt: projection.generatedAt,
    sources: projection.sources,
    entities: projection.entities.slice(0, MAX_PROJECTION_ENTITIES),
    observations: projection.observations.slice(0, MAX_PROJECTION_OBSERVATIONS),
    relationships: projection.relationships.slice(0, MAX_PROJECTION_RELATIONSHIPS),
    limitations: projection.limitations,
    truncated: projection.truncated === true
      || projection.entities.length > MAX_PROJECTION_ENTITIES
      || projection.observations.length > MAX_PROJECTION_OBSERVATIONS
      || projection.relationships.length > MAX_PROJECTION_RELATIONSHIPS,
    detail: '',
  };
}
