import {
  createRelationshipObservation,
  deleteRelationshipObservation as removeObservation,
  serializeRelationshipObservationStore,
  upsertRelationshipObservation,
  type RelationshipObservation,
  type RelationshipObservationInput,
} from './analysis/relationship-observation-model.ts';
import { browserLocalDataProvider } from './browser-local-data-service.js';
import { RELATIONSHIP_OBSERVATIONS_COLLECTION } from './browser-local-data-definitions.js';

export type { RelationshipObservation, RelationshipObservationInput } from './analysis/relationship-observation-model.ts';

export async function loadRelationshipObservations(): Promise<RelationshipObservation[]> {
  return await (await browserLocalDataProvider()).read(RELATIONSHIP_OBSERVATIONS_COLLECTION) as RelationshipObservation[];
}

function boundedObservations(raw: unknown): RelationshipObservation[] {
  return JSON.parse(serializeRelationshipObservationStore(raw)).observations as RelationshipObservation[];
}

export async function retainRelationshipObservation(
  input: RelationshipObservationInput,
  options: {
    observedAt?: unknown;
    retainedAt?: unknown;
    complete?: unknown;
    truncated?: unknown;
    limitations?: unknown;
    sourceVersion?: unknown;
  } = {},
): Promise<{ record: RelationshipObservation; added: boolean; pruned: number }> {
  const observation = createRelationshipObservation(input, options);
  return (await browserLocalDataProvider()).update(RELATIONSHIP_OBSERVATIONS_COLLECTION, (current) => {
    const result = upsertRelationshipObservation(current, observation);
    const observations = boundedObservations(result.observations);
    return {
      document: observations,
      result: { record: result.record, added: result.added, pruned: result.pruned },
    };
  });
}

export async function deleteRelationshipObservation(id: string): Promise<RelationshipObservation[]> {
  return (await browserLocalDataProvider()).update(RELATIONSHIP_OBSERVATIONS_COLLECTION, (current) => {
    const observations = boundedObservations(removeObservation(current, id));
    return { document: observations, result: observations };
  });
}
