import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXECUTABLE = join(ROOT, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs');
const FIXTURE_ROOT = join(ROOT, 'test', 'fixtures', 'architecture');

describe('architecture boundaries', () => {
  test('rejects contract, domain, and presentation dependency inversions', () => {
    const result = spawnSync(process.execPath, [
      EXECUTABLE,
      '--config',
      join(ROOT, '.dependency-cruiser.json'),
      '--output-type',
      'json',
      join(FIXTURE_ROOT, 'packages', 'contracts'),
      join(FIXTURE_ROOT, 'packages', 'evidence'),
      join(FIXTURE_ROOT, 'packages', 'cases'),
      join(FIXTURE_ROOT, 'packages', 'workspace'),
      join(FIXTURE_ROOT, 'packages', 'monitoring'),
      join(FIXTURE_ROOT, 'packages', 'investigation'),
      join(FIXTURE_ROOT, 'packages', 'interchange'),
      join(FIXTURE_ROOT, 'packages', 'relationships'),
      join(FIXTURE_ROOT, 'packages', 'comparison'),
      join(FIXTURE_ROOT, 'cli'),
      join(FIXTURE_ROOT, 'lib'),
      join(FIXTURE_ROOT, 'tools'),
      join(FIXTURE_ROOT, 'netlify', 'functions'),
      join(FIXTURE_ROOT, 'server.mts'),
      join(FIXTURE_ROOT, 'frontend', 'src', 'lib'),
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    const output = `${result.stdout}\n${result.stderr}`;
    // The JSON reporter returns data successfully even when that data contains
    // violations. Inspect its findings, not the reporter's process status.
    assert.equal(result.status, 0, result.stderr);
    assert.match(output, /shared-contracts-stay-independent-of-domain-and-adapters/u);
    assert.match(output, /domain-packages-stay-independent-of-runtime-adapters/u);
    assert.match(output, /case-domain-stays-independent-of-runtime-adapters/u);
    assert.match(output, /case-domain-no-node-core/u);
    assert.match(output, /workspace-domain-stays-independent-of-runtime-adapters/u);
    assert.match(output, /workspace-domain-no-node-core/u);
    assert.match(output, /portable-domain-packages-stay-independent-of-runtime-adapters/u);
    assert.match(output, /portable-domain-packages-no-node-core/u);
    assert.match(output, /non-frontend-production-stays-out-of-frontend/u);
    assert.match(output, /observation-consumers-use-domain-owner/u);
    const report = JSON.parse(result.stdout) as { summary: { error: number; violations: Array<{ from: string; to: string; rule: { name: string } }> } };
    assert.ok(report.summary.error > 0);
    const blockedTargets = new Set(report.summary.violations
      .filter((violation) => violation.rule.name === 'non-frontend-production-stays-out-of-frontend')
      .map((violation) => violation.to.replace('test/fixtures/architecture/frontend/src/lib/', '')));
    // Independent bad-import fixtures still exercise every retired duplicate
    // rule. The general boundary covers new frontend modules automatically.
    for (const target of [
      'components/adapter.mts', 'analysis/case-model.mts', 'analysis/brand-profile-model.mts',
      'analysis/workspace-archive.mts', 'analysis/external-findings-import.mts', 'analysis/page-similarity.mts',
      'analysis/artifact-integrity.mts', 'analysis/domain-control-manifest-core.mts', 'analysis/domain-control-records.mts',
    ]) assert.ok(blockedTargets.has(target), `${target} must remain forbidden to non-frontend consumers`);
  });

  test('makes the blocking architecture reporter fail for a forbidden import', () => {
    const result = spawnSync(process.execPath, [EXECUTABLE, '--config', join(ROOT, '.dependency-cruiser.json'),
      '--output-type', 'err-long', join(FIXTURE_ROOT, 'cli')], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /non-frontend-production-stays-out-of-frontend/u);
  });
});
