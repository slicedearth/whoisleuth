export type BulkSortKey =
  | 'domain'
  | 'availability'
  | 'confidence'
  | 'risk'
  | 'opportunity'
  | 'activity'
  | 'registrar'
  | 'mutation';

export type BulkSortDirection = 1 | -1;

type BulkSortableResult = {
  domain: string;
  availability: string;
  confidence: string;
  risk: number | null;
  opportunity: number | null;
  activity: string;
  registrar: string;
  mutationTypes: string[];
};

const CONFIDENCE_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function boundedText(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 300);
}

function textValue(value: unknown): { missing: boolean; value: string } {
  const text = boundedText(value);
  return { missing: !text || text === '—', value: text };
}

function compareText(left: unknown, right: unknown): number {
  const leftText = boundedText(left);
  const rightText = boundedText(right);
  return leftText.localeCompare(rightText, 'en', { numeric: true, sensitivity: 'base' });
}

function sortValue(row: BulkSortableResult, key: BulkSortKey): { missing: boolean; value: number | string } {
  if (key === 'risk' || key === 'opportunity') {
    return { missing: !Number.isFinite(row[key]), value: Number(row[key] ?? 0) };
  }
  if (key === 'confidence') {
    const confidence = boundedText(row.confidence).toLowerCase();
    const rank = CONFIDENCE_RANK[confidence];
    return { missing: rank === undefined, value: rank ?? confidence };
  }
  if (key === 'mutation') return textValue(row.mutationTypes.join(' '));
  return textValue(row[key]);
}

export function defaultBulkSortDirection(key: BulkSortKey): BulkSortDirection {
  return key === 'risk' || key === 'opportunity' || key === 'confidence' ? -1 : 1;
}

export function sortBulkResults<T extends BulkSortableResult>(
  rows: readonly T[],
  key: BulkSortKey,
  direction: BulkSortDirection,
): T[] {
  return [...rows].sort((left, right) => {
    const leftValue = sortValue(left, key);
    const rightValue = sortValue(right, key);
    // Missing values always remain last instead of jumping to the top when
    // the requested direction changes.
    if (leftValue.missing !== rightValue.missing) return leftValue.missing ? 1 : -1;
    const comparison = typeof leftValue.value === 'number' && typeof rightValue.value === 'number'
      ? leftValue.value - rightValue.value
      : compareText(leftValue.value, rightValue.value);
    if (comparison !== 0) return comparison * direction;
    return compareText(left.domain, right.domain);
  });
}
