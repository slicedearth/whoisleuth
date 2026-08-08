import {
  MAX_WEBSITE_SNAPSHOTS,
  compareWebsiteSnapshots,
  normalizeWebsiteProfileSnapshot,
  type WebsiteProfileSnapshot,
  type WebsiteSnapshotChange,
  type WebsiteSnapshotSource,
} from './website-snapshot-model.ts';
import {
  comparisonLedgerCollector,
  comparisonLedgerInputArray,
  makeComparisonLedgerCandidate,
  stableComparisonLedgerId,
  type ComparisonLedgerCandidate,
  type ComparisonLedgerCompleteness,
  type ComparisonLedgerState,
  type MutableComparisonLedgerCounters,
  type RawComparisonLedgerProjection,
  type RawComparisonLedgerSide,
} from './comparison-ledger-contract.ts';

const MAX_RECONCILED_WEBSITE_SOURCES = 16;
const RELEVANT_WEBSITE_SOURCE_IDS = Object.freeze(['dns', 'http', 'tls']);
const UNAVAILABLE_WEBSITE_SOURCE_STATES = new Set(['blocked', 'error', 'not_found', 'rate_limited', 'unavailable', 'unsupported']);

function websiteCompleteness(snapshot: WebsiteProfileSnapshot): ComparisonLedgerCompleteness {
  if (snapshot.complete && !snapshot.truncated) return 'complete';
  return snapshot.truncated || !snapshot.complete ? 'partial' : 'not_reported';
}

function canonicalWebsiteSourceState(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/gu, '_');
}

function websiteSourceStateSeverity(value: string): number {
  if (UNAVAILABLE_WEBSITE_SOURCE_STATES.has(value)) return 2;
  return ['complete', 'success'].includes(value) ? 0 : 1;
}

function reconciledWebsiteSources(snapshot: WebsiteProfileSnapshot): WebsiteSnapshotSource[] {
  const selected = new Map<string, Readonly<{ state: string; severity: number }>>();
  for (const source of snapshot.sources.slice(0, MAX_RECONCILED_WEBSITE_SOURCES)) {
    const sourceId = source.source.trim().toLowerCase();
    if (!sourceId) continue;
    const state = canonicalWebsiteSourceState(source.state);
    const severity = websiteSourceStateSeverity(state);
    const current = selected.get(sourceId);
    if (!current || severity > current.severity || (severity === current.severity && state.localeCompare(current.state) < 0)) {
      selected.set(sourceId, { state, severity });
    }
  }
  return [...selected.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, value]) => ({ source, state: value.state }));
}

function websiteWithReconciledSources(snapshot: WebsiteProfileSnapshot): WebsiteProfileSnapshot {
  return { ...snapshot, sources: reconciledWebsiteSources(snapshot) };
}

function reconciledWebsiteSourceState(snapshot: WebsiteProfileSnapshot, sourceId: string): string | null {
  const canonicalId = sourceId.trim().toLowerCase();
  return reconciledWebsiteSources(snapshot).find((source) => source.source === canonicalId)?.state ?? null;
}

function websiteRetainedCompleteness(snapshot: WebsiteProfileSnapshot): ComparisonLedgerCompleteness {
  let completeness = websiteCompleteness(snapshot);
  for (const sourceId of RELEVANT_WEBSITE_SOURCE_IDS) {
    const state = reconciledWebsiteSourceState(snapshot, sourceId);
    if (!state) continue;
    if (UNAVAILABLE_WEBSITE_SOURCE_STATES.has(state)) return 'unavailable';
    if (!['complete', 'success'].includes(state)) completeness = 'partial';
  }
  if (snapshot.certificate && (!snapshot.certificate.complete || snapshot.certificate.truncated)) completeness = 'partial';
  return completeness;
}

function websitePairCompleteness(earlier: WebsiteProfileSnapshot, later: WebsiteProfileSnapshot): ComparisonLedgerCompleteness {
  const retained = [websiteRetainedCompleteness(earlier), websiteRetainedCompleteness(later)];
  return retained.includes('unavailable') ? 'unavailable' : retained.every((state) => state === 'complete') ? 'complete' : 'partial';
}

function websiteFamily(field: string): string {
  return field.split('.')[0] || 'website';
}

function websiteFieldSource(field: string): string {
  if (field.startsWith('certificate.')) return 'tls';
  if (field.startsWith('source.')) return field.slice('source.'.length);
  if (field.startsWith('dependency.')) {
    const recordType = field.slice('dependency.'.length).split(':')[0];
    return recordType === 'HTTP' ? 'http' : 'dns';
  }
  if (['technology', 'posture', 'identity', 'identityValues'].some((family) => field.startsWith(family))) return 'http';
  return '';
}

function completeWebsiteSourceState(value: string): boolean {
  const state = canonicalWebsiteSourceState(value);
  return state === 'complete' || state === 'success';
}

function websiteFamilyComplete(snapshot: WebsiteProfileSnapshot, field: string): boolean {
  const sourceName = websiteFieldSource(field);
  const retainedSource = sourceName ? reconciledWebsiteSourceState(snapshot, sourceName) : null;
  const retainedSourceComplete = !retainedSource || completeWebsiteSourceState(retainedSource);
  if (field.startsWith('certificate.')) {
    return Boolean(snapshot.certificate?.complete && !snapshot.certificate.truncated && retainedSourceComplete);
  }
  return snapshot.complete && !snapshot.truncated && retainedSourceComplete;
}

function websiteSourceState(snapshot: WebsiteProfileSnapshot, field: string): string {
  if (field === 'summary') return websiteRetainedCompleteness(snapshot);
  if (field.startsWith('certificate.')) {
    const retained = reconciledWebsiteSourceState(snapshot, 'tls');
    if (!snapshot.certificate) return retained ?? 'unavailable';
    if (snapshot.certificate.truncated) return 'partial';
    if (retained && !completeWebsiteSourceState(retained)) return retained;
    return snapshot.certificate.complete ? retained ?? 'complete' : 'partial';
  }
  const sourceName = websiteFieldSource(field);
  const retained = sourceName ? reconciledWebsiteSourceState(snapshot, sourceName) : null;
  return retained ?? (websiteCompleteness(snapshot) === 'complete' ? 'complete' : 'partial');
}

function websiteSide(
  snapshot: WebsiteProfileSnapshot,
  field: string,
  value: unknown,
): RawComparisonLedgerSide {
  return {
    source: 'Website profile snapshot',
    sourceState: websiteSourceState(snapshot, field),
    value,
    observedAt: snapshot.observedAt,
    retainedAt: snapshot.savedAt,
  };
}

function websiteChangeState(
  change: WebsiteSnapshotChange,
  later: WebsiteProfileSnapshot,
): ComparisonLedgerState {
  if (change.field.startsWith('source.')) return 'collection_changed';
  if (change.state === 'added') return 'added';
  if (change.state === 'removed') {
    if (websiteFamilyComplete(later, change.field)) return 'removed';
    const state = websiteSourceState(later, change.field);
    if (state === 'unsupported') return 'unsupported';
    return ['error', 'unavailable', 'not_found'].includes(state) ? 'unavailable' : 'incomplete';
  }
  if (change.state === 'incomparable') return 'collection_changed';
  if (change.state === 'unavailable') {
    const state = websiteSourceState(later, change.field);
    if (state === 'unsupported') return 'unsupported';
    return ['error', 'unavailable', 'not_found'].includes(state) ? 'unavailable' : 'incomplete';
  }
  return 'different';
}

function websiteChangeCompleteness(
  state: ComparisonLedgerState,
  change: WebsiteSnapshotChange,
  later: WebsiteProfileSnapshot,
): ComparisonLedgerCompleteness {
  if (state === 'unavailable' || state === 'unsupported') return 'unavailable';
  if (state === 'added' || state === 'removed' || state === 'different') {
    return websiteFamilyComplete(later, change.field) ? 'complete' : 'partial';
  }
  return 'partial';
}

function buildWebsiteRows(
  ownerId: string,
  entityId: string,
  earlier: WebsiteProfileSnapshot,
  later: WebsiteProfileSnapshot,
): RawComparisonLedgerProjection {
  const comparisonId = stableComparisonLedgerId('website-interval', [ownerId, earlier.id, later.id]);
  const comparableEarlier = websiteWithReconciledSources(earlier);
  const comparableLater = websiteWithReconciledSources(later);
  const comparison = compareWebsiteSnapshots(comparableEarlier, comparableLater);
  const output = comparisonLedgerCollector();
  for (const change of comparison.changes) {
    const state = websiteChangeState(change, comparableLater);
    output.add({
      comparisonId,
      ownerId,
      entityId,
      mode: 'temporal',
      state,
      field: change.field,
      family: websiteFamily(change.field),
      earlier: websiteSide(comparableEarlier, change.field, change.before),
      later: websiteSide(comparableLater, change.field, change.after),
      completeness: websiteChangeCompleteness(state, change, comparableLater),
      truncated: comparableEarlier.truncated || comparableLater.truncated,
      limitations: state === 'incomplete'
        ? ['The later website family is incomplete or truncated, so absence is not represented as removal or resolution.']
        : state === 'removed'
          ? ['Removal means the value is absent from this later complete retained website family, not from every current deployment.']
          : [],
    });
  }
  if (!output.totalRows) {
    const completeness = websitePairCompleteness(comparableEarlier, comparableLater);
    output.add({
      comparisonId,
      ownerId,
      entityId,
      mode: 'temporal',
      state: completeness === 'complete' ? 'equivalent' : completeness === 'unavailable' ? 'unavailable' : 'incomplete',
      field: 'Curated website profile',
      family: 'summary',
      earlier: websiteSide(comparableEarlier, 'summary', 'No curated field difference'),
      later: websiteSide(comparableLater, 'summary', 'No curated field difference'),
      completeness,
      truncated: comparableEarlier.truncated || comparableLater.truncated,
      limitations: [completeness === 'complete'
        ? 'Equivalence applies only to the bounded curated website-profile fields.'
        : completeness === 'unavailable'
          ? 'At least one relevant retained website source family is unavailable, so the absence of a field difference is not represented as equivalence or resolution.'
          : 'At least one retained website profile or relevant source family is incomplete, so the absence of a field difference is not represented as equivalence or resolution.'],
    });
  }
  return { rows: output.rows, totalRows: output.totalRows, sourceOmittedRows: 0 };
}

export function buildWebsiteComparisonCandidates(
  raw: unknown,
  counters: MutableComparisonLedgerCounters,
): ComparisonLedgerCandidate[] {
  const input = comparisonLedgerInputArray(raw);
  counters.inputRecords += Math.max(0, input.length - MAX_WEBSITE_SNAPSHOTS);
  const snapshots = new Map<string, WebsiteProfileSnapshot>();
  for (const value of input.slice(0, MAX_WEBSITE_SNAPSHOTS)) {
    const item = normalizeWebsiteProfileSnapshot(value);
    if (!item) {
      counters.invalidRecords += 1;
      continue;
    }
    if (snapshots.has(item.id)) {
      counters.duplicateRecords += 1;
      continue;
    }
    snapshots.set(item.id, item);
  }
  const byDomain = new Map<string, WebsiteProfileSnapshot[]>();
  for (const item of snapshots.values()) {
    const group = byDomain.get(item.domain) ?? [];
    group.push(item);
    byDomain.set(item.domain, group);
  }
  const candidates: ComparisonLedgerCandidate[] = [];
  for (const [domain, group] of [...byDomain.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const history = [...group].sort((left, right) => (
      left.observedAt.localeCompare(right.observedAt) || left.savedAt.localeCompare(right.savedAt) || left.id.localeCompare(right.id)
    ));
    for (let index = 1; index < history.length; index += 1) {
      const earlier = history[index - 1];
      const later = history[index];
      if (!earlier || !later) continue;
      const candidate = makeComparisonLedgerCandidate({
        idParts: [domain, earlier.id, later.id],
        ownerType: 'website_snapshot',
        ownerId: later.id,
        entityId: domain,
        label: `${domain} · adjacent website profiles`,
        mode: 'temporal',
        earlier: websiteSide(earlier, 'summary', undefined),
        later: websiteSide(later, 'summary', undefined),
        completeness: websitePairCompleteness(earlier, later),
        truncated: earlier.truncated || later.truncated,
        limitations: [
          'Website profiles contain bounded curated observations and digests, not raw page or source payloads.',
          'A field difference is a retained review lead and does not establish ownership, attribution, safety, intent, or maliciousness.',
        ],
        ownerHref: `/lookup?q=${encodeURIComponent(domain)}#website-profile-snapshots`,
        buildDetails: () => buildWebsiteRows(later.id, domain, earlier, later),
      }, counters);
      if (candidate) candidates.push(candidate);
      else counters.invalidRecords += 1;
    }
  }
  return candidates;
}
