// Append-only response actions: transitions, reconciliation and bounded history.

import {
  CASE_SCHEMA_VERSION,
  MAX_CASE_ACTIONS,
  MAX_CASE_ACTION_BYTES,
  MAX_CASE_ACTION_EVENTS_PER_ACTION,
  MAX_CASE_ACTION_EVENTS_PER_CASE,
  MAX_CASE_ACTION_HISTORY_BYTES_PER_CASE,
  MAX_RESPONSE_LABEL_LENGTH,
  MAX_RESPONSE_RATIONALE_LENGTH,
  MAX_RESPONSE_RECIPIENT_LENGTH,
  MAX_RESPONSE_REFERENCE_LENGTH,
} from '../contracts/case-portability.mts';
import {
  normalizeExplicitIsoTimestamp,
} from '../evidence/observation.mts';
import {
  CASE_ACTION_EVENT_SOURCE_CLASSES,
  CASE_ACTION_STATES,
  CASE_ACTION_TYPES,
  CASE_PROVIDER_OUTCOMES,
  type CaseActionEventSourceClass,
  type CaseActionOutcomeSummary,
  type CaseActionRecord,
  type CaseActionState,
  type CaseActionTransitionEvent,
  type CaseActionType,
  type CaseProviderOutcome,
  type CaseResponseTimestampOptions,
} from './case-response-records.mts';
import {
  SAFE_ID_RE,
  boundedCounter,
  compareCodeUnits,
  deterministicId,
  freshId,
  iso,
  lifecycleLimitations,
  limitations,
  optionalIso,
  record,
  safeId,
  text,
} from './case-response-values.mts';

const ACTION_TYPES = new Set<string>(CASE_ACTION_TYPES);

const ACTION_STATES = new Set<string>(CASE_ACTION_STATES);

const PROVIDER_OUTCOMES = new Set<string>(CASE_PROVIDER_OUTCOMES);

const ACTION_EVENT_SOURCE_CLASSES = new Set<string>(CASE_ACTION_EVENT_SOURCE_CLASSES);

function currentActionNormalizationOptions(
  validEvidencePinIds?: ReadonlySet<string>,
): CaseResponseTimestampOptions {
  return validEvidencePinIds
    ? { sourceVersion: CASE_SCHEMA_VERSION, validEvidencePinIds }
    : { sourceVersion: CASE_SCHEMA_VERSION };
}

const LEGACY_ACTION_STATE_MAP: Readonly<Record<string, CaseActionState>> = Object.freeze({
  planned: 'drafting',
  ready_for_review: 'ready_for_review',
  submitted: 'submitted',
  acknowledged: 'acknowledged',
  resolved: 'terminal',
  closed: 'terminal',
});

const ACTION_TRANSITIONS: Readonly<Record<CaseActionState, ReadonlySet<CaseActionState>>> = Object.freeze({
  drafting: new Set<CaseActionState>(['ready_for_review', 'terminal']),
  ready_for_review: new Set<CaseActionState>(['drafting', 'reviewed', 'terminal']),
  reviewed: new Set<CaseActionState>(['drafting', 'authorised', 'terminal']),
  authorised: new Set<CaseActionState>(['drafting', 'submitted', 'terminal']),
  submitted: new Set<CaseActionState>(['submitted', 'acknowledged', 'terminal']),
  acknowledged: new Set<CaseActionState>(['acknowledged', 'terminal']),
  terminal: new Set<CaseActionState>(),
});

function bytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function isLegalCaseActionTransition(
  previousState: CaseActionState | null,
  nextState: CaseActionState,
  sourceClass: CaseActionEventSourceClass = 'analyst',
): boolean {
  if (previousState === null) {
    return sourceClass === 'migration'
      || nextState === 'drafting' && (sourceClass === 'analyst' || sourceClass === 'browser_local');
  }
  if (!ACTION_TRANSITIONS[previousState].has(nextState)) return false;
  if (sourceClass === 'provider' || sourceClass === 'import') {
    return (previousState === 'submitted' || previousState === 'acknowledged')
      && (nextState === 'submitted' || nextState === 'acknowledged' || nextState === 'terminal');
  }
  if (sourceClass === 'browser_local') {
    return nextState === 'drafting' && ['ready_for_review', 'reviewed', 'authorised'].includes(previousState);
  }
  return sourceClass === 'analyst';
}

function normalizeActionEvent(
  raw: unknown,
  actionId: string,
  options: CaseResponseTimestampOptions = {},
): CaseActionTransitionEvent | null {
  const item = record(raw);
  const previousState = item.previousState === null
    ? null
    : typeof item.previousState === 'string' && ACTION_STATES.has(item.previousState)
      ? item.previousState as CaseActionState
      : undefined;
  const nextState = typeof item.nextState === 'string' && ACTION_STATES.has(item.nextState)
    ? item.nextState as CaseActionState
    : null;
  const sourceClass = typeof item.sourceClass === 'string' && ACTION_EVENT_SOURCE_CLASSES.has(item.sourceClass)
    ? item.sourceClass as CaseActionEventSourceClass
    : null;
  const occurredAt = optionalIso(item.occurredAt, options);
  if (previousState === undefined || !nextState || !sourceClass || !occurredAt
    || !isLegalCaseActionTransition(previousState, nextState, sourceClass)) {
    return null;
  }
  const migrationSnapshot = sourceClass === 'migration' && previousState === null;
  if (['ready_for_review', 'reviewed', 'authorised', 'submitted'].includes(nextState)
    && sourceClass !== 'analyst' && !migrationSnapshot) return null;
  const provenance = text(item.provenance, MAX_RESPONSE_LABEL_LENGTH) || `${sourceClass}_record`;
  const providerOutcome = typeof item.providerOutcome === 'string' && PROVIDER_OUTCOMES.has(item.providerOutcome)
    ? item.providerOutcome as CaseProviderOutcome
    : null;
  if (providerOutcome && !['submitted', 'acknowledged', 'terminal'].includes(nextState) && sourceClass !== 'migration') {
    return null;
  }
  if (providerOutcome && previousState === 'authorised' && nextState === 'submitted' && !migrationSnapshot) {
    return null;
  }
  if (providerOutcome === 'no_response' && sourceClass === 'provider') return null;
  if (nextState === 'terminal' && previousState !== null
    && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(previousState)
    && (sourceClass !== 'analyst' || providerOutcome !== 'withdrawn')) {
    return null;
  }
  if (providerOutcome === 'withdrawn'
    && (nextState !== 'terminal' || (sourceClass !== 'analyst' && !migrationSnapshot))) return null;
  const candidateEvidencePinId = typeof item.evidencePinId === 'string' && SAFE_ID_RE.test(item.evidencePinId)
    ? item.evidencePinId
    : null;
  const evidencePinId = candidateEvidencePinId
    && (!options.validEvidencePinIds || options.validEvidencePinIds.has(candidateEvidencePinId))
    ? candidateEvidencePinId
    : null;
  const eventMaterial = {
    previousState,
    nextState,
    occurredAt,
    sourceClass,
    provenance,
    reference: text(item.reference, MAX_RESPONSE_REFERENCE_LENGTH) || null,
    evidencePinId,
    limitations: limitations([
      ...(item.evidencePinId != null && !evidencePinId ? ['A malformed or dangling evidence-pin reference was omitted from this transition.'] : []),
      ...limitations(item.limitations),
    ]),
    providerOutcome,
    outcomeDetail: text(item.outcomeDetail, MAX_RESPONSE_RATIONALE_LENGTH) || null,
    originActionId: typeof item.originActionId === 'string' && SAFE_ID_RE.test(item.originActionId) && item.originActionId !== actionId
      ? item.originActionId
      : null,
  };
  return {
    id: safeId(item.id, 'action-event', { actionId, ...eventMaterial }),
    ...eventMaterial,
    applied: false,
  };
}

function legacyActionState(value: unknown): CaseActionState {
  if (typeof value === 'string' && ACTION_STATES.has(value)) return value as CaseActionState;
  if (typeof value === 'string' && LEGACY_ACTION_STATE_MAP[value]) return LEGACY_ACTION_STATE_MAP[value]!;
  return 'drafting';
}

function legacyActionEvent(
  item: Record<string, unknown>,
  actionId: string,
  createdAt: string,
  fallback: string,
  options: CaseResponseTimestampOptions,
): CaseActionTransitionEvent {
  const nextState = legacyActionState(item.state);
  const occurredAt = iso(item.updatedAt, createdAt || fallback, options);
  const sourceVersion = options.sourceVersion;
  const provenance = sourceVersion !== null && sourceVersion !== undefined && sourceVersion <= 12
    ? 'case_v12_legacy_snapshot'
    : 'legacy_action_snapshot';
  const legacyState = typeof item.state === 'string' ? item.state : 'planned';
  const migrationLimitation = sourceVersion !== null && sourceVersion !== undefined && sourceVersion <= 12
    ? `Migrated from the Case v12 current state "${text(legacyState, 40)}"; pre-v13 transition history is unavailable.`
    : 'Recovered a legacy current-state action; earlier transition history is unavailable.';
  const eventMaterial = {
    previousState: null,
    nextState,
    occurredAt,
    sourceClass: 'migration' as const,
    provenance,
    reference: text(item.reference, MAX_RESPONSE_REFERENCE_LENGTH) || null,
    evidencePinId: null,
    limitations: limitations([migrationLimitation, ...limitations(item.contactLimitations)]),
    providerOutcome: !(sourceVersion !== null && sourceVersion !== undefined && sourceVersion <= 12)
      && typeof item.providerOutcome === 'string' && PROVIDER_OUTCOMES.has(item.providerOutcome)
      ? item.providerOutcome as CaseProviderOutcome
      : null,
    outcomeDetail: text(item.outcome, MAX_RESPONSE_RATIONALE_LENGTH) || null,
    originActionId: typeof item.originActionId === 'string' && SAFE_ID_RE.test(item.originActionId) && item.originActionId !== actionId
      ? item.originActionId
      : null,
  };
  return {
    id: deterministicId('action-event', { actionId, ...eventMaterial }),
    ...eventMaterial,
    applied: true,
  };
}

function currentActionRecoveryEvent(
  actionId: string,
  createdAt: string,
): CaseActionTransitionEvent {
  const eventMaterial = {
    previousState: null,
    nextState: 'drafting' as const,
    occurredAt: createdAt,
    sourceClass: 'browser_local' as const,
    provenance: 'case_v13_history_recovery',
    reference: null,
    evidencePinId: null,
    limitations: ['The v13 action had no valid transition history. Mutable state, reference, and outcome projections were ignored.'],
    providerOutcome: null,
    outcomeDetail: null,
    originActionId: null,
  };
  return {
    id: deterministicId('action-event', { actionId, ...eventMaterial }),
    ...eventMaterial,
    applied: true,
  };
}

function actionEventContent(event: CaseActionTransitionEvent): string {
  const { applied: _applied, ...material } = event;
  return JSON.stringify(material);
}

function projectActionHistory(
  source: readonly CaseActionTransitionEvent[],
  omitted: number,
): { history: CaseActionTransitionEvent[]; state: CaseActionState; conflicts: number } {
  let state: CaseActionState | null = null;
  let conflicts = 0;
  const history: CaseActionTransitionEvent[] = [];
  for (let start = 0; start < source.length;) {
    let end = start + 1;
    while (end < source.length && source[end]!.occurredAt === source[start]!.occurredAt) end += 1;
    const cohort = source.slice(start, end);
    if (state === null && omitted > 0 && start === 0 && cohort[0]!.previousState !== null) state = cohort[0]!.previousState;
    while (cohort.length) {
      // State prerequisites order equal-time transitions. Competing successors
      // retain the existing deterministic conflict order; times are unchanged.
      const eligible = cohort.findIndex((event) => event.previousState === state);
      const [event] = cohort.splice(eligible < 0 ? 0 : eligible, 1);
      const applied = event!.previousState === state
        && isLegalCaseActionTransition(event!.previousState, event!.nextState, event!.sourceClass);
      if (applied) state = event!.nextState;
      else conflicts += 1;
      history.push({ ...event!, applied });
    }
    start = end;
  }
  return { history, state: state ?? 'drafting', conflicts };
}

function normalizeActionHistory(
  raw: unknown,
  item: Record<string, unknown>,
  actionId: string,
  createdAt: string,
  fallback: string,
  options: CaseResponseTimestampOptions,
): { history: CaseActionTransitionEvent[]; state: CaseActionState; omitted: number; historyLimitations: string[] } {
  const source = Array.isArray(raw) ? raw : [];
  let omitted = boundedCounter(item.historyOmitted);
  let invalid = 0;
  let duplicateConflict = 0;
  const byId = new Map<string, CaseActionTransitionEvent>();
  for (const candidate of source.slice(0, MAX_CASE_ACTION_EVENTS_PER_ACTION * 4)) {
    const event = normalizeActionEvent(candidate, actionId, options);
    if (!event) {
      invalid += 1;
      continue;
    }
    const existing = byId.get(event.id);
    if (!existing) byId.set(event.id, event);
    else if (actionEventContent(existing) !== actionEventContent(event)) {
      duplicateConflict += 1;
      if (actionEventContent(event) < actionEventContent(existing)) byId.set(event.id, event);
    }
  }
  invalid += Math.max(0, source.length - MAX_CASE_ACTION_EVENTS_PER_ACTION * 4);
  if (!byId.size) {
    const recovered = options.sourceVersion != null && options.sourceVersion <= 12
      ? legacyActionEvent(item, actionId, createdAt, fallback, options)
      : currentActionRecoveryEvent(actionId, createdAt);
    byId.set(recovered.id, recovered);
  }
  let history = [...byId.values()].sort((left, right) =>
    Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || compareCodeUnits(left.id, right.id));
  if (history.length > MAX_CASE_ACTION_EVENTS_PER_ACTION) {
    omitted += history.length - MAX_CASE_ACTION_EVENTS_PER_ACTION;
    history = history.slice(-MAX_CASE_ACTION_EVENTS_PER_ACTION);
  }
  while (history.length > 1 && bytes(history) > MAX_CASE_ACTION_BYTES) {
    history.shift();
    omitted += 1;
  }
  const totalOmitted = omitted + invalid + duplicateConflict;
  const projected = projectActionHistory(history, totalOmitted);
  const retainedLimitations = limitations(item.historyLimitations).filter((item) =>
    !/^\d+ earlier action transition events? omitted by bounded retention\.$/u.test(item)
    && !/^\d+ retained concurrent transition(?: is|s are) not applied to the current-state projection\.$/u.test(item));
  const historyLimitations = lifecycleLimitations([
    ...(totalOmitted ? [`${totalOmitted} earlier action transition event${totalOmitted === 1 ? '' : 's'} omitted by bounded retention.`] : []),
    ...(invalid ? [`${invalid} malformed or illegal action transition event${invalid === 1 ? '' : 's'} omitted during normalisation.`] : []),
    ...(duplicateConflict ? [`${duplicateConflict} conflicting duplicate event identit${duplicateConflict === 1 ? 'y was' : 'ies were'} reconciled deterministically.`] : []),
    ...(projected.conflicts ? [`${projected.conflicts} retained concurrent transition${projected.conflicts === 1 ? ' is' : 's are'} not applied to the current-state projection.`] : []),
    ...retainedLimitations,
  ]);
  return {
    history: projected.history,
    state: projected.state,
    omitted: totalOmitted,
    historyLimitations,
  };
}

function normalizeAction(
  raw: unknown,
  fallback: string,
  options: CaseResponseTimestampOptions = {},
): CaseActionRecord | null {
  const item = record(raw);
  const recipient = text(item.recipient, MAX_RESPONSE_RECIPIENT_LENGTH);
  if (!recipient) return null;
  const createdAt = iso(item.createdAt, fallback, options);
  const actionId = safeId(item.id, 'action', { recipient, createdAt });
  const history = normalizeActionHistory(item.history, item, actionId, createdAt, fallback, options);
  const applied = history.history.filter((event) => event.applied);
  const latestReference = [...applied].reverse().find((event) => event.reference)?.reference ?? null;
  const latestProviderOutcome = [...applied].reverse().find((event) => event.providerOutcome) ?? null;
  const latestOutcomeDetail = [...applied].reverse().find((event) => event.outcomeDetail) ?? null;
  const latestEventAt = applied.at(-1)?.occurredAt ?? createdAt;
  const metadataUpdatedAt = iso(item.metadataUpdatedAt ?? item.updatedAt, createdAt, options);
  const updatedAt = Date.parse(latestEventAt) > Date.parse(metadataUpdatedAt) ? latestEventAt : metadataUpdatedAt;
  const contactSource = text(item.contactSource, MAX_RESPONSE_LABEL_LENGTH) || 'analyst_supplied';
  const legacyPlatformReview = options.sourceVersion != null && options.sourceVersion < 15
    && item.type === 'security_contact_report'
    ? /^Official .+, reviewed (\d{4}-\d{2}-\d{2})$/u.exec(contactSource)
    : null;
  return {
    id: actionId,
    type: legacyPlatformReview
      ? 'platform_report'
      : typeof item.type === 'string' && ACTION_TYPES.has(item.type)
      ? item.type as CaseActionType
      : 'internal_review',
    recipient,
    contactSource,
    routeObservedAt: legacyPlatformReview
      ? normalizeExplicitIsoTimestamp(`${legacyPlatformReview[1]}T00:00:00.000Z`)
      : options.sourceVersion != null && options.sourceVersion < 14
      ? null
      : optionalIso(item.routeObservedAt, options),
    routeReviewAfter: options.sourceVersion != null && options.sourceVersion < 15
      ? null
      : optionalIso(item.routeReviewAfter, options),
    contactLimitations: limitations(item.contactLimitations),
    dueAt: optionalIso(item.dueAt, options),
    state: history.state,
    reference: latestReference,
    followUpAt: optionalIso(item.followUpAt, options),
    providerOutcome: latestProviderOutcome?.providerOutcome ?? null,
    outcome: latestProviderOutcome?.outcomeDetail ?? latestOutcomeDetail?.outcomeDetail ?? null,
    originActionId: typeof item.originActionId === 'string' && SAFE_ID_RE.test(item.originActionId) && item.originActionId !== actionId
      ? item.originActionId
      : null,
    history: history.history,
    historyOmitted: history.omitted,
    historyLimitations: history.historyLimitations,
    createdAt,
    metadataUpdatedAt,
    updatedAt,
  };
}

function mergeNormalizedActions(left: CaseActionRecord, right: CaseActionRecord, fallback: string): CaseActionRecord {
  const metadataWinner = Date.parse(left.metadataUpdatedAt) > Date.parse(right.metadataUpdatedAt)
    ? left
    : Date.parse(right.metadataUpdatedAt) > Date.parse(left.metadataUpdatedAt)
      ? right
      : JSON.stringify(left) <= JSON.stringify(right) ? left : right;
  return normalizeAction({
    ...metadataWinner,
    id: left.id,
    createdAt: Date.parse(left.createdAt) <= Date.parse(right.createdAt) ? left.createdAt : right.createdAt,
    history: [...left.history, ...right.history],
    historyOmitted: Math.max(left.historyOmitted, right.historyOmitted),
    historyLimitations: [...left.historyLimitations, ...right.historyLimitations],
  }, fallback, { sourceVersion: CASE_SCHEMA_VERSION })!;
}

function boundActionCollection(actions: CaseActionRecord[], fallback: string): CaseActionRecord[] {
  const keep = new Set<string>();
  for (const action of actions) {
    const latest = action.history.at(-1);
    if (latest) keep.add(`${action.id}\u0000${latest.id}`);
  }
  const all = actions.flatMap((action) => action.history.map((event) => ({ action, event })))
    .sort((left, right) => Date.parse(right.event.occurredAt) - Date.parse(left.event.occurredAt)
      || compareCodeUnits(right.event.id, left.event.id));
  for (const item of all) {
    if (keep.size >= MAX_CASE_ACTION_EVENTS_PER_CASE) break;
    keep.add(`${item.action.id}\u0000${item.event.id}`);
  }
  let bounded = actions.map((action) => {
    const history = action.history.filter((event) => keep.has(`${action.id}\u0000${event.id}`));
    const omitted = action.historyOmitted + action.history.length - history.length;
    return normalizeAction({ ...action, history, historyOmitted: omitted }, fallback, { sourceVersion: CASE_SCHEMA_VERSION })!;
  });
  while (bytes(bounded) > MAX_CASE_ACTION_HISTORY_BYTES_PER_CASE) {
    const candidate = bounded
      .flatMap((action) => action.history.slice(0, -1).map((event) => ({ action, event })))
      .sort((left, right) => Date.parse(left.event.occurredAt) - Date.parse(right.event.occurredAt)
        || compareCodeUnits(left.event.id, right.event.id))[0];
    if (!candidate) break;
    bounded = bounded.map((action) => action.id !== candidate.action.id
      ? action
      : normalizeAction({
          ...action,
          history: action.history.filter((event) => event.id !== candidate.event.id),
          historyOmitted: action.historyOmitted + 1,
        }, fallback, { sourceVersion: CASE_SCHEMA_VERSION })!);
  }
  if (bytes(bounded) > MAX_CASE_ACTION_HISTORY_BYTES_PER_CASE && bounded.length > 1) {
    const byteOmissionPattern = /^(\d+) earlier response actions? omitted by the per-Case response-history byte bound\.$/u;
    const previouslyOmitted = bounded.reduce((maximum, action) => {
      const retainedCount = action.historyLimitations.reduce((count, item) => {
        const match = byteOmissionPattern.exec(item);
        return match ? Math.max(count, Number(match[1])) : count;
      }, 0);
      return Math.max(maximum, retainedCount);
    }, 0);
    bounded = bounded.map((action) => ({
      ...action,
      historyLimitations: action.historyLimitations.filter((item) => !byteOmissionPattern.test(item)),
    }));
    let omittedActions = 0;
    while (bounded.length > 1) {
      bounded = bounded.slice(1);
      omittedActions += 1;
      const first = bounded[0]!;
      const totalOmitted = previouslyOmitted + omittedActions;
      bounded = [{
        ...first,
        historyLimitations: lifecycleLimitations([
          `${totalOmitted} earlier response action${totalOmitted === 1 ? '' : 's'} omitted by the per-Case response-history byte bound.`,
          ...first.historyLimitations,
        ]),
      }, ...bounded.slice(1)];
      if (bytes(bounded) <= MAX_CASE_ACTION_HISTORY_BYTES_PER_CASE) return bounded;
    }
  }
  return bounded;
}

export function normalizeCaseActions(
  raw: unknown,
  fallback: string,
  options: CaseResponseTimestampOptions = {},
): CaseActionRecord[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, CaseActionRecord>();
  const inspected = raw.slice(0, MAX_CASE_ACTIONS * 2);
  let invalid = 0;
  for (const item of inspected) {
    const normalized = normalizeAction(item, fallback, options);
    if (!normalized) {
      invalid += 1;
      continue;
    }
    const existing = byId.get(normalized.id);
    byId.set(normalized.id, existing ? mergeNormalizedActions(existing, normalized, fallback) : normalized);
  }
  const normalizedActions = [...byId.values()]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || compareCodeUnits(left.id, right.id));
  const uninspected = Math.max(0, raw.length - inspected.length);
  const omitted = Math.max(0, normalizedActions.length - MAX_CASE_ACTIONS);
  const actions = normalizedActions.slice(-MAX_CASE_ACTIONS);
  if (actions.length && (invalid || uninspected || omitted)) {
    const first = actions[0]!;
    actions[0] = {
      ...first,
      historyLimitations: lifecycleLimitations([
        ...(invalid ? [`${invalid} malformed response-action candidate${invalid === 1 ? '' : 's'} omitted during normalisation.`] : []),
        ...(uninspected ? [`${uninspected} response-action candidate${uninspected === 1 ? '' : 's'} beyond the bounded inspection window were not traversed.`] : []),
        ...(omitted ? [`${omitted} earlier response action${omitted === 1 ? '' : 's'} omitted by the per-Case action bound.`] : []),
        ...first.historyLimitations,
      ]),
    };
  }
  const actionIds = new Set(actions.map((action) => action.id));
  const linked = actions.map((action) => {
    const originActionId = action.originActionId && actionIds.has(action.originActionId) && action.originActionId !== action.id
      ? action.originActionId
      : null;
    const invalidOrigins = action.history.filter((event) => event.originActionId
      && (!actionIds.has(event.originActionId) || event.originActionId === action.id)).length;
    return {
      ...action,
      originActionId,
      history: action.history.map((event) => ({
        ...event,
        originActionId: event.originActionId && actionIds.has(event.originActionId) && event.originActionId !== action.id
          ? event.originActionId
          : null,
      })),
      historyLimitations: lifecycleLimitations([
        ...action.historyLimitations,
        ...(invalidOrigins || (action.originActionId && !originActionId)
          ? ['One or more dangling or self-referential origin-action links were omitted.']
          : []),
      ]),
    };
  });
  return boundActionCollection(linked, fallback);
}

export function appendCaseAction(
  current: readonly CaseActionRecord[],
  raw: unknown,
  now: string,
): CaseActionRecord[] {
  if (current.length >= MAX_CASE_ACTIONS) {
    throw new Error(`A Case can retain at most ${MAX_CASE_ACTIONS} response actions. No additional action was retained.`);
  }
  const item = record(raw);
  const id = freshId('action');
  const originActionId = typeof item.originActionId === 'string' && current.some((action) => action.id === item.originActionId)
    ? item.originActionId
    : null;
  if (item.originActionId != null && !originActionId) throw new Error('A follow-on action requires an existing originating action.');
  const history = [{
    id: freshId('action-event'),
    previousState: null,
    nextState: 'drafting',
    occurredAt: now,
    sourceClass: 'analyst',
    provenance: 'browser_local_action_creation',
    reference: null,
    evidencePinId: null,
    limitations: [],
    providerOutcome: null,
    outcomeDetail: null,
    originActionId,
  }];
  const created = normalizeAction({
    ...item,
    id,
    originActionId,
    history,
    historyOmitted: 0,
    createdAt: now,
    metadataUpdatedAt: now,
  }, now, { sourceVersion: CASE_SCHEMA_VERSION });
  if (!created) throw new Error('An action requires a recipient or internal owner.');
  return normalizeCaseActions([...current, created], now, { sourceVersion: CASE_SCHEMA_VERSION });
}

export function appendCaseActionTransition(
  current: readonly CaseActionRecord[],
  actionId: string,
  raw: unknown,
  now: string,
  validPinIds?: ReadonlySet<string>,
): CaseActionRecord[] {
  const action = current.find((item) => item.id === actionId);
  if (!action) throw new Error('That case action no longer exists.');
  const item = record(raw);
  const nextState = typeof item.nextState === 'string' && ACTION_STATES.has(item.nextState)
    ? item.nextState as CaseActionState
    : null;
  const sourceClass = typeof item.sourceClass === 'string' && ACTION_EVENT_SOURCE_CLASSES.has(item.sourceClass)
    ? item.sourceClass as CaseActionEventSourceClass
    : 'analyst';
  if (!nextState || !isLegalCaseActionTransition(action.state, nextState, sourceClass)) {
    throw new Error(`The transition from ${action.state.replaceAll('_', ' ')} to ${String(item.nextState || 'that state').replaceAll('_', ' ')} is not permitted.`);
  }
  if (['ready_for_review', 'reviewed', 'authorised', 'submitted'].includes(nextState) && sourceClass !== 'analyst') {
    throw new Error('Readiness, review, authorisation, and submission require an explicit analyst transition.');
  }
  const originActionId = typeof item.originActionId === 'string'
    && item.originActionId !== action.id
    && current.some((candidate) => candidate.id === item.originActionId)
    ? item.originActionId
    : action.originActionId;
  if (item.originActionId != null && originActionId !== item.originActionId) {
    throw new Error('A referral or follow-on transition requires a distinct existing originating action.');
  }
  if (item.evidencePinId != null && (typeof item.evidencePinId !== 'string'
    || !SAFE_ID_RE.test(item.evidencePinId) || (validPinIds && !validPinIds.has(item.evidencePinId)))) {
    throw new Error('An action transition evidence pin must reference a retained Case evidence pin.');
  }
  const occurredAt = optionalIso(item.occurredAt) ?? now;
  const event = normalizeActionEvent({
    ...item,
    id: freshId('action-event'),
    previousState: action.state,
    nextState,
    occurredAt,
    sourceClass,
    provenance: text(item.provenance, MAX_RESPONSE_LABEL_LENGTH) || 'browser_local_explicit_transition',
    originActionId,
  }, action.id, currentActionNormalizationOptions(validPinIds));
  if (!event) throw new Error('The action transition contains an invalid time, provider outcome, or provenance field.');
  const updated = normalizeAction({
    ...action,
    history: [...action.history, event],
    historyOmitted: action.historyOmitted,
  }, now, currentActionNormalizationOptions(validPinIds));
  return normalizeCaseActions(
    current.map((candidate) => candidate.id === actionId ? updated : candidate),
    now,
    currentActionNormalizationOptions(validPinIds),
  );
}

const ACTION_REVIEW_MATERIAL_FIELDS = [
  'type', 'recipient', 'contactSource', 'routeObservedAt', 'routeReviewAfter', 'contactLimitations', 'originActionId',
] as const satisfies readonly (keyof CaseActionRecord)[];

export function updateCaseAction(
  current: readonly CaseActionRecord[],
  raw: unknown,
  now: string,
  validPinIds?: ReadonlySet<string>,
): CaseActionRecord[] {
  const patch = record(raw);
  const id = typeof patch.id === 'string' && SAFE_ID_RE.test(patch.id) ? patch.id : '';
  const existing = current.find((item) => item.id === id);
  if (!existing) throw new Error('That case action no longer exists.');
  if (Object.hasOwn(patch, 'state') || Object.hasOwn(patch, 'outcome') || Object.hasOwn(patch, 'providerOutcome') || Object.hasOwn(patch, 'reference')) {
    throw new Error('State, reference, and provider outcomes must be recorded as an append-only action transition.');
  }
  const metadata = {
    ...existing,
    ...Object.fromEntries(ACTION_REVIEW_MATERIAL_FIELDS
      .filter((field) => Object.hasOwn(patch, field))
      .map((field) => [field, patch[field]])),
    dueAt: Object.hasOwn(patch, 'dueAt') ? patch.dueAt : existing.dueAt,
    followUpAt: Object.hasOwn(patch, 'followUpAt') ? patch.followUpAt : existing.followUpAt,
    metadataUpdatedAt: now,
  };
  if (Object.hasOwn(patch, 'originActionId') && patch.originActionId !== null
    && (typeof patch.originActionId !== 'string' || patch.originActionId === id || !current.some((item) => item.id === patch.originActionId))) {
    throw new Error('A follow-on action requires a distinct existing originating action.');
  }
  let updated = normalizeAction(metadata, now, currentActionNormalizationOptions(validPinIds));
  if (!updated) throw new Error('An action requires a recipient or internal owner.');
  const materialChanged = ACTION_REVIEW_MATERIAL_FIELDS
    .some((key) => Object.hasOwn(patch, key) && JSON.stringify(record(existing)[key]) !== JSON.stringify(record(updated)[key]));
  if (materialChanged && ['submitted', 'acknowledged', 'terminal'].includes(existing.state)) {
    throw new Error('Submitted or terminal action identity and recipient metadata cannot be rewritten; create a linked follow-on action instead.');
  }
  if (materialChanged && ['ready_for_review', 'reviewed', 'authorised'].includes(existing.state)) {
    const invalidated = normalizeAction({
      ...updated,
      history: [...updated.history, {
        id: freshId('action-event'),
        previousState: existing.state,
        nextState: 'drafting',
        occurredAt: now,
        sourceClass: 'browser_local',
        provenance: 'material_action_change',
        reference: null,
        evidencePinId: null,
        limitations: ['Material action inputs changed after review; prior readiness, review, or authorisation no longer applies.'],
        providerOutcome: null,
        outcomeDetail: null,
        originActionId: updated.originActionId,
      }],
    }, now, currentActionNormalizationOptions(validPinIds));
    if (!invalidated) throw new Error('The material action change could not be retained safely.');
    updated = invalidated;
  }
  const interim = current.map((item) => item.id === id ? updated : item);
  return patch.transition !== undefined
    ? appendCaseActionTransition(interim, id, patch.transition, now, validPinIds)
    : normalizeCaseActions(interim, now, currentActionNormalizationOptions(validPinIds));
}

export function buildCaseActionOutcomeSummary(
  actions: readonly CaseActionRecord[],
  nowRaw: unknown = new Date().toISOString(),
): CaseActionOutcomeSummary {
  const now = optionalIso(nowRaw) ?? new Date().toISOString();
  const nowTime = Date.parse(now);
  const active = actions.filter((item) => item.state !== 'terminal');
  const latestOutcomes = actions
    .flatMap((action) => action.history.filter((event) => event.applied && event.providerOutcome).map((event) => ({ action, event })))
    .sort((left, right) => Date.parse(right.event.occurredAt) - Date.parse(left.event.occurredAt) || compareCodeUnits(right.event.id, left.event.id))
    .slice(0, 5)
    .map(({ action, event }) => ({
      actionId: action.id,
      recipient: action.recipient,
      state: action.state,
      providerOutcome: event.providerOutcome!,
      outcomeDetail: event.outcomeDetail,
      occurredAt: event.occurredAt,
    }));
  return {
    total: actions.length,
    active: active.length,
    drafting: actions.filter((item) => item.state === 'drafting').length,
    readyForReview: actions.filter((item) => item.state === 'ready_for_review').length,
    reviewed: actions.filter((item) => item.state === 'reviewed').length,
    authorised: actions.filter((item) => item.state === 'authorised').length,
    submitted: actions.filter((item) => item.state === 'submitted').length,
    acknowledged: actions.filter((item) => item.state === 'acknowledged').length,
    terminal: actions.filter((item) => item.state === 'terminal').length,
    overdue: active.filter((item) => item.dueAt && Date.parse(item.dueAt) < nowTime).length,
    followUpDue: active.filter((item) => item.followUpAt && Date.parse(item.followUpAt) <= nowTime).length,
    withProviderOutcome: actions.filter((item) => item.providerOutcome !== null).length,
    latestOutcomes,
  };
}

export function mergeCaseActions(
  local: readonly CaseActionRecord[],
  imported: readonly CaseActionRecord[],
  fallback: string,
  validPinIds?: ReadonlySet<string>,
): CaseActionRecord[] {
  return normalizeCaseActions([...local, ...imported], fallback, currentActionNormalizationOptions(validPinIds));
}
