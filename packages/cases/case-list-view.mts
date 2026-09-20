import { CASE_STATUSES } from './case-record-decisions.mts';
import { caseFreeformTags, caseNumber, caseTypeRecords } from './case-workflow-metadata.mts';
import type { CaseRecord } from './case-record-contracts.mts';
import type { CaseViewFilters } from '../contracts/case-views-contract.mts';

const statusOrder = new Map<string, number>(CASE_STATUSES.map((item, index) => [item.value, index]));

/** Saved and temporary views share the ordinary Case-list query; no collection is implied. */
export function filterCaseList(cases: readonly CaseRecord[], view: CaseViewFilters): CaseRecord[] {
  const term = view.search.trim().toLowerCase();
  return cases.filter(record => {
    if (view.status && record.status !== view.status) return false;
    if (view.disposition && record.disposition !== view.disposition) return false;
    return !term || record.domain.includes(term) || (record.title ?? '').toLowerCase().includes(term)
      || caseNumber(record.id).toLowerCase().includes(term)
      || caseFreeformTags(record.tags).some(tag => tag.toLowerCase().includes(term))
      || caseTypeRecords(record.tags).some(type => type.label.toLowerCase().includes(term));
  }).sort((left, right) => view.sort === 'domain' ? left.domain.localeCompare(right.domain)
    : view.sort === 'status' ? (statusOrder.get(left.status) ?? 99) - (statusOrder.get(right.status) ?? 99) || left.domain.localeCompare(right.domain)
    : Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}
