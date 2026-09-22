import type { CaseRecord } from '../cases/case-record-contracts.mts';
import { compareCaseEvidence } from '../cases/case-evidence-model.mts';
import { MAX_CASE_EVIDENCE_PINS, MAX_EVIDENCE_SNAPSHOTS_PER_CASE } from '../contracts/case-portability.mts';
import { array, domain, enumeration, exact, iso, text } from '../evidence/artifact-structure.mts';
import { CONTEXT_REVIEW_SCHEMA, CONTEXT_REVIEW_VERSION, MAX_CONTEXT_RECORDS, type ContextObservation, type ContextReview } from '../contracts/context-review.mts';

export { DOMAIN_HISTORY_INPUT_SCHEMA, DOMAIN_HISTORY_INPUT_VERSION } from '../contracts/context-review.mts';
export const DOMAIN_CHANGE_FAMILIES = ['registration', 'dns', 'mail', 'certificate', 'web'] as const;
export type DomainChangeFamily = typeof DOMAIN_CHANGE_FAMILIES[number];
export type ExpectedDomainChange = Readonly<{ family: DomainChangeFamily; start: string; end: string; reason: string }>;
export type RetiredDependency = Readonly<{ asset: string; dependency: string; family: DomainChangeFamily; retiredAt: string; source: string }>;

export function readDomainHistoryDeclarations(raw: unknown) {
  const input = exact(raw, ['expectedChanges', 'retiredDependencies'], 'Domain history declarations');
  const expectedChanges = array(input.expectedChanges, 'Expected changes', MAX_CONTEXT_RECORDS).map(value => {
    const item = exact(value, ['family', 'start', 'end', 'reason'], 'Expected change');
    iso(item.start, 'Expected window start'); iso(item.end, 'Expected window end');
    if (Date.parse(item.start as string) > Date.parse(item.end as string)) throw new TypeError('Expected change window ends before it starts.');
    return { family: enumeration(item.family, DOMAIN_CHANGE_FAMILIES, 'Change family'), start: item.start as string, end: item.end as string, reason: text(item.reason, 'Change reason', 500) };
  });
  const retiredDependencies = array(input.retiredDependencies, 'Retired dependencies', MAX_CONTEXT_RECORDS).map(value => {
    const item = exact(value, ['asset', 'dependency', 'family', 'retiredAt', 'source'], 'Retired dependency');
    domain(item.asset, 'Owned asset'); domain(item.dependency, 'Dependency hostname'); iso(item.retiredAt, 'Retirement time');
    return { asset: item.asset as string, dependency: item.dependency as string, family: enumeration(item.family, DOMAIN_CHANGE_FAMILIES, 'Dependency family'), retiredAt: item.retiredAt as string, source: text(item.source, 'Retirement source', 500) };
  });
  return { expectedChanges, retiredDependencies };
}

function family(field: string): DomainChangeFamily | null {
  if (['registrar', 'createdDate', 'expiryDate', 'availability'].includes(field)) return 'registration';
  if (field === 'nameservers') return 'dns';
  if (['hasMx', 'hasSpf', 'hasDmarc'].includes(field)) return 'mail';
  if (field.startsWith('http') || ['activityStatus', 'pageTitle', 'websiteProbeDetail'].includes(field)) return 'web';
  return null;
}

/** Input is a canonical Case from storage or the existing exact Case-export reader. */
export function reviewDomainHistory(record: CaseRecord, declarations: unknown, reviewedAt: string): ContextReview {
  iso(reviewedAt, 'Review time');
  const declared = readDomainHistoryDeclarations(declarations);
  const related = (hostname: string) => hostname === record.domain || hostname.endsWith(`.${record.domain}`);
  if (declared.retiredDependencies.some(row => !related(row.asset) && !related(row.dependency))) throw new TypeError('A retired dependency must involve this Case domain or one of its hostnames.');
  array(record.evidenceHistory, 'Case evidence history', MAX_EVIDENCE_SNAPSHOTS_PER_CASE);
  array(record.evidencePins, 'Case evidence pins', MAX_CASE_EVIDENCE_PINS);
  const snapshots = [...record.evidenceHistory].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const observations: ContextObservation[] = [];
  let comparablePairs = 0;
  for (let index = 1; index < snapshots.length; index++) {
    const before = snapshots[index - 1]!, after = snapshots[index]!;
    if (before.capturedAt === after.capturedAt) {
      observations.push({ label: 'Concurrent snapshot observations', state: 'unknown', detail: 'These records have the same observation time; their ordering is not a change sequence.', source: `${before.id} / ${after.id}`, observedAt: after.capturedAt, hostname: record.domain });
      continue;
    }
    comparablePairs++;
    for (const change of compareCaseEvidence(before, after)) {
      const category = family(change.field); if (!category) continue;
      const windows = declared.expectedChanges.filter(row => row.family === category && Date.parse(row.start) <= Date.parse(after.capturedAt) && Date.parse(row.end) >= Date.parse(before.capturedAt));
      observations.push({ label: `${category} · ${change.label}`, state: 'changed',
        detail: `${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}${windows.length ? ` · Overlaps ${windows.length} analyst-declared expected-change window(s); not automatically approved.` : ''}`,
        source: `${before.source} ${before.id} → ${after.source} ${after.id}`, observedAt: after.capturedAt, hostname: after.observationHostname ?? record.domain });
    }
  }
  for (const pin of record.evidencePins.filter(pin => pin.certificateObservation)) {
    observations.push({ label: `Retained certificate · ${pin.label}`, state: pin.completeness === 'complete' && pin.truncated !== true ? 'observed' : 'partial', detail: pin.value,
      source: `${pin.source} · pin ${pin.id}`, observedAt: pin.observedAt, hostname: record.domain });
  }
  for (const row of declared.expectedChanges) observations.push({ label: `Expected ${row.family} change`, state: 'reported', detail: `${row.start} – ${row.end} · ${row.reason}`, source: 'Analyst declaration', observedAt: null, hostname: record.domain });
  for (const row of declared.retiredDependencies) observations.push({ label: `Declared retired ${row.family} dependency`, state: 'reported', detail: `${row.asset} depended on ${row.dependency}. Check whether owned configuration still references it.`, source: row.source, observedAt: row.retiredAt, hostname: row.dependency });
  const certificateCount = observations.filter(row => row.label.startsWith('Retained certificate')).length;
  return { schema: CONTEXT_REVIEW_SCHEMA, version: CONTEXT_REVIEW_VERSION, kind: 'domain_history', reviewedAt, title: 'Domain history and retired dependencies', state: comparablePairs < 1 ? 'partial' : 'reviewed',
    summary: `Retained snapshots: ${snapshots.length}; time-ordered pairs: ${comparablePairs}; certificate pins: ${certificateCount}; declared retired dependencies: ${declared.retiredDependencies.length}.`, observations,
    nextSteps: ['Review changed registration, DNS, mail and web evidence against declared maintenance windows.', 'Recheck owned references to retired dependencies before changing configuration; preserve evidence of legitimate transfers or rebrands.'],
    limitations: ['This review uses retained Case evidence, not fresh collection. Missing or incompatible fields are not compared.', 'Certificate pins retain their own source and completeness; they are not equivalent to live TLS observations.', 'Changes and retired dependencies do not establish ownership transfer, malicious repurposing or takeover availability.'] };
}
