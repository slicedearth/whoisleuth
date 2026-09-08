import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test } from 'node:test';

import {
  PRODUCTION_COVERAGE_EXCLUSIONS,
  PRODUCTION_COVERAGE_POLICY,
  parseProductionCoverage,
  productionCoverageArguments,
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
  test('native instrumentation discovers ordinary modules and excludes generated code in any package', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whoisleuth-coverage-boundary-'));
    try {
      const modules = [
        'lib/ordinary.mts', 'packages/example/ordinary.mts',
        'packages/example/generated/catalogue.mts', 'packages/example/catalogue.generated.mts',
        'frontend/src/lib/generated/catalogue.ts', 'lib/catalogue.generated.ts',
      ];
      for (const filename of modules) {
        await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
        await writeFile(path.join(root, filename), 'export const ready = true;\n');
      }
      await mkdir(path.join(root, 'test'));
      await writeFile(path.join(root, 'test/probe.test.mts'), [
        "import assert from 'node:assert/strict';",
        "import { test } from 'node:test';",
        ...modules.map((filename, index) => `import { ready as value${index} } from '../${filename}';`),
        `test('fixture modules execute', () => assert.ok([${modules.map((_, index) => `value${index}`).join(',')}].every(Boolean)));`,
      ].join('\n'));
      // This is a separate test-runner invocation, not a worker in the parent
      // run. The inherited worker marker prevents a recursive test run.
      const environment = { ...process.env };
      delete environment.NODE_TEST_CONTEXT;
      delete environment.NODE_V8_COVERAGE;
      await promisify(execFile)(process.execPath, productionCoverageArguments('test/probe.test.mts'), {
        cwd: root, env: environment, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
      });
      const report = parseProductionCoverage(await readFile(path.join(root, 'test-coverage.lcov'), 'utf8'));
      assert.deepEqual(report.records.map((record) => record.source).sort(), [
        'lib/ordinary.mts', 'packages/example/ordinary.mts',
      ]);
      assert.equal(report.global.lines.percentage, 100);
      for (const filename of modules.slice(2)) {
        assert.throws(() => parseProductionCoverage(lcovRecord(filename)), /Generated source/u);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('retains explicit browser owners and coverage floors for critical production paths', () => {
    assert.deepEqual(PRODUCTION_COVERAGE_POLICY.criticalFiles['cli/discriminated-command-handlers.mts'], {
      lines: 100, branches: 100, functions: 100,
    });
    assert.deepEqual(PRODUCTION_COVERAGE_POLICY.criticalFiles['cli/assurance-command-runner.mts'], {
      lines: 90, branches: 60, functions: 100,
    });
    assert.deepEqual(PRODUCTION_COVERAGE_POLICY.criticalFiles['cli/evidence-command-runner.mts'], {
      lines: 90, branches: 75, functions: 100,
    });
    assert.deepEqual(PRODUCTION_COVERAGE_POLICY.criticalFiles['cli/review-command-runner.mts'], {
      lines: 95, branches: 50, functions: 80,
    });
    assert.deepEqual(PRODUCTION_COVERAGE_POLICY.criticalFiles['cli/workflow-command-runner.mts'], {
      lines: 95, branches: 65, functions: 100,
    });
    assert.deepEqual(PRODUCTION_COVERAGE_POLICY.criticalFiles['cli/lookup-browser-view.mts'], {
      lines: 95, branches: 75, functions: 100,
    });
    assert.deepEqual(PRODUCTION_COVERAGE_POLICY.criticalFiles['cli/formatters/terminal-lookup.mts'], {
      lines: 95, branches: 85, functions: 100,
    });
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
    assert.deepEqual(PRODUCTION_COVERAGE_POLICY.criticalFiles['packages/investigation/investigation-capsule.mts'], {
      lines: 98, branches: 75, functions: 100,
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
