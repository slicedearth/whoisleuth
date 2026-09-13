/** Optional result columns. Domain identity and actions are always available. */
export const BULK_RESULT_COLUMNS = Object.freeze([
  { id: 'registration', label: 'Registration' },
  { id: 'risk', label: 'Risk' },
  { id: 'website', label: 'Website' },
  { id: 'registrar', label: 'Registrar' },
  { id: 'mutation', label: 'Mutation' },
  { id: 'review', label: 'Review' },
  { id: 'case', label: 'Case' },
] as const);

export type BulkResultColumn = typeof BULK_RESULT_COLUMNS[number]['id'];
export const DEFAULT_BULK_RESULT_COLUMNS: readonly BulkResultColumn[] = Object.freeze(
  BULK_RESULT_COLUMNS.map((column) => column.id),
);

export function normalizeBulkResultColumns(value: unknown): BulkResultColumn[] {
  // Missing choices preserve the full presentation used by public version 1.
  if (!Array.isArray(value)) return [...DEFAULT_BULK_RESULT_COLUMNS];
  return BULK_RESULT_COLUMNS.filter((column) => value.includes(column.id)).map((column) => column.id);
}
