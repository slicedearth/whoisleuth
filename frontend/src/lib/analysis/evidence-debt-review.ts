import type { CaseRecord } from './case-model.ts';
import {
  BULK_REVIEW_STALE_AFTER_DAYS,
} from './bulk-retry-plan.ts';
import {
  isExpectedUnsupportedBulkSource,
} from './bulk-source-coverage.ts';
import type {
  BulkSession,
  BulkSessionSourceCoverage,
} from './bulk-session-model.ts';
import { stableComparisonLedgerId } from './comparison-ledger-serialization.ts';
import {
  ANALYST_REVIEW_STALE_AFTER_DAYS,
  currentCaseEvidenceGapDismissedPinIds,
} from './analyst-review-inbox.ts';
import {
  EVIDENCE_DEBT_STATES,
  EVIDENCE_DEBT_VERSION,
  MAX_EVIDENCE_DEBT_BULK_ROWS,
  MAX_EVIDENCE_DEBT_CASE_PINS,
  MAX_EVIDENCE_DEBT_ITEMS,
  MAX_EVIDENCE_DEBT_MATRIX_ROWS,
  type EvidenceDebtItem,
  type EvidenceDebtMatrixRow,
  type EvidenceDebtNextAction,
  type EvidenceDebtOwner,
  type EvidenceDebtPriority,
  type EvidenceDebtReview,
  type EvidenceDebtSourceState,
  type EvidenceDebtState,
} from './evidence-debt-contract.ts';

export * from './evidence-debt-contract.ts';
export const CASE_EVIDENCE_STALE_AFTER_DAYS = ANALYST_REVIEW_STALE_AFTER_DAYS;

type Candidate = EvidenceDebtItem;
type MutableRetention = {
  bulkRowsWithoutCoverage: number;
  casesWithoutPins: number;
  explicitlySkipped: number;
  explicitlyNotFound: number;
  resolvedCasesExcluded: number;
  reviewedCasePinsExcluded: number;
};

const DAY_MS = 86_400_000;
const STATE_RANK = new Map<EvidenceDebtState, number>(
  EVIDENCE_DEBT_STATES.map((state, index) => [state, index]),
);
const HIGH_STATES = new Set<EvidenceDebtState>(['conflicting', 'rate_limited', 'unavailable']);
const DEEP_LOOKUP_SOURCE_IDS = new Set([
  'availability',
  'dns',
  'http',
  'lookup',
  'page_identity',
  'rdap',
  'registrar_rdap',
  'tls',
  'whois',
]);
const CONTROL_RE = /[\u0000-\u001f\u007f]/gu;
const STATE_ALIASES: Readonly<Record<string, EvidenceDebtState>> = Object.freeze({
  blocked: 'unavailable',
  conflict: 'conflicting',
  conflicting: 'conflicting',
  disagreement: 'conflicting',
  error: 'unavailable',
  failed: 'unavailable',
  inconclusive: 'unavailable',
  limited: 'partial',
  partial: 'partial',
  rate_limit: 'rate_limited',
  rate_limited: 'rate_limited',
  ratelimited: 'rate_limited',
  stale: 'stale',
  timeout: 'unavailable',
  truncated: 'partial',
  unavailable: 'unavailable',
  unsupported: 'unsupported',
});

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === 'string'
    ? value.replace(CONTROL_RE, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

function timestamp(value: unknown): string | null {
  const text = boundedText(value, 64);
  const parsed = Date.parse(text);
  return text && Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeState(value: unknown): string {
  return boundedText(value, 40).toLowerCase().replace(/[\s-]+/gu, '_');
}

function sourceId(value: unknown): string {
  return boundedText(value, 80)
    .toLowerCase()
    .replace(/[\s-]+/gu, '_')
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 80) || 'unknown';
}

function sourceLabel(value: unknown): string {
  const source = boundedText(value, 80) || 'Unknown source';
  const known: Readonly<Record<string, string>> = {
    ct: 'Certificate Transparency',
    dns: 'DNS',
    http: 'HTTP',
    rdap: 'RDAP',
    tls: 'TLS',
    whois: 'WHOIS',
  };
  return known[sourceId(source)] ?? source.replaceAll('_', ' ');
}

function ageDays(value: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(value)) / DAY_MS));
}

function sortStates(states: Iterable<EvidenceDebtState>): EvidenceDebtState[] {
  return [...new Set(states)].sort((left, right) => (
    (STATE_RANK.get(left) ?? 99) - (STATE_RANK.get(right) ?? 99)
  ));
}

function boundedLimitations(values: readonly unknown[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values.slice(0, 16)) {
    const text = boundedText(value, 240);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
    if (output.length >= 4) break;
  }
  return output;
}

function itemPriority(states: readonly EvidenceDebtState[]): EvidenceDebtPriority {
  return states.some((state) => HIGH_STATES.has(state)) ? 'high' : 'medium';
}

function itemSort(left: Candidate, right: Candidate): number {
  if (left.priority !== right.priority) return left.priority === 'high' ? -1 : 1;
  const state = (STATE_RANK.get(left.primaryState) ?? 99) - (STATE_RANK.get(right.primaryState) ?? 99);
  if (state) return state;
  const time = Date.parse(left.observedAt) - Date.parse(right.observedAt);
  if (time) return time;
  return compareText(left.id, right.id);
}

function emptyCounts(): Record<EvidenceDebtState, number> {
  return {
    conflicting: 0,
    rate_limited: 0,
    unavailable: 0,
    partial: 0,
    stale: 0,
    unsupported: 0,
  };
}

function debtForBulkSource(
  domain: string,
  observation: BulkSessionSourceCoverage,
  observedAt: string,
  nowMs: number,
): EvidenceDebtState[] {
  const states: EvidenceDebtState[] = [];
  const normalized = normalizeState(observation.state);
  if (normalized === 'partial') states.push('partial');
  else if (normalized === 'error' || normalized === 'unavailable') states.push('unavailable');
  else if (normalized === 'unsupported' && !isExpectedUnsupportedBulkSource(domain, observation)) states.push('unsupported');
  if (
    normalized !== 'skipped'
    && normalized !== 'unsupported'
    && ageDays(observedAt, nowMs) >= BULK_REVIEW_STALE_AFTER_DAYS
  ) states.push('stale');
  return sortStates(states);
}

function debtForCasePin(
  domain: string,
  source: unknown,
  sourceState: unknown,
  completeness: unknown,
  truncated: unknown,
  observedAt: string,
  nowMs: number,
): EvidenceDebtState[] {
  const rawState = normalizeState(sourceState);
  if (rawState === 'skipped') return [];
  if (rawState === 'unsupported' && isExpectedUnsupportedBulkSource(domain, {
    source: sourceId(source),
    state: rawState,
  })) return [];
  const states: EvidenceDebtState[] = [];
  const mapped = STATE_ALIASES[rawState];
  if (mapped) states.push(mapped);
  if (truncated === true || completeness === 'partial') states.push('partial');
  if ((completeness === 'inconclusive' || completeness === 'unknown') && rawState !== 'unsupported') {
    states.push('unavailable');
  }
  if (
    rawState !== 'unsupported'
    && nowMs - Date.parse(observedAt) > CASE_EVIDENCE_STALE_AFTER_DAYS * DAY_MS
  ) {
    states.push('stale');
  }
  return sortStates(states);
}

function nextForCase(states: readonly EvidenceDebtState[], domain: string, caseId: string, source: string): Readonly<{
  action: EvidenceDebtNextAction;
  href: string;
}> {
  if (
    states.includes('conflicting')
    || states.includes('unsupported')
    || !DEEP_LOOKUP_SOURCE_IDS.has(source)
  ) {
    return {
      action: 'case_review',
      href: `/monitor?view=cases&case=${encodeURIComponent(caseId)}#case-response-${encodeURIComponent(caseId)}`,
    };
  }
  return {
    action: 'deep_lookup',
    href: `/lookup?q=${encodeURIComponent(domain)}&depth=deep`,
  };
}

function buildBulkCandidates(
  sessions: readonly BulkSession[],
  nowMs: number,
  retention: MutableRetention,
): { candidates: Candidate[]; totalRows: number; olderObservations: number } {
  const rows = sessions.slice(0, 10).flatMap((session) => session.results.map((result) => ({
    session,
    result,
    observedAt: timestamp(session.updatedAt) ?? new Date(0).toISOString(),
  })));
  rows.sort((left, right) => (
    Date.parse(right.observedAt) - Date.parse(left.observedAt)
    || compareText(left.session.id, right.session.id)
    || compareText(left.result.domain, right.result.domain)
  ));
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  let olderObservations = 0;
  for (const { session, result, observedAt } of rows.slice(0, MAX_EVIDENCE_DEBT_BULK_ROWS)) {
    if (!result.sourceCoverage.length) retention.bulkRowsWithoutCoverage += 1;
    for (const observation of result.sourceCoverage.slice(0, 12)) {
      if (observation.state === 'skipped') retention.explicitlySkipped += 1;
      if (observation.state === 'not_found') retention.explicitlyNotFound += 1;
      const normalizedSource = sourceId(observation.source);
      const latestKey = `${result.domain}\u0000${normalizedSource}`;
      if (seen.has(latestKey)) {
        olderObservations += 1;
        continue;
      }
      seen.add(latestKey);
      const states = debtForBulkSource(result.domain, observation, observedAt, nowMs);
      if (!states.length) continue;
      const label = sourceLabel(observation.source);
      candidates.push(Object.freeze({
        id: stableComparisonLedgerId('debt-bulk', [session.id, result.domain, normalizedSource, observedAt, ...states]),
        owner: 'bulk',
        ownerId: session.id,
        ownerLabel: boundedText(session.name, 100) || 'Saved Bulk session',
        domain: result.domain,
        sourceId: normalizedSource,
        sourceLabel: label,
        states: Object.freeze(states),
        primaryState: states[0]!,
        priority: itemPriority(states),
        observedAt,
        detail: `${label} is retained as ${observation.state.replaceAll('_', ' ')} in ${boundedText(session.name, 100) || 'a saved Bulk session'}.`,
        limitations: Object.freeze([
          `Bulk source age uses the saved session time and becomes stale after ${BULK_REVIEW_STALE_AFTER_DAYS} days.`,
        ]),
        reviewHref: '/bulk#bulk-sessions-title',
        nextAction: 'retry',
        nextHref: '/bulk#bulk-sessions-title',
        expectedEffect: 'A deliberate retry could replace this saved source state, but may remain limited or expose a new disagreement.',
        disclosure: 'Open the saved session, review its retained rows, and deliberately start any retry. This queue starts no request.',
      }));
    }
  }
  return { candidates, totalRows: rows.length, olderObservations };
}

function buildCaseCandidates(
  cases: readonly CaseRecord[],
  nowIso: string,
  nowMs: number,
  retention: MutableRetention,
): { candidates: Candidate[]; totalPins: number } {
  const active = cases.slice(0, 500).filter((record) => {
    if (record.status === 'resolved') {
      retention.resolvedCasesExcluded += 1;
      return false;
    }
    if (!record.evidencePins.length) retention.casesWithoutPins += 1;
    return true;
  });
  const pins = active.flatMap((record) => {
    const dismissedPinIds = currentCaseEvidenceGapDismissedPinIds(record, nowIso);
    retention.reviewedCasePinsExcluded += dismissedPinIds.size;
    return record.evidencePins
      .filter((pin) => !dismissedPinIds.has(pin.id))
      .map((pin) => ({
        record,
        pin,
        observedAt: timestamp(pin.observedAt) ?? timestamp(pin.createdAt) ?? new Date(0).toISOString(),
      }));
  });
  pins.sort((left, right) => (
    Date.parse(right.observedAt) - Date.parse(left.observedAt)
    || compareText(left.record.id, right.record.id)
    || compareText(left.pin.id, right.pin.id)
  ));
  const candidates: Candidate[] = [];
  for (const { record, pin, observedAt } of pins.slice(0, MAX_EVIDENCE_DEBT_CASE_PINS)) {
    const rawState = normalizeState(pin.sourceState);
    if (rawState === 'skipped') retention.explicitlySkipped += 1;
    if (rawState === 'not_found') retention.explicitlyNotFound += 1;
    const states = debtForCasePin(record.domain, pin.source, pin.sourceState, pin.completeness, pin.truncated, observedAt, nowMs);
    if (!states.length) continue;
    const normalizedSource = sourceId(pin.source);
    const label = sourceLabel(pin.source);
    const next = nextForCase(states, record.domain, record.id, normalizedSource);
    candidates.push(Object.freeze({
      id: stableComparisonLedgerId('debt-case', [record.id, pin.id, normalizedSource, observedAt, ...states]),
      owner: 'case',
      ownerId: record.id,
      ownerLabel: `Case ${record.domain}`,
      domain: record.domain,
      sourceId: normalizedSource,
      sourceLabel: label,
      states: Object.freeze(states),
      primaryState: states[0]!,
      priority: itemPriority(states),
      observedAt,
      detail: `${pin.label} is an explicit retained pin with ${states.map((state) => state.replaceAll('_', ' ')).join(' and ')} evidence.`,
      limitations: Object.freeze(boundedLimitations(pin.limitations)),
      reviewHref: `/monitor?view=cases&case=${encodeURIComponent(record.id)}#case-response-${encodeURIComponent(record.id)}`,
      nextAction: next.action,
      nextHref: next.href,
      expectedEffect: next.action === 'case_review'
        ? 'Reviewing the case can reconcile or accept the retained limitation without changing the source observation.'
        : 'A deliberate Deep Lookup could collect a newer bounded observation, but may remain limited or expose a new disagreement.',
      disclosure: next.action === 'deep_lookup'
        ? 'The link pre-fills Deep Lookup only. Submitting it would disclose the target to the documented source-specific endpoints.'
        : 'Case review uses retained browser-local evidence and starts no request.',
    }));
  }
  return { candidates, totalPins: pins.length };
}

function buildMatrix(candidates: readonly Candidate[]): EvidenceDebtMatrixRow[] {
  const rows = new Map<string, { owner: EvidenceDebtOwner; sourceId: string; sourceLabel: string; counts: Record<EvidenceDebtState, number> }>();
  for (const item of candidates) {
    const key = `${item.owner}\u0000${item.sourceId}`;
    const row = rows.get(key) ?? {
      owner: item.owner,
      sourceId: item.sourceId,
      sourceLabel: item.sourceLabel,
      counts: emptyCounts(),
    };
    for (const state of item.states) row.counts[state] += 1;
    rows.set(key, row);
  }
  return [...rows.values()].map((row) => {
    const total = EVIDENCE_DEBT_STATES.reduce((sum, state) => sum + row.counts[state], 0);
    return Object.freeze({
      id: stableComparisonLedgerId('debt-matrix', [row.owner, row.sourceId]),
      owner: row.owner,
      sourceId: row.sourceId,
      sourceLabel: row.sourceLabel,
      counts: Object.freeze({ ...row.counts }),
      total,
    });
  }).sort((left, right) => (
    right.total - left.total
    || compareText(left.owner, right.owner)
    || compareText(left.sourceId, right.sourceId)
  ));
}

export function buildEvidenceDebtReview(input: Readonly<{
  cases?: readonly CaseRecord[];
  bulkSessions?: readonly BulkSession[];
  sourceStates?: Readonly<{
    cases?: EvidenceDebtSourceState;
    bulk?: EvidenceDebtSourceState;
  }>;
}>, nowRaw = new Date().toISOString()): EvidenceDebtReview {
  const now = timestamp(nowRaw) ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  const sourceStates = Object.freeze({
    bulk: input.sourceStates?.bulk ?? 'ready',
    cases: input.sourceStates?.cases ?? 'ready',
  });
  const retention = {
    bulkRowsWithoutCoverage: 0,
    casesWithoutPins: 0,
    explicitlySkipped: 0,
    explicitlyNotFound: 0,
    resolvedCasesExcluded: 0,
    reviewedCasePinsExcluded: 0,
  };
  const bulk = sourceStates.bulk === 'ready'
    ? buildBulkCandidates(input.bulkSessions ?? [], nowMs, retention)
    : { candidates: [], totalRows: 0, olderObservations: 0 };
  const cases = sourceStates.cases === 'ready'
    ? buildCaseCandidates(input.cases ?? [], now, nowMs, retention)
    : { candidates: [], totalPins: 0 };
  const candidates = [...bulk.candidates, ...cases.candidates].sort(itemSort);
  const items = Object.freeze(candidates.slice(0, MAX_EVIDENCE_DEBT_ITEMS));
  const allMatrix = buildMatrix(candidates);
  const matrix = Object.freeze(allMatrix.slice(0, MAX_EVIDENCE_DEBT_MATRIX_ROWS));
  const counts = emptyCounts();
  for (const item of candidates) for (const state of item.states) counts[state] += 1;
  const omissions = Object.freeze({
    items: Math.max(0, candidates.length - items.length),
    matrixRows: Math.max(0, allMatrix.length - matrix.length),
    bulkRows: Math.max(0, bulk.totalRows - MAX_EVIDENCE_DEBT_BULK_ROWS),
    casePins: Math.max(0, cases.totalPins - MAX_EVIDENCE_DEBT_CASE_PINS),
    olderBulkObservations: bulk.olderObservations,
  });
  const truncated = omissions.items > 0
    || omissions.matrixRows > 0
    || omissions.bulkRows > 0
    || omissions.casePins > 0;
  const countsComplete = sourceStates.bulk === 'ready'
    && sourceStates.cases === 'ready'
    && omissions.bulkRows === 0
    && omissions.casePins === 0;
  return Object.freeze({
    version: EVIDENCE_DEBT_VERSION,
    items,
    matrix,
    counts: Object.freeze({ ...counts, all: candidates.length }),
    sourceStates,
    countsComplete,
    truncated,
    omissions,
    retention: Object.freeze({ ...retention }),
    limitations: Object.freeze([
      'Only exact retained Bulk source states and separately pinned case evidence are projected. Empty compact fields do not create debt.',
      'No retained per-source record is different from an explicit skipped collection state; neither is converted into evidence of absence.',
      `Bulk observations become stale after ${BULK_REVIEW_STALE_AFTER_DAYS} days and case pins after ${CASE_EVIDENCE_STALE_AFTER_DAYS} days for review ordering only.`,
      'Expected unsupported registry services are excluded using the reviewed authority-aware registry capability catalogue.',
      'Resolved cases and case pins covered by an exact current reviewed gap dismissal are excluded from the actionable queue.',
      'Next-evidence effects are counterfactual planning aids. A retry or review can remain limited and never guarantees a true, safe, or actionable conclusion.',
      'This projection is browser-local, starts no request, and writes no retained record.',
    ]),
  });
}
