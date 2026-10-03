import { normalizeDomain } from '../evidence/domain-name.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { sha256IdentityHex } from '../evidence/record-identity.mts';
import { ordinaryWorkspaceRecord } from './hostile-input.mts';
import {
  MAX_CANDIDATE_OBSERVATIONS,
  MAX_CANDIDATE_MATCHES,
  MAX_CANDIDATE_SOURCES,
  MAX_CANDIDATE_TEXT,
  MAX_CANDIDATE_EXCEPTIONS,
  MAX_CANDIDATE_EXCEPTION_HISTORY,
  MAX_WATCH_CONTEXTS,
  MAX_WATCHLIST_DOMAINS,
  MAX_WATCHLIST_INPUT_RECORDS,
} from '../contracts/workspace-portability.mts';
export {
  MAX_CANDIDATE_OBSERVATIONS,
  MAX_CANDIDATE_MATCHES,
  MAX_CANDIDATE_SOURCES,
  MAX_CANDIDATE_TEXT,
  MAX_CANDIDATE_EXCEPTIONS,
  MAX_CANDIDATE_EXCEPTION_HISTORY,
  MAX_WATCH_CONTEXTS,
} from '../contracts/workspace-portability.mts';

/** Analyst urgency never changes a score, collection mode or schedule. */
export const WATCH_PRIORITIES = Object.freeze([
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'p1', label: 'P1 immediate review' },
  { value: 'p2', label: 'P2 prompt review' },
  { value: 'p3', label: 'P3 routine review' },
  { value: 'p4', label: 'P4 background watch' },
] as const);
export type WatchPriority = (typeof WATCH_PRIORITIES)[number]['value'];
const CONTROL = /[\u0000-\u001f\u007f]/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
function record(value: unknown) {
  return ordinaryWorkspaceRecord(value, 'Candidate metadata') ?? {};
}
function text(value: unknown, maximum = MAX_CANDIDATE_TEXT): string {
  return typeof value === 'string' && !CONTROL.test(value) && value.length <= maximum * 4
    ? value.replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}
function reference(value: unknown): string {
  return typeof value === 'string' && ID.test(value) ? value : '';
}
function time(value: unknown) {
  return normalizeExplicitIsoTimestamp(value);
}

export type CandidateSourceObservation = Readonly<{
  source: string;
  revision: string | null;
  observedHostname: string;
  sourceFirstObservedAt: string | null;
  sourceLastObservedAt: string | null;
  firstLocalObservedAt: string | null;
  completeness: 'complete' | 'partial' | 'unknown';
  gap: string;
}>;
export type CandidateMatch = Readonly<{
  brandProfileId: string;
  ruleKey: string;
  term: string;
  reason: string;
}>;
export type BrandCandidateObservation = Readonly<{
  domain: string;
  matches: readonly CandidateMatch[];
  sources: readonly CandidateSourceObservation[];
}>;
export type WatchDomainContext = Readonly<{
  brandProfileId: string | null;
  priority: WatchPriority;
  reason: string;
  changedAt: string | null;
  reviewDueAt: string | null;
}>;
export type WatchDomainMetadata = Readonly<{
  domain: string;
  contexts: readonly WatchDomainContext[];
  candidate: BrandCandidateObservation | null;
}>;
export type BrandCandidateExceptionSnapshot = Readonly<{
  revision: number;
  reason: string;
  expiresAt: string;
  reviewedAt: string;
  reviewedFingerprint: string;
  enabled: boolean;
}>;
export type BrandCandidateException = BrandCandidateExceptionSnapshot &
  Readonly<{
    id: string;
    domain: string;
    ruleKey: string;
    purpose: 'irrelevant_match' | 'deferred_review' | 'accepted_temporary_change';
    history: readonly BrandCandidateExceptionSnapshot[];
    historyOmitted: number;
  }>;

export function normalizeCandidateObservation(value: unknown): BrandCandidateObservation | null {
  const raw = record(value),
    domain = normalizeDomain(raw.domain);
  if (!domain) return null;
  if (
    (Array.isArray(raw.matches) && raw.matches.length > MAX_CANDIDATE_MATCHES) ||
    (Array.isArray(raw.sources) && raw.sources.length > MAX_CANDIDATE_SOURCES)
  ) {
    throw new RangeError(
      'Candidate provenance exceeds its retained bound. Reduce the exact selection; no source was silently chosen or discarded.',
    );
  }
  const matches = new Map<string, CandidateMatch>();
  for (const entry of (Array.isArray(raw.matches) ? raw.matches : []).slice(
    0,
    MAX_CANDIDATE_MATCHES * 4,
  )) {
    const match = record(entry),
      brandProfileId = reference(match.brandProfileId),
      ruleKey = reference(match.ruleKey);
    const reason = text(match.reason),
      term = text(match.term);
    if (brandProfileId && ruleKey && reason) {
      const key = `${brandProfileId}\0${ruleKey}`,
        next = { brandProfileId, ruleKey, term, reason },
        prior = matches.get(key);
      if (prior && JSON.stringify(prior) !== JSON.stringify(next))
        throw new TypeError(
          'The same Brand rule has conflicting candidate reasons. Keep its source identity separate.',
        );
      matches.set(key, next);
    }
    if (matches.size >= MAX_CANDIDATE_MATCHES) break;
  }
  const sources = new Map<string, CandidateSourceObservation>();
  for (const entry of (Array.isArray(raw.sources) ? raw.sources : []).slice(
    0,
    MAX_CANDIDATE_SOURCES * 4,
  )) {
    const input = record(entry),
      source = text(input.source, 100),
      observedHostname = normalizeDomain(input.observedHostname);
    if (
      !source ||
      !observedHostname ||
      /https?:\/\/|[?]/iu.test(source) ||
      /https?:\/\/|[?]/iu.test(String(input.revision ?? ''))
    )
      continue;
    const first = time(input.sourceFirstObservedAt),
      last = time(input.sourceLastObservedAt);
    const invalidInterval = Boolean(first && last && first > last);
    const malformedClock =
      (input.sourceFirstObservedAt != null && !first) ||
      (input.sourceLastObservedAt != null && !last);
    const observation: CandidateSourceObservation = {
      source,
      observedHostname,
      revision: text(input.revision, 128) || null,
      sourceFirstObservedAt: invalidInterval ? null : first,
      sourceLastObservedAt: invalidInterval ? null : last,
      firstLocalObservedAt: time(input.firstLocalObservedAt),
      completeness:
        invalidInterval || malformedClock
          ? 'partial'
          : input.completeness === 'complete' || input.completeness === 'partial'
            ? input.completeness
            : 'unknown',
      gap: invalidInterval
        ? 'The source-reported interval is inconsistent.'
        : malformedClock
          ? 'A supplied source observation clock is invalid or lacks an explicit timezone.'
          : text(input.gap),
    };
    sources.set(JSON.stringify(observation), observation);
    if (sources.size >= MAX_CANDIDATE_SOURCES) break;
  }
  return {
    domain,
    matches: [...matches.values()].sort((a, b) =>
      `${a.brandProfileId}:${a.ruleKey}`.localeCompare(`${b.brandProfileId}:${b.ruleKey}`),
    ),
    sources: [...sources.values()],
  };
}

export function candidateMaterialFingerprint(
  candidate: BrandCandidateObservation,
  brandProfileId: string,
  ruleKey?: string,
): string {
  return `material:${sha256IdentityHex(
    new TextEncoder().encode(
      JSON.stringify({
        domain: candidate.domain,
        matches: candidate.matches.filter(
          (match) =>
            match.brandProfileId === brandProfileId && (!ruleKey || match.ruleKey === ruleKey),
        ),
        // Local retention time is not material evidence and repeated captures do not recur.
        sources: candidate.sources
          .map(({ firstLocalObservedAt: _local, ...source }) => source)
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      }),
    ),
  )}`;
}

export function mergeCandidateObservations(
  left: unknown,
  right: unknown,
): BrandCandidateObservation | null {
  const a = normalizeCandidateObservation(left),
    b = normalizeCandidateObservation(right);
  if (!a) return b;
  if (!b) return a;
  if (a.domain !== b.domain)
    throw new TypeError('Candidate provenance can only merge for the exact same domain.');
  const sources = new Map<string, CandidateSourceObservation>();
  for (const source of [...a.sources, ...b.sources]) {
    const { firstLocalObservedAt: _local, ...material } = source;
    const key = JSON.stringify(material),
      old = sources.get(key);
    sources.set(key, {
      ...source,
      firstLocalObservedAt:
        old?.firstLocalObservedAt && source.firstLocalObservedAt
          ? old.firstLocalObservedAt < source.firstLocalObservedAt
            ? old.firstLocalObservedAt
            : source.firstLocalObservedAt
          : (old?.firstLocalObservedAt ?? source.firstLocalObservedAt),
    });
  }
  const matches = new Map<string, CandidateMatch>();
  for (const match of [...a.matches, ...b.matches]) {
    const key = `${match.brandProfileId}\0${match.ruleKey}`,
      old = matches.get(key);
    if (old && JSON.stringify(old) !== JSON.stringify(match))
      throw new TypeError(
        'The same Brand rule has conflicting candidate reasons. No observation was overwritten.',
      );
    matches.set(key, match);
  }
  return normalizeCandidateObservation({
    domain: a.domain,
    matches: [...matches.values()],
    sources: [...sources.values()],
  });
}

export function normalizeCandidateObservations(value: unknown): BrandCandidateObservation[] {
  const output = new Map<string, BrandCandidateObservation>();
  for (const raw of (Array.isArray(value) ? value : []).slice(0, MAX_CANDIDATE_OBSERVATIONS * 4)) {
    const candidate = normalizeCandidateObservation(raw);
    if (!candidate) continue;
    output.set(
      candidate.domain,
      mergeCandidateObservations(output.get(candidate.domain), candidate)!,
    );
    if (output.size >= MAX_CANDIDATE_OBSERVATIONS) break;
  }
  return [...output.values()];
}

export function normalizeWatchDomainMetadata(
  value: unknown,
  legacyDomains: readonly string[] = [],
): WatchDomainMetadata[] {
  const output = new Map<string, WatchDomainMetadata>();
  for (const raw of (Array.isArray(value) ? value : []).slice(0, MAX_WATCHLIST_INPUT_RECORDS)) {
    const entry = record(raw),
      domain = normalizeDomain(entry.domain);
    if (!domain) continue;
    const prior = output.get(domain);
    const contexts = new Map<string, WatchDomainContext>(
      prior?.contexts.map((context) => [context.brandProfileId ?? '', context]) ?? [],
    );
    for (const item of (Array.isArray(entry.contexts) ? entry.contexts : []).slice(
      0,
      MAX_WATCH_CONTEXTS * 4,
    )) {
      const input = record(item),
        brandProfileId = reference(input.brandProfileId) || null;
      if (input.brandProfileId !== null && !brandProfileId) continue;
      const priority = WATCH_PRIORITIES.some((option) => option.value === input.priority)
        ? (input.priority as WatchPriority)
        : 'unassigned';
      const context = {
        brandProfileId,
        priority,
        reason: text(input.reason),
        changedAt: time(input.changedAt),
        reviewDueAt: time(input.reviewDueAt),
      };
      const key = brandProfileId ?? '',
        old = contexts.get(key);
      if (!old || (context.changedAt && (!old.changedAt || context.changedAt > old.changedAt)))
        contexts.set(key, context);
      if (contexts.size >= MAX_WATCH_CONTEXTS) break;
    }
    const candidate = normalizeCandidateObservation(entry.candidate);
    output.set(domain, {
      domain,
      contexts: [...contexts.values()],
      candidate: mergeCandidateObservations(
        prior?.candidate,
        candidate?.domain === domain ? candidate : null,
      ),
    });
    if (output.size >= MAX_WATCHLIST_DOMAINS) break;
  }
  for (const raw of legacyDomains.slice(0, MAX_WATCHLIST_DOMAINS)) {
    const domain = normalizeDomain(raw);
    if (domain && !output.has(domain) && output.size < MAX_WATCHLIST_DOMAINS)
      output.set(domain, {
        domain,
        contexts: [
          {
            brandProfileId: null,
            priority: 'unassigned',
            reason: '',
            changedAt: null,
            reviewDueAt: null,
          },
        ],
        candidate: null,
      });
  }
  return [...output.values()];
}

export function mergeWatchDomainMetadata(local: unknown, imported: unknown): WatchDomainMetadata[] {
  const output = new Map(normalizeWatchDomainMetadata(local).map((entry) => [entry.domain, entry]));
  for (const incoming of normalizeWatchDomainMetadata(imported)) {
    const previous = output.get(incoming.domain);
    if (!previous) {
      if (output.size < MAX_WATCHLIST_DOMAINS) output.set(incoming.domain, incoming);
      continue;
    }
    const contexts = new Map(previous.contexts.map((context) => [context.brandProfileId, context]));
    for (const context of incoming.contexts) {
      const old = contexts.get(context.brandProfileId);
      if (
        (!old && contexts.size < MAX_WATCH_CONTEXTS) ||
        (old && context.changedAt && (!old.changedAt || context.changedAt > old.changedAt))
      )
        contexts.set(context.brandProfileId, context);
    }
    output.set(incoming.domain, {
      domain: incoming.domain,
      contexts: [...contexts.values()],
      candidate: mergeCandidateObservations(previous.candidate, incoming.candidate),
    });
  }
  return [...output.values()];
}

function exceptionSnapshot(value: unknown): BrandCandidateExceptionSnapshot | null {
  const raw = record(value),
    reviewedAt = time(raw.reviewedAt),
    expiresAt = time(raw.expiresAt),
    reason = text(raw.reason);
  if (
    !reviewedAt ||
    !expiresAt ||
    (raw.enabled === true && expiresAt <= reviewedAt) ||
    !reason ||
    !Number.isSafeInteger(raw.revision) ||
    Number(raw.revision) < 1 ||
    typeof raw.reviewedFingerprint !== 'string' ||
    !/^material:[a-f0-9]{64}$/u.test(raw.reviewedFingerprint) ||
    typeof raw.enabled !== 'boolean'
  )
    return null;
  return {
    revision: Number(raw.revision),
    reviewedAt,
    expiresAt,
    reason,
    reviewedFingerprint: raw.reviewedFingerprint,
    enabled: raw.enabled,
  };
}

export function normalizeCandidateExceptions(value: unknown): BrandCandidateException[] {
  const output = new Map<string, BrandCandidateException>();
  const seenRevisions = new Map<string, string>();
  const seenScopes = new Map<string, string>();
  for (const item of (Array.isArray(value) ? value : []).slice(0, MAX_CANDIDATE_EXCEPTIONS * 4)) {
    const raw = record(item),
      snapshot = exceptionSnapshot(raw),
      id = reference(raw.id),
      domain = normalizeDomain(raw.domain),
      ruleKey = reference(raw.ruleKey);
    if (
      !snapshot ||
      !id ||
      !domain ||
      !ruleKey ||
      !['irrelevant_match', 'deferred_review', 'accepted_temporary_change'].includes(
        String(raw.purpose),
      )
    )
      continue;
    const history = (Array.isArray(raw.history) ? raw.history : [])
      .slice(0, MAX_CANDIDATE_EXCEPTION_HISTORY * 4)
      .map(exceptionSnapshot)
      .filter((entry): entry is BrandCandidateExceptionSnapshot => entry !== null)
      .slice(0, MAX_CANDIDATE_EXCEPTION_HISTORY);
    const exception = {
      ...snapshot,
      id,
      domain,
      ruleKey,
      purpose: raw.purpose as BrandCandidateException['purpose'],
      history,
      historyOmitted:
        Number.isSafeInteger(raw.historyOmitted) && Number(raw.historyOmitted) >= 0
          ? Number(raw.historyOmitted)
          : 0,
    };
    const old = output.get(id);
    const scope = JSON.stringify([domain, ruleKey, exception.purpose]);
    const previousScope = seenScopes.get(id);
    if (
      previousScope !== undefined && previousScope !== scope
    )
      throw new TypeError(
        'An exception identifier cannot change its exact domain, rule or purpose.',
      );
    seenScopes.set(id, scope);
    const revisionKey = JSON.stringify([id, exception.revision]);
    const revisionValue = JSON.stringify(exception);
    const previousRevision = seenRevisions.get(revisionKey);
    if (previousRevision !== undefined && previousRevision !== revisionValue)
      throw new TypeError('The same exception identifier and revision contain conflicting decisions. No exception was imported.');
    seenRevisions.set(revisionKey, revisionValue);
    if ((old && exception.revision > old.revision) || (!old && output.size < MAX_CANDIDATE_EXCEPTIONS)) output.set(id, exception);
  }
  return [...output.values()];
}

export function candidateExceptionState(
  exception: BrandCandidateException,
  candidate: BrandCandidateObservation,
  brandProfileId: string,
  now: unknown,
): 'active' | 'disabled' | 'expired' | 'changed' | 'unmatched' | 'clock_unavailable' {
  if (!exception.enabled) return 'disabled';
  if (
    exception.domain !== candidate.domain ||
    !candidate.matches.some(
      (match) => match.brandProfileId === brandProfileId && match.ruleKey === exception.ruleKey,
    )
  )
    return 'unmatched';
  const clock = time(now);
  if (!clock || clock < exception.reviewedAt) return 'clock_unavailable';
  if (clock >= exception.expiresAt) return 'expired';
  if (
    candidateMaterialFingerprint(candidate, brandProfileId, exception.ruleKey) !==
    exception.reviewedFingerprint
  )
    return 'changed';
  return 'active';
}

/** Updates are revision-checked; disabling preserves the previous reason and snapshot. */
export function reviseCandidateException(
  existing: BrandCandidateException | null,
  input: Omit<BrandCandidateException, 'revision' | 'history' | 'historyOmitted'>,
  expectedRevision: number | null,
): BrandCandidateException {
  if ((existing?.revision ?? null) !== expectedRevision)
    throw new Error(
      'The candidate exception changed. Reopen it before saving; nothing was overwritten.',
    );
  if (
    typeof input.reason !== 'string' ||
    input.reason.length > MAX_CANDIDATE_TEXT ||
    CONTROL.test(input.reason)
  )
    throw new TypeError('Exception reasons must contain 1–300 plain-text characters.');
  const revision = (existing?.revision ?? 0) + 1;
  const retainedReviewClock = existing
    ? [existing.reviewedAt, ...existing.history.map(snapshot => snapshot.reviewedAt)].sort().at(-1)!
    : null;
  const submittedReviewClock = time(input.reviewedAt);
  if (input.enabled && retainedReviewClock && submittedReviewClock && submittedReviewClock < retainedReviewClock)
    throw new TypeError('The review clock precedes a retained exception review. Correct the clock before renewing or re-enabling it.');
  const reviewedAt = !input.enabled && retainedReviewClock && submittedReviewClock && submittedReviewClock < retainedReviewClock
    ? retainedReviewClock
    : input.reviewedAt;
  const prior = existing ? [exceptionSnapshot(existing)!, ...existing.history] : [];
  const normalized = normalizeCandidateExceptions([
    {
      ...input,
      reviewedAt,
      revision,
      history: prior.slice(0, MAX_CANDIDATE_EXCEPTION_HISTORY),
      historyOmitted:
        (existing?.historyOmitted ?? 0) +
        Math.max(0, prior.length - MAX_CANDIDATE_EXCEPTION_HISTORY),
    },
  ])[0];
  if (!normalized)
    throw new TypeError(
      'Use an exact domain and rule, a reason, a future expiry and current reviewed evidence.',
    );
  if (
    existing &&
    (input.id !== existing.id ||
      input.domain !== existing.domain ||
      input.ruleKey !== existing.ruleKey ||
      input.purpose !== existing.purpose)
  )
    throw new TypeError(
      'An exception revision cannot widen its domain or rule scope. Create and preview another exact exception.',
    );
  return normalized;
}
