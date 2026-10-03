import { readBoundedInvestigationProjection } from './investigation-projection-reader.mts';
import { readInfrastructureObservation, compareInfrastructureObservations, type InfrastructureObservation } from './infrastructure-observation.mts';
export type RetainedInfrastructureSnapshot = { identity: string; caseId: string; observation: InfrastructureObservation };
/** Full admitted snapshot set is independent of search and source-list pagination. */
export function retainedInfrastructureSnapshots(raw: unknown): RetainedInfrastructureSnapshot[] {
  const projection = readBoundedInvestigationProjection(raw);
  if (projection.state !== 'ready') return [];
  const admitted = new Map<string, RetainedInfrastructureSnapshot>(), ambiguous = new Set<string>();
  for (const rawRow of projection.observations) {
    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) continue;
    const row = rawRow as Record<string, unknown>;
    if (row.kind !== 'case_external_observation' || row.store !== 'cases' || typeof row.id !== 'string' || row.id.length > 200 || typeof row.recordId !== 'string' || row.recordId.length > 200 || !row.infrastructureObservation) continue;
    try {
      const observation = readInfrastructureObservation(row.infrastructureObservation);
      if (admitted.has(row.id)) { ambiguous.add(row.id); continue; }
      admitted.set(row.id, { identity: row.id, caseId: row.recordId, observation });
    } catch { /* Unsupported or malformed snapshots never acquire comparison facts. */ }
  }
  return [...admitted.values()].filter(row => !ambiguous.has(row.identity)).sort((a, b) => a.observation.observedAt.localeCompare(b.observation.observedAt) || a.identity.localeCompare(b.identity));
}
export function reviewRetainedInfrastructureSnapshots(raw: unknown, selectedIds: readonly string[] = [], requestedPage = 1) {
  const projection = readBoundedInvestigationProjection(raw);
  const all = retainedInfrastructureSnapshots(raw);
  const candidates = projection.observations.filter(row => row && typeof row === 'object' && !Array.isArray(row) && Object.hasOwn(row, 'infrastructureObservation')).length;
  const partial = projection.state !== 'ready' || projection.truncated || candidates !== all.length;
  const pageCount = Math.max(1, Math.ceil(all.length / 50)), page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(pageCount, requestedPage) : 1;
  const selected = selectedIds.length <= 2 && new Set(selectedIds).size === selectedIds.length ? selectedIds.map(id => all.find(row => row.identity === id)).filter((row): row is RetainedInfrastructureSnapshot => Boolean(row)) : [];
  const comparison = selected.length === 2 ? compareInfrastructureObservations(selected[0]!.observation, selected[1]!.observation) : null;
  return { summaries: all.slice((page - 1) * 50, page * 50).map(row => ({ identity: row.identity, caseId: row.caseId, id: row.observation.id, target: row.observation.target, observedAt: row.observation.observedAt, mode: row.observation.mode, coverage: row.observation.coverage, hostCount: row.observation.scope.hostnames.length })), selected, comparison, total: all.length, page, pageCount, partial };
}
export type RetainedInfrastructureSnapshotReview = ReturnType<typeof reviewRetainedInfrastructureSnapshots>;
