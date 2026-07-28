import type { CaseRecord } from './case-model.ts';
import type { BulkTriageRow } from './bulk-triage.ts';
import type { ScanResult } from './bulk-result-model.ts';
import { outreachAction } from '../drafts.ts';

export type BulkPrimaryFilter =
  | 'all'
  | 'available'
  | 'registered'
  | 'high_risk'
  | 'trusted'
  | 'errors';

export type BulkPrimaryFilterCounts = Readonly<Record<BulkPrimaryFilter, number>>;

export type BulkRouteFilterSelection = Readonly<{
  filter: BulkPrimaryFilter;
  mutationFilter: string;
  signalFilters: ReadonlySet<string>;
}>;

export type BulkResultDisplayRow = Readonly<{
  resultIndex: number;
  domain: string;
  shortlisted: boolean;
  unicodeDomain: string;
  mixedScript: boolean;
  referenceMatch: boolean;
  trusted: string;
  faviconMatch: boolean;
  faviconNearMatch: boolean;
  reusesOfficialAssets: boolean;
  hasPasswordField: boolean;
  phishingLanguageMatch: string;
  ct: Readonly<{
    lastObservedAt: string | null;
    hostnameCount: number;
    certificateCount: number;
  }> | null;
  errorRow: boolean;
  error: string;
  availability: string;
  confidence: string;
  risk: number | null;
  highRisk: boolean;
  riskTitle: string | undefined;
  opportunity: number | null;
  activity: string;
  registrar: string;
  mutationLabel: string;
  reviewState: string;
  caseRecord: Readonly<{ id: string; disposition: string }> | null;
  outreach: Readonly<{ mailto: string; body: string }> | null;
  responseHref: string;
}>;

const REGISTERED_STATES = new Set(['registered', 'for_sale', 'expiring']);

export function matchesBulkRouteFilter(
  row: ScanResult,
  selection: BulkRouteFilterSelection,
): boolean {
  if (selection.filter === 'available' && row.availability !== 'available') return false;
  if (selection.filter === 'registered' && !REGISTERED_STATES.has(row.availability)) return false;
  if (selection.filter === 'high_risk' && ((row.risk ?? -1) < 70 || Boolean(row.trusted))) return false;
  if (selection.filter === 'trusted' && !row.trusted) return false;
  if (selection.filter === 'errors' && row.status !== 'error') return false;
  if (selection.mutationFilter && !row.mutationTypes.includes(selection.mutationFilter)) return false;
  for (const signal of selection.signalFilters) {
    if (signal === 'favicon' && !row.faviconMatch && !row.faviconNearMatch) return false;
    if (signal === 'password' && !row.hasPasswordField) return false;
    if (signal === 'phishing' && !row.phishingLanguageMatch) return false;
    if (signal === 'asset_reuse' && !row.reusesOfficialAssets) return false;
    if (signal === 'idn' && !row.idn?.mixedScript && !row.idn?.referenceMatches?.length) return false;
  }
  return true;
}

export function countBulkRouteFilters(results: readonly ScanResult[]): BulkPrimaryFilterCounts {
  const counts: Record<BulkPrimaryFilter, number> = {
    all: results.length,
    available: 0,
    registered: 0,
    high_risk: 0,
    trusted: 0,
    errors: 0,
  };
  for (const row of results) {
    if (row.availability === 'available') counts.available += 1;
    if (REGISTERED_STATES.has(row.availability)) counts.registered += 1;
    if ((row.risk ?? -1) >= 70 && !row.trusted) counts.high_risk += 1;
    if (row.trusted) counts.trusted += 1;
    if (row.status === 'error') counts.errors += 1;
  }
  return counts;
}

export function toBulkRouteTriageRow(
  row: ScanResult,
  caseRecord: CaseRecord | null,
): BulkTriageRow {
  return {
    domain: row.domain,
    availability: row.availability,
    registrar: row.registrar,
    mutationTypes: row.mutationTypes,
    nameservers: row.nameservers,
    sourceCoverage: row.sourceCoverage,
    createdDate: row.saved.createdDate ?? null,
    hasMx: row.saved.hasMx ?? null,
    hasSpf: row.saved.hasSpf ?? null,
    hasDmarc: row.saved.hasDmarc ?? null,
    caseDisposition: caseRecord?.disposition || 'untracked',
  };
}

function riskTitle(row: ScanResult): string | undefined {
  const factors = Array.isArray(row.saved.riskFactors) ? row.saved.riskFactors : [];
  const lines = factors.map((factor) =>
    `${factor.label} ${Number(factor.points) >= 0 ? '+' : ''}${factor.points}`);
  if (row.saved.riskModelVersion) lines.push(`Risk model v${row.saved.riskModelVersion}`);
  return lines.join('\n') || undefined;
}

export function buildBulkResultDisplayRows(input: {
  visibleResults: readonly ScanResult[];
  allResults: readonly ScanResult[];
  shortlistedDomains: ReadonlySet<string>;
  caseByDomain: ReadonlyMap<string, CaseRecord>;
  reviewStateByDomain: ReadonlyMap<string, string>;
  mutationLabels: Readonly<Record<string, string>>;
}): BulkResultDisplayRow[] {
  return input.visibleResults.map((row) => {
    const caseRecord = input.caseByDomain.get(row.domain) ?? null;
    const outreach = outreachAction(row.domain, row.registrant);
    return {
      resultIndex: input.allResults.indexOf(row),
      domain: row.domain,
      shortlisted: input.shortlistedDomains.has(row.domain),
      unicodeDomain: row.idn?.hasIdn ? String(row.idn.unicodeDomain || '') : '',
      mixedScript: Boolean(row.idn?.mixedScript),
      referenceMatch: Boolean(row.idn?.referenceMatches?.length),
      trusted: row.trusted || '',
      faviconMatch: row.faviconMatch,
      faviconNearMatch: row.faviconNearMatch,
      reusesOfficialAssets: row.reusesOfficialAssets,
      hasPasswordField: row.hasPasswordField,
      phishingLanguageMatch: row.phishingLanguageMatch || '',
      ct: row.ct
        ? {
            lastObservedAt: row.ct.lastObservedAt,
            hostnameCount: row.ct.hostnames.length,
            certificateCount: row.ct.certificateCount,
          }
        : null,
      errorRow: row.status === 'error',
      error: row.error,
      availability: row.availability,
      confidence: row.confidence,
      risk: row.risk,
      highRisk: (row.risk ?? -1) >= 70 && !row.trusted,
      riskTitle: riskTitle(row),
      opportunity: row.opportunity,
      activity: row.activity,
      registrar: row.registrar,
      mutationLabel: row.mutationTypes
        .map((value) => input.mutationLabels[value] || value.replaceAll('_', ' '))
        .join(', ') || '—',
      reviewState: input.reviewStateByDomain.get(row.domain) || 'unreviewed',
      caseRecord: caseRecord ? { id: caseRecord.id, disposition: caseRecord.disposition } : null,
      outreach: outreach ? { mailto: outreach.mailto, body: outreach.body } : null,
      responseHref: row.abuseEvidence && caseRecord
        ? `/monitor?case=${encodeURIComponent(caseRecord.id)}`
        : '',
    };
  });
}
