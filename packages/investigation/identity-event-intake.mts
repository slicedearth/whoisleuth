import { parseBoundedJson, boundedJsonLimitsForBytes } from '../analysis/bounded-json.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { exact, exactOptional } from '../evidence/artifact-structure.mts';
import { MAX_MESSAGE_INTAKE_BYTES, type MessageIntakeResult } from '../contracts/message-intake.mts';
import { IDENTITY_EVENTS_INPUT_SCHEMA, IDENTITY_EVENTS_INPUT_VERSION, MAX_IDENTITY_EVENTS,
  type IdentityEvent, type IdentityEventProvider, type IdentityEventReview, type IdentityFieldMatch, type IdentityMatchScope } from '../contracts/identity-events.mts';
import { createIntakeReport } from './intake-report.mts';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const instant = (value: unknown) => typeof value === 'string' ? normalizeExplicitIsoTimestamp(value) : null;
const guid = (value: unknown) => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(value) ? value.toLowerCase() : null;
function applicationId(value: unknown, provider: IdentityEventProvider): string | null {
  return provider === 'entra' ? guid(value) : typeof value === 'string' && /^0oa[a-z\d]{17}$/iu.test(value) ? value : null;
}
function protocol(value: unknown): IdentityEvent['protocol'] {
  switch (value) {
    case 'oAuth2': return 'oauth2';
    case 'deviceCode': return 'device_code';
    case 'saml20': return 'saml';
    case 'wsFederation': return 'ws_federation';
    case 'ropc': return 'password_grant';
    default: return 'unknown';
  }
}
function eventKind(value: unknown): IdentityEvent['kind'] {
  switch (value) {
    case 'user.authentication.sso': return 'application_access';
    case 'user.session.start': return 'session_start';
    case 'user.authentication.auth_via_mfa': case 'user.authentication.verify': return 'credential_check';
    case 'app.oauth2.consent.grant': return 'consent';
    default: return 'other';
  }
}

/** IDs are replaced in memory; actor labels are meaningful only within this file. */
function extractEvents(input: readonly unknown[], provider: IdentityEventProvider) {
  const actors = new Map<string, string>(), events: IdentityEvent[] = [];
  let invalidEvents = 0;
  const actor = (value: unknown) => {
    if (typeof value !== 'string' || !value || value.length > 240) return null;
    let label = actors.get(value);
    if (!label) { label = `Actor ${actors.size + 1}`; actors.set(value, label); }
    return label;
  };
  for (const [index, value] of input.entries()) {
    const row = record(value);
    if (provider === 'entra') {
      if (!Object.hasOwn(row, 'createdDateTime') || !Object.hasOwn(row, 'status')) { invalidEvents++; continue; }
      const app = applicationId(row.appId, provider), code = record(row.status).errorCode;
      events.push({ sequence: index + 1, actorLabel: actor(row.userId), applicationIds: app ? [app] : [], tenantId: guid(row.resourceTenantId),
        // A client category (for example Browser) is not an authentication protocol.
        protocol: protocol(row.authenticationProtocol), kind: 'sign_in', occurredAt: instant(row.createdDateTime),
        result: typeof code === 'number' && Number.isSafeInteger(code) && code >= 0 ? code === 0 ? 'success' : 'failure' : 'unknown' });
    } else {
      if (typeof row.eventType !== 'string' || !Object.hasOwn(row, 'published')) { invalidEvents++; continue; }
      const targets = Array.isArray(row.target) ? row.target : [];
      const apps = targets.filter(target => record(target).type === 'AppInstance').map(target => applicationId(record(target).id, provider)).filter((id): id is string => id !== null);
      const outcome = record(row.outcome).result;
      events.push({ sequence: index + 1, actorLabel: actor(record(row.actor).id), applicationIds: [...new Set(apps)], tenantId: null,
        protocol: 'unknown', kind: eventKind(row.eventType), occurredAt: instant(row.published),
        result: outcome === 'SUCCESS' ? 'success' : outcome === 'FAILURE' ? 'failure' : outcome === 'DENY' ? 'denied' : outcome === 'CHALLENGE' ? 'challenge' : 'unknown' });
    }
  }
  return { events, invalidEvents };
}

export function readIdentityMatchScope(raw: unknown, provider: IdentityEventProvider): IdentityMatchScope {
  const source = exact(raw, ['applicationId', 'tenantId', 'actorLabel', 'startedAt', 'endedAt'], 'Identity comparison scope');
  const app = applicationId(source.applicationId, provider), tenant = source.tenantId === null ? null : guid(source.tenantId);
  const start = instant(source.startedAt), end = instant(source.endedAt);
  if (!app || !start || !end || Date.parse(end) < Date.parse(start) || source.tenantId !== null && !tenant
    || source.actorLabel !== null && (typeof source.actorLabel !== 'string' || !/^Actor [1-9]\d{0,4}$/u.test(source.actorLabel))) {
    throw new TypeError('Select a valid application ID, explicit-timezone interval, and optional retained tenant or file-local actor label.');
  }
  return { applicationId: app, tenantId: tenant, actorLabel: source.actorLabel as string | null, startedAt: start, endedAt: end };
}

/** Exact supplied-field corroboration, not a causal or account-compromise judgement. */
export function compareIdentityEvents(review: IdentityEventReview, rawScope: unknown): IdentityEventReview {
  const scope = readIdentityMatchScope(rawScope, review.provider);
  const compare = (selected: string | null, supplied: string | null): IdentityFieldMatch => selected === null ? 'not_selected' : supplied === null ? 'unavailable' : selected === supplied ? 'matched' : 'different';
  return { ...review, comparison: { scope, events: review.events.map(event => {
    const application: IdentityFieldMatch = !event.applicationIds.length ? 'unavailable' : event.applicationIds.includes(scope.applicationId) ? 'matched' : 'different';
    const tenant = compare(scope.tenantId, event.tenantId), actor = compare(scope.actorLabel, event.actorLabel);
    const time: IdentityFieldMatch = !event.occurredAt ? 'unavailable' : Date.parse(event.occurredAt) >= Date.parse(scope.startedAt) && Date.parse(event.occurredAt) <= Date.parse(scope.endedAt) ? 'matched' : 'different';
    const fields = [application, tenant, actor, time];
    return { sequence: event.sequence, application, tenant, actor, time,
      state: fields.includes('different') ? 'different' : fields.includes('unavailable') ? 'incomplete' : 'matched' };
  }) } };
}

export async function reviewIdentityEventInput(bytes: Uint8Array, reviewedAt: string): Promise<MessageIntakeResult> {
  const base = await createIntakeReport(bytes, 'identity', reviewedAt);
  const parsed = parseBoundedJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { label: 'Identity event input', maximumBytes: MAX_MESSAGE_INTAKE_BYTES,
    limits: { ...boundedJsonLimitsForBytes(MAX_MESSAGE_INTAKE_BYTES), maximumContainerItems: MAX_IDENTITY_EVENTS } });
  const root = record(parsed);
  let provider: IdentityEventProvider, input: unknown, match: unknown = null;
  if (Object.hasOwn(root, 'schema')) {
    exactOptional(root, ['schema', 'version', 'provider', 'events'], ['match'], 'Identity event input');
    if (root.schema !== IDENTITY_EVENTS_INPUT_SCHEMA || root.version !== IDENTITY_EVENTS_INPUT_VERSION || !['entra', 'okta'].includes(String(root.provider))) throw new TypeError('Unsupported identity event input schema, version or provider.');
    provider = root.provider as IdentityEventProvider; input = root.events; match = root.match ?? null;
  } else if (Array.isArray(parsed)) { provider = 'okta'; input = parsed; }
  else { provider = 'entra'; input = root.value; }
  if (!Array.isArray(input) || input.length > MAX_IDENTITY_EVENTS) throw new TypeError('Select a sign-in value array, a System Log array, or a versioned identity event input.');
  const extracted = extractEvents(input, provider);
  if (input.length && !extracted.events.length) throw new TypeError('No supported identity event records were found.');
  let identityEventReview: IdentityEventReview = { provider, ...extracted, sourceHasMore: typeof root['@odata.nextLink'] === 'string' && Boolean(root['@odata.nextLink']), comparison: null };
  if (match !== null) identityEventReview = compareIdentityEvents(identityEventReview, match);
  return { targets: [], report: { ...base, identityEventReview, coverage: { ...base.coverage,
    state: identityEventReview.invalidEvents || identityEventReview.sourceHasMore ? 'partial' : 'reviewed', reviewedParts: identityEventReview.events.length,
    boundsReached: identityEventReview.sourceHasMore ? ['The selected export declares another page; it was not requested'] : [] } } };
}
