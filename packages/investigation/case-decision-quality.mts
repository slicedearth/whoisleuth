import { latestCaseEvidence } from '../cases/case-model.mts';
import type { CaseRecord } from '../cases/case-record-contracts.mts';

export const CASE_DECISION_QUALITY_VERSION = 1;
export const MAX_CASE_DECISION_QUALITY_FINDINGS = 500;

export type CaseDecisionQualityFindingKind =
  | 'inconsistent_disposition'
  | 'disposition_without_reason'
  | 'decision_without_evidence'
  | 'strong_disposition_without_evidence'
  | 'escalation_without_action'
  | 'monitoring_without_follow_up'
  | 'assertion_without_evidence'
  | 'assertion_predates_evidence';

export type CaseDecisionQualityFinding = Readonly<{
  id: string;
  kind: CaseDecisionQualityFindingKind;
  severity: 'high' | 'medium';
  title: string;
  detail: string;
  caseIds: readonly string[];
  domains: readonly string[];
  href: string;
}>;

export type CaseDecisionQualityReport = Readonly<{
  version: typeof CASE_DECISION_QUALITY_VERSION;
  caseCount: number;
  findingCount: number;
  findings: readonly CaseDecisionQualityFinding[];
  counts: Readonly<Record<CaseDecisionQualityFindingKind, number>>;
  truncated: boolean;
  limitation: string;
}>;

const REVIEWED_DISPOSITIONS = new Set(['suspicious', 'confirmed_abuse', 'false_positive', 'expected', 'closed_no_action']);

function caseHref(caseId: string): string {
  return `/monitor?view=cases&case=${encodeURIComponent(caseId)}#case-response-${encodeURIComponent(caseId)}`;
}

function laterThan(value: unknown, baseline: unknown): boolean {
  if (typeof value !== 'string' || typeof baseline !== 'string') return false;
  const left = Date.parse(value);
  const right = Date.parse(baseline);
  return Number.isFinite(left) && Number.isFinite(right) && left > right;
}

function add(output: CaseDecisionQualityFinding[], finding: CaseDecisionQualityFinding): void {
  if (output.length < MAX_CASE_DECISION_QUALITY_FINDINGS) output.push(Object.freeze(finding));
}

export function buildCaseDecisionQualityReport(rawRecords: readonly CaseRecord[]): CaseDecisionQualityReport {
  const records = rawRecords.slice(0, 500);
  const findings: CaseDecisionQualityFinding[] = [];
  const byFingerprint = new Map<string, CaseRecord[]>();
  for (const record of records) {
    const latest = latestCaseEvidence(record);
    if (latest?.fingerprint && REVIEWED_DISPOSITIONS.has(record.disposition)) {
      const group = byFingerprint.get(latest.fingerprint) ?? [];
      group.push(record);
      byFingerprint.set(latest.fingerprint, group);
    }
    if (REVIEWED_DISPOSITIONS.has(record.disposition) && !record.reviewReasonCode) {
      add(findings, {
        id: `reason:${record.id}`,
        kind: 'disposition_without_reason',
        severity: 'medium',
        title: `Record why ${record.domain} was dispositioned`,
        detail: `The case is marked ${record.disposition.replaceAll('_', ' ')} without a structured review reason.`,
        caseIds: [record.id], domains: [record.domain], href: caseHref(record.id),
      });
    }
    const evidenceLinkedDecisions = record.decisions.filter((decision) => decision.evidencePinIds.length > 0);
    if (record.disposition === 'confirmed_abuse' && evidenceLinkedDecisions.length === 0) {
      add(findings, {
        id: `strong-disposition:${record.id}`,
        kind: 'strong_disposition_without_evidence',
        severity: 'high',
        title: `Link the confirmed-abuse disposition for ${record.domain} to evidence`,
        detail: 'The strongest disposition is retained without an evidence-linked decision. The disposition remains analyst-authored and should be reviewed before handoff.',
        caseIds: [record.id], domains: [record.domain], href: caseHref(record.id),
      });
    }
    if (record.status === 'escalated' && record.actions.length === 0) {
      add(findings, {
        id: `escalation:${record.id}`,
        kind: 'escalation_without_action',
        severity: 'medium',
        title: `Record the escalation path for ${record.domain}`,
        detail: 'The Case is marked escalated but has no retained response action. Record the actual route or return the status to a state supported by the record.',
        caseIds: [record.id], domains: [record.domain], href: caseHref(record.id),
      });
    }
    if (record.status === 'monitoring' && record.actions.length === 0 && record.observedEffects.reviews.length === 0) {
      add(findings, {
        id: `monitoring:${record.id}`,
        kind: 'monitoring_without_follow_up',
        severity: 'medium',
        title: `Record the monitoring intent for ${record.domain}`,
        detail: 'The Case is marked monitoring without a retained response action or observed-effect review. Confirm the follow-up path before relying on this status.',
        caseIds: [record.id], domains: [record.domain], href: caseHref(record.id),
      });
    }
    for (const decision of record.decisions) {
      if (decision.evidencePinIds.length) continue;
      add(findings, {
        id: `decision:${record.id}:${decision.id}`,
        kind: 'decision_without_evidence',
        severity: 'high',
        title: `Link the decision for ${record.domain} to evidence`,
        detail: 'A structured decision has no evidence-pin reference. Its rationale remains analyst-authored and is not independently supported by the case record.',
        caseIds: [record.id], domains: [record.domain], href: caseHref(record.id),
      });
    }
    for (const assertion of record.assertions) {
      if (assertion.state !== 'open') continue;
      if (!assertion.evidencePinIds.length) {
        add(findings, {
          id: `assertion-evidence:${record.id}:${assertion.id}`,
          kind: 'assertion_without_evidence',
          severity: assertion.kind === 'verified_fact' ? 'high' : 'medium',
          title: `Review an unsupported ${assertion.kind.replaceAll('_', ' ')} for ${record.domain}`,
          detail: 'The open assertion does not reference a retained evidence pin.',
          caseIds: [record.id], domains: [record.domain], href: caseHref(record.id),
        });
      }
      if (latest && laterThan(latest.capturedAt, assertion.updatedAt)) {
        add(findings, {
          id: `assertion-age:${record.id}:${assertion.id}:${latest.fingerprint}`,
          kind: 'assertion_predates_evidence',
          severity: 'medium',
          title: `Recheck an open assertion for ${record.domain}`,
          detail: 'The case contains a newer evidence snapshot than this open assertion. The newer observation is not automatically treated as supporting or contradicting it.',
          caseIds: [record.id], domains: [record.domain], href: caseHref(record.id),
        });
      }
    }
  }

  for (const [fingerprint, group] of byFingerprint) {
    const dispositions = [...new Set(group.map((record) => record.disposition))];
    if (group.length < 2 || dispositions.length < 2) continue;
    const sorted = [...group].sort((left, right) => left.domain.localeCompare(right.domain));
    add(findings, {
      id: `consistency:${fingerprint}`,
      kind: 'inconsistent_disposition',
      severity: 'high',
      title: 'Review inconsistent dispositions for equivalent retained evidence',
      detail: `${sorted.length} cases share the same latest evidence fingerprint but have different reviewed dispositions: ${dispositions.map((item) => item.replaceAll('_', ' ')).join(', ')}.`,
      caseIds: sorted.map((record) => record.id),
      domains: sorted.map((record) => record.domain),
      href: caseHref(sorted[0]!.id),
    });
  }

  findings.sort((left, right) => Number(right.severity === 'high') - Number(left.severity === 'high') || left.title.localeCompare(right.title));
  const counts: Record<CaseDecisionQualityFindingKind, number> = {
    inconsistent_disposition: 0,
    disposition_without_reason: 0,
    decision_without_evidence: 0,
    strong_disposition_without_evidence: 0,
    escalation_without_action: 0,
    monitoring_without_follow_up: 0,
    assertion_without_evidence: 0,
    assertion_predates_evidence: 0,
  };
  for (const finding of findings) counts[finding.kind] += 1;
  return Object.freeze({
    version: CASE_DECISION_QUALITY_VERSION,
    caseCount: records.length,
    findingCount: findings.length,
    findings: Object.freeze(findings),
    counts: Object.freeze(counts),
    truncated: rawRecords.length > records.length || findings.length >= MAX_CASE_DECISION_QUALITY_FINDINGS,
    limitation: 'This local audit checks record consistency and evidence linkage only. It does not decide whether a disposition, assertion, or action is substantively correct.',
  });
}
