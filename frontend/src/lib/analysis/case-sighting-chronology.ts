import type {
  CasePinCompleteness,
  CaseSightingCategory,
  CaseSightingRecord,
  CaseSightingState,
} from './case-response-model.ts';

export const MAX_CASE_SIGHTING_CHRONOLOGY_ENTRIES = 40;

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
  firstObservedAt: string;
  lastObservedAt: string;
  observationCount: number;
  states: readonly CaseSightingState[];
  completeness: CasePinCompleteness;
  limitations: readonly string[];
}>;

type MutableChronologyEntry = {
  category: CaseSightingCategory;
  sourceClass: CaseSightingRecord['sourceClass'];
  source: string;
  firstObservedAt: string;
  lastObservedAt: string;
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

  for (const sighting of sightings.slice(-80)) {
    if (!OBSERVATION_STATES.has(sighting.state)) continue;
    const key = chronologyKey(sighting);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        category: sighting.category,
        sourceClass: sighting.sourceClass,
        source: sighting.source,
        firstObservedAt: sighting.observedAt,
        lastObservedAt: sighting.observedAt,
        observationCount: 1,
        states: new Set([sighting.state]),
        completeness: sighting.completeness,
        limitations: new Set(sighting.limitations.slice(0, 8)),
      });
      continue;
    }

    if (sighting.observedAt < existing.firstObservedAt) {
      existing.firstObservedAt = sighting.observedAt;
    }
    if (sighting.observedAt > existing.lastObservedAt) {
      existing.lastObservedAt = sighting.observedAt;
    }
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
      right.lastObservedAt.localeCompare(left.lastObservedAt)
      || left.category.localeCompare(right.category)
      || left.source.localeCompare(right.source))
    .slice(0, MAX_CASE_SIGHTING_CHRONOLOGY_ENTRIES)
    .map((entry) => ({
      ...entry,
      states: [...entry.states].sort(),
      limitations: [...entry.limitations],
    }));
}
