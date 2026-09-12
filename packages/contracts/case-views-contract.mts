import type { CaseDisposition, CaseStatus } from '../cases/case-record-decisions.mts';

export const CASE_VIEWS_SCHEMA = 'whoisleuth.case-views';
export const CASE_VIEWS_VERSION = 1;
export const MAX_CASE_VIEWS = 100;
export const MAX_CASE_VIEW_NAME_LENGTH = 80;
export const MAX_CASE_VIEW_SEARCH_LENGTH = 512;
// Accommodates 100 views with maximum-length Unicode names and search text.
export const MAX_CASE_VIEWS_BYTES = 512 * 1024;
export const CASE_VIEW_SORTS = Object.freeze([
  { value: 'updated', label: 'Recently updated' },
  { value: 'domain', label: 'Domain' },
  { value: 'status', label: 'Status' },
] as const);
export type CaseViewSort = typeof CASE_VIEW_SORTS[number]['value'];
export type CaseViewFilters = Readonly<{
  status: CaseStatus | '';
  disposition: CaseDisposition | '';
  search: string;
  sort: CaseViewSort;
}>;
export type SavedCaseView = Readonly<{
  id: string;
  name: string;
  filters: CaseViewFilters;
  createdAt: string;
  updatedAt: string;
}>;
export type CaseViewsStore = Readonly<{
  schema: typeof CASE_VIEWS_SCHEMA;
  version: typeof CASE_VIEWS_VERSION;
  views: readonly SavedCaseView[];
}>;
