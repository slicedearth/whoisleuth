import type { CaseRecord } from './case-model.ts';
import type { BulkTriageRow } from './bulk-triage.ts';
import type { ScanResult } from './bulk-result-model.ts';
import { RISK_MODEL_VERSION } from './scoring.ts';
import { outreachAction } from '../drafts.ts';

export type BulkPrimaryFilter =
  | 'all'
  | 'available'
  | 'registered'
  | 'high_risk'
  | 'trusted'
  | 'profile_unevaluated'
  | 'errors';

export type BulkPrimaryFilterCounts = Readonly<Record<BulkPrimaryFilter, number>>;

export type BulkRouteFilterSelection = Readonly<{
  filter: BulkPrimaryFilter;
  mutationFilter: string;
  signalFilters: ReadonlySet<string>;
}>;

export type BulkRiskBand = 'elevated' | 'review' | 'lower' | 'inconclusive';

export type BulkRiskComparison = Readonly<{
  modelVersion: number;
  signature: string | null;
  comparableCount: number;
  inconclusiveCount: number;
  totalCount: number;
  summary: string;
}>;

export type BulkRiskPresentation = Readonly<{
  state: 'comparable' | 'inconclusive';
  band: BulkRiskBand;
  label: string;
  summary: string;
  exactScore: number | null;
  modelVersion: number | null;
  modelLabel: string;
  scanDepth: string;
  coverageLabel: string;
  provenanceLabel: string;
  factors: readonly Readonly<{ label: string; points: number }>[];
  limitations: readonly string[];
}>;

export type BulkResultDisplayRow = Readonly<{
  resultIndex: number;
  domain: string;
  shortlisted: boolean;
  unicodeDomain: string;
  mixedScript: boolean;
  referenceMatch: boolean;
  trusted: string;
  profileContextReady: boolean;
  profileContextLimitation: string;
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
  risk: BulkRiskPresentation;
  highRisk: boolean;
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
const INCONCLUSIVE_SOURCE_STATES = new Set(['error', 'partial', 'unavailable']);

type RiskEligibility = Readonly<{
  signature: string | null;
  reason: string;
  coverageLabel: string;
}>;

function exactRiskScore(row: ScanResult): number | null {
  return typeof row.risk === 'number' && Number.isFinite(row.risk) && row.risk >= 0 && row.risk <= 100
    ? row.risk
    : null;
}

function riskModelVersion(row: ScanResult): number | null {
  const value = row.saved.riskModelVersion;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function coverageLabel(row: ScanResult): string {
  return [...row.sourceCoverage]
    .sort((left, right) => left.source.localeCompare(right.source) || left.state.localeCompare(right.state))
    .map((item) => `${item.source} ${item.state.replaceAll('_', ' ')}`)
    .join(' · ') || 'Source states not recorded';
}

function riskEligibility(row: ScanResult): RiskEligibility {
  const coverage = coverageLabel(row);
  if (row.status !== 'complete') return {
    signature: null,
    reason: 'The row did not settle successfully, so its Risk triage is inconclusive.',
    coverageLabel: coverage,
  };
  if (exactRiskScore(row) === null) return {
    signature: null,
    reason: 'No bounded Risk result is available for this row.',
    coverageLabel: coverage,
  };
  const modelVersion = riskModelVersion(row);
  if (modelVersion !== RISK_MODEL_VERSION) return {
    signature: null,
    reason: modelVersion === null
      ? `The retained Risk result has no compatible model version; the current model is v${RISK_MODEL_VERSION}.`
      : `Retained Risk model v${modelVersion} is not comparable with the current model v${RISK_MODEL_VERSION}.`,
    coverageLabel: coverage,
  };
  const profileContext = row.saved.profileContext;
  if (profileContext.sourceState !== 'ready') return {
    signature: null,
    reason: profileContext.limitation || 'Brand Profile provenance is unavailable, so profile-dependent Risk remains inconclusive.',
    coverageLabel: coverage,
  };
  if (!row.sourceCoverage.length) return {
    signature: null,
    reason: 'Source-level coverage was not retained, so this score cannot join a comparable Risk cohort.',
    coverageLabel: coverage,
  };
  const inconclusiveSources = row.sourceCoverage.filter((item) => INCONCLUSIVE_SOURCE_STATES.has(item.state));
  if (inconclusiveSources.length) return {
    signature: null,
    reason: `Risk remains inconclusive because source evidence is partial or unavailable (${inconclusiveSources.map((item) => `${item.source} ${item.state}`).join(', ')}).`,
    coverageLabel: coverage,
  };
  const sourceSignature = [...row.sourceCoverage]
    .sort((left, right) => left.source.localeCompare(right.source) || left.state.localeCompare(right.state))
    .map((item) => `${item.source}:${item.state}`);
  return {
    signature: JSON.stringify([
      modelVersion,
      row.saved.scanDepth,
      profileContext.activeProfileId,
      profileContext.profileUpdatedAt,
      sourceSignature,
    ]),
    reason: '',
    coverageLabel: coverage,
  };
}

export function buildBulkRiskComparison(results: readonly ScanResult[]): BulkRiskComparison {
  const cohorts = new Map<string, number>();
  for (const row of results) {
    const signature = riskEligibility(row).signature;
    if (signature) cohorts.set(signature, (cohorts.get(signature) ?? 0) + 1);
  }
  const selected = [...cohorts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? null;
  const signature = selected?.[0] ?? null;
  const comparableCount = selected?.[1] ?? 0;
  const inconclusiveCount = Math.max(0, results.length - comparableCount);
  const summary = signature
    ? `Risk sorting compares ${comparableCount} of ${results.length} row${results.length === 1 ? '' : 's'} under model v${RISK_MODEL_VERSION}, matching ready Brand Profile provenance, scan depth, and exact source states. ${inconclusiveCount} incompatible or inconclusive row${inconclusiveCount === 1 ? ' sorts' : 's sort'} last.`
    : `No row currently has a comparable Risk result under model v${RISK_MODEL_VERSION} with ready Brand Profile provenance and settled source states. Risk sorting keeps every row inconclusive.`;
  return Object.freeze({
    modelVersion: RISK_MODEL_VERSION,
    signature,
    comparableCount,
    inconclusiveCount,
    totalCount: results.length,
    summary,
  });
}

function riskBand(score: number): Readonly<{ band: Exclude<BulkRiskBand, 'inconclusive'>; label: string; summary: string }> {
  if (score >= 70) return {
    band: 'elevated',
    label: 'Elevated',
    summary: 'Elevated Risk triage priority. Review the attributed factors; this is not a maliciousness determination.',
  };
  if (score >= 40) return {
    band: 'review',
    label: 'Review',
    summary: 'Risk triage indicates review priority. The band is a heuristic, not a finding.',
  };
  return {
    band: 'lower',
    label: 'Lower',
    summary: 'Lower Risk triage is neutral. It does not establish safety, legitimacy, ownership, or absence of concern.',
  };
}

export function buildBulkRiskPresentation(
  row: ScanResult,
  comparison: BulkRiskComparison,
): BulkRiskPresentation {
  const eligibility = riskEligibility(row);
  const score = exactRiskScore(row);
  const modelVersion = riskModelVersion(row);
  const comparable = Boolean(comparison.signature && eligibility.signature === comparison.signature);
  const factors = Object.freeze((Array.isArray(row.saved.riskFactors) ? row.saved.riskFactors : [])
    .slice(0, 40)
    .flatMap((factor) => {
      const points = Number(factor.points);
      if (!Number.isFinite(points)) return [];
      return [Object.freeze({ label: String(factor.label).slice(0, 500), points })];
    }));
  const provenanceLabel = row.saved.profileContext.sourceState === 'ready'
    ? 'Ready Brand Profile provenance'
    : 'Brand Profile provenance unavailable';
  const modelLabel = modelVersion === null ? 'Risk model unavailable' : `Risk model v${modelVersion}`;
  if (!comparable || score === null) {
    const reason = eligibility.reason || 'This row uses different Brand Profile provenance, scan depth, or source states from the current comparable cohort.';
    return Object.freeze({
      state: 'inconclusive' as const,
      band: 'inconclusive' as const,
      label: 'Inconclusive',
      summary: reason,
      exactScore: score,
      modelVersion,
      modelLabel,
      scanDepth: row.saved.scanDepth,
      coverageLabel: eligibility.coverageLabel,
      provenanceLabel,
      factors,
      limitations: Object.freeze([
        reason,
        'The retained exact result remains inspectable when present, but it is excluded from the current Risk sort and high-Risk filter.',
      ]),
    });
  }
  const band = riskBand(score);
  return Object.freeze({
    state: 'comparable' as const,
    band: band.band,
    label: band.label,
    summary: band.summary,
    exactScore: score,
    modelVersion,
    modelLabel,
    scanDepth: row.saved.scanDepth,
    coverageLabel: eligibility.coverageLabel,
    provenanceLabel,
    factors,
    limitations: Object.freeze([
      'Comparable only within the displayed cohort that shares this model, Brand Profile provenance, scan depth, and exact source states.',
      ...(band.band === 'lower'
        ? ['A lower Risk band is not evidence of safety, legitimacy, ownership, or absence of concern.']
        : ['Risk is explainable triage only and does not establish maliciousness, ownership, control, or intent.']),
    ]),
  });
}

export function comparableBulkRiskScore(
  row: ScanResult,
  comparison: BulkRiskComparison,
): number | null {
  const eligibility = riskEligibility(row);
  return comparison.signature && eligibility.signature === comparison.signature
    ? exactRiskScore(row)
    : null;
}

export function matchesBulkRouteFilter(
  row: ScanResult,
  selection: BulkRouteFilterSelection,
  riskComparison: BulkRiskComparison = buildBulkRiskComparison([row]),
): boolean {
  if (selection.filter === 'available' && row.availability !== 'available') return false;
  if (selection.filter === 'registered' && !REGISTERED_STATES.has(row.availability)) return false;
  if (selection.filter === 'high_risk' && ((comparableBulkRiskScore(row, riskComparison) ?? -1) < 70 || Boolean(row.trusted))) return false;
  if (selection.filter === 'trusted' && !row.trusted) return false;
  if (selection.filter === 'profile_unevaluated' && row.saved.profileContext.sourceState === 'ready') return false;
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

export function countBulkRouteFilters(
  results: readonly ScanResult[],
  riskComparison: BulkRiskComparison = buildBulkRiskComparison(results),
): BulkPrimaryFilterCounts {
  const counts: Record<BulkPrimaryFilter, number> = {
    all: results.length,
    available: 0,
    registered: 0,
    high_risk: 0,
    trusted: 0,
    profile_unevaluated: 0,
    errors: 0,
  };
  for (const row of results) {
    if (row.availability === 'available') counts.available += 1;
    if (REGISTERED_STATES.has(row.availability)) counts.registered += 1;
    if ((comparableBulkRiskScore(row, riskComparison) ?? -1) >= 70 && !row.trusted) counts.high_risk += 1;
    if (row.trusted) counts.trusted += 1;
    if (row.saved.profileContext.sourceState !== 'ready') counts.profile_unevaluated += 1;
    if (row.status === 'error') counts.errors += 1;
  }
  return counts;
}

export function toBulkRouteTriageRow(
  row: ScanResult,
  caseRecord: CaseRecord | null,
  caseSourceState: 'ready' | 'unavailable' = 'ready',
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
    caseDisposition: caseSourceState === 'ready' ? caseRecord?.disposition || 'untracked' : 'unavailable',
  };
}

export function buildBulkResultDisplayRows(input: {
  visibleResults: readonly ScanResult[];
  allResults: readonly ScanResult[];
  shortlistedDomains: ReadonlySet<string>;
  caseByDomain: ReadonlyMap<string, CaseRecord>;
  reviewStateByDomain: ReadonlyMap<string, string>;
  mutationLabels: Readonly<Record<string, string>>;
  riskComparison?: BulkRiskComparison;
}): BulkResultDisplayRow[] {
  const riskComparison = input.riskComparison ?? buildBulkRiskComparison(input.allResults);
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
      profileContextReady: row.saved.profileContext.sourceState === 'ready',
      profileContextLimitation: row.saved.profileContext.limitation,
      faviconMatch: row.faviconMatch === true,
      faviconNearMatch: row.faviconNearMatch === true,
      reusesOfficialAssets: row.reusesOfficialAssets === true,
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
      risk: buildBulkRiskPresentation(row, riskComparison),
      highRisk: (comparableBulkRiskScore(row, riskComparison) ?? -1) >= 70 && !row.trusted,
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
