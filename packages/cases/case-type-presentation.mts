import type { CaseRecord } from './case-record-contracts.mts';
import { caseTypeRecords } from './case-workflow-metadata.mts';

/** Display text for declared Case types; admission and mutation remain separate. */
export function caseTypeSummary(record: Pick<CaseRecord, 'workflowMetadata'>): string {
  const labels = caseTypeRecords(record).map((item) => item.label);
  if (!labels.length) return '';
  if (labels.length <= 2) return labels.join(' and ');
  return `${labels.slice(0, 2).join(', ')} and ${labels.length - 2} more`;
}
