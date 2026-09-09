import {
  MAX_DESIRED_POSTURE_BASELINES,
  brandPostureObservationContext,
  currentDesiredPostureObservation,
  desiredPostureObservations,
  type BrandProfile,
  type DesiredPostureBaseline,
  type DesiredPostureObservation,
} from './brand-profile-model.ts';
import {
  buildDesiredPostureComparisonsFromObservation,
  DESIRED_POSTURE_COMPARISON_FIELDS,
  DESIRED_POSTURE_FIELD_LABELS,
  type DesiredPostureComparison,
  type DesiredPostureComparisonField,
} from './owned-domain-posture-review.ts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';
import { MAX_POSTURE_CHECKS, MAX_POSTURE_CHECK_RECORDS } from '../../../../packages/evidence/domain-posture-context.mts';

export const DOMAIN_POSTURE_MATRIX_VERSION = 1;

export type DomainPostureMatrixState = DesiredPostureComparison['state'];

export type DomainPostureMatrixCell = Readonly<{
  field: DesiredPostureComparisonField;
  label: string;
  state: DomainPostureMatrixState;
  explanation: string;
  desired: readonly string[];
  observed: readonly string[];
  suppressionReason: string;
  approvedWindowSummary: string;
  baselineHref: string;
  observationHref: string | null;
}>;

export type DomainPostureMatrixRow = Readonly<{
  domain: string;
  baselineConfigured: boolean;
  baselineUpdatedAt: string | null;
  observationAt: string | null;
  observationId: string | null;
  lifecycle: DesiredPostureBaseline['lifecycle'] | 'unconfigured';
  zoneIntent: DesiredPostureBaseline['zoneIntent'];
  cells: readonly DomainPostureMatrixCell[];
  observationChecks: readonly Readonly<{
    id: string;
    status: DesiredPostureObservation['checks'][number]['status'];
    records: readonly string[];
  }>[];
}>;

export type DomainPostureMatrix = Readonly<{
  version: typeof DOMAIN_POSTURE_MATRIX_VERSION;
  generatedAt: string;
  columns: readonly Readonly<{ field: DesiredPostureComparisonField; label: string }>[];
  rows: readonly DomainPostureMatrixRow[];
  stateCounts: Readonly<Record<DomainPostureMatrixState, number>>;
  baselineCount: number;
  observationCount: number;
  incomplete: boolean;
  limitations: readonly string[];
}>;

const STATES: readonly DomainPostureMatrixState[] = Object.freeze([
  'aligned',
  'approved_window',
  'drift',
  'not_configured',
  'review',
  'suppressed',
  'unavailable',
  'unknown',
  'unsupported',
]);

function baselineHref(domain: string): string {
  return `/brands?baseline=${encodeURIComponent(domain)}#desired-posture-baseline`;
}

export function retainedPostureObservationId(domain: string): string {
  return `retained-posture-observation-${encodeURIComponent(domain)}`;
}

function unconfiguredCell(domain: string, field: DesiredPostureComparisonField): DomainPostureMatrixCell {
  return Object.freeze({
    field,
    label: DESIRED_POSTURE_FIELD_LABELS[field],
    state: 'not_configured',
    explanation: 'No analyst-authored desired posture baseline is configured for this official domain.',
    desired: Object.freeze([]),
    observed: Object.freeze([]),
    suppressionReason: '',
    approvedWindowSummary: '',
    baselineHref: baselineHref(domain),
    observationHref: null,
  });
}

function comparisonCell(
  domain: string,
  comparison: DesiredPostureComparison,
  hasObservation: boolean,
): DomainPostureMatrixCell {
  return Object.freeze({
    ...comparison,
    desired: Object.freeze([...comparison.desired]),
    observed: Object.freeze([...comparison.observed]),
    baselineHref: baselineHref(domain),
    observationHref: hasObservation ? `#${retainedPostureObservationId(domain)}` : null,
  });
}

export function buildDomainPostureMatrix(
  profile: BrandProfile,
  now: unknown = new Date().toISOString(),
): DomainPostureMatrix {
  const generatedAt = normalizeExplicitIsoTimestamp(now) ?? '';
  const baselines = new Map(
    profile.desiredPostureBaselines
      .slice(0, MAX_DESIRED_POSTURE_BASELINES)
      .map((baseline) => [baseline.domain, baseline]),
  );
  const domains = [...new Set(profile.officialDomains.slice(0, MAX_DESIRED_POSTURE_BASELINES))].sort();
  const rows = domains.map((domain): DomainPostureMatrixRow => {
    const baseline = baselines.get(domain) ?? null;
    if (!baseline) {
      return Object.freeze({
        domain,
        baselineConfigured: false,
        baselineUpdatedAt: null,
        observationAt: null,
        observationId: null,
        lifecycle: 'unconfigured',
        zoneIntent: 'unconfigured',
        cells: Object.freeze(DESIRED_POSTURE_COMPARISON_FIELDS.map((field) => unconfiguredCell(domain, field))),
        observationChecks: Object.freeze([]),
      });
    }
    const latest = currentDesiredPostureObservation(baseline);
    const observation = latest.observation;
    const hasObservation = desiredPostureObservations(baseline).length > 0;
    const comparisons = new Map(
      buildDesiredPostureComparisonsFromObservation(baseline, observation, generatedAt, {
        context: brandPostureObservationContext(profile, domain), limitation: latest.limitation,
      })
        .map((comparison) => [comparison.field, comparison]),
    );
    return Object.freeze({
      domain,
      baselineConfigured: true,
      baselineUpdatedAt: baseline.updatedAt,
      observationAt: observation?.observedAt ?? null,
      observationId: hasObservation ? retainedPostureObservationId(domain) : null,
      lifecycle: baseline.lifecycle,
      zoneIntent: baseline.zoneIntent,
      cells: Object.freeze(DESIRED_POSTURE_COMPARISON_FIELDS.map((field) => {
        const comparison = comparisons.get(field);
        return comparison ? comparisonCell(domain, comparison, hasObservation) : unconfiguredCell(domain, field);
      })),
      observationChecks: Object.freeze((observation?.checks ?? []).slice(0, MAX_POSTURE_CHECKS).map((check) => Object.freeze({
        id: check.id,
        status: check.status,
        records: Object.freeze(check.records.slice(0, MAX_POSTURE_CHECK_RECORDS)),
      }))),
    });
  });
  const stateCounts = Object.fromEntries(STATES.map((state) => [
    state,
    rows.flatMap((row) => row.cells).filter((cell) => cell.state === state).length,
  ])) as Record<DomainPostureMatrixState, number>;
  const baselineCount = rows.filter((row) => row.baselineConfigured).length;
  const observationCount = rows.filter((row) => row.observationId).length;
  return Object.freeze({
    version: DOMAIN_POSTURE_MATRIX_VERSION,
    generatedAt,
    columns: Object.freeze(DESIRED_POSTURE_COMPARISON_FIELDS.map((field) => Object.freeze({
      field,
      label: DESIRED_POSTURE_FIELD_LABELS[field],
    }))),
    rows: Object.freeze(rows),
    stateCounts: Object.freeze(stateCounts),
    baselineCount,
    observationCount,
    incomplete: baselineCount < rows.length || observationCount < baselineCount || stateCounts.unknown > 0 || stateCounts.unavailable > 0 || stateCounts.unsupported > 0,
    limitations: Object.freeze([
      'This matrix projects analyst-authored desired state and retained compact posture observations only. It performs no request and makes no uptime, ownership, control, or continuous-monitoring claim.',
      'Unavailable, unknown, unsupported, suppressed, and approved-window states remain distinct. They are never converted into alignment or proof that a configuration is safe.',
      'Each cell links to the selected local baseline and retained source records. Equal or unknown capture times cannot establish a unique latest observation.',
      ...(!generatedAt ? ['The matrix review time is unavailable.'] : []),
    ]),
  });
}
