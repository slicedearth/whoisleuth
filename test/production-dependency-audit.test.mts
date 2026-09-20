import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assessProductionDependencyAudit,
  PRODUCTION_DEPENDENCY_AUDIT_MAX_BYTES,
  PRODUCTION_DEPENDENCY_AUDIT_MAX_PACKAGES,
} from '../lib/production-dependency-audit-policy.mts';
import {
  main,
  productionDependencyAuditArguments,
  productionAuditLockfile,
  PRODUCTION_DEPENDENCY_AUDIT_TIMEOUT_MS,
} from '../tools/production-dependency-audit.mts';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

function auditReport(entries: Record<string, unknown> = {}) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const entry of Object.values(entries)) {
    const severity = (entry as { severity?: keyof typeof counts }).severity;
    if (severity && Object.hasOwn(counts, severity)) counts[severity] += 1;
  }
  return {
    auditReportVersion: 2,
    vulnerabilities: structuredClone(entries),
    metadata: {
      vulnerabilities: { ...counts, total: Object.keys(entries).length },
      dependencies: { prod: 12, dev: 34, optional: 0, peer: 0, peerOptional: 0, total: 46 },
    },
  };
}

function vulnerability(name: string, severity = 'low') {
  return {
    name,
    severity,
    isDirect: false,
    via: [],
    effects: [],
    range: '<=1.0.0',
    nodes: [`node_modules/${name}`],
    fixAvailable: false,
  };
}

function outputBuffer() {
  let value = '';
  return { write: (chunk: string) => { value += chunk; }, value: () => value };
}

describe('production dependency audit policy', () => {
  test('audits optional package runtimes without promoting unrelated development dependencies or changing the source lockfile', () => {
    const source = { packages: {
      '': { dependencies: { app: '^1.0.0' } },
      'node_modules/app': { version: '1.0.0' },
      'node_modules/optional': { version: '2.0.0', dev: true, dependencies: { shared: '3.0.0' } },
      'node_modules/shared': { version: '3.0.0', dev: true, integrity: 'sha512-fixture' },
      'node_modules/test-only': { version: '4.0.0', dev: true },
    } };
    const saved = structuredClone(source);
    const result = productionAuditLockfile(source, [{ dependencies: { optional: '^2.0.0' } }]) as typeof source;
    assert.deepEqual(result.packages[''].dependencies, { app: '^1.0.0', optional: '2.0.0' });
    assert.equal(result.packages['node_modules/optional'].dev, undefined);
    assert.equal(result.packages['node_modules/shared'].dev, undefined);
    assert.equal(result.packages['node_modules/shared'].integrity, 'sha512-fixture');
    assert.equal(result.packages['node_modules/test-only'].dev, true);
    assert.deepEqual(source, saved);
    assert.throws(() => productionAuditLockfile(source, [{ dependencies: { missing: '1.0.0' } }]), /not installed/u);
  });
  test('accepts exactly zero production vulnerabilities', () => {
    const report = assessProductionDependencyAudit({ auditJson: JSON.stringify(auditReport()) });
    assert.equal(report.status, 'accepted');
    assert.equal(report.auditReportVersion, 2);
    assert.equal(report.vulnerablePackageEntries, 0);
    assert.deepEqual(report.findings, []);
  });

  test('admits the counted production root without permitting inflated dependency metadata', () => {
    for (const total of [0, 29]) {
      const report = auditReport();
      report.metadata.dependencies = { prod: total + 1, dev: 0, optional: 0, peer: 0, peerOptional: 0, total };
      assert.equal(assessProductionDependencyAudit({ auditJson: JSON.stringify(report) }).status, 'accepted');
      report.metadata.dependencies.prod += 1;
      assert.equal(assessProductionDependencyAudit({ auditJson: JSON.stringify(report) }).findings[0]?.code,
        'audit_metadata_invalid');
    }
    for (const category of ['dev', 'optional', 'peer', 'peerOptional'] as const) {
      const report = auditReport();
      report.metadata.dependencies = { prod: 1, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 29 };
      report.metadata.dependencies[category] = 30;
      assert.equal(assessProductionDependencyAudit({ auditJson: JSON.stringify(report) }).findings[0]?.code,
        'audit_metadata_invalid');
    }
    const vulnerable = auditReport({ fixture: vulnerability('fixture') });
    vulnerable.metadata.dependencies = { prod: 30, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 29 };
    assert.deepEqual(assessProductionDependencyAudit({ auditJson: JSON.stringify(vulnerable) }).findings.map(item => item.code),
      ['production_vulnerability']);
  });

  test('blocks every reported production vulnerability without a tolerance or exception', () => {
    const entries = {
      'fixture-direct': { ...vulnerability('fixture-direct', 'critical'), isDirect: true },
      'fixture-transitive': vulnerability('fixture-transitive', 'info'),
    };
    const report = assessProductionDependencyAudit({ auditJson: JSON.stringify(auditReport(entries)) });
    assert.equal(report.status, 'blocked');
    assert.equal(report.vulnerablePackageEntries, 2);
    assert.deepEqual(report.findings.map((entry) => entry.code), [
      'production_vulnerability',
      'production_vulnerability',
    ]);
    assert.match(report.findings[0]?.message ?? '', /fixture-direct/u);
    assert.match(report.findings[1]?.message ?? '', /fixture-transitive/u);
  });

  test('fails closed on absent, malformed, oversized, unsupported, or excessive audit data', async (context) => {
    await context.test('absent output', () => {
      const report = assessProductionDependencyAudit({ auditJson: '' });
      assert.equal(report.findings[0]?.code, 'audit_data_unavailable');
    });
    await context.test('malformed JSON', () => {
      const report = assessProductionDependencyAudit({ auditJson: '{' });
      assert.equal(report.findings[0]?.code, 'audit_output_invalid');
    });
    await context.test('non-object JSON', () => {
      const report = assessProductionDependencyAudit({ auditJson: '[]' });
      assert.equal(report.findings[0]?.code, 'audit_output_invalid');
    });
    await context.test('spoofed internal assessment shape', () => {
      const report = assessProductionDependencyAudit({
        auditJson: JSON.stringify({ status: 'accepted', findings: [] }),
      });
      assert.equal(report.status, 'blocked');
      assert.equal(report.findings[0]?.code, 'audit_report_unsupported');
    });
    await context.test('oversized JSON', () => {
      const report = assessProductionDependencyAudit({
        auditJson: ' '.repeat(PRODUCTION_DEPENDENCY_AUDIT_MAX_BYTES + 1),
      });
      assert.equal(report.findings[0]?.code, 'audit_output_invalid');
    });
    await context.test('unsupported report version', () => {
      const value = auditReport() as Record<string, unknown>;
      value.auditReportVersion = 3;
      const report = assessProductionDependencyAudit({ auditJson: JSON.stringify(value) });
      assert.equal(report.findings[0]?.code, 'audit_report_unsupported');
    });
    await context.test('excessive package map', () => {
      const entries = Object.fromEntries(Array.from(
        { length: PRODUCTION_DEPENDENCY_AUDIT_MAX_PACKAGES + 1 },
        (_, index) => [`fixture-${index}`, vulnerability(`fixture-${index}`)],
      ));
      const report = assessProductionDependencyAudit({ auditJson: JSON.stringify(auditReport(entries)) });
      assert.equal(report.findings[0]?.code, 'audit_metadata_invalid');
    });
  });

  test('requires supported package entries and exact vulnerability metadata', async (context) => {
    const validReport = () => {
      const report = auditReport({ fixture: vulnerability('fixture') });
      // The package is vulnerable, but its independent report metadata is valid.
      assert.deepEqual(assessProductionDependencyAudit({ auditJson: JSON.stringify(report) }).findings.map((item) => item.code),
        ['production_vulnerability']);
      return report;
    };
    await context.test('name identity', () => {
      const report = validReport();
      (report.vulnerabilities.fixture as { name: string }).name = 'other';
      assert.equal(
        assessProductionDependencyAudit({ auditJson: JSON.stringify(report) }).findings[0]?.code,
        'audit_metadata_invalid',
      );
    });
    await context.test('unsafe package name', () => {
      const report = auditReport({ 'fixture\u001b[31m': vulnerability('fixture\u001b[31m') });
      assert.equal(
        assessProductionDependencyAudit({ auditJson: JSON.stringify(report) }).findings[0]?.code,
        'audit_metadata_invalid',
      );
    });
    await context.test('severity count', () => {
      const report = validReport();
      report.metadata.vulnerabilities.low = 0;
      assert.equal(
        assessProductionDependencyAudit({ auditJson: JSON.stringify(report) }).findings[0]?.code,
        'audit_metadata_invalid',
      );
    });
    await context.test('unknown metadata field', () => {
      const report = validReport();
      (report.metadata.vulnerabilities as Record<string, number>).unknown = 1;
      assert.equal(
        assessProductionDependencyAudit({ auditJson: JSON.stringify(report) }).findings[0]?.code,
        'audit_metadata_invalid',
      );
    });
    await context.test('unsupported top-level report field', () => {
      const report = { ...validReport(), futureField: true };
      assert.equal(
        assessProductionDependencyAudit({ auditJson: JSON.stringify(report) }).findings[0]?.code,
        'audit_report_unsupported',
      );
    });
    await context.test('invalid dependency count', () => {
      const report = validReport();
      report.metadata.dependencies.prod = -1;
      assert.equal(
        assessProductionDependencyAudit({ auditJson: JSON.stringify(report) }).findings[0]?.code,
        'audit_metadata_invalid',
      );
    });
    await context.test('inconsistent dependency total', () => {
      const report = validReport();
      report.metadata.dependencies.total = 11;
      report.metadata.dependencies.prod = 12;
      assert.equal(
        assessProductionDependencyAudit({ auditJson: JSON.stringify(report) }).findings[0]?.code,
        'audit_metadata_invalid',
      );
    });
    await context.test('unbounded dependency chain', () => {
      const report = validReport();
      (report.vulnerabilities.fixture as { via: unknown[] }).via = Array.from(
        { length: PRODUCTION_DEPENDENCY_AUDIT_MAX_PACKAGES + 1 },
        () => 'fixture',
      );
      assert.equal(
        assessProductionDependencyAudit({ auditJson: JSON.stringify(report) }).findings[0]?.code,
        'audit_metadata_invalid',
      );
    });
  });

  test('runner emits only a concise result and rejects command failures', () => {
    assert.equal(PRODUCTION_DEPENDENCY_AUDIT_TIMEOUT_MS, 300_000);
    assert.deepEqual(productionDependencyAuditArguments(), [
      'audit',
      '--package-lock-only',
      '--omit=dev',
      '--json',
      '--registry=https://registry.npmjs.org',
      '--offline=false',
      '--prefer-online',
    ]);

    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const rawAudit = JSON.stringify(auditReport());
    const code = main({
      stdout,
      stderr,
      runAudit: () => ({ status: 0, signal: null, stdout: rawAudit, stderr: '' }),
    });
    assert.equal(code, 0);
    assert.equal(stdout.value(), [
      'WHOISleuth production dependency audit',
      'Status: accepted',
      'Production vulnerability entries: 0',
      '',
    ].join('\n'));
    assert.doesNotMatch(stdout.value(), /auditReportVersion|metadata|fixture/u);
    assert.equal(stderr.value(), '');

    const blockedStdout = outputBuffer();
    const blockedStderr = outputBuffer();
    const blocked = main({
      stdout: blockedStdout,
      stderr: blockedStderr,
      runAudit: () => ({
        status: 1,
        signal: null,
        stdout: JSON.stringify(auditReport({ fixture: vulnerability('fixture') })),
        stderr: '',
      }),
    });
    assert.equal(blocked, 1);
    assert.equal(blockedStdout.value(), '');
    assert.match(blockedStderr.value(), /BLOCKED production_vulnerability/u);

    const failedStderr = outputBuffer();
    const failed = main({
      stdout: outputBuffer(),
      stderr: failedStderr,
      runAudit: () => ({ status: 2, signal: null, stdout: '', stderr: 'registry unavailable' }),
    });
    assert.equal(failed, 2);
    assert.match(failedStderr.value(), /could not complete: registry unavailable/u);

    const hostileStderr = outputBuffer();
    const hostile = main({
      stdout: outputBuffer(),
      stderr: hostileStderr,
      runAudit: () => ({ status: 2, signal: null, stdout: '', stderr: '\u001b[31mregistry\u0000 unavailable' }),
    });
    assert.equal(hostile, 2);
    assert.equal(hostileStderr.value(), 'Production dependency audit could not complete: registry unavailable\n');
    assert.doesNotMatch(hostileStderr.value().trimEnd(), /[\u0000-\u001f\u007f-\u009f]/u);

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

  test('production imports stay on the dependency package-root surface', () => {
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

});
