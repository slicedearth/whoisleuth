import type { AnyLocalDataCollectionDefinition } from '../browser-local-data.ts';

export function guardedWorkspaceRollback(
  definitions: readonly AnyLocalDataCollectionDefinition[],
  currentDocuments: ReadonlyMap<string, unknown>,
  appliedDocuments: ReadonlyMap<string, unknown>,
  previousDocuments: ReadonlyMap<string, unknown>,
): Map<string, unknown> {
  for (const definition of definitions) {
    const current = definition.serialize(definition.normalize(currentDocuments.get(definition.id)));
    const applied = definition.serialize(definition.normalize(appliedDocuments.get(definition.id)));
    if (current !== applied) {
      throw new Error('Workspace data changed in another tab after import; automatic rollback was not applied.');
    }
  }
  return new Map(previousDocuments);
}
