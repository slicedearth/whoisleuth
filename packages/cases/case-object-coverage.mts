// Derived local view; append-only owners retain the evidence and event clocks.
import type { CaseRecord } from './case-record-contracts.mts';
import type { CaseIncidentTarget } from './case-workflow-metadata.mts';
import { retainedCaseResponseObjects, sameCaseResponseObject, type CaseResponseObject } from './case-response-object.mts';

export function buildCaseIncidentCoverage(record: Pick<CaseRecord, 'workflowMetadata'> & Partial<Pick<CaseRecord, 'createdAt' | 'updatedAt' | 'actions' | 'observedEffects' | 'evidencePins' | 'closures' | 'assertions'>>) {
  const objects = new Map<string, { target: CaseIncidentTarget; object: CaseResponseObject; targetRetained: boolean }>();
  const explicit = retainedCaseResponseObjects(record);
  for (const target of record.workflowMetadata?.incidentTargets ?? []) {
    const matching = explicit.filter(object => object.incidentTargetId === target.id && object.identifier === target.url);
    for (const object of matching.length ? matching : [{ kind: 'other' as const, identifier: target.url, incidentTargetId: target.id }]) objects.set(JSON.stringify(object), { target, object, targetRetained: true });
  }
  for (const object of explicit) if (!objects.has(JSON.stringify(object))) objects.set(JSON.stringify(object), {
    object, targetRetained: false,
    target: { id: object.incidentTargetId ?? `${object.kind}-${object.identifier}`, url: object.identifier, state: 'open', createdAt: record.createdAt ?? '', updatedAt: record.updatedAt ?? '' },
  });
  return [...objects.values()].map(({ target, object, targetRetained }) => {
    const actions = (record.actions ?? []).filter(action => action.responseObjects?.some(bound => sameCaseResponseObject(bound, object)));
    const reviews = (record.observedEffects?.reviews ?? []).filter(review => sameCaseResponseObject(review.responseObject, object));
    const latestAt = Math.max(...reviews.map(review => Date.parse(review.observedAt)));
    const latest = reviews.filter(review => Date.parse(review.observedAt) === latestAt);
    return { target, targetRetained, responseObject: object,
      hostname: object.kind === 'domain' || object.kind === 'hostname' ? object.identifier : new URL(object.identifier).hostname,
      actionCoverage: actions.length ? 'bound' as const : 'unknown' as const,
      actionIds: actions.map(action => action.id),
      providerEvents: (record.actions ?? []).flatMap(action => action.history.filter(event => event.applied
        && event.responseObjects?.some(bound => sameCaseResponseObject(bound, object))
        && (event.providerOutcome || event.objectOutcome || event.nextState === 'acknowledged'))
        .map(event => ({ actionId: action.id, eventId: event.id, state: event.nextState, outcome: event.objectOutcome ?? event.providerOutcome, occurredAt: event.occurredAt, sourceClass: event.sourceClass }))),
      observationCoverage: !reviews.length ? 'unknown' as const : new Set(latest.map(review => `${review.state}\u0000${review.objectOutcome ?? ''}`)).size > 1 ? 'ambiguous' as const : 'available' as const,
      reviews,
      closures: (record.closures?.records ?? []).filter(closure => sameCaseResponseObject(closure.responseObject, object)),
    };
  });
}
