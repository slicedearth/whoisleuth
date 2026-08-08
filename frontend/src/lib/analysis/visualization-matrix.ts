import { scaleBand } from 'd3-scale';
import {
  boundedVisualizationId as boundedId,
  boundedVisualizationText as boundedText,
} from './visualization-bounds.ts';

export const MAX_VISUAL_MATRIX_ROWS = 24;
export const MAX_VISUAL_MATRIX_COLUMNS = 6;
// A row is one source-pair lane, so it can publish at most one cell for each
// allowed column. This keeps output at 24 × 6 = 144 cells and prevents hostile
// duplicate inputs from creating sub-pixel marks or unbounded cell arrays.
export const MAX_VISUAL_MATRIX_CELLS = MAX_VISUAL_MATRIX_ROWS * MAX_VISUAL_MATRIX_COLUMNS;
const MAX_VISUAL_MATRIX_COLUMN_INPUTS = MAX_VISUAL_MATRIX_COLUMNS * 4;
const MAX_VISUAL_MATRIX_ROW_INPUTS = MAX_VISUAL_MATRIX_ROWS * 4;
const MAX_VISUAL_MATRIX_CELL_INPUTS_PER_ROW = MAX_VISUAL_MATRIX_COLUMNS * 4;

export type MatrixCellTone =
  | 'equal'
  | 'different'
  | 'conflict'
  | 'observed'
  | 'partial'
  | 'unavailable'
  | 'not_collected'
  | 'unknown';

// Retained for callers that used the original broad visual-state name. The
// projected `state` now preserves the exact source token; `tone` is the
// secondary, deliberately broader visual classification.
export type MatrixCellState = MatrixCellTone;

export type MatrixInput = {
  id: string;
  label: string;
  context?: string;
  status?: string;
  assessment?: string;
  sparse?: boolean;
  cells: Array<{
    column: string;
    state: string;
    tone?: MatrixCellTone | string;
    detail?: string;
  }>;
};

function normalizedMatrixTone(value: unknown): MatrixCellTone {
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
  const columnInputs = Array.isArray(rawColumns) ? rawColumns : [];
  const columns: string[] = [];
  const seenColumns = new Set<string>();
  for (const rawColumn of columnInputs.slice(0, MAX_VISUAL_MATRIX_COLUMN_INPUTS)) {
    const column = boundedText(rawColumn, 40);
    if (!column || seenColumns.has(column) || columns.length >= MAX_VISUAL_MATRIX_COLUMNS) continue;
    seenColumns.add(column);
    columns.push(column);
  }
  const columnSet = new Set(columns);
  const seenRows = new Set<string>();
  const rowInputs = Array.isArray(rawRows) ? rawRows : [];
  const rows: Array<{
    id: string;
    label: string;
    context: string;
    status: string;
    assessment: string;
    cells: Array<{ column: string; state: string; tone: MatrixCellTone; detail: string }>;
  }> = [];
  let discardedCellInputs = 0;
  const scannedRows = rowInputs.slice(0, MAX_VISUAL_MATRIX_ROW_INPUTS);
  for (const [index, row] of scannedRows.entries()) {
    if (rows.length >= MAX_VISUAL_MATRIX_ROWS) break;
    const id = boundedId(row?.id) || `row-${index}`;
    const label = boundedText(row?.label, 56);
    if (!label || seenRows.has(id)) continue;
    seenRows.add(id);
    const rowCells = (Array.isArray(row.cells) ? row.cells : []) as MatrixInput['cells'];
    const scannedCells = rowCells.slice(0, MAX_VISUAL_MATRIX_CELL_INPUTS_PER_ROW);
    discardedCellInputs += Math.max(0, rowCells.length - scannedCells.length);
    const byColumn = new Map<string, {
      column: string;
      state: string;
      tone: MatrixCellTone;
      detail: string;
    }>();
    for (const cell of scannedCells) {
      const column = boundedText(cell?.column, 40);
      if (!columnSet.has(column) || byColumn.has(column)) {
        discardedCellInputs += 1;
        continue;
      }
      const exactState = boundedText(cell?.state, 40).toLowerCase() || 'unknown';
      byColumn.set(column, {
        column,
        state: exactState,
        tone: normalizedMatrixTone(cell?.tone ?? exactState),
        detail: boundedText(cell?.detail, 320),
      });
    }
    const cells = columns.flatMap((column) => {
      const value = byColumn.get(column);
      if (value) return [value];
      if (row.sparse === true) return [];
      return [{
        column,
        state: 'not_collected',
        tone: 'not_collected' as const,
        detail: '',
      }];
    });
    rows.push({
      id,
      label,
      context: boundedText(row.context, 90),
      status: boundedText(row.status, 40).toLowerCase() || 'unknown',
      assessment: boundedText(row.assessment, 80),
      cells,
    });
  }
  const discarded = {
    columnInputs: Math.max(0, columnInputs.length - columns.length),
    rowInputs: Math.max(0, rowInputs.length - rows.length),
    cellInputs: discardedCellInputs,
  };
  const width = 900;
  const top = 54;
  const left = 250;
  const rowHeight = 40;
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
    discarded,
    projectedCellCount: rows.reduce((sum, row) => sum + row.cells.length, 0),
    truncated: discarded.columnInputs > 0 || discarded.rowInputs > 0 || discarded.cellInputs > 0,
  };
}
