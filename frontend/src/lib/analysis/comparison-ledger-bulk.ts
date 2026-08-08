import {
  MAX_BULK_SESSIONS,
  compareBulkSessions,
  normalizeBulkSession,
  type BulkSession,
  type BulkSessionResult,
  type BulkSessionSourceState,
} from './bulk-session-model.ts';
import {
  MAX_COMPARISON_LEDGER_BULK_PAIRS,
  boundedComparisonLedgerId,
  comparisonLedgerCollector,
  comparisonLedgerInputArray,
  comparisonLedgerRecord,
  comparisonLedgerValuePresent,
  comparisonLedgerValueState,
  makeComparisonLedgerCandidate,
  stableComparisonLedgerId,
  type ComparisonLedgerCandidate,
  type ComparisonLedgerCompleteness,
  type ComparisonLedgerState,
  type MutableComparisonLedgerCounters,
  type RawComparisonLedgerProjection,
  type RawComparisonLedgerSide,
} from './comparison-ledger-contract.ts';

function bulkCompleteness(session: BulkSession): ComparisonLedgerCompleteness {
  return session.state === 'complete' ? 'complete' : session.state === 'partial' ? 'partial' : 'unavailable';
}

function sourceMap(result: BulkSessionResult): Map<string, BulkSessionSourceState> {
  return new Map(result.sourceCoverage.map((item) => [item.source, item.state]));
}

function namedBulkSourceState(result: BulkSessionResult, source: string): string {
  return result.sourceCoverage.find((item) => item.source === source)?.state ?? 'not_reported';
}

function bulkFamilyState(result: BulkSessionResult, family: string): string {
  if (family === 'model') return 'derived';
  if (family === 'collection') return 'retained';
  return result.status;
}

function bulkSide(session: BulkSession, result: BulkSessionResult | null, family: string, value: unknown, sourceState?: string): RawComparisonLedgerSide {
  return {
    source: `Saved Bulk session · ${session.name}`,
    sourceState: sourceState ?? (result ? bulkFamilyState(result, family) : session.state),
    value,
    observedAt: session.state === 'complete' ? session.completedAt : null,
    retainedAt: session.updatedAt,
  };
}

type BulkField = Readonly<{
  field: string;
  family: string;
  kind: 'source' | 'model' | 'registrar';
  read: (result: BulkSessionResult) => unknown;
  sourceState: (result: BulkSessionResult) => string;
}>;

const BULK_FIELDS: readonly BulkField[] = Object.freeze([
  { field: 'Availability', family: 'registration', kind: 'source', read: (item) => item.availability, sourceState: (item) => namedBulkSourceState(item, 'availability') },
  { field: 'Registrar', family: 'registration', kind: 'registrar', read: (item) => item.registrar, sourceState: () => 'not_reported' },
  { field: 'Website activity', family: 'website', kind: 'source', read: (item) => item.activityStatus, sourceState: (item) => namedBulkSourceState(item, 'http') },
  { field: 'Risk score', family: 'model', kind: 'model', read: (item) => item.risk, sourceState: () => 'derived' },
  { field: 'Opportunity score', family: 'model', kind: 'model', read: (item) => item.opportunity, sourceState: () => 'derived' },
  { field: 'Technology IDs', family: 'technology', kind: 'source', read: (item) => item.comparisonEvidence?.technology.ids ?? null, sourceState: (item) => item.comparisonEvidence?.technology.state ?? 'not_reported' },
  { field: 'TLS issuer', family: 'certificate', kind: 'source', read: (item) => item.comparisonEvidence?.tls.issuerLabel ?? null, sourceState: (item) => item.comparisonEvidence?.tls.state ?? 'not_reported' },
  { field: 'TLS public key', family: 'certificate', kind: 'source', read: (item) => item.comparisonEvidence?.tls.spkiSha256 ?? null, sourceState: (item) => item.comparisonEvidence?.tls.state ?? 'not_reported' },
]);

type BulkFieldDecision = Readonly<{
  state: ComparisonLedgerState;
  completeness: ComparisonLedgerCompleteness;
  earlierState: string;
  laterState: string;
  limitation: string | null;
}>;

function completeBulkSourceState(value: string): boolean { return value === 'complete' || value === 'success'; }

function settledBulkCoverageState(value: BulkSessionSourceState | undefined): boolean {
  return value === 'complete' || value === 'skipped' || value === 'unsupported';
}

function bulkFieldDecision(field: BulkField, earlier: BulkSessionResult, later: BulkSessionResult, before: unknown, after: unknown): BulkFieldDecision {
  const earlierState = field.sourceState(earlier);
  const laterState = field.sourceState(later);
  if (earlier.scanDepth !== later.scanDepth) return { state: 'not_compared', completeness: 'partial', earlierState, laterState, limitation: 'Unlike Fast and Deep result rows are not compared as an observed field change.' };
  if (field.kind === 'registrar') return { state: 'not_compared', completeness: 'not_reported', earlierState, laterState, limitation: 'The exact retained registrar texts are shown, but saved Bulk rows do not retain field-level registrar provenance; these values are not compared as a publication or target change.' };
  if (field.kind === 'model') {
    const comparable = comparisonLedgerValuePresent(before) && comparisonLedgerValuePresent(after);
    return { state: comparable ? 'different' : 'not_compared', completeness: comparable ? 'complete' : 'partial', earlierState, laterState, limitation: comparable ? null : 'A score absent from either retained row is not represented as an observed score change.' };
  }
  if (earlierState !== laterState) return { state: 'collection_changed', completeness: 'partial', earlierState, laterState, limitation: 'The exact retained family source state changed, so the values are not represented as an observed field change.' };
  if (!completeBulkSourceState(earlierState) || !completeBulkSourceState(laterState)) {
    const state = laterState === 'unsupported' ? 'unsupported' : ['error', 'not_found', 'unavailable'].includes(laterState) ? 'unavailable' : 'not_compared';
    return { state, completeness: state === 'not_compared' ? 'partial' : 'unavailable', earlierState, laterState, limitation: 'Both retained family source states must be complete before values are compared.' };
  }
  return { state: comparisonLedgerValueState(before, after, true), completeness: 'complete', earlierState, laterState, limitation: null };
}

function bulkPairCompleteness(earlier: BulkSession, later: BulkSession): ComparisonLedgerCompleteness {
  if (bulkCompleteness(earlier) !== 'complete' || bulkCompleteness(later) !== 'complete' || earlier.mode !== later.mode) return 'partial';
  const before = new Map(earlier.results.map((item) => [item.domain, item]));
  const after = new Map(later.results.map((item) => [item.domain, item]));
  if (before.size !== after.size) return 'partial';
  for (const [domain, left] of before) {
    const right = after.get(domain);
    if (!right || left.scanDepth !== right.scanDepth) return 'partial';
    if (left.riskModelVersion === null || right.riskModelVersion === null || left.riskModelVersion !== right.riskModelVersion
      || left.opportunityModelVersion === null || right.opportunityModelVersion === null || left.opportunityModelVersion !== right.opportunityModelVersion) return 'partial';
    for (const field of BULK_FIELDS) {
      if (field.kind === 'registrar' && exactEqual(field.read(left), field.read(right))) continue;
      const decision = bulkFieldDecision(field, left, right, field.read(left), field.read(right));
      if (decision.completeness !== 'complete') return 'partial';
    }
    const leftSources = sourceMap(left);
    const rightSources = sourceMap(right);
    if ([...new Set([...leftSources.keys(), ...rightSources.keys()])].some((source) => leftSources.get(source) !== rightSources.get(source)
      || !settledBulkCoverageState(leftSources.get(source)) || !settledBulkCoverageState(rightSources.get(source)))) return 'partial';
  }
  return 'complete';
}

function exactEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => value === right[index]);
  }
  return Object.is(left, right);
}

function buildBulkRows(ownerId: string, earlier: BulkSession, later: BulkSession, pairCompleteness: ComparisonLedgerCompleteness): RawComparisonLedgerProjection {
  const output = comparisonLedgerCollector();
  const before = new Map(earlier.results.map((item) => [item.domain, item]));
  const after = new Map(later.results.map((item) => [item.domain, item]));
  for (const domain of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const left = before.get(domain) ?? null;
    const right = after.get(domain) ?? null;
    if (!left && right) {
      output.add({
        comparisonId: ownerId,
        ownerId,
        entityId: domain,
        mode: 'membership',
        state: 'added',
        field: 'Settled result-set membership',
        family: 'membership',
        earlier: bulkSide(earlier, null, 'membership', null),
        later: bulkSide(later, right, 'membership', 'Included in the later settled result set'),
        completeness: bulkCompleteness(later),
        limitations: ['This is membership in two explicitly selected saved sessions, not evidence that the domain itself was created or became active.'],
      });
      continue;
    }
    if (left && !right) {
      output.add({
        comparisonId: ownerId,
        ownerId,
        entityId: domain,
        mode: 'membership',
        state: 'not_compared',
        field: 'Settled result-set membership',
        family: 'membership',
        earlier: bulkSide(earlier, left, 'membership', 'Included in the earlier settled result set'),
        later: bulkSide(later, null, 'membership', null),
        completeness: 'partial',
        limitations: ['No settled row is retained in the later saved session. This is not domain removal, release, resolution, or an availability finding.'],
      });
      continue;
    }
    if (!left || !right) continue;
    const riskModelsComparable = left.riskModelVersion !== null
      && right.riskModelVersion !== null
      && left.riskModelVersion === right.riskModelVersion;
    const riskModelChanged = left.riskModelVersion !== null
      && right.riskModelVersion !== null
      && left.riskModelVersion !== right.riskModelVersion;
    const leftOpportunityVersion = left.opportunityModelVersion ?? null;
    const rightOpportunityVersion = right.opportunityModelVersion ?? null;
    const opportunityModelsComparable = leftOpportunityVersion !== null
      && rightOpportunityVersion !== null
      && leftOpportunityVersion === rightOpportunityVersion;
    const opportunityModelChanged = leftOpportunityVersion !== null
      && rightOpportunityVersion !== null
      && leftOpportunityVersion !== rightOpportunityVersion;
    for (const field of BULK_FIELDS) {
      const beforeValue = field.read(left);
      const afterValue = field.read(right);
      if ((field.field === 'Risk score' && !riskModelsComparable)
        || (field.field === 'Opportunity score' && !opportunityModelsComparable)) continue;
      const decision = bulkFieldDecision(field, left, right, beforeValue, afterValue);
      if (exactEqual(beforeValue, afterValue) && decision.state !== 'collection_changed') continue;
      output.add({
        comparisonId: ownerId,
        ownerId,
        entityId: domain,
        mode: 'temporal',
        state: decision.state,
        field: field.field,
        family: field.family,
        earlier: bulkSide(earlier, left, field.family, beforeValue, decision.earlierState),
        later: bulkSide(later, right, field.family, afterValue, decision.laterState),
        completeness: decision.completeness,
        limitations: [
          'Saved Bulk rows are compact derived observations, not raw source publications or current provider state.',
          ...(decision.limitation ? [decision.limitation] : []),
        ],
      });
    }
    if (riskModelChanged) {
      output.add({
        comparisonId: ownerId,
        ownerId,
        entityId: domain,
        mode: 'temporal',
        state: 'model_changed',
        field: 'Risk model version',
        family: 'model',
        earlier: bulkSide(earlier, left, 'model', left.riskModelVersion),
        later: bulkSide(later, right, 'model', right.riskModelVersion),
        completeness: 'partial',
        limitations: ['Risk scores from unlike model versions are not represented as an observed domain change.'],
      });
    } else if (!riskModelsComparable && (left.risk !== null || right.risk !== null)) {
      output.add({
        comparisonId: ownerId,
        ownerId,
        entityId: domain,
        mode: 'temporal',
        state: 'not_compared',
        field: 'Risk model version',
        family: 'model',
        earlier: bulkSide(earlier, left, 'model', left.riskModelVersion),
        later: bulkSide(later, right, 'model', right.riskModelVersion),
        completeness: 'partial',
        limitations: ['At least one saved Risk score lacks a retained model version, so score values are not compared.'],
      });
    }
    if (opportunityModelChanged) {
      output.add({
        comparisonId: ownerId,
        ownerId,
        entityId: domain,
        mode: 'temporal',
        state: 'model_changed',
        field: 'Opportunity model version',
        family: 'model',
        earlier: bulkSide(earlier, left, 'model', leftOpportunityVersion),
        later: bulkSide(later, right, 'model', rightOpportunityVersion),
        completeness: 'partial',
        limitations: ['Opportunity scores from unlike model versions are not represented as an observed domain change.'],
      });
    } else if (!opportunityModelsComparable && (left.opportunity !== null || right.opportunity !== null)) {
      output.add({
        comparisonId: ownerId,
        ownerId,
        entityId: domain,
        mode: 'temporal',
        state: 'not_compared',
        field: 'Opportunity model version',
        family: 'model',
        earlier: bulkSide(earlier, left, 'model', leftOpportunityVersion),
        later: bulkSide(later, right, 'model', rightOpportunityVersion),
        completeness: 'partial',
        limitations: ['At least one saved Opportunity score lacks a retained model version, so score values are not compared.'],
      });
    }
    const beforeSources = sourceMap(left);
    const afterSources = sourceMap(right);
    for (const source of [...new Set([...beforeSources.keys(), ...afterSources.keys()])].sort()) {
      const beforeState = beforeSources.get(source) ?? 'not_reported';
      const afterState = afterSources.get(source) ?? 'not_reported';
      if (beforeState === afterState) continue;
      output.add({
        comparisonId: ownerId,
        ownerId,
        entityId: domain,
        mode: 'temporal',
        state: 'collection_changed',
        field: `${source} source state`,
        family: 'collection',
        earlier: bulkSide(earlier, left, 'collection', beforeState),
        later: bulkSide(later, right, 'collection', afterState),
        completeness: 'partial',
        limitations: ['A source-state difference can reflect collection conditions rather than a target change.'],
      });
    }
  }
  if (earlier.mode !== later.mode) {
    output.add({
      comparisonId: ownerId,
      ownerId,
      entityId: `${earlier.id}:${later.id}`,
      mode: 'temporal',
      state: 'collection_changed',
      field: 'Bulk collection mode',
      family: 'collection',
      earlier: bulkSide(earlier, null, 'collection', earlier.mode),
      later: bulkSide(later, null, 'collection', later.mode),
      completeness: 'partial',
      limitations: ['Fast and Deep saved sessions have different collection contracts; unlike fields remain not compared.'],
    });
  }
  if (!output.totalRows) {
    output.add({
      comparisonId: ownerId,
      ownerId,
      entityId: `${earlier.id}:${later.id}`,
      mode: 'temporal',
      state: pairCompleteness === 'complete' ? 'equivalent' : 'incomplete',
      field: 'Compact comparable saved rows',
      family: 'summary',
      earlier: bulkSide(earlier, null, 'summary', 'No bounded material difference'),
      later: bulkSide(later, null, 'summary', 'No bounded material difference'),
      completeness: pairCompleteness,
      limitations: [pairCompleteness === 'complete'
        ? 'Equivalence applies only to the compact fields retained in both explicitly selected saved sessions.'
        : 'At least one compact field or source state is not completely comparable across both saved sessions, so the absence of a retained row difference is not represented as equivalence or resolution.'],
    });
  }
  return { rows: output.rows, totalRows: output.totalRows, sourceOmittedRows: 0 };
}

export function comparisonLedgerBulkPairIndexId(earlierSessionId: unknown, laterSessionId: unknown): string {
  return stableComparisonLedgerId('ledger-bulk_session_pair', [String(earlierSessionId ?? ''), String(laterSessionId ?? '')]);
}

export function buildBulkComparisonCandidates(sessionsRaw: unknown, pairsRaw: unknown, counters: MutableComparisonLedgerCounters): ComparisonLedgerCandidate[] {
  const input = comparisonLedgerInputArray(sessionsRaw);
  counters.inputRecords += Math.max(0, input.length - MAX_BULK_SESSIONS);
  const sessions = new Map<string, BulkSession>();
  for (const value of input.slice(0, MAX_BULK_SESSIONS)) {
    const item = normalizeBulkSession(value);
    if (!item) {
      counters.invalidRecords += 1;
      continue;
    }
    if (sessions.has(item.id)) {
      counters.duplicateRecords += 1;
      continue;
    }
    sessions.set(item.id, item);
  }
  const pairs = comparisonLedgerInputArray(pairsRaw);
  counters.inputRecords += Math.max(0, pairs.length - MAX_COMPARISON_LEDGER_BULK_PAIRS);
  const candidates: ComparisonLedgerCandidate[] = [];
  const seen = new Set<string>();
  for (const rawPair of pairs.slice(0, MAX_COMPARISON_LEDGER_BULK_PAIRS)) {
    const pair = comparisonLedgerRecord(rawPair);
    const earlierId = boundedComparisonLedgerId(pair?.earlierSessionId, counters);
    const laterId = boundedComparisonLedgerId(pair?.laterSessionId, counters);
    const earlier = sessions.get(earlierId);
    const later = sessions.get(laterId);
    if (!pair || !earlierId || !laterId || earlierId === laterId || !earlier || !later
      || earlier.updatedAt > later.updatedAt) {
      counters.invalidRecords += 1;
      continue;
    }
    const id = comparisonLedgerBulkPairIndexId(earlierId, laterId);
    if (seen.has(id)) {
      counters.duplicateRecords += 1;
      continue;
    }
    seen.add(id);
    const comparison = compareBulkSessions(earlier, later);
    if (!comparison) {
      counters.invalidRecords += 1;
      continue;
    }
    const ownerId = stableComparisonLedgerId('bulk-pair', [earlierId, laterId]);
    const pairCompleteness = bulkPairCompleteness(earlier, later);
    const candidate = makeComparisonLedgerCandidate({
      idParts: [earlierId, laterId],
      ownerType: 'bulk_session_pair',
      ownerId,
      entityId: `${earlierId}:${laterId}`,
      label: `${earlier.name} → ${later.name} · explicit saved-session pair`,
      mode: 'temporal',
      earlier: { source: `Saved Bulk session · ${earlier.name}`, sourceState: earlier.state, observedAt: earlier.completedAt, retainedAt: earlier.updatedAt },
      later: { source: `Saved Bulk session · ${later.name}`, sourceState: later.state, observedAt: later.completedAt, retainedAt: later.updatedAt },
      completeness: pairCompleteness,
      truncated: false,
      limitations: [
        ...comparison.limitations,
        ...(pairCompleteness === 'complete' ? [] : ['At least one compact field or retained source state is not completely comparable across both selected sessions.']),
      ],
      ownerHref: '/bulk#bulk-sessions-title',
      buildDetails: () => buildBulkRows(ownerId, earlier, later, pairCompleteness),
    }, counters);
    if (candidate) candidates.push(candidate);
    else counters.invalidRecords += 1;
  }
  return candidates;
}
