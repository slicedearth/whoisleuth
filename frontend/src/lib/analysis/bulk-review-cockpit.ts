export type BulkReviewCockpitRow = Readonly<{
  resultIndex: number;
  domain: string;
  availability: string;
  confidence: string;
  risk: number | null;
  opportunity: number | null;
  activity: string;
  registrar: string;
  reviewState: string;
  shortlisted: boolean;
  trusted: boolean | null;
  profileContextReady: boolean;
  profileContextLimitation: string;
  sourceCoverage: readonly { source: string; state: string }[];
  error: string;
  caseRecord: { id: string; disposition: string } | null;
}>;

function unresolved(row: BulkReviewCockpitRow): boolean {
  return row.reviewState !== 'reviewed' && row.reviewState !== 'deferred';
}

export function nextBulkReviewIndex(
  rows: readonly BulkReviewCockpitRow[],
  current: number,
  direction: -1 | 1,
): number {
  if (!rows.length) return -1;
  const start = current >= 0 && current < rows.length ? current : direction === 1 ? -1 : 0;
  for (let offset = 1; offset <= rows.length; offset += 1) {
    const index = (start + direction * offset + rows.length) % rows.length;
    const candidate = rows[index];
    if (candidate && unresolved(candidate)) return index;
  }
  return Math.max(0, Math.min(rows.length - 1, current));
}
