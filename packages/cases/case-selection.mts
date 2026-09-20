import { normalizeDomain } from '../evidence/domain-name.mts';
import type { CaseRecord } from './case-record-contracts.mts';

export type CaseOpenSelection = Readonly<{ caseId?: string; newIncident?: boolean }>;
export class CaseSelectionError extends Error {
  constructor(message: string) { super(message); this.name = 'CaseSelectionError'; }
}

export function casesForDomain(records: readonly CaseRecord[], value: unknown): CaseRecord[] {
  const domain = normalizeDomain(value);
  return domain ? records.filter(record => record.domain === domain) : [];
}

export function casesForDomains(records: readonly CaseRecord[], domains: readonly string[]): CaseRecord[] {
  const selected = new Set(domains.map(normalizeDomain).filter(Boolean));
  return records.filter(record => selected.has(record.domain));
}

/** A domain pivot cannot choose between independent analyst investigations. */
export function selectExistingCase(records: readonly CaseRecord[], domain: string, selection: CaseOpenSelection = {}): CaseRecord | null {
  if (selection.newIncident && selection.caseId) throw new CaseSelectionError('Choose an existing Case or create a new incident, not both.');
  if (selection.newIncident) return null;
  const matches = casesForDomain(records, domain);
  if (selection.caseId) {
    const selected = matches.find(record => record.id === selection.caseId);
    if (!selected) throw new CaseSelectionError('The selected Case is no longer available for this domain. No data was changed.');
    return selected;
  }
  if (matches.length > 1) throw new CaseSelectionError(`Several Cases use ${domain}. Select the intended incident before saving evidence or decisions.`);
  return matches[0] ?? null;
}

/** Only explicit or unambiguous selections may carry Case decisions into a domain view. */
export function selectedCasesByDomain(records: readonly CaseRecord[], selections: ReadonlyMap<string, string> = new Map()): Map<string, CaseRecord> {
  const grouped = new Map<string, CaseRecord[]>();
  for (const record of records) {
    const group = grouped.get(record.domain) ?? [];
    group.push(record);
    grouped.set(record.domain, group);
  }
  const selected = new Map<string, CaseRecord>();
  for (const [domain, group] of grouped) {
    const id = selections.get(domain);
    const record = id ? group.find(item => item.id === id) : group.length === 1 ? group[0] : undefined;
    if (record) selected.set(domain, record);
  }
  return selected;
}
