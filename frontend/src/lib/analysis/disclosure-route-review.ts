import type { CaseRecord } from './case-model.ts';

export const MAX_DISCLOSURE_ROUTE_REVIEWS = 250;

export type DisclosureRouteReview = Readonly<{
  id: string;
  caseId: string;
  domain: string;
  actionType: string;
  recipient: string;
  source: string;
  state: string;
  updatedAt: string;
  nextReviewAt: string | null;
  review: 'current' | 'due' | 'unconfirmed';
  limitations: readonly string[];
}>;

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function buildDisclosureRouteReview(
  records: readonly CaseRecord[],
  now: unknown = new Date().toISOString(),
): Readonly<{
  routes: readonly DisclosureRouteReview[];
  truncated: boolean;
  limitations: readonly string[];
}> {
  const nowMs = Number.isFinite(Date.parse(String(now))) ? Date.parse(String(now)) : 0;
  const routes: DisclosureRouteReview[] = [];
  for (const record of records.slice(0, 500)) {
    for (const action of record.actions.slice(-50)) {
      if (!['network_hosting_report', 'registrar_report', 'registry_report', 'security_contact_report'].includes(action.type)) continue;
      const nextReviewAt = timestamp(action.followUpAt) || timestamp(action.dueAt);
      const hasReviewedSource = Boolean(action.contactSource && action.contactLimitations.length);
      routes.push({
        id: `${record.id}:${action.id}`,
        caseId: record.id,
        domain: record.domain,
        actionType: action.type,
        recipient: action.recipient,
        source: action.contactSource || 'Source not recorded',
        state: action.state,
        updatedAt: timestamp(action.updatedAt) || timestamp(record.updatedAt) || new Date(0).toISOString(),
        nextReviewAt,
        review: nextReviewAt && Date.parse(nextReviewAt) <= nowMs
          ? 'due'
          : hasReviewedSource
            ? 'current'
            : 'unconfirmed',
        limitations: action.contactLimitations,
      });
    }
  }
  routes.sort((left, right) => {
    const priority = { due: 0, unconfirmed: 1, current: 2 };
    return priority[left.review] - priority[right.review]
      || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      || left.domain.localeCompare(right.domain);
  });
  return {
    routes: routes.slice(0, MAX_DISCLOSURE_ROUTE_REVIEWS),
    truncated: records.length > 500 || routes.length > MAX_DISCLOSURE_ROUTE_REVIEWS,
    limitations: [
      'Route review uses only contact sources and actions deliberately saved in browser-local cases. It performs no discovery or reachability check.',
      'A current entry means its recorded review date is not due. It does not prove that the recipient is monitored, appropriate, responsive, or responsible.',
    ],
  };
}
