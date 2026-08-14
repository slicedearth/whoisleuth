import {
  createRelationshipObservation,
  deleteRelationshipObservation as removeObservation,
  serializeRelationshipObservationStore,
  upsertRelationshipObservation,
  type RelationshipObservation,
  type RelationshipObservationInput,
} from './analysis/relationship-observation-model.ts';
import { readBrowserLocalData, updateBrowserLocalData } from './browser-local-data-service.ts';

export type { RelationshipObservation, RelationshipObservationInput } from './analysis/relationship-observation-model.ts';

export async function loadRelationshipObservations(): Promise<RelationshipObservation[]> {
  return readBrowserLocalData('relationship_observations');
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
  return updateBrowserLocalData('relationship_observations', (current) => {
    const result = upsertRelationshipObservation(current, observation);
    const observations = boundedObservations(result.observations);
    return {
      document: observations,
      result: { record: result.record, added: result.added, pruned: result.pruned },
    };
  });
}

export async function deleteRelationshipObservation(id: string): Promise<RelationshipObservation[]> {
  return updateBrowserLocalData('relationship_observations', (current) => {
    const observations = boundedObservations(removeObservation(current, id));
    return { document: observations, result: observations };
  });
}
