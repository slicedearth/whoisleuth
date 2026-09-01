import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  PRODUCTION_COVERAGE_POLICY,
  parseProductionCoverage,
  validateProductionCoverage,
  validateProductionCoverageInventory,
  type CoveragePolicy,
} from '../tools/production-coverage.mts';

function lcovRecord(source: string, values = [10, 9, 8, 6, 5, 5]): string {
  const [linesFound, linesHit, branchesFound, branchesHit, functionsFound, functionsHit] = values;
  return [
    `SF:${source}`,
    `FNF:${functionsFound}`,
    `FNH:${functionsHit}`,
    `BRF:${branchesFound}`,
    `BRH:${branchesHit}`,
    `LF:${linesFound}`,
    `LH:${linesHit}`,
    'end_of_record',
  ].join('\n');
}

const FOCUSED_COVERAGE_POLICY: CoveragePolicy = Object.freeze({
  global: Object.freeze({ lines: 80, branches: 70, functions: 90 }),
  criticalFiles: Object.freeze({
    'lib/critical.mts': Object.freeze({ lines: 90, branches: 75, functions: 100 }),
  }),
  requiredAreas: Object.freeze(['shared runtime', 'CLI']),
});

describe('production coverage policy', () => {
  test('retains explicit floors for browser-local mutation, analyst actions, and Lookup projections', () => {
    assert.deepEqual(PRODUCTION_COVERAGE_POLICY.criticalFiles['frontend/src/lib/browser-local-data.ts'], {
      lines: 80, branches: 65, functions: 75,
    });
    assert.deepEqual(PRODUCTION_COVERAGE_POLICY.criticalFiles['frontend/src/lib/controllers/lookup-case-controller.ts'], {
      lines: 95, branches: 90, functions: 95,
    });
    assert.deepEqual(PRODUCTION_COVERAGE_POLICY.criticalFiles['frontend/src/lib/analysis/brand-profile-signals.ts'], {
      lines: 95, branches: 90, functions: 100,
    });
    assert.deepEqual(PRODUCTION_COVERAGE_POLICY.criticalFiles['frontend/src/lib/analysis/lookup-dns-display.ts'], {
      lines: 95, branches: 80, functions: 100,
    });
    assert.deepEqual(PRODUCTION_COVERAGE_POLICY.criticalFiles['frontend/src/lib/analysis/lookup-tls-display.ts'], {
      lines: 95, branches: 85, functions: 100,
    });
    assert.deepEqual(PRODUCTION_COVERAGE_POLICY.criticalFiles['frontend/src/lib/analysis/lookup-page-profile-display.ts'], {
      lines: 95, branches: 70, functions: 100,
    });
  });

  test('aggregates executable records and enforces global, ownership-area, and critical-file thresholds', () => {
    const report = parseProductionCoverage([
      lcovRecord('lib/critical.mts', [10, 9, 8, 6, 5, 5]),
      lcovRecord('cli/runner.mts', [10, 8, 8, 6, 5, 4]),
    ].join('\n'));

    assert.equal(report.records.length, 2);
    assert.equal(report.global.lines.percentage, 85);
    assert.equal(report.global.branches.percentage, 75);
    assert.equal(report.global.functions.percentage, 90);
    assert.doesNotThrow(() => validateProductionCoverage(report, FOCUSED_COVERAGE_POLICY));
  });

  test('rejects missing runtime areas and critical files independently of the global result', () => {
    const report = parseProductionCoverage(lcovRecord('lib/other.mts', [10, 10, 8, 8, 5, 5]));
    assert.throws(() => validateProductionCoverage(report, FOCUSED_COVERAGE_POLICY), /missing maintained runtime areas: CLI/u);

    const noCriticalPolicy = Object.freeze({ ...FOCUSED_COVERAGE_POLICY, requiredAreas: Object.freeze(['shared runtime']) });
    assert.throws(() => validateProductionCoverage(report, noCriticalPolicy), /missing critical source lib\/critical\.mts/u);
  });

  test('rejects generated, unsafe, duplicate, truncated, and inconsistent records', () => {
    assert.throws(() => parseProductionCoverage(lcovRecord('lib/generated/catalogue.mts')), /Generated source/u);
    assert.throws(() => parseProductionCoverage(lcovRecord('../outside.mts')), /unsafe source path/u);
    assert.throws(() => parseProductionCoverage(`${lcovRecord('lib/a.mts')}\n${lcovRecord('lib/a.mts')}`), /must be unique/u);
    assert.throws(() => parseProductionCoverage(lcovRecord('lib/a.mts').replace('end_of_record', '')), /ended before/u);
    assert.throws(() => parseProductionCoverage(lcovRecord('lib/a.mts', [10, 11, 8, 6, 5, 5])), /hits no greater/u);
  });

  test('fails each retained threshold instead of rounding a near miss up', () => {
    const report = parseProductionCoverage([
      lcovRecord('lib/critical.mts', [10, 9, 8, 5, 5, 5]),
      lcovRecord('cli/runner.mts', [10, 8, 8, 8, 5, 5]),
    ].join('\n'));
    assert.throws(() => validateProductionCoverage(report, FOCUSED_COVERAGE_POLICY), /critical\.mts branch coverage is 62\.50%; required 75\.00%/u);
  });

  test('closes the complete source inventory with explicit, owned non-unit exclusions', () => {
    const report = parseProductionCoverage([
      lcovRecord('lib/critical.mts'),
      lcovRecord('cli/runner.mts'),
    ].join('\n'));
    const exclusion = Object.freeze({
      source: 'frontend/src/lib/browser-adapter.ts',
      category: 'browser_adapter' as const,
      owner: 'e2e/browser-adapter.spec.ts',
    });
    const inventory = ['cli/runner.mts', 'frontend/src/lib/browser-adapter.ts', 'lib/critical.mts'];
    assert.deepEqual(
      validateProductionCoverageInventory(report, inventory, [exclusion], () => true),
      {
        sourceFiles: 3,
        measuredFiles: 2,
        excludedFiles: 1,
        exclusionsByCategory: {
          type_only: 0,
          compatibility_re_export: 0,
          browser_adapter: 1,
          framework_entry: 0,
          executable_entry: 0,
        },
      },
    );
    assert.throws(
      () => validateProductionCoverageInventory(report, inventory, [], () => true),
      /unreviewed source omissions/u,
    );
    assert.throws(
      () => validateProductionCoverageInventory(report, inventory, [{ ...exclusion, source: 'cli/runner.mts' }], () => true),
      /exclusions are now measured/u,
    );
    assert.throws(
      () => validateProductionCoverageInventory(report, inventory, [exclusion], () => false),
      /exclusion owner is missing/u,
    );
  });
});
