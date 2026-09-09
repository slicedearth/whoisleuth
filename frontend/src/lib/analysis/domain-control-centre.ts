import type { BrandProfile, DesiredPostureBaseline } from './brand-profile-model.ts';
import { brandPostureObservationContext, currentDesiredPostureObservation, desiredPostureObservations } from './brand-profile-model.ts';
import { buildDesiredPostureComparisonsFromObservation } from './owned-domain-posture-review.ts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';
import { domainControlRecordMode } from '../../../../packages/evidence/domain-control-runtime.mts';
import { DOMAIN_CONTROL_RECORD_LIST_FIELDS } from '../../../../packages/contracts/domain-control-manifest.mts';

export type DomainControlCentreRow = Readonly<{
  domain: string;
  baseline: DesiredPostureBaseline | null;
  baselineFields: number;
  latestObservationAt: string | null;
  observationLimitation: string | null;
  nameserverPreflight: 'aligned' | 'configured' | 'drift' | 'incomplete' | 'not_configured' | 'observed';
  activeWindow: DesiredPostureBaseline['approvedChangeWindows'][number] | null;
  nextWindow: DesiredPostureBaseline['approvedChangeWindows'][number] | null;
}>;

export type DomainControlConcentration = Readonly<{
  kind: 'nameserver_set' | 'recovery_dependency';
  label: string;
  domains: readonly string[];
}>;

export type DomainControlCentre = Readonly<{
  rows: readonly DomainControlCentreRow[];
  concentrations: readonly DomainControlConcentration[];
  counts: Readonly<{
    domains: number;
    baselines: number;
    retainedObservations: number;
    plannedOrActiveChanges: number;
    retiringOrRetired: number;
  }>;
}>;

function nameserverPreflight(profile: BrandProfile, baseline: DesiredPostureBaseline | null, now: string): DomainControlCentreRow['nameserverPreflight'] {
  if (!baseline) return 'not_configured';
  if (domainControlRecordMode(baseline, 'nameservers') === 'unconfigured') return 'not_configured';
  if (!desiredPostureObservations(baseline).length) return 'configured';
  const latest = currentDesiredPostureObservation(baseline);
  const comparison = buildDesiredPostureComparisonsFromObservation(baseline, latest.observation, now, {
    context: brandPostureObservationContext(profile, baseline.domain), limitation: latest.limitation,
  }).find((item) => item.field === 'nameservers');
  return comparison?.state === 'aligned' ? 'aligned' : comparison?.state === 'drift' ? 'drift' : comparison?.state === 'observed' ? 'observed' : 'incomplete';
}

function baselineFieldCount(baseline: DesiredPostureBaseline): number {
  return [
    ...DOMAIN_CONTROL_RECORD_LIST_FIELDS.map((field) => domainControlRecordMode(baseline, field) !== 'unconfigured'),
    baseline.tlsIssuer,
    baseline.tlsSanPatterns.length,
    baseline.tlsSpkiSha256,
    baseline.registrarLock !== 'unconfigured',
    baseline.renewalReviewAt,
    baseline.zoneIntent !== 'unconfigured',
    baseline.recoveryDependency,
  ].filter(Boolean).length;
}

function concentrationGroups(profile: BrandProfile): DomainControlConcentration[] {
  const groups = new Map<string, { kind: DomainControlConcentration['kind']; label: string; domains: string[] }>();
  for (const baseline of profile.desiredPostureBaselines) {
    if (baseline.nameservers.length) {
      const label = [...baseline.nameservers].sort().join(' · ');
      const key = `nameserver_set:${label.toLowerCase()}`;
      const group = groups.get(key) ?? { kind: 'nameserver_set', label, domains: [] };
      group.domains.push(baseline.domain);
      groups.set(key, group);
    }
    if (baseline.recoveryDependency) {
      const label = baseline.recoveryDependency;
      const key = `recovery_dependency:${label.toLowerCase()}`;
      const group = groups.get(key) ?? { kind: 'recovery_dependency', label, domains: [] };
      group.domains.push(baseline.domain);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .filter((group) => group.domains.length > 1)
    .sort((left, right) => right.domains.length - left.domains.length || left.label.localeCompare(right.label));
}

export function buildDomainControlCentre(profile: BrandProfile, nowValue = new Date().toISOString()): DomainControlCentre {
  const now = Date.parse(normalizeExplicitIsoTimestamp(nowValue) ?? '');
  const rows = profile.officialDomains.map((domain) => {
    const baseline = profile.desiredPostureBaselines.find((item) => item.domain === domain) ?? null;
    const windows = [...(baseline?.approvedChangeWindows ?? [])].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const activeWindow = windows.find((window) => Date.parse(window.startsAt) <= now && now <= Date.parse(window.endsAt)) ?? null;
    const nextWindow = windows.find((window) => Date.parse(window.startsAt) > now) ?? null;
    const latest = baseline ? currentDesiredPostureObservation(baseline) : null;
    return Object.freeze({
      domain,
      baseline,
      baselineFields: baseline ? baselineFieldCount(baseline) : 0,
      latestObservationAt: latest?.observation?.observedAt ?? null,
      observationLimitation: latest?.limitation ?? null,
      nameserverPreflight: nameserverPreflight(profile, baseline, nowValue),
      activeWindow,
      nextWindow,
    });
  });
  return Object.freeze({
    rows: Object.freeze(rows),
    concentrations: Object.freeze(concentrationGroups(profile)),
    counts: Object.freeze({
      domains: rows.length,
      baselines: rows.filter((row) => row.baseline).length,
      retainedObservations: rows.filter((row) => row.baseline && desiredPostureObservations(row.baseline).length).length,
      plannedOrActiveChanges: rows.filter((row) => row.activeWindow || row.nextWindow || row.baseline?.lifecycle === 'change_planned').length,
      retiringOrRetired: rows.filter((row) => row.baseline?.lifecycle === 'retiring' || row.baseline?.lifecycle === 'retired').length,
    }),
  });
}
