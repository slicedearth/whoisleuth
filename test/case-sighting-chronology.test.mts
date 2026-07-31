import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildCaseSightingChronology,
  MAX_CASE_SIGHTING_CHRONOLOGY_ENTRIES,
} from '../frontend/src/lib/analysis/case-sighting-chronology.ts';
import type { CaseSightingRecord } from '../frontend/src/lib/analysis/case-response-model.ts';

const EARLY = '2026-07-01T00:00:00.000Z';
const LATE = '2026-07-20T00:00:00.000Z';

function sighting(
  overrides: Partial<CaseSightingRecord> = {},
): CaseSightingRecord {
  return {
    id: 'sighting-one',
    state: 'observed_by_deployment',
    sourceClass: 'deployment',
    category: 'delegation',
    source: 'DNS lookup',
    observedAt: EARLY,
    completeness: 'complete',
    evidencePinId: null,
    limitations: [],
    createdAt: EARLY,
    ...overrides,
  };
}

describe('case sighting chronology', () => {
  test('summarizes first and last observations without treating review conclusions as observations', () => {
    const chronology = buildCaseSightingChronology([
      sighting(),
      sighting({
        id: 'sighting-two',
        state: 'analyst_confirmed',
        observedAt: LATE,
        completeness: 'partial',
        limitations: ['The source retained only a bounded answer.'],
      }),
      sighting({
        id: 'sighting-three',
        state: 'not_reproduced',
        observedAt: '2026-07-25T00:00:00.000Z',
        completeness: 'inconclusive',
      }),
    ]);

    assert.equal(chronology.length, 1);
    assert.deepEqual(chronology[0], {
      category: 'delegation',
      sourceClass: 'deployment',
      source: 'DNS lookup',
      firstObservedAt: EARLY,
      lastObservedAt: LATE,
      observationCount: 2,
      states: ['analyst_confirmed', 'observed_by_deployment'],
      completeness: 'partial',
      limitations: ['The source retained only a bounded answer.'],
    });
  });

  test('keeps source classes separate and bounds the derived summary', () => {
    const entries = Array.from(
      { length: MAX_CASE_SIGHTING_CHRONOLOGY_ENTRIES + 10 },
      (_, index) => sighting({
        id: `sighting-${index}`,
        sourceClass: index % 2 ? 'provider' : 'deployment',
        state: index % 2 ? 'reported_by_provider' : 'observed_by_deployment',
        source: `Source ${index}`,
        observedAt: new Date(Date.parse(EARLY) + index * 1_000).toISOString(),
      }),
    );

    const chronology = buildCaseSightingChronology(entries);
    assert.equal(chronology.length, MAX_CASE_SIGHTING_CHRONOLOGY_ENTRIES);
    assert.notEqual(chronology[0]?.source, chronology.at(-1)?.source);
  });
});
