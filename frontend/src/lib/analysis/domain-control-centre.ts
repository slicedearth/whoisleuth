import type { BrandProfile, DesiredPostureBaseline } from './brand-profile-model.ts';

export type DomainControlCentreRow = Readonly<{
  domain: string;
  baseline: DesiredPostureBaseline | null;
  baselineFields: number;
  latestObservationAt: string | null;
  nameserverPreflight: 'aligned' | 'configured' | 'drift' | 'incomplete' | 'not_configured';
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

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  const normalise = (values: readonly string[]) => [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
  const a = normalise(left);
  const b = normalise(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function nameserverPreflight(baseline: DesiredPostureBaseline | null): DomainControlCentreRow['nameserverPreflight'] {
  if (!baseline) return 'not_configured';
  if (!baseline.nameservers.length) return 'incomplete';
  const latest = baseline.observationHistory?.at(-1) ?? baseline.previousObservation;
  if (!latest) return 'configured';
  const observed = latest.checks.find((check) => check.id === 'nameservers');
  if (!observed || observed.status === 'info' || !observed.records.length) return 'incomplete';
  return sameValues(baseline.nameservers, observed.records) ? 'aligned' : 'drift';
}

function baselineFieldCount(baseline: DesiredPostureBaseline): number {
  return [
    baseline.nameservers.length,
    baseline.ds.length,
    baseline.mx.length,
    baseline.caa.length,
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
  const now = Date.parse(nowValue);
  const rows = profile.officialDomains.map((domain) => {
    const baseline = profile.desiredPostureBaselines.find((item) => item.domain === domain) ?? null;
    const windows = baseline?.approvedChangeWindows ?? [];
    const activeWindow = windows.find((window) => Date.parse(window.startsAt) <= now && now <= Date.parse(window.endsAt)) ?? null;
    const nextWindow = windows.find((window) => Date.parse(window.startsAt) > now) ?? null;
    const latest = baseline?.observationHistory?.at(-1) ?? baseline?.previousObservation ?? null;
    return Object.freeze({
      domain,
      baseline,
      baselineFields: baseline ? baselineFieldCount(baseline) : 0,
      latestObservationAt: latest?.observedAt ?? null,
      nameserverPreflight: nameserverPreflight(baseline),
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
      retainedObservations: rows.filter((row) => row.latestObservationAt).length,
      plannedOrActiveChanges: rows.filter((row) => row.activeWindow || row.nextWindow || row.baseline?.lifecycle === 'change_planned').length,
      retiringOrRetired: rows.filter((row) => row.baseline?.lifecycle === 'retiring' || row.baseline?.lifecycle === 'retired').length,
    }),
  });
}
