import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXECUTABLE = join(ROOT, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs');
const FIXTURE_ROOT = join(ROOT, 'test', 'fixtures', 'architecture');

describe('architecture boundaries', () => {
  test('resolves supported package subpaths without hiding invalid imports', () => {
    const result = spawnSync(process.execPath, [EXECUTABLE, '--config', join(ROOT, '.dependency-cruiser.json'),
      // Include resolved external nodes in this diagnostic; the application
      // report normally omits them. The existing no-follow rule still applies.
      '--exclude', '^$', '--output-type', 'json', join(FIXTURE_ROOT, 'frontend', 'src', 'lib', 'package-exports.mts')],
    { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout) as { summary: { violations: Array<{ to: string; rule: { name: string } }> }; modules: Array<{ dependencies: Array<{ module: string; couldNotResolve?: boolean }> }> };
    const dependencies = report.modules.flatMap(module => module.dependencies);
    const supported = dependencies.find(dependency => dependency.module === 'svelte/store');
    assert.ok(supported, 'the supported subpath must actually be examined');
    assert.notEqual(supported.couldNotResolve, true);
    const unresolved = report.summary.violations.filter(violation => violation.rule.name === 'not-to-unresolvable');
    assert.deepEqual(unresolved.map(violation => violation.to), ['svelte/not-a-public-export']);
  });

  test('rejects contract, domain, and presentation dependency inversions', () => {
    const result = spawnSync(process.execPath, [
      EXECUTABLE,
      '--config',
      join(ROOT, '.dependency-cruiser.json'),
      '--output-type',
      'json',
      join(FIXTURE_ROOT, 'packages'),
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

    // The JSON reporter returns data successfully even when that data contains
    // violations. Inspect its findings, not the reporter's process status.
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout) as { summary: { error: number; violations: Array<{ from: string; to: string; rule: { name: string } }> } };
    assert.ok(report.summary.error > 0);
    const violatedRules = new Set(report.summary.violations.map((violation) => violation.rule.name));
    for (const name of [
      'shared-contracts-stay-independent-of-domain-and-adapters',
      'domain-packages-stay-independent-of-runtime-adapters',
      'domain-packages-no-node-core',
      'non-frontend-production-stays-out-of-frontend',
      'observation-consumers-use-domain-owner',
    ]) assert.ok(violatedRules.has(name), `${name} must report an actual forbidden dependency`);
    const newDomainViolations = report.summary.violations.filter(violation =>
      violation.from.endsWith('packages/new-domain/forbidden-dependencies.mts'));
    assert.ok(newDomainViolations.some(violation => violation.to === 'fs'
      && violation.rule.name === 'domain-packages-no-node-core'));
    assert.ok(newDomainViolations.some(violation => violation.to.endsWith('lib/runtime.mts')
      && violation.rule.name === 'domain-packages-stay-independent-of-runtime-adapters'));
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
