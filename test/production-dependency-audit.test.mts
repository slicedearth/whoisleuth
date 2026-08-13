import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assessProductionDependencyAudit,
  PRODUCTION_DEPENDENCY_AUDIT_EXPIRES_AT,
  PRODUCTION_DEPENDENCY_AUDIT_REVIEWED_FIX,
} from '../lib/production-dependency-audit-policy.mts';
import {
  main,
  productionDependencyAuditArguments,
  PRODUCTION_DEPENDENCY_AUDIT_CACHE_PREFIX,
  PRODUCTION_DEPENDENCY_AUDIT_TIMEOUT_MS,
} from '../tools/production-dependency-audit.mts';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

const ADVISORIES = [
  {
    source: 1138808,
    name: 'image-size',
    dependency: 'image-size',
    title: 'Fixture parser denial of service',
    url: 'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr',
    severity: 'high',
    range: '<=2.0.2',
  },
  {
    source: 1138809,
    name: 'image-size',
    dependency: 'image-size',
    title: 'Fixture parser denial of service',
    url: 'https://github.com/advisories/GHSA-5p2g-fcmc-qvqq',
    severity: 'high',
    range: '<=2.0.2',
  },
];

function auditReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      '@netlify/blobs': {
        name: '@netlify/blobs',
        severity: 'high',
        isDirect: true,
        via: ['@netlify/dev-utils'],
        effects: [],
        range: '>=9.1.6',
        nodes: ['node_modules/@netlify/blobs'],
        fixAvailable: structuredClone(PRODUCTION_DEPENDENCY_AUDIT_REVIEWED_FIX),
      },
      '@netlify/dev-utils': {
        name: '@netlify/dev-utils',
        severity: 'high',
        isDirect: false,
        via: ['image-size'],
        effects: ['@netlify/blobs'],
        range: '>=3.2.0',
        nodes: ['node_modules/@netlify/dev-utils'],
        fixAvailable: structuredClone(PRODUCTION_DEPENDENCY_AUDIT_REVIEWED_FIX),
      },
      'image-size': {
        name: 'image-size',
        severity: 'high',
        isDirect: false,
        via: structuredClone(ADVISORIES),
        effects: ['@netlify/dev-utils'],
        range: '*',
        nodes: ['node_modules/image-size'],
        fixAvailable: structuredClone(PRODUCTION_DEPENDENCY_AUDIT_REVIEWED_FIX),
      },
    },
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 3, critical: 0, total: 3 },
      dependencies: { prod: 3, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 3 },
    },
  };
}

function lockfile() {
  return {
    name: 'fixture-project',
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { '@netlify/blobs': '10.7.9' } },
      'node_modules/@netlify/blobs': {
        version: '10.7.9',
        dependencies: { '@netlify/dev-utils': '4.4.6' },
      },
      'node_modules/@netlify/dev-utils': {
        version: '4.4.6',
        dependencies: { 'image-size': '^2.0.2' },
      },
      'node_modules/image-size': { version: '2.0.2' },
    },
  };
}

function remediatedLockfile() {
  return {
    name: 'fixture-project',
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { '@netlify/blobs': '10.7.13' } },
      'node_modules/@netlify/blobs': {
        version: '10.7.13',
        dependencies: { '@netlify/dev-utils': '5.0.0' },
      },
      'node_modules/@netlify/dev-utils': {
        version: '5.0.0',
        dependencies: {},
      },
    },
  };
}

function assess(
  audit: ReturnType<typeof auditReport>,
  locked: unknown = lockfile(),
  now = new Date('2026-08-10T00:00:00.000Z'),
) {
  return assessProductionDependencyAudit({
    auditJson: JSON.stringify(audit),
    lockfileJson: JSON.stringify(locked),
    now: () => now,
  });
}

function outputBuffer() {
  let value = '';
  return { write: (chunk: string) => { value += chunk; }, value: () => value };
}

describe('production dependency audit policy', () => {
  test('accepts only the reviewed advisory IDs on the exact package chain', () => {
    const report = assess(auditReport());
    assert.equal(report.status, 'accepted');
    assert.equal(report.vulnerablePackageEntries, 3);
    assert.deepEqual(report.reviewedAdvisoryIds, [
      'GHSA-5p2g-fcmc-qvqq',
      'GHSA-w3rx-r6r6-pgpr',
    ]);
    assert.deepEqual(report.findings, []);
  });

  test('fails closed when an empty audit still has the reviewed vulnerable chain', () => {
    const audit = auditReport();
    audit.vulnerabilities = {} as ReturnType<typeof auditReport>['vulnerabilities'];
    audit.metadata.vulnerabilities = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
    const report = assess(audit, lockfile(), new Date('2027-01-01T00:00:00.000Z'));
    assert.equal(report.status, 'blocked');
    assert.equal(report.vulnerablePackageEntries, 0);
    assert.equal(report.findings[0]?.code, 'audit_data_unavailable');
  });

  test('allows a clean production audit for the remediated package chain', () => {
    const audit = auditReport();
    audit.vulnerabilities = {} as ReturnType<typeof auditReport>['vulnerabilities'];
    audit.metadata.vulnerabilities = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
    const report = assess(audit, remediatedLockfile(), new Date('2027-01-01T00:00:00.000Z'));
    assert.equal(report.status, 'accepted');
    assert.equal(report.vulnerablePackageEntries, 0);
  });

  test('rejects an empty audit paired with an unsupported lockfile document', () => {
    const audit = auditReport();
    audit.vulnerabilities = {} as ReturnType<typeof auditReport>['vulnerabilities'];
    audit.metadata.vulnerabilities = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
    const report = assess(audit, {});
    assert.equal(report.status, 'blocked');
    assert.equal(report.findings[0]?.code, 'lockfile_changed');
  });

  test('blocks every unreviewed advisory, including a new critical package entry', () => {
    const audit = auditReport();
    (audit.vulnerabilities as Record<string, unknown>)['fixture-parser'] = {
      name: 'fixture-parser',
      severity: 'critical',
      isDirect: false,
      via: [{
        source: 9999999,
        name: 'fixture-parser',
        dependency: 'fixture-parser',
        title: 'Fixture advisory',
        url: 'https://advisories.invalid/GHSA-2222-3333-4444',
        severity: 'critical',
        range: '<=1.0.0',
      }],
      effects: [],
      range: '',
      nodes: ['node_modules/fixture-parser'],
      fixAvailable: false,
    };
    audit.metadata.vulnerabilities.high = 3;
    audit.metadata.vulnerabilities.critical = 1;
    audit.metadata.vulnerabilities.total = 4;
    const report = assess(audit);
    assert.equal(report.status, 'blocked');
    assert.ok(report.findings.some((item) => item.code === 'unreviewed_vulnerability'));
  });

  test('requires exactly one record for each reviewed advisory ID', async (context) => {
    await context.test('missing reviewed ID', () => {
      const audit = auditReport();
      audit.vulnerabilities['image-size'].via.pop();
      const report = assess(audit);
      assert.equal(report.status, 'blocked');
      assert.ok(report.findings.some((item) => item.code === 'advisory_changed'));
    });
    await context.test('duplicated remaining reviewed ID', () => {
      const audit = auditReport();
      const first = structuredClone(audit.vulnerabilities['image-size'].via[0]!);
      audit.vulnerabilities['image-size'].via = [first, structuredClone(first)];
      const report = assess(audit);
      assert.equal(report.status, 'blocked');
      assert.ok(report.findings.some((item) => item.code === 'advisory_changed'));
    });
  });

  test('blocks changed severity, affected range, fix availability, chain, and versions', async (context) => {
    await context.test('advisory details', () => {
      const audit = auditReport();
      audit.vulnerabilities['image-size'].via[0]!.severity = 'critical';
      audit.vulnerabilities['image-size'].via[0]!.range = '<=2.1.0';
      const report = assess(audit);
      assert.equal(report.status, 'blocked');
      assert.ok(report.findings.some((item) => item.code === 'advisory_changed'));
    });
    await context.test('advisory source URL', () => {
      const audit = auditReport();
      audit.vulnerabilities['image-size'].via[0]!.url = 'https://advisories.invalid/GHSA-w3rx-r6r6-pgpr';
      const report = assess(audit);
      assert.equal(report.status, 'blocked');
      assert.ok(report.findings.some((item) => item.code === 'advisory_changed'));
    });
    await context.test('package chain and fix availability', () => {
      const audit = auditReport();
      audit.vulnerabilities['@netlify/blobs'].via = ['fixture-parser'];
      audit.vulnerabilities['@netlify/blobs'].fixAvailable = { name: '@netlify/blobs', version: '11.0.0' } as never;
      const report = assess(audit);
      assert.equal(report.status, 'blocked');
      assert.ok(report.findings.some((item) => item.code === 'package_chain_changed'));
    });
    await context.test('advertised fix descriptor', () => {
      const audit = auditReport();
      audit.vulnerabilities['image-size'].fixAvailable = false as never;
      const report = assess(audit);
      assert.equal(report.status, 'blocked');
      assert.match(
        report.findings.find((item) => item.code === 'package_chain_changed')?.message ?? '',
        /fix availability/u,
      );
    });
    await context.test('package range diagnostic', () => {
      const audit = auditReport();
      audit.vulnerabilities['image-size'].range = '<=2.0.2';
      const report = assess(audit);
      assert.equal(report.status, 'blocked');
      assert.match(
        report.findings.find((item) => item.code === 'package_chain_changed')?.message ?? '',
        /range/u,
      );
    });
    await context.test('direct-dependency diagnostic', () => {
      const audit = auditReport();
      audit.vulnerabilities['@netlify/dev-utils'].isDirect = true;
      const report = assess(audit);
      assert.equal(report.status, 'blocked');
      assert.match(
        report.findings.find((item) => item.code === 'package_chain_changed')?.message ?? '',
        /direct-dependency state/u,
      );
    });
    await context.test('locked versions', () => {
      const locked = lockfile();
      locked.packages['node_modules/image-size'].version = '2.0.3';
      const report = assess(auditReport(), locked);
      assert.equal(report.status, 'blocked');
      assert.ok(report.findings.some((item) => item.code === 'lockfile_changed'));
    });
  });

  test('fails closed when the exception is stale or audit output is malformed', () => {
    const stale = assess(auditReport(), lockfile(), new Date(PRODUCTION_DEPENDENCY_AUDIT_EXPIRES_AT));
    assert.equal(stale.status, 'blocked');
    assert.equal(stale.findings[0]?.code, 'exception_expired');

    const malformed = assessProductionDependencyAudit({ auditJson: '{', lockfileJson: '{}' });
    assert.equal(malformed.status, 'blocked');
    assert.equal(malformed.findings[0]?.code, 'audit_output_invalid');

    const inconsistent = auditReport();
    inconsistent.metadata.vulnerabilities.high = 2;
    const report = assess(inconsistent);
    assert.equal(report.status, 'blocked');
    assert.equal(report.findings[0]?.code, 'audit_metadata_invalid');
  });

  test('runner preserves raw audit JSON and rejects command failures', () => {
    assert.ok(PRODUCTION_DEPENDENCY_AUDIT_TIMEOUT_MS > 0);
    assert.ok(PRODUCTION_DEPENDENCY_AUDIT_TIMEOUT_MS <= 120_000);
    assert.match(PRODUCTION_DEPENDENCY_AUDIT_CACHE_PREFIX, /^whoisleuth-[a-z-]+-$/u);
    assert.deepEqual(productionDependencyAuditArguments('/tmp/fixture-audit-cache'), [
      'audit',
      '--omit=dev',
      '--json',
      '--offline=false',
      '--cache=/tmp/fixture-audit-cache',
    ]);
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const rawAudit = JSON.stringify(auditReport());
    const code = main({
      stdout,
      stderr,
      now: () => new Date('2026-08-10T00:00:00.000Z'),
      runAudit: () => ({ status: 1, signal: null, stdout: rawAudit, stderr: '' }),
      readLockfile: () => JSON.stringify(lockfile()),
    });
    assert.equal(code, 0);
    assert.match(stdout.value(), new RegExp(`^${rawAudit.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\n`, 'u'));
    assert.match(stdout.value(), /Status: accepted/u);
    assert.match(stdout.value(), /Historical exception guard: reviewed 2026-08-10/u);
    assert.equal(stderr.value(), '');

    const failedStderr = outputBuffer();
    const failed = main({
      stdout: outputBuffer(),
      stderr: failedStderr,
      runAudit: () => ({ status: 2, signal: null, stdout: '', stderr: 'registry unavailable' }),
    });
    assert.equal(failed, 2);
    assert.match(failedStderr.value(), /could not complete: registry unavailable/u);

    const timeoutStderr = outputBuffer();
    const timedOut = main({
      stdout: outputBuffer(),
      stderr: timeoutStderr,
      runAudit: () => ({ status: null, signal: 'SIGTERM', stdout: '', stderr: '', timedOut: true }),
    });
    assert.equal(timedOut, 2);
    assert.equal(
      timeoutStderr.value(),
      `Production dependency audit timed out after ${PRODUCTION_DEPENDENCY_AUDIT_TIMEOUT_MS}ms.\n`,
    );
  });

  test('production imports stay on the reviewed package-root surface', () => {
    const expected = new Set([
      'netlify/functions/scheduled-monitor-management.mts',
      'netlify/functions/scheduled-monitor.mts',
    ]);
    const files = [
      'server.mts',
      ...['cli', 'frontend/src', 'lib', 'netlify', 'packages'].flatMap((directory) =>
        fs.readdirSync(path.join(REPOSITORY_ROOT, directory), { recursive: true, encoding: 'utf8' })
          .map((entry) => path.join(directory, entry))
          .filter((entry) => /\.(?:[cm]?[jt]s|svelte)$/u.test(entry)),
      ),
    ];
    const imports = files.filter((entry) => /(?:from\s+|(?:import|require)\s*\()\s*['"]@netlify\/blobs/u
      .test(fs.readFileSync(path.join(REPOSITORY_ROOT, entry), 'utf8')));
    assert.deepEqual(new Set(imports), expected);
    for (const entry of imports) {
      const source = fs.readFileSync(path.join(REPOSITORY_ROOT, entry), 'utf8');
      assert.match(source, /import \{ getStore \} from '@netlify\/blobs';/u);
      assert.doesNotMatch(source, /@netlify\/blobs\//u);
    }
  });

  test('documents the remediated chain, retired exception, and fresh online audit boundary', () => {
    const guide = fs.readFileSync(path.join(REPOSITORY_ROOT, 'docs/dependency-maintenance.md'), 'utf8');
    assert.match(guide, /currently relies on no production-audit exception/u);
    assert.match(guide, /`@netlify\/blobs` 10\.7\.13/u);
    assert.match(guide, new RegExp(`${PRODUCTION_DEPENDENCY_AUDIT_REVIEWED_FIX.name}@${PRODUCTION_DEPENDENCY_AUDIT_REVIEWED_FIX.version}`, 'u'));
    assert.match(guide, /isolated temporary npm cache/u);
    assert.match(guide, /offline=false/u);
    assert.doesNotMatch(guide, /currently reports no fix/u);
  });
});
