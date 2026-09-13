import type { CaseRecord } from './case-model.ts';
import { responseRouteFreshness } from '../../../../packages/cases/response-route-freshness.mts';
import { MAX_CASES, MAX_CASE_ACTIONS } from '../../../../packages/contracts/case-portability.mts';
import { normalizeExplicitIsoTimestamp as timestamp } from '../../../../packages/evidence/observation.mts';

export type DisclosureRouteReview = Readonly<{
  id: string;
  caseId: string;
  domain: string;
  actionType: string;
  recipient: string;
  source: string;
  state: string;
  observedAt: string | null;
  updatedAt: string | null;
  nextReviewAt: string | null;
  followUpAt: string | null;
  review: 'current' | 'due' | 'unconfirmed';
  limitations: readonly string[];
}>;

export function buildDisclosureRouteReview(
  records: readonly CaseRecord[],
  now: unknown = new Date().toISOString(),
): Readonly<{
  routes: readonly DisclosureRouteReview[];
  evaluatedAt: string | null;
  sourceCasesOmitted: number;
  sourceActionsOmitted: number;
  truncated: boolean;
  limitations: readonly string[];
}> {
  const evaluatedAt = timestamp(now);
  const sourceCasesOmitted = Math.max(0, records.length - MAX_CASES);
  let sourceActionsOmitted = 0;
  const routes: DisclosureRouteReview[] = [];
  for (const record of records.slice(0, MAX_CASES)) {
    sourceActionsOmitted += Math.max(0, record.actions.length - MAX_CASE_ACTIONS);
    for (const action of record.actions.slice(-MAX_CASE_ACTIONS)) {
      if (!['network_hosting_report', 'registrar_report', 'registry_report', 'security_contact_report', 'platform_report'].includes(action.type)) continue;
      const nextReviewAt = timestamp(action.routeReviewAfter);
      const freshness = responseRouteFreshness(action.routeObservedAt, action.routeReviewAfter, evaluatedAt ?? '');
      routes.push({
        id: `${record.id}:${action.id}`,
        caseId: record.id,
        domain: record.domain,
        actionType: action.type,
        recipient: action.recipient,
        source: action.contactSource || 'Source not recorded',
        state: action.state,
        observedAt: timestamp(action.routeObservedAt),
        updatedAt: timestamp(action.updatedAt),
        nextReviewAt,
        followUpAt: timestamp(action.followUpAt) || timestamp(action.dueAt),
        review: !action.contactSource || freshness === 'unknown' ? 'unconfirmed' : freshness === 'stale' ? 'due' : 'current',
        limitations: action.contactLimitations,
      });
    }
  }
  routes.sort((left, right) => {
    const priority = { due: 0, unconfirmed: 1, current: 2 };
    if (left.review !== right.review) return priority[left.review] - priority[right.review];
    const leftTime = left.updatedAt === null ? -Infinity : Date.parse(left.updatedAt);
    const rightTime = right.updatedAt === null ? -Infinity : Date.parse(right.updatedAt);
    if (leftTime !== rightTime) return rightTime - leftTime;
    if (left.domain !== right.domain) return left.domain < right.domain ? -1 : 1;
    return left.id < right.id ? -1 : left.id === right.id ? 0 : 1;
  });
  return {
    routes,
    evaluatedAt,
    sourceCasesOmitted,
    sourceActionsOmitted,
    truncated: sourceCasesOmitted > 0 || sourceActionsOmitted > 0,
    limitations: [
      'Route review uses only contact sources and actions deliberately saved in Cases. It performs no discovery or reachability check.',
      'Route freshness uses its source observation and review deadline, not the action follow-up date. Current evidence does not prove that the recipient is monitored, appropriate, responsive, or responsible.',
    ],
  };
}
