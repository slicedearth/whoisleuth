import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test } from 'node:test';

import {
  PRODUCTION_COVERAGE_EXCLUSIONS,
  PRODUCTION_COVERAGE_POLICY,
  discoverForwardingCoverageExclusions,
  parseProductionCoverage,
  productionCoverageArguments,
  readProductionCoverageInventory,
  validateProductionCoverage,
  validateProductionCoverageInventory,
  type CoveragePolicy,
} from '../tools/production-coverage.mts';
import { MAX_FORWARDING_SOURCE_BYTES, moduleForwardingSpecifier } from '../tools/module-forwarding.mts';

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
  test('recognises only an exact value-forwarding module without constraining formatting', () => {
    for (const source of ["export * from './owner.mts';", '// A comment.\n; export * from "./owner.mts";\n;']) {
      assert.equal(moduleForwardingSpecifier(source), './owner.mts');
    }
    for (const source of [
      '', 'export * from', "export type * from './owner.mts';", "export * as nested from './owner.mts';",
      "export { value } from './owner.mts';", "export {} from './owner.mts';",
      "export * from './owner.mts' with { type: 'json' };",
      "import './effect.mts'; export * from './owner.mts';",
      "export * from './owner.mts'; globalThis.effect = true;",
      "export * from './owner.mts'; export * from './another.mts';",
      ' '.repeat(MAX_FORWARDING_SOURCE_BYTES + 1),
    ]) assert.equal(moduleForwardingSpecifier(source), null);
  });

  test('discovers an ordinary forwarding chain without a new exclusion declaration', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whoisleuth-forwarding-coverage-'));
    try {
      await mkdir(path.join(root, 'lib'));
      await writeFile(path.join(root, 'lib/owner.mts'), 'export const value = 1;');
      await writeFile(path.join(root, 'lib/forward.mts'), '// A formatting change.\nexport * from "./owner.mts";');
      await writeFile(path.join(root, 'lib/new-helper.mts'), "export * from './forward.mts';");
      const sources = ['lib/owner.mts', 'lib/forward.mts', 'lib/new-helper.mts'];
      const report = parseProductionCoverage(lcovRecord('lib/owner.mts'));
      const exclusions = await discoverForwardingCoverageExclusions(report, sources, root, []);
      assert.deepEqual(exclusions, [
        { source: 'lib/forward.mts', category: 'compatibility_re_export', owner: 'lib/owner.mts' },
        { source: 'lib/new-helper.mts', category: 'compatibility_re_export', owner: 'lib/owner.mts' },
      ]);
      assert.equal(validateProductionCoverageInventory(report, sources, exclusions, () => true).excludedFiles, 2);
      const instrumented = parseProductionCoverage(`${lcovRecord('lib/owner.mts')}\n${lcovRecord('lib/forward.mts')}`);
      assert.deepEqual(await discoverForwardingCoverageExclusions(instrumented, sources, root, []), [
        { source: 'lib/new-helper.mts', category: 'compatibility_re_export', owner: 'lib/forward.mts' },
      ]);
      await writeFile(path.join(root, 'lib/new-helper.mts'), "export * from './forward.mts'; export const extra = 2;");
      const changed = await discoverForwardingCoverageExclusions(report, sources, root, []);
      assert.equal(changed.length, 1);
      assert.throws(() => validateProductionCoverageInventory(report, sources, changed, () => true), /unreviewed source omissions: lib\/new-helper.mts/u);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('cannot excuse an unmeasured implementation, unknown owner, cycle or unsafe source path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whoisleuth-forwarding-refusal-'));
    try {
      await mkdir(path.join(root, 'lib'));
      const contents = {
        'measured.mts': 'export const value = 1;',
        'untested.mts': 'export const value = 2;',
        'forward.mts': "export * from './untested.mts';",
        'unknown.mts': "export * from './missing.mts';",
        'cycle-a.mts': "export * from './cycle-b.mts';",
        'cycle-b.mts': "export * from './cycle-a.mts';",
      };
      for (const [filename, source] of Object.entries(contents)) await writeFile(path.join(root, 'lib', filename), source);
      const inventory = Object.keys(contents).map((filename) => `lib/${filename}`);
      const report = parseProductionCoverage(lcovRecord('lib/measured.mts'));
      assert.deepEqual(await discoverForwardingCoverageExclusions(report, inventory, root, []), []);
      assert.throws(() => validateProductionCoverageInventory(report, inventory, [], () => true), /unreviewed source omissions/u);
      await symlink(path.join(root, 'lib/measured.mts'), path.join(root, 'lib/link.mts'));
      await assert.rejects(discoverForwardingCoverageExclusions(report, [...inventory, 'lib/link.mts'], root, []), /symbolic link/u);
      await assert.rejects(discoverForwardingCoverageExclusions(report, ['../escape.mts'], root, []), /safe relative/u);
      await writeFile(path.join(root, 'lib/oversized.mts'), ' '.repeat(MAX_FORWARDING_SOURCE_BYTES + 1));
      await assert.rejects(discoverForwardingCoverageExclusions(report, ['lib/oversized.mts'], root, []), /byte maximum/u);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

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

  test('reports every measured threshold and missing area from one valid report', () => {
    const report = parseProductionCoverage(lcovRecord('lib/critical.mts', [10, 1, 8, 1, 5, 1]));
    assert.throws(() => validateProductionCoverage(report, FOCUSED_COVERAGE_POLICY), error => {
      assert.ok(error instanceof Error);
      for (const expected of [
        'missing maintained runtime areas: CLI',
        'Global line coverage is 10.00%; required 80.00%',
        'Global branch coverage is 12.50%; required 70.00%',
        'Global function coverage is 20.00%; required 90.00%',
        'lib/critical.mts line coverage is 10.00%; required 90.00%',
        'lib/critical.mts branch coverage is 12.50%; required 75.00%',
        'lib/critical.mts function coverage is 20.00%; required 100.00%',
      ]) assert.ok(error.message.includes(expected), expected);
      return true;
    });
  });

  test('reports missing, measured, unknown and unowned inventory entries together', () => {
    const report = parseProductionCoverage([
      lcovRecord('lib/measured.mts'), lcovRecord('lib/unknown.mts'),
    ].join('\n'));
    assert.throws(() => validateProductionCoverageInventory(report,
      ['lib/measured.mts', 'lib/untested.mts'],
      [
        { source: 'lib/measured.mts', category: 'browser_adapter', owner: 'e2e/missing.spec.ts' },
        { source: 'lib/removed.mts', category: 'browser_adapter', owner: 'e2e/missing.spec.ts' },
      ], () => false), error => {
      assert.ok(error instanceof Error);
      for (const expected of [
        'exclusion is stale or unknown: lib/removed.mts',
        'exclusion owner is missing for lib/measured.mts',
        'exclusion owner is missing for lib/removed.mts',
        'measured unknown source files: lib/unknown.mts',
        'exclusions are now measured and must be removed: lib/measured.mts',
        'unreviewed source omissions: lib/untested.mts',
      ]) assert.ok(error.message.includes(expected), expected);
      return true;
    });
  });

  test('the executable reports threshold and inventory failures before rejecting the same report', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-coverage-diagnostics-'));
    try {
      const omitted = 'cli/discriminated-command-handlers.mts';
      const underCovered = 'cli/workflow-command-runner.mts';
      const nowMeasured = 'frontend/src/lib/browser-workspace-provider.ts';
      const excluded = new Set(PRODUCTION_COVERAGE_EXCLUSIONS.map(item => item.source));
      const sources = readProductionCoverageInventory().filter(source =>
        source !== omitted && (!excluded.has(source) || source === nowMeasured));
      assert.ok(sources.includes(underCovered));
      assert.ok(sources.includes(nowMeasured));
      const file = path.join(directory, 'fixture.lcov');
      await writeFile(file, sources.map(source => lcovRecord(source,
        source === underCovered ? [10, 1, 8, 1, 5, 1] : [10, 10, 8, 8, 5, 5])).join('\n'));
      const environment = { ...process.env };
      delete environment.NODE_V8_COVERAGE;
      await assert.rejects(promisify(execFile)(process.execPath, ['tools/production-coverage.mts', file], {
        cwd: path.resolve(import.meta.dirname, '..'), env: environment,
        encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
      }), error => {
        const result = error as Error & { code: number; stdout: string; stderr: string };
        assert.equal(result.code, 2);
        assert.equal(result.stdout, '');
        for (const expected of [
          `missing critical source ${omitted}`,
          `${underCovered} line coverage is 10.00%; required 95.00%`,
          `${underCovered} branch coverage is 12.50%; required 65.00%`,
          `${underCovered} function coverage is 20.00%; required 100.00%`,
          `exclusions are now measured and must be removed: ${nowMeasured}`,
          `unreviewed source omissions: ${omitted}`,
        ]) assert.ok(result.stderr.includes(expected), expected);
        return true;
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
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
