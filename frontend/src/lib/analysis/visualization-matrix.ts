import { scaleBand } from 'd3-scale';
import {
  boundedVisualizationId as boundedId,
  boundedVisualizationText as boundedText,
} from './visualization-bounds.ts';

export const MAX_VISUAL_MATRIX_ROWS = 24;
export const MAX_VISUAL_MATRIX_COLUMNS = 6;

export type MatrixCellState =
  | 'equal'
  | 'different'
  | 'conflict'
  | 'observed'
  | 'partial'
  | 'unavailable'
  | 'not_collected'
  | 'unknown';

export type MatrixInput = {
  id: string;
  label: string;
  cells: Array<{
    column: string;
    state: MatrixCellState | string;
    detail?: string;
  }>;
};

function normalizedMatrixState(value: unknown): MatrixCellState {
  const state = boundedText(value, 30).toLowerCase();
  if (state === 'equal' || state === 'equivalent' || state === 'same') return 'equal';
  if (state === 'different') return 'different';
  if (state === 'conflict' || state === 'conflicting') return 'conflict';
  if (state === 'observed' || state === 'complete' || state === 'success') return 'observed';
  if (state === 'partial' || state === 'inconclusive' || state === 'rate_limited' || state === 'missing') return 'partial';
  if (state === 'unavailable' || state === 'error' || state === 'failed') return 'unavailable';
  if (state === 'not_collected' || state === 'skipped' || state === 'disabled' || state === 'not_recorded') {
    return 'not_collected';
  }
  return 'unknown';
}

export function projectEvidenceMatrix(
  rawColumns: readonly string[],
  rawRows: readonly MatrixInput[],
) {
  const columns = [...new Set((Array.isArray(rawColumns) ? rawColumns : [])
    .map((column) => boundedText(column, 40))
    .filter(Boolean))]
    .slice(0, MAX_VISUAL_MATRIX_COLUMNS);
  const columnSet = new Set(columns);
  const seenRows = new Set<string>();
  const candidates = (Array.isArray(rawRows) ? rawRows : [])
    .map((row, index) => {
      const id = boundedId(row?.id) || `row-${index}`;
      const label = boundedText(row?.label, 56);
      if (!label || seenRows.has(id)) return null;
      seenRows.add(id);
      const rowCells = (Array.isArray(row.cells) ? row.cells : []) as MatrixInput['cells'];
      const byColumn = new Map(rowCells
        .map((cell) => {
          const column = boundedText(cell?.column, 40);
          return [column, {
            state: normalizedMatrixState(cell?.state),
            detail: boundedText(cell?.detail, 120),
          }] as const;
        })
        .filter(([column]) => columnSet.has(column)));
      return {
        id,
        label,
        cells: columns.map((column) => ({
          column,
          state: byColumn.get(column)?.state ?? 'not_collected',
          detail: byColumn.get(column)?.detail ?? '',
        })),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const rows = candidates.slice(0, MAX_VISUAL_MATRIX_ROWS);
  const width = 900;
  const top = 54;
  const left = 210;
  const rowHeight = 30;
  const x = scaleBand<string>().domain(columns).range([left, 870]).padding(0.12);
  const y = scaleBand<string>().domain(rows.map((row) => row.id))
    .range([top, top + Math.max(1, rows.length) * rowHeight])
    .padding(0.12);
  return {
    width,
    height: Math.max(104, top + rows.length * rowHeight + 22),
    columns: columns.map((column) => ({
      label: column,
      x: x(column) ?? left,
      width: x.bandwidth(),
    })),
    rows: rows.map((row) => ({
      ...row,
      y: y(row.id) ?? top,
      height: y.bandwidth(),
      cells: row.cells.map((cell) => ({
        ...cell,
        x: x(cell.column) ?? left,
        width: x.bandwidth(),
      })),
    })),
    truncated: candidates.length > rows.length || rawColumns.length > columns.length,
  };
}
