import { brandPostureObservationContext, currentDesiredPostureObservation, desiredPostureObservationIdentity, type BrandProfile } from './brand-profile-model.ts';
import { buildDesiredPostureComparisonsFromObservation } from './owned-domain-posture-review.ts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';
import type { BulkSession } from './bulk-session-model.ts';
import type { CaseRecord } from './case-model.ts';
import type { DetectionRule } from './detection-rule-model.ts';
import { evaluateDetectionRules } from './detection-rule-model.ts';
import type { WebsiteProfileSnapshot } from './website-snapshot-model.ts';
import type { WatchlistCollection } from './watchlist-store.ts';
import { buildComparisonLedgerIndex } from './comparison-ledger.ts';
import {
  analystReviewMaterialFingerprint,
  analystReviewAgeAt,
  analystReviewSubjectKey,
  type AnalystReviewCompleteness,
  type AnalystReviewEvidenceFamily,
  type AnalystReviewItem,
  type AnalystReviewKind,
  type AnalystReviewStateStore,
} from './analyst-review-state.ts';
import {
  retainTopAnalystReviewItems,
  type AnalystReviewProjectionAdmission,
} from './analyst-review-inbox.ts';

export type LocalAnalystReviewProjection = Readonly<{
  items: readonly AnalystReviewItem[];
  admission: AnalystReviewProjectionAdmission;
  limitations: readonly string[];
}>;

type ItemSeed = Readonly<{
  stable: readonly unknown[];
  material: readonly unknown[];
  kind: AnalystReviewKind;
  family: AnalystReviewEvidenceFamily;
  priority?: AnalystReviewItem['priority'];
  title: string;
  detail: string;
  source: string;
  sourceIds: readonly string[];
  observedAt: string;
  dueAt?: string | null;
  completeness: AnalystReviewCompleteness;
  nextAction?: AnalystReviewItem['nextAction'];
  href: string;
  retryHref?: string | null;
  caseId?: string | null;
  caseDomain?: string | null;
  campaignIds?: readonly string[];
  requiresExpiry?: boolean;
}>;

function timestamp(value: unknown, fallback: string): string {
  return normalizeExplicitIsoTimestamp(value) ?? fallback;
}

function item(seed: ItemSeed, now: string): AnalystReviewItem {
  const dueAt = normalizeExplicitIsoTimestamp(seed.dueAt);
  const priority = seed.priority ?? (dueAt && Date.parse(dueAt) <= Date.parse(now) ? 'high' : 'normal');
  const subjectKey = analystReviewSubjectKey(seed.family, seed.stable);
  return {
    id: `local-review:${subjectKey.slice(-64)}`,
    kind: seed.kind,
    evidenceFamily: seed.family,
    subjectKey,
    materialFingerprint: analystReviewMaterialFingerprint(seed.material),
    requiresExpiry: seed.requiresExpiry ?? true,
    priority,
    title: seed.title,
    detail: seed.detail,
    source: seed.source,
    sourceIds: seed.sourceIds,
    caseDomain: seed.caseDomain ?? null,
    observedAt: timestamp(seed.observedAt, ''),
    dueAt,
    age: analystReviewAgeAt(seed.observedAt, now),
    completeness: seed.completeness,
    nextAction: seed.nextAction ?? 'review',
    rankingReason: dueAt && Date.parse(dueAt) <= Date.parse(now)
      ? 'The explicit review or expiry time has arrived.'
      : 'This retained local evidence is ordered by due time, observation time, and stable identity.',
    href: seed.href,
    retryHref: seed.retryHref ?? null,
    caseId: seed.caseId ?? null,
    campaignIds: seed.campaignIds ?? [],
    dismissalTarget: null,
  };
}

function profileItems(profiles: readonly BrandProfile[], now: string): AnalystReviewItem[] {
  const output: AnalystReviewItem[] = [];
  for (const profile of profiles.slice(0, 100)) {
    for (const baseline of profile.desiredPostureBaselines.slice(0, 200)) {
      const href = `/brands?profile=${encodeURIComponent(profile.id)}&domain=${encodeURIComponent(baseline.domain)}#desired-posture-baseline`;
      for (const window of baseline.approvedChangeWindows) {
        output.push(item({
          stable: [profile.id, baseline.domain, 'approved-change-window', window.id],
          material: [window.startsAt, window.endsAt, window.summary],
          kind: 'change_window',
          family: 'change_window',
          title: `Review approved change window for ${baseline.domain}`,
          detail: `${window.summary} The retained window documents analyst intent only and does not establish that an observed change is authorised or complete.`,
          source: `Brand Profile · ${profile.name}`,
          sourceIds: ['brand_profile'],
          observedAt: baseline.updatedAt,
          dueAt: window.startsAt,
          completeness: 'complete',
          href,
          caseDomain: baseline.domain,
        }, now));
      }
      for (const suppression of baseline.suppressions) {
        output.push(item({
          stable: [profile.id, baseline.domain, 'suppression', suppression.field],
          material: [suppression.field, suppression.reason, suppression.expiresAt],
          kind: 'suppression',
          family: 'suppression',
          title: `Review ${suppression.field.replaceAll('_', ' ')} suppression for ${baseline.domain}`,
          detail: suppression.expiresAt
            ? `The reviewed exception expires ${suppression.expiresAt}. It changes only analyst triage and does not remove the underlying posture difference.`
            : 'This retained exception has no expiry. It remains an explicit review concern and cannot silently resolve the underlying posture difference.',
          source: `Brand Profile · ${profile.name}`,
          sourceIds: ['brand_profile'],
          observedAt: baseline.updatedAt,
          dueAt: suppression.expiresAt,
          completeness: suppression.expiresAt ? 'complete' : 'partial',
          href,
          caseDomain: baseline.domain,
        }, now));
      }
      const selected = currentDesiredPostureObservation(baseline);
      const observation = selected.observation;
      const context = profile.officialDomains.includes(baseline.domain) ? brandPostureObservationContext(profile, baseline.domain) : undefined;
      const comparisons = buildDesiredPostureComparisonsFromObservation(baseline, observation, now, { ...(context ? { context } : {}), limitation: selected.limitation });
      if (selected.limitation) output.push(item({
        stable: [profile.id, baseline.domain, 'posture-order'],
        material: selected.candidates.map(desiredPostureObservationIdentity).sort(),
        kind: 'desired_posture', family: 'desired_posture',
        title: `Review retained settings context for ${baseline.domain}`,
        detail: selected.limitation, source: `Retained Brand posture observations · ${profile.name}`,
        sourceIds: ['brand_posture'], observedAt: '', completeness: 'inconclusive', nextAction: 'refresh', href, caseDomain: baseline.domain,
      }, now));
      for (const check of observation?.checks ?? []) {
        const comparison = comparisons.find((value) => value.field === (check.id === 'registration_lock' ? 'registrarLock' : check.id));
        const relevantComparison = comparison && !['not_configured', 'aligned', 'observed'].includes(comparison.state);
        if (check.status !== 'danger' && check.status !== 'warning' && !relevantComparison) continue;
        output.push(item({
          stable: [profile.id, baseline.domain, 'desired-posture', check.id],
          material: [check.id, check.status, check.records, check.sourceContext, observation?.context, comparison?.desired, comparison?.state],
          kind: 'desired_posture',
          family: 'desired_posture',
          priority: check.status === 'danger' ? 'high' : 'normal',
          title: `Review ${check.id.replaceAll('_', ' ')} posture for ${baseline.domain}`,
          detail: relevantComparison ? comparison.explanation : 'The retained check is marked for review. Its status does not establish a difference from expected settings.',
          source: `Retained Brand posture observation · ${profile.name}`,
          sourceIds: ['brand_posture'],
          observedAt: check.sourceContext?.observedAt ?? '',
          completeness: relevantComparison && ['drift', 'review', 'approved_window', 'suppressed'].includes(comparison.state) ? 'complete' : 'partial',
          href,
          caseDomain: baseline.domain,
        }, now));
      }
    }
  }
  return output;
}

function comparisonItems(input: Readonly<{
  cases: readonly CaseRecord[];
  websiteSnapshots: readonly WebsiteProfileSnapshot[];
  watchlists: WatchlistCollection;
  bulkSessions: readonly BulkSession[];
}>, now: string): { items: AnalystReviewItem[]; omittedAtLeast: number; totalIsLowerBound: boolean } {
  const index = buildComparisonLedgerIndex(input);
  return {
    omittedAtLeast: index.omissions.indexItems,
    totalIsLowerBound: index.omissions.inputScanTruncations > 0,
    items: index.items.map((entry) => item({
      stable: [entry.ownerType, entry.ownerId, entry.entityId, entry.mode],
      material: [entry.id, entry.earlier, entry.later, entry.completeness, entry.truncated, entry.limitations],
      kind: 'comparison',
      family: 'comparison',
      title: entry.label,
      detail: `Review the retained ${entry.mode.replaceAll('_', ' ')} without treating a difference as ownership, intent, or maliciousness.`,
      source: `${entry.earlier.source} → ${entry.later.source}`,
      sourceIds: ['comparison_ledger'],
      observedAt: entry.later.observedAt ?? '',
      completeness: entry.completeness === 'complete' && !entry.truncated ? 'complete'
        : entry.completeness === 'partial' ? 'partial' : 'inconclusive',
      nextAction: entry.completeness === 'complete' && !entry.truncated ? 'review' : 'refresh',
      href: entry.ownerHref,
    }, now)),
  };
}

function packetItems(cases: readonly CaseRecord[], now: string): AnalystReviewItem[] {
  return cases.slice(0, 500).flatMap((record) => record.actions
    .filter((action) => action.type.endsWith('_report') && !['submitted', 'acknowledged', 'terminal'].includes(action.state))
    .map((action) => item({
      stable: [record.id, action.id, 'response-packet-readiness'],
      material: [action.state, action.recipient, action.contactSource, action.contactLimitations, action.dueAt, action.followUpAt, action.updatedAt, action.history],
      kind: 'incomplete_packet',
      family: 'packet',
      priority: action.state === 'authorised' ? 'high' : 'normal',
      title: `Complete reviewed handoff for ${record.domain}`,
      detail: `The retained ${action.type.replaceAll('_', ' ')} action is ${action.state.replaceAll('_', ' ')}. Packet draft fields and authorisation remain transient until deliberate export, so this Review Item does not claim that a packet exists or was submitted.`,
      source: 'Browser-local Case response action',
      sourceIds: ['case_action'],
      observedAt: action.updatedAt,
      dueAt: action.followUpAt ?? action.dueAt,
      completeness: record.evidencePins.length ? 'partial' : 'inconclusive',
      nextAction: 'resume',
      href: `/monitor?view=cases&case=${encodeURIComponent(record.id)}&response=1#case-response-preflight-${encodeURIComponent(record.id)}`,
      caseId: record.id,
      caseDomain: record.domain,
    }, now)));
}

function ruleItems(cases: readonly CaseRecord[], rules: readonly DetectionRule[], now: string): AnalystReviewItem[] {
  const output: AnalystReviewItem[] = [];
  for (const record of cases.slice(0, 500)) {
    const evaluation = evaluateDetectionRules(record, rules);
    for (const match of evaluation.matchedRules) {
      output.push(item({
        stable: [match.id, record.id],
        material: [match.id, record.updatedAt, match.appliedDelta, match.tag, record.disposition],
        kind: 'detection_rule',
        family: 'rule',
        title: `Review custom-rule match for ${record.domain}`,
        detail: `${match.name} matched retained Case evidence. This browser-local heuristic does not change the built-in Risk score and is not proof of maliciousness.`,
        source: 'Browser-local custom detection rule',
        sourceIds: ['detection_rule'],
        observedAt: record.updatedAt,
        completeness: record.evidenceHistory.length || record.evidencePins.length ? 'partial' : 'inconclusive',
        href: `/monitor?view=rules&case=${encodeURIComponent(record.id)}&rule=${encodeURIComponent(match.id)}`,
        caseId: record.id,
        caseDomain: record.domain,
      }, now));
    }
  }
  return output;
}

export function buildLocalAnalystReviewProjection(input: Readonly<{
  cases?: readonly CaseRecord[];
  profiles?: readonly BrandProfile[];
  detectionRules?: readonly DetectionRule[];
  websiteSnapshots?: readonly WebsiteProfileSnapshot[];
  watchlists?: WatchlistCollection;
  bulkSessions?: readonly BulkSession[];
  reviewState?: AnalystReviewStateStore;
}>, nowRaw: unknown = new Date().toISOString()): LocalAnalystReviewProjection {
  const now = timestamp(nowRaw, '');
  const cases = input.cases ?? [];
  const comparison = comparisonItems({
    cases,
    websiteSnapshots: input.websiteSnapshots ?? [],
    watchlists: input.watchlists ?? {},
    bulkSessions: input.bulkSessions ?? [],
  }, now);
  const all = [
    ...profileItems(input.profiles ?? [], now),
    ...comparison.items,
    ...packetItems(cases, now),
    ...ruleItems(cases, input.detectionRules ?? [], now),
  ];
  const retained = retainTopAnalystReviewItems(all, {
    now,
    ...(input.reviewState ? { reviewState: input.reviewState } : {}),
  });
  const omittedAtLeast: Partial<Record<AnalystReviewEvidenceFamily, number>> = {};
  for (const family of Object.keys(retained.candidateCounts) as AnalystReviewEvidenceFamily[]) {
    const omitted = retained.candidateCounts[family] - retained.retainedCounts[family];
    if (omitted > 0) omittedAtLeast[family] = omitted;
  }
  if (comparison.omittedAtLeast > 0) {
    omittedAtLeast.comparison = (omittedAtLeast.comparison ?? 0) + comparison.omittedAtLeast;
  }
  const lowerBoundFamilies = new Set<AnalystReviewEvidenceFamily>();
  if (comparison.totalIsLowerBound) lowerBoundFamilies.add('comparison');
  if ((input.cases?.length ?? 0) > 500) {
    lowerBoundFamilies.add('packet');
    lowerBoundFamilies.add('rule');
  }
  const profiles = input.profiles ?? [];
  if (profiles.length > 100 || profiles.slice(0, 100).some((profile) => profile.desiredPostureBaselines.length > 200)) {
    lowerBoundFamilies.add('change_window');
    lowerBoundFamilies.add('suppression');
    lowerBoundFamilies.add('desired_posture');
  }
  return {
    items: retained.items,
    admission: {
      omittedAtLeast,
      lowerBoundFamilies: [...lowerBoundFamilies],
      currentSubjectKeys: [...new Set(all.map((item) => item.subjectKey))],
    },
    limitations: [
      'These Review Items are projections over retained browser-local records. They make no request and do not rewrite their source records.',
      'Custom-rule matches and desired-posture differences are analyst review leads, not proof of compromise, ownership, safety, or maliciousness.',
      'Response-packet draft inputs are transient; retained Case action readiness can prompt a handoff review but does not establish that a packet was exported or submitted.',
    ],
  };
}
