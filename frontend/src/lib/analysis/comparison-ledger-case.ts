import { caseWorkspaceHref } from './case-response-stage.ts';
import { domainTransitionReview } from '../../../../packages/investigation/domain-transition-review.mts';
import { MAX_CASES, MAX_EVIDENCE_SNAPSHOTS_PER_CASE } from '../../../../packages/contracts/case-portability.mts';
import {
  caseEvidenceIncomparableReasons,
  compareCaseEvidence,
} from '../../../../packages/cases/case-evidence-model.mts';
import { normalizeCase } from '../../../../packages/cases/case-record-operations.mts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';
import type { CaseEvidenceSnapshot, CaseRecord } from './case-model.ts';
import {
  comparisonLedgerCollector,
  comparisonLedgerInputArray,
  comparisonLedgerRecord,
  comparisonLedgerValueState,
  MAX_COMPARISON_LEDGER_ENTITIES_PER_REQUEST,
  makeComparisonLedgerCandidate,
  stableComparisonLedgerId,
  validComparisonLedgerRequestId,
  type ComparisonLedgerCandidate,
  type MutableComparisonLedgerCounters,
  type RawComparisonLedgerProjection,
  type RawComparisonLedgerSide,
} from './comparison-ledger-contract.ts';

const EPOCH = '1970-01-01T00:00:00.000Z';
// Case storage retains 25 snapshots; scanning four windows preserves the
// established normaliser's deduplication headroom without unbounded traversal.
const MAX_CASE_HISTORY_INPUTS = MAX_EVIDENCE_SNAPSHOTS_PER_CASE * 4;
const CONCLUSIVE_AVAILABILITY = new Set(['available', 'registered', 'for_sale', 'expiring']);

function caseFamily(field: string): string {
  if (['availability', 'confidence', 'registrar', 'createdDate', 'expiryDate'].includes(field)) return 'registration';
  if (field === 'nameservers') return 'dns';
  if (['hasMx', 'hasSpf', 'hasDmarc'].includes(field)) return 'mail';
  if (field.startsWith('http') || ['activityStatus', 'websiteProbeDetail'].includes(field)) return 'website';
  if (['pageTitle', 'faviconMatch', 'faviconNearMatch', 'reusesOfficialAssets', 'hasPasswordField', 'hasExternalFormAction', 'hasExternalPasswordForm', 'phishingLanguageMatch'].includes(field)) return 'identity';
  if (field.startsWith('risk') || field.startsWith('opportunity')) return 'model';
  if (field === 'mutationTypes') return 'membership';
  return 'other';
}

function caseSide(snapshot: CaseEvidenceSnapshot, value: unknown, sourceState: string): RawComparisonLedgerSide {
  return {
    source: `Case snapshot · ${snapshot.source}`,
    sourceState,
    value,
    observedAt: snapshot.capturedAt,
    retainedAt: null,
  };
}

function boundedCaseInput(
  value: unknown,
  counters: MutableComparisonLedgerCounters,
): Readonly<{ value: unknown; rejected: boolean }> {
  const record = comparisonLedgerRecord(value);
  const history = record?.evidenceHistory;
  if (!record || !Array.isArray(history)) return { value, rejected: false };
  const length = history.length;
  if (length > MAX_CASE_HISTORY_INPUTS) {
    counters.inputRecords += length - MAX_CASE_HISTORY_INPUTS;
    counters.inputScanTruncations += 1;
    return { value: null, rejected: true };
  }
  return { value, rejected: false };
}

function buildCaseRows(
  ownerId: string,
  entityId: string,
  earlier: CaseEvidenceSnapshot,
  later: CaseEvidenceSnapshot,
): RawComparisonLedgerProjection {
  const comparisonId = stableComparisonLedgerId('case-interval', [ownerId, earlier.id, later.id]);
  const output = comparisonLedgerCollector();
  const changes = compareCaseEvidence(earlier, later);
  const reasons = caseEvidenceIncomparableReasons(earlier, later);
  const changedFields = new Set(changes.map((change) => change.field));
  for (const change of changes) {
    const state = comparisonLedgerValueState(change.before, change.after, false);
    output.add({
      comparisonId,
      ownerId,
      entityId,
      mode: change.field === 'mutationTypes' ? 'membership' : 'temporal',
      state,
      field: change.label,
      family: caseFamily(change.field),
      earlier: caseSide(earlier, change.before, 'retained'),
      later: caseSide(later, change.after, state === 'incomplete' ? 'not_reported' : 'retained'),
      completeness: state === 'incomplete' ? 'partial' : 'not_reported',
      limitations: state === 'incomplete'
        ? ['The later case snapshot does not retain a comparable value, so this is not treated as removal or resolution.']
        : [domainTransitionReview(change.field, change.before, change.after)].filter((value): value is string => value !== null),
    });
  }
  if (!changedFields.has('availability')
    && CONCLUSIVE_AVAILABILITY.has(String(earlier.availability))
    && !CONCLUSIVE_AVAILABILITY.has(String(later.availability))) {
    output.add({
      comparisonId,
      ownerId,
      entityId,
      mode: 'temporal',
      state: 'incomplete',
      field: 'Availability',
      family: 'registration',
      earlier: caseSide(earlier, earlier.availability, 'retained'),
      later: caseSide(later, later.availability, later.availability === 'unsupported' ? 'unsupported' : 'incomplete'),
      completeness: 'partial',
      limitations: ['A missing, unknown, or failed later registration observation cannot establish removal, availability, or resolution.'],
    });
  }
  for (const reason of reasons) {
    if (reason === 'collection-quality') {
      output.add({ comparisonId, ownerId, entityId, mode: 'temporal', state: 'not_compared',
        field: 'Web collection quality', family: 'collection',
        earlier: caseSide(earlier, earlier.webCollectionQuality ?? 'Unknown', 'retained'),
        later: caseSide(later, later.webCollectionQuality ?? 'Unknown', 'incomplete'), completeness: 'partial',
        limitations: ['Affected page, favicon and score fields require complete collection at both observations.'],
      });
      continue;
    }
    if (reason === 'observation-context') {
      output.add({
        comparisonId,
        ownerId,
        entityId,
        mode: 'temporal',
        state: 'not_compared',
        field: 'Submitted hostname context',
        family: 'collection',
        earlier: caseSide(earlier, earlier.inputHostname, 'retained'),
        later: caseSide(later, later.inputHostname, 'retained'),
        completeness: 'partial',
        limitations: ['The exact submitted hostname differs. It identifies observation context only and is not evidence that domain or infrastructure state changed.'],
      });
      continue;
    }
    if (reason === 'scan-depth') {
      output.add({
        comparisonId,
        ownerId,
        entityId,
        mode: 'temporal',
        state: 'collection_changed',
        field: 'Collection depth',
        family: 'collection',
        earlier: caseSide(earlier, earlier.scanDepth, 'retained'),
        later: caseSide(later, later.scanDepth, 'retained'),
        completeness: 'partial',
        limitations: ['Deep-only fields are not compared across unlike collection depths.'],
      });
      continue;
    }
    const risk = reason === 'risk-model';
    output.add({
      comparisonId,
      ownerId,
      entityId,
      mode: 'temporal',
      state: 'model_changed',
      field: risk ? 'Risk model version' : 'Opportunity model version',
      family: 'model',
      earlier: caseSide(earlier, risk ? earlier.riskModelVersion : earlier.opportunityModelVersion, 'retained'),
      later: caseSide(later, risk ? later.riskModelVersion : later.opportunityModelVersion, 'retained'),
      completeness: 'partial',
      limitations: ['Scores and factors produced by unlike model versions are not represented as an observed target change.'],
    });
  }
  if (!output.totalRows) {
    output.add({
      comparisonId,
      ownerId,
      entityId,
      mode: 'temporal',
      state: 'equivalent',
      field: 'Bounded comparable evidence',
      family: 'summary',
      earlier: caseSide(earlier, 'No bounded material difference', 'retained'),
      later: caseSide(later, 'No bounded material difference', 'retained'),
      completeness: 'not_reported',
      limitations: ['Equivalence applies only to the retained fields that the existing case comparator can compare.'],
    });
  }
  return { rows: output.rows, totalRows: output.totalRows, sourceOmittedRows: 0 };
}

function casePairIdParts(caseId: string, earlierId: string, laterId: string, explicit: boolean): string[] {
  return [...(explicit ? ['explicit'] : []), caseId, earlierId, laterId];
}

export function comparisonLedgerCasePairIndexId(caseId: string, earlierId: string, laterId: string): string {
  return stableComparisonLedgerId('ledger-case', casePairIdParts(caseId, earlierId, laterId, true));
}

function casePairCandidate(
  item: CaseRecord,
  earlier: CaseEvidenceSnapshot,
  later: CaseEvidenceSnapshot,
  counters: MutableComparisonLedgerCounters,
  explicit = false,
): ComparisonLedgerCandidate | null {
  const reasons = caseEvidenceIncomparableReasons(earlier, later);
  return makeComparisonLedgerCandidate({
    idParts: casePairIdParts(item.id, earlier.id, later.id, explicit),
    ownerType: 'case', ownerId: item.id, entityId: item.domain,
    label: `${item.domain} · ${explicit ? 'selected' : 'adjacent'} case snapshots`,
    mode: 'temporal',
    earlier: caseSide(earlier, undefined, 'not_reported'),
    later: caseSide(later, undefined, 'not_reported'),
    completeness: reasons.length ? 'partial' : 'not_reported', truncated: false,
    limitations: [
      'Case evidence stores bounded normalised fields rather than raw source payloads.',
      'Case snapshots do not retain a whole-snapshot completeness flag; field-specific comparison gates remain authoritative.',
      ...(explicit ? ['Only the two selected checkpoints are compared. No observation or transition between them is inferred.'] : []),
    ],
    ownerHref: caseWorkspaceHref(item.id, 'evidence'),
    buildDetails: () => buildCaseRows(item.id, item.domain, earlier, later),
  }, counters);
}

export function buildCaseComparisonCandidates(
  raw: unknown,
  counters: MutableComparisonLedgerCounters,
  pairsRaw?: unknown,
): ComparisonLedgerCandidate[] {
  const input = comparisonLedgerInputArray(raw);
  counters.inputRecords += Math.max(0, input.length - MAX_CASES);
  const cases = new Map<string, CaseRecord>();
  const rawCases = new Map<string, unknown>();
  const ambiguousCases = new Set<string>();
  for (const value of input.slice(0, MAX_CASES)) {
    const bounded = boundedCaseInput(value, counters);
    if (bounded.rejected) {
      counters.invalidRecords += 1;
      continue;
    }
    const item = normalizeCase(bounded.value, undefined, EPOCH);
    if (!item) {
      counters.invalidRecords += 1;
      continue;
    }
    if (cases.has(item.id)) {
      counters.duplicateRecords += 1;
      ambiguousCases.add(item.id);
      continue;
    }
    cases.set(item.id, item);
    rawCases.set(item.id, bounded.value);
  }
  const candidates: ComparisonLedgerCandidate[] = [];
  for (const item of [...cases.values()].sort((left, right) => left.domain.localeCompare(right.domain) || left.id.localeCompare(right.id))) {
    const history = [...item.evidenceHistory].sort((left, right) => (
      left.capturedAt.localeCompare(right.capturedAt) || left.id.localeCompare(right.id)
    ));
    for (let index = 1; index < history.length; index += 1) {
      const earlier = history[index - 1];
      const later = history[index];
      if (!earlier || !later) continue;
      const candidate = casePairCandidate(item, earlier, later, counters);
      if (candidate) candidates.push(candidate);
      else counters.invalidRecords += 1;
    }
  }
  const pairs = comparisonLedgerInputArray(pairsRaw);
  counters.inputRecords += Math.max(0, pairs.length - MAX_COMPARISON_LEDGER_ENTITIES_PER_REQUEST);
  const seen = new Set<string>();
  for (const value of pairs.slice(0, MAX_COMPARISON_LEDGER_ENTITIES_PER_REQUEST)) {
    const pair = comparisonLedgerRecord(value);
    const caseId = pair?.caseId, earlierId = pair?.earlierSnapshotId, laterId = pair?.laterSnapshotId;
    if (!validComparisonLedgerRequestId(caseId) || !validComparisonLedgerRequestId(earlierId)
      || !validComparisonLedgerRequestId(laterId) || earlierId === laterId) {
      counters.invalidRecords += 1; continue;
    }
    const item = cases.get(caseId as string);
    const history = comparisonLedgerInputArray(comparisonLedgerRecord(rawCases.get(caseId as string))?.evidenceHistory);
    const original = (id: unknown) => history.filter(value => comparisonLedgerRecord(value)?.id === id);
    const earlierOriginal = original(earlierId), laterOriginal = original(laterId);
    const earlierTime = normalizeExplicitIsoTimestamp(comparisonLedgerRecord(earlierOriginal[0])?.capturedAt);
    const laterTime = normalizeExplicitIsoTimestamp(comparisonLedgerRecord(laterOriginal[0])?.capturedAt);
    const earlier = item?.evidenceHistory.find(value => value.id === earlierId);
    const later = item?.evidenceHistory.find(value => value.id === laterId);
    if (!item || ambiguousCases.has(item.id) || !earlier || !later || earlierOriginal.length !== 1
      || laterOriginal.length !== 1 || !earlierTime || !laterTime || Date.parse(earlierTime) >= Date.parse(laterTime)) {
      counters.invalidRecords += 1; continue;
    }
    const id = comparisonLedgerCasePairIndexId(item.id, earlier.id, later.id);
    if (seen.has(id)) { counters.duplicateRecords += 1; continue; }
    seen.add(id);
    const candidate = casePairCandidate(item, earlier, later, counters, true);
    if (candidate) candidates.push(candidate);
    else counters.invalidRecords += 1;
  }
  return candidates;
}
