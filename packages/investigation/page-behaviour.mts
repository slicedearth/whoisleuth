import { array, boolean, enumeration, exact, integer, text, HEX_DIGEST_RE } from '../evidence/artifact-structure.mts';
import { MESSAGE_ACTION_HINTS } from '../contracts/message-intake.mts';
import { readCaptureCoverage, captureCoverageIsPartial, captureAttemptDescription, type CaptureCoverage } from './capture-coverage.mts';

export const PAGE_BEHAVIOUR_VERSION = 1;
// Separate from the capture's request, DOM traversal and aggregate byte bounds.
export const MAX_PAGE_OBSERVATIONS = 500;
export const PAGE_ACTION_HINTS = MESSAGE_ACTION_HINTS;
export type PageActionHint = typeof PAGE_ACTION_HINTS[number];
export type PageRequestObservation = Readonly<{
  position: number; kind: 'navigation' | 'script' | 'frame' | 'document'; origin: string;
  contentSha256: string | null; status: number; cspEnforced: boolean; cspReportOnly: boolean;
}>;
export type PageElementObservation = Readonly<{
  position: number; kind: 'script' | 'frame' | 'form'; origin: string | null;
  inline: boolean; integrity: 'present' | 'absent' | 'not_applicable';
  method: 'get' | 'post' | 'other' | null; passwordFields: number; scriptSha256: string | null;
}>;
export type PageBehaviour = Readonly<{
  version: typeof PAGE_BEHAVIOUR_VERSION; state: 'observed' | 'partial';
  requests: readonly PageRequestObservation[]; elements: readonly PageElementObservation[];
  actionHints: readonly PageActionHint[]; clipboardWriteAttempts: number;
  coverage: CaptureCoverage;
}>;

export function pageObservationOrigin(raw: unknown, base?: string): string | null {
  if (typeof raw !== 'string' || raw.length > 8_192 || /[\u0000-\u0020\u007f]/u.test(raw)) return null;
  try { const url = new URL(raw, base); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null; }
  catch { return null; }
}

function origin(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  const candidate = text(value, 'Page observation origin', 500);
  if (pageObservationOrigin(candidate) !== candidate) throw new TypeError('Page observations retain origins only.');
  return candidate;
}
function hash(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !HEX_DIGEST_RE.test(value)) throw new TypeError('Page observation digest must be SHA-256.');
  return value;
}
function ordered<T extends { position: number }>(values: T[]): T[] {
  if (values.some((value, index) => index > 0 && value.position <= values[index - 1]!.position)) throw new TypeError('Page observation positions must be unique and increasing.');
  return values;
}
export function readPageBehaviour(raw: unknown): PageBehaviour {
  const value = exact(raw, ['version', 'state', 'requests', 'elements', 'actionHints', 'clipboardWriteAttempts', 'coverage'], 'Page behaviour');
  if (value.version !== PAGE_BEHAVIOUR_VERSION) throw new TypeError('Unsupported page behaviour version.');
  const requests = ordered(array(value.requests, 'Page requests', MAX_PAGE_OBSERVATIONS).map(raw => {
    const item = exact(raw, ['position', 'kind', 'origin', 'contentSha256', 'status', 'cspEnforced', 'cspReportOnly'], 'Page request');
    boolean(item.cspEnforced, 'Enforced policy presence'); boolean(item.cspReportOnly, 'Report-only policy presence');
    const kind = enumeration(item.kind, ['navigation', 'script', 'frame', 'document'] as const, 'Page request kind'), contentSha256 = hash(item.contentSha256);
    if (kind !== 'script' && contentSha256 !== null) throw new TypeError('Only script response bodies are hashed in page observations.');
    return { position: integer(item.position, 'Request position', 1, 10_000), kind, origin: origin(item.origin)!, contentSha256,
      status: integer(item.status, 'Response status', 100, 599), cspEnforced: item.cspEnforced as boolean, cspReportOnly: item.cspReportOnly as boolean };
  }));
  const elements = ordered(array(value.elements, 'Page elements', MAX_PAGE_OBSERVATIONS).map(raw => {
    const item = exact(raw, ['position', 'kind', 'origin', 'inline', 'integrity', 'method', 'passwordFields', 'scriptSha256'], 'Page element');
    const kind = enumeration(item.kind, ['script', 'frame', 'form'] as const, 'Page element kind');
    boolean(item.inline, 'Inline script');
    const method = item.method === null ? null : enumeration(item.method, ['get', 'post', 'other'] as const, 'Form method');
    const passwordFields = integer(item.passwordFields, 'Password field count', 0, 20_000), scriptSha256 = hash(item.scriptSha256);
    const integrity = enumeration(item.integrity, ['present', 'absent', 'not_applicable'] as const, 'Integrity attribute');
    if (kind !== 'form' && (method !== null || passwordFields !== 0) || kind === 'form' && method === null
      || kind !== 'script' && (item.inline || scriptSha256 !== null || integrity !== 'not_applicable')
      || kind === 'script' && (item.inline && item.origin !== null || !item.inline && scriptSha256 !== null)) throw new TypeError('Page element fields do not match their kind.');
    return { position: integer(item.position, 'Element position', 1, 20_000), kind, origin: origin(item.origin, true), inline: item.inline as boolean, integrity, method, passwordFields, scriptSha256 };
  }));
  const actionHints = array(value.actionHints, 'Requested-action hints', PAGE_ACTION_HINTS.length).map(raw => enumeration(raw, PAGE_ACTION_HINTS, 'Requested-action hint'));
  if (new Set(actionHints).size !== actionHints.length) throw new TypeError('Page action hints must not repeat.');
  const coverage = readCaptureCoverage(value.coverage);
  if (value.state === 'observed' && captureCoverageIsPartial(coverage)) throw new TypeError('Partial request coverage cannot declare complete page observations.');
  return { version: PAGE_BEHAVIOUR_VERSION, state: enumeration(value.state, ['observed', 'partial'] as const, 'Page observation state'), requests, elements, actionHints,
    clipboardWriteAttempts: integer(value.clipboardWriteAttempts, 'Blocked clipboard attempts', 0, 1_000_000), coverage };
}

export function readManifestPageBehaviour(value: unknown, manifestVersion: unknown): PageBehaviour | null {
  if (manifestVersion === 2 && value === undefined) return null;
  if (manifestVersion !== 3) throw new TypeError('Page behaviour requires capture manifest version 3.');
  return readPageBehaviour(value);
}

/** A missing/partial observation cannot establish removal or unchanged content. */
export function pageBehaviourRows(input: PageBehaviour) {
  return [
    ...input.requests.map(value => ({ identity: JSON.stringify(['request', value.kind, value.origin, value.contentSha256, value.status, value.cspEnforced, value.cspReportOnly]),
      label: `${value.kind} response ${value.position} · HTTP ${value.status} · enforced CSP ${value.cspEnforced ? 'present' : 'absent'} · report-only CSP ${value.cspReportOnly ? 'present' : 'absent'}`, origin: value.origin, digest: value.contentSha256 })),
    ...input.elements.map(value => ({ identity: JSON.stringify(['element', value.kind, value.origin, value.inline, value.integrity, value.method, value.passwordFields, value.scriptSha256]),
      label: `${value.kind} element ${value.position}${value.inline ? ' · inline' : ''}${value.kind === 'form' ? ` · ${value.method} · ${value.passwordFields} password fields` : value.kind === 'script' ? ` · integrity attribute ${value.integrity}` : ''}`,
      origin: value.origin, digest: value.scriptSha256 })),
    ...input.actionHints.map(value => ({ identity: JSON.stringify(['action_wording', value]), label: `Body text wording · ${value.replaceAll('_', ' ')}`, origin: null, digest: null })),
    ...input.coverage.attempts.filter(value => !['navigation', 'script', 'frame', 'document'].includes(value.channel) || value.state !== 'observed').map(value => ({
      identity: JSON.stringify(['request_channel', value.channel, value.method, value.origin, value.state, value.reason, value.collectionStarted]),
      label: `${value.channel.replaceAll('_', ' ')} request ${value.position} · ${captureAttemptDescription(value)}`,
      origin: value.origin, digest: null,
    })),
  ];
}

export function comparePageBehaviour(before: PageBehaviour | null, after: PageBehaviour | null) {
  type Row = ReturnType<typeof pageBehaviourRows>[number] & { count: number };
  const counts = (input: PageBehaviour | null) => { const map = new Map<string, Row>(); for (const row of input ? pageBehaviourRows(input) : []) map.set(row.identity, { ...row, count: (map.get(row.identity)?.count ?? 0) + 1 }); return map; };
  const left = counts(before), right = counts(after), complete = before?.state === 'observed' && after?.state === 'observed';
  const difference = (a: Map<string, Row>, b: Map<string, Row>) => [...a.values()].filter(row => row.count > (b.get(row.identity)?.count ?? 0))
    .map(row => ({ ...row, count: row.count - (b.get(row.identity)?.count ?? 0) }));
  const added = difference(right, left), notReobserved = difference(left, right);
  const navigation = (value: PageBehaviour) => value.requests.filter(row => row.kind === 'navigation').map(row => [row.origin, row.status]);
  const navigationChanged = before && after ? JSON.stringify(navigation(before)) !== JSON.stringify(navigation(after)) : null;
  const clipboardWriteDelta = before && after ? after.clipboardWriteAttempts - before.clipboardWriteAttempts : null;
  const requestChannelsChanged = before && after ? JSON.stringify(before.coverage) !== JSON.stringify(after.coverage) : null;
  return { state: !before || !after ? 'unavailable' as const : complete ? added.length || notReobserved.length || navigationChanged || clipboardWriteDelta || requestChannelsChanged ? 'changed' as const : 'unchanged' as const : 'inconclusive' as const,
    navigationChanged, clipboardWriteDelta, requestChannelsChanged,
    added: before ? added : [], notReobserved: after ? notReobserved : [], removalEstablished: false as const,
    boundary: 'Selected capture observations, not proof of authorisation, worldwide removal or compromise. Script hashes identify collected bytes; an integrity attribute is not a verified integrity result.' };
}
