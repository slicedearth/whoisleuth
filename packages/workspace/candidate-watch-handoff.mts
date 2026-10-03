import { normalizeDomain } from '../evidence/domain-name.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { assertWorkspaceInputGraph } from './hostile-input.mts';
import {
  MAX_WATCHLISTS,
  normalizeWatchlistName,
  normalizeWatchlistStore,
  assertWatchlistStoreBudget,
  type WatchlistCollection,
} from './watchlist-store.mts';
import { MAX_WATCHLIST_DOMAINS } from '../contracts/workspace-portability.mts';
import {
  MAX_WATCH_CONTEXTS,
  WATCH_PRIORITIES,
  mergeWatchDomainMetadata,
  normalizeCandidateObservation,
  candidateMaterialFingerprint,
  type BrandCandidateObservation,
  type WatchDomainContext,
  type WatchPriority,
} from './brand-candidate-workflow.mts';

export type CandidateWatchOutcome = Readonly<{
  domain: string;
  state: 'add' | 'existing' | 'rejected';
  reason: string;
  previousContext: WatchDomainContext | null;
  materialFingerprint: string | null;
}>;
export type CandidateWatchPlan = Readonly<{
  destination: string;
  brandProfileId: string | null;
  priority: WatchPriority;
  reason: string;
  reviewDueAt: string | null;
  replaceExistingContext: boolean;
  rows: readonly CandidateWatchOutcome[];
  additionalRequests: 0;
  collectionAuthorised: false;
}>;
export type CandidateWatchInput = Readonly<{
  name: string;
  candidates: readonly BrandCandidateObservation[];
  brandProfileId: string | null;
  priority: WatchPriority;
  reason: string;
  reviewDueAt?: string | null;
  replaceExistingContext?: boolean;
}>;

function admitInput(input: CandidateWatchInput): CandidateWatchInput {
  assertWorkspaceInputGraph(input, 'Candidate watch handoff');
  if (!normalizeWatchlistName(input.name))
    throw new TypeError('Choose a safe watchlist name containing 1–100 characters.');
  if (!Array.isArray(input.candidates) || input.candidates.length > MAX_WATCHLIST_DOMAINS)
    throw new RangeError(`Select at most ${MAX_WATCHLIST_DOMAINS} candidate domains.`);
  if (
    input.brandProfileId !== null &&
    (typeof input.brandProfileId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.brandProfileId))
  )
    throw new TypeError('The Brand context identifier is invalid.');
  if (!WATCH_PRIORITIES.some((option) => option.value === input.priority))
    throw new TypeError('Choose an admitted review priority.');
  if (
    typeof input.reason !== 'string' ||
    /[\u0000-\u001f\u007f]/u.test(input.reason) ||
    input.reason.trim().length > 300 ||
    !input.reason.trim()
  )
    throw new TypeError(
      'Enter a watch reason containing 1–300 characters and no control characters.',
    );
  if (input.reviewDueAt != null && !normalizeExplicitIsoTimestamp(input.reviewDueAt))
    throw new TypeError('Use a valid explicit review time. A review time is not a scan schedule.');
  if (
    input.replaceExistingContext !== undefined &&
    typeof input.replaceExistingContext !== 'boolean'
  )
    throw new TypeError('Existing-context replacement must be selected explicitly.');
  return {
    ...input,
    name: normalizeWatchlistName(input.name),
    reason: input.reason.trim(),
    reviewDueAt: normalizeExplicitIsoTimestamp(input.reviewDueAt),
  };
}

/** Pure exact-domain preview. It grants no collection authority and makes no requests. */
export function planCandidateWatchHandoff(
  localRaw: unknown,
  rawInput: CandidateWatchInput,
): CandidateWatchPlan {
  const input = admitInput(rawInput),
    local = normalizeWatchlistStore(localRaw).watchlists;
  const name =
    Object.keys(local).find((name) => name.toLowerCase() === input.name.toLowerCase()) ??
    input.name;
  const entry = local[name],
    existing = new Map(entry?.domainMetadata.map((record) => [record.domain, record]) ?? []);
  const seen = new Set<string>(),
    rows: CandidateWatchOutcome[] = [];
  let admitted = existing.size;
  for (const raw of input.candidates) {
    const candidate = normalizeCandidateObservation(raw),
      domain = candidate?.domain ?? normalizeDomain(raw?.domain) ?? '';
    let reason = '';
    if (!candidate || !domain) reason = 'Invalid candidate domain or provenance.';
    else if (seen.has(domain)) reason = 'Repeated selection; the first exact domain is retained.';
    else if (!entry && Object.keys(local).length >= MAX_WATCHLISTS)
      reason = 'Watchlist count capacity is exhausted.';
    else if (!existing.has(domain) && admitted >= MAX_WATCHLIST_DOMAINS)
      reason = 'Domain capacity is exhausted.';
    else if (
      existing.get(domain)?.contexts.length === MAX_WATCH_CONTEXTS &&
      !existing
        .get(domain)
        ?.contexts.some((context) => context.brandProfileId === input.brandProfileId)
    )
      reason = 'This domain has reached its separate-context capacity.';
    seen.add(domain);
    const previousContext =
      existing
        .get(domain)
        ?.contexts.find((context) => context.brandProfileId === input.brandProfileId) ?? null;
    const materialFingerprint = candidate
      ? candidateMaterialFingerprint(candidate, input.brandProfileId ?? '')
      : null;
    if (reason)
      rows.push({ domain, state: 'rejected', reason, previousContext, materialFingerprint });
    else {
      const context = existing
        .get(domain)
        ?.contexts.find((context) => context.brandProfileId === input.brandProfileId);
      rows.push({
        domain,
        state: existing.has(domain) ? 'existing' : 'add',
        previousContext,
        materialFingerprint,
        reason: context
          ? input.replaceExistingContext
            ? `Explicitly replace this context (${context.priority}) with ${input.priority}; preserve evidence and other Brand contexts.`
            : `Preserve existing deliberate ${context.priority} priority and reason; merge provenance only.`
          : existing.has(domain)
            ? 'Already tracked; add this separate Brand context, preserving other contexts.'
            : 'Add metadata only; no scan or baseline is invented.',
      });
      if (!existing.has(domain)) admitted++;
    }
  }
  return {
    destination: name,
    brandProfileId: input.brandProfileId,
    priority: input.priority,
    reason: input.reason,
    reviewDueAt: input.reviewDueAt ?? null,
    replaceExistingContext: input.replaceExistingContext ?? false,
    rows,
    additionalRequests: 0,
    collectionAuthorised: false,
  };
}

export function applyCandidateWatchHandoff(
  localRaw: unknown,
  rawInput: CandidateWatchInput,
  nowRaw: unknown,
) {
  const input = admitInput(rawInput),
    now = normalizeExplicitIsoTimestamp(nowRaw);
  if (!now) throw new TypeError('The watch metadata change time must use an explicit timezone.');
  if (input.reviewDueAt && input.reviewDueAt <= now)
    throw new TypeError('The review time must be later than this change time.');
  const local = normalizeWatchlistStore(localRaw).watchlists,
    plan = planCandidateWatchHandoff(local, input);
  const candidates = new Map<string, BrandCandidateObservation>();
  for (const raw of input.candidates) {
    const candidate = normalizeCandidateObservation(raw);
    if (candidate && !candidates.has(candidate.domain)) candidates.set(candidate.domain, candidate);
  }
  const context: WatchDomainContext = {
    brandProfileId: input.brandProfileId,
    priority: input.priority,
    reason: input.reason,
    changedAt: now,
    reviewDueAt: input.reviewDueAt ?? null,
  };
  const entry = local[plan.destination] ?? {
    updatedAt: null,
    results: [],
    baseline: [],
    history: [],
    domainMetadata: [],
  };
  if (
    input.replaceExistingContext &&
    plan.rows.some(
      (row) =>
        row.state !== 'rejected' &&
        row.previousContext?.changedAt &&
        now <= row.previousContext.changedAt,
    )
  )
    throw new Error(
      'The change clock does not follow the retained context. Review the clock before replacing a manual priority.',
    );
  const metadata = plan.rows
    .filter((row) => row.state !== 'rejected')
    .map((row) => ({
      domain: row.domain,
      contexts:
        !input.replaceExistingContext &&
        entry.domainMetadata.some(
          (record) =>
            record.domain === row.domain &&
            record.contexts.some((old) => old.brandProfileId === input.brandProfileId),
        )
          ? []
          : [context],
      candidate: candidates.get(row.domain) ?? null,
    }));
  if (!metadata.length) return { watchlists: local, plan };
  Object.defineProperty(local, plan.destination, {
    value: { ...entry, domainMetadata: mergeWatchDomainMetadata(entry.domainMetadata, metadata) },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return { watchlists: assertWatchlistStoreBudget(local).watchlists, plan };
}

/** Field-scoped optimistic edits preserve unrelated domains and contexts. */
export function setWatchDomainContext(
  localRaw: unknown,
  name: string,
  domainRaw: string,
  input: WatchDomainContext,
  expected: WatchDomainContext | null,
): WatchlistCollection {
  return setWatchDomainContexts(localRaw, name, [{ domain: domainRaw, input, expected }]);
}

export type WatchDomainContextEdit = Readonly<{
  domain: string;
  input: WatchDomainContext;
  expected: WatchDomainContext | null;
}>;
export function setWatchDomainContexts(
  localRaw: unknown,
  name: string,
  edits: readonly WatchDomainContextEdit[],
): WatchlistCollection {
  if (!Array.isArray(edits) || edits.length > MAX_WATCHLIST_DOMAINS)
    throw new RangeError('The reviewed metadata edit exceeds its domain bound.');
  const local = normalizeWatchlistStore(localRaw).watchlists,
    entry = local[name];
  if (!entry) throw new Error('The selected watchlist was deleted; nothing was overwritten.');
  const metadata = new Map(entry.domainMetadata.map((record) => [record.domain, record])),
    seen = new Set<string>();
  for (const edit of edits) {
    const domain = normalizeDomain(edit.domain),
      record = domain ? metadata.get(domain) : null;
    const key = `${domain}\0${edit.input.brandProfileId ?? ''}`,
      old =
        record?.contexts.find((context) => context.brandProfileId === edit.input.brandProfileId) ??
        null;
    if (
      !domain ||
      !record ||
      seen.has(key) ||
      JSON.stringify(old) !== JSON.stringify(edit.expected)
    )
      throw new Error(
        'A reviewed domain context changed, was repeated or was deleted. Reopen the selection; nothing was overwritten.',
      );
    const input = admitInput({ name, candidates: [], ...edit.input });
    const changedAt = normalizeExplicitIsoTimestamp(edit.input.changedAt);
    if (
      !changedAt ||
      (old?.changedAt && changedAt <= old.changedAt) ||
      (input.reviewDueAt && input.reviewDueAt <= changedAt)
    )
      throw new TypeError('Use a current change time and a later optional review time.');
    seen.add(key);
    metadata.set(domain, {
      ...record,
      contexts: [
        ...record.contexts.filter(
          (context) => context.brandProfileId !== edit.input.brandProfileId,
        ),
        { ...edit.input, reason: input.reason, changedAt, reviewDueAt: input.reviewDueAt ?? null },
      ],
    });
  }
  local[name] = { ...entry, domainMetadata: [...metadata.values()] };
  return assertWatchlistStoreBudget(local).watchlists;
}
