// Derived local view; append-only owners retain the evidence and event clocks.
import type { CaseRecord } from './case-record-contracts.mts';
import type { CaseIncidentTarget } from './case-workflow-metadata.mts';
import {
  retainedCaseResponseObjects,
  sameCaseResponseObject,
  type CaseResponseObject,
} from './case-response-object.mts';
import { correctionDelivery } from './case-packet-correction.mts';

export function buildCaseIncidentCoverage(
  record: Pick<CaseRecord, 'workflowMetadata'> &
    Partial<
      Pick<
        CaseRecord,
        | 'createdAt'
        | 'updatedAt'
        | 'actions'
        | 'observedEffects'
        | 'evidencePins'
        | 'closures'
        | 'assertions'
      >
    >,
) {
  const objects = new Map<
    string,
    { target: CaseIncidentTarget; object: CaseResponseObject; targetRetained: boolean }
  >();
  const explicit = retainedCaseResponseObjects(record);
  for (const target of record.workflowMetadata?.incidentTargets ?? []) {
    const matching = explicit.filter(
      (object) => object.incidentTargetId === target.id && object.identifier === target.url,
    );
    for (const object of matching.length
      ? matching
      : [{ kind: 'other' as const, identifier: target.url, incidentTargetId: target.id }])
      objects.set(JSON.stringify(object), { target, object, targetRetained: true });
  }
  for (const object of explicit)
    if (!objects.has(JSON.stringify(object)))
      objects.set(JSON.stringify(object), {
        object,
        targetRetained: false,
        target: {
          id: object.incidentTargetId ?? `${object.kind}-${object.identifier}`,
          url: object.identifier,
          state: 'open',
          createdAt: record.createdAt ?? '',
          updatedAt: record.updatedAt ?? '',
        },
      });
  return [...objects.values()].map(({ target, object, targetRetained }) => {
    const contexts = (record.actions ?? [])
      .map((action) => ({
        action,
        currentlyBound: Boolean(
          action.responseObjects?.some((bound) => sameCaseResponseObject(bound, object)),
        ),
        events: action.history.filter((event) =>
          event.responseObjects?.some((bound) => sameCaseResponseObject(bound, object)),
        ),
      }))
      .filter((context) => context.currentlyBound || context.events.length);
    const actions = contexts
      .filter((context) => context.currentlyBound)
      .map((context) => context.action);
    const responseContexts = contexts.map(({ action, currentlyBound, events }) => {
      let correction = null;
      if (currentlyBound && action.correction) {
        let linkAvailable = false;
        try {
          linkAvailable = Boolean(correctionDelivery(record.actions ?? [], action));
        } catch {
          /* Historical linkage can be unavailable; the draft is not re-authorised here. */
        }
        correction = {
          purpose: action.correction.purpose,
          originActionId: action.originActionId,
          deliveryEventId: action.correction.deliveryEventId,
          packetDigestSha256: action.correction.packetDigestSha256,
          packetVersion: action.correction.packetVersion,
          linkAvailable,
        };
      }
      return {
        actionId: action.id,
        type: action.type,
        recipient: action.recipient,
        contactSource: action.contactSource,
        routeObservedAt: action.routeObservedAt,
        routeReviewAfter: action.routeReviewAfter,
        contactLimitations: action.contactLimitations,
        metadataUpdatedAt: action.metadataUpdatedAt,
        currentState: action.state,
        currentlyBound,
        historyOmitted: action.historyOmitted,
        historyLimitations: action.historyLimitations,
        reviewEvents: events.filter(
          (event) =>
            event.sourceClass === 'analyst' &&
            (event.nextState === 'reviewed' || event.nextState === 'authorised'),
        ),
        // A repeated submitted-state update alone does not establish another delivery.
        deliveryEvents: events.filter(
          (event) =>
            event.sourceClass === 'analyst' &&
            event.nextState === 'submitted' &&
            (event.previousState === 'authorised' || Boolean(event.packetReceipt)),
        ),
        correction,
      };
    });
    const responseEvents = contexts.flatMap(({ action, events }) =>
      events
        .filter(
          (event) =>
            event.providerOutcome || event.objectOutcome || event.nextState === 'acknowledged',
        )
        .map((event) => ({
          actionId: action.id,
          eventId: event.id,
          state: event.nextState,
          outcome: event.objectOutcome ?? event.providerOutcome,
          occurredAt: event.occurredAt,
          sourceClass: event.sourceClass,
          applied: event.applied,
          provenance: event.provenance,
          reference: event.reference,
        })),
    );
    const reviews = (record.observedEffects?.reviews ?? []).filter((review) =>
      sameCaseResponseObject(review.responseObject, object),
    );
    const latestAt = Math.max(...reviews.map((review) => Date.parse(review.observedAt)));
    const latest = reviews.filter((review) => Date.parse(review.observedAt) === latestAt);
    return {
      target,
      targetRetained,
      responseObject: object,
      hostname:
        object.kind === 'domain' || object.kind === 'hostname'
          ? object.identifier
          : new URL(object.identifier).hostname,
      actionCoverage: actions.length ? ('bound' as const) : ('unknown' as const),
      actionIds: actions.map((action) => action.id),
      responseContexts,
      providerEvents: responseEvents.filter((event) => event.applied),
      unappliedProviderEvents: responseEvents.filter((event) => !event.applied),
      observationCoverage: !reviews.length
        ? ('unknown' as const)
        : new Set(latest.map((review) => `${review.state}\u0000${review.objectOutcome ?? ''}`))
              .size > 1
          ? ('ambiguous' as const)
          : ('available' as const),
      reviews,
      closures: (record.closures?.records ?? []).filter((closure) =>
        sameCaseResponseObject(closure.responseObject, object),
      ),
    };
  });
}
