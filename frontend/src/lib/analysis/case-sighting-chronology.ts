import type {
  CasePinCompleteness,
  CaseSightingCategory,
  CaseSightingRecord,
  CaseSightingState,
} from './case-response-model.ts';
import { MAX_CASE_SIGHTINGS } from './case-response-model.ts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';

export const MAX_CASE_SIGHTING_CHRONOLOGY_ENTRIES = MAX_CASE_SIGHTINGS;

const OBSERVATION_STATES = new Set<CaseSightingState>([
  'observed_by_deployment',
  'reported_by_provider',
  'analyst_confirmed',
]);

const COMPLETENESS_PRIORITY: Readonly<Record<CasePinCompleteness, number>> = {
  complete: 0,
  partial: 1,
  inconclusive: 2,
  unknown: 3,
};

export type CaseSightingChronologyEntry = Readonly<{
  category: CaseSightingCategory;
  sourceClass: CaseSightingRecord['sourceClass'];
  source: string;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  undatedCount: number;
  observationCount: number;
  states: readonly CaseSightingState[];
  completeness: CasePinCompleteness;
  limitations: readonly string[];
}>;

type MutableChronologyEntry = {
  category: CaseSightingCategory;
  sourceClass: CaseSightingRecord['sourceClass'];
  source: string;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  undatedCount: number;
  observationCount: number;
  states: Set<CaseSightingState>;
  completeness: CasePinCompleteness;
  limitations: Set<string>;
};

function chronologyKey(sighting: CaseSightingRecord): string {
  return `${sighting.category}\u0000${sighting.sourceClass}\u0000${sighting.source.toLocaleLowerCase('en')}`;
}

function lessComplete(
  left: CasePinCompleteness,
  right: CasePinCompleteness,
): CasePinCompleteness {
  return COMPLETENESS_PRIORITY[right] > COMPLETENESS_PRIORITY[left] ? right : left;
}

export function buildCaseSightingChronology(
  sightings: readonly CaseSightingRecord[],
): CaseSightingChronologyEntry[] {
  const grouped = new Map<string, MutableChronologyEntry>();

  for (const sighting of sightings.slice(-MAX_CASE_SIGHTINGS)) {
    if (!OBSERVATION_STATES.has(sighting.state)) continue;
    const observedAt = normalizeExplicitIsoTimestamp(sighting.observedAt);
    const key = chronologyKey(sighting);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        category: sighting.category,
        sourceClass: sighting.sourceClass,
        source: sighting.source,
        firstObservedAt: observedAt,
        lastObservedAt: observedAt,
        undatedCount: observedAt === null ? 1 : 0,
        observationCount: 1,
        states: new Set([sighting.state]),
        completeness: sighting.completeness,
        limitations: new Set(sighting.limitations.slice(0, 8)),
      });
      continue;
    }

    if (observedAt && (!existing.firstObservedAt || observedAt < existing.firstObservedAt)) {
      existing.firstObservedAt = observedAt;
    }
    if (observedAt && (!existing.lastObservedAt || observedAt > existing.lastObservedAt)) {
      existing.lastObservedAt = observedAt;
    }
    if (!observedAt) existing.undatedCount += 1;
    existing.observationCount += 1;
    existing.states.add(sighting.state);
    existing.completeness = lessComplete(existing.completeness, sighting.completeness);
    for (const limitation of sighting.limitations) {
      if (existing.limitations.size >= 8) break;
      existing.limitations.add(limitation);
    }
  }

  return [...grouped.values()]
    .sort((left, right) =>
      Number(left.lastObservedAt === null) - Number(right.lastObservedAt === null)
      || (right.lastObservedAt ?? '').localeCompare(left.lastObservedAt ?? '')
      || left.category.localeCompare(right.category)
      || left.source.localeCompare(right.source))
    .slice(0, MAX_CASE_SIGHTING_CHRONOLOGY_ENTRIES)
    .map((entry) => ({
      ...entry,
      states: [...entry.states].sort(),
      limitations: [...entry.limitations],
    }));
}
