import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  auditServiceDependencySignatures,
  SERVICE_DEPENDENCY_SIGNATURE_AUDIT_SCHEMA,
} from '../tools/service-dependency-signature-audit.mts';

const SIGNATURE = {
  id: 'fixture-service',
  label: 'Fixture service',
  targetSuffixes: ['service.test'],
  evidenceTypes: ['dns_target_suffix', 'passive_page_title'] as const,
  source: 'Reviewed fixture source',
  license: 'Fixture data',
  sourceDate: '2026-07-01',
  reviewedAt: '2026-07-01',
  provenance: 'Fixture review',
  deprovisionPageTitles: ['fixture not found'],
};

describe('service-dependency signature audit', () => {
  test('accepts a fresh digest-backed catalogue', () => {
    const first = auditServiceDependencySignatures({
      signatures: [SIGNATURE],
      expectedDigestSha256: '0'.repeat(64),
      now: () => new Date('2026-07-30T00:00:00.000Z'),
    });
    const report = auditServiceDependencySignatures({
      signatures: [SIGNATURE],
      expectedDigestSha256: first.calculatedDigestSha256,
      now: () => new Date('2026-07-30T00:00:00.000Z'),
    });
    assert.equal(report.schema, SERVICE_DEPENDENCY_SIGNATURE_AUDIT_SCHEMA);
    assert.equal(report.status, 'current');
    assert.equal(report.summary.current, 1);
  });

  test('reports stale and changed-provider metadata without contacting a service', () => {
    const stale = auditServiceDependencySignatures({
      signatures: [SIGNATURE],
      expectedDigestSha256: '0'.repeat(64),
      now: () => new Date('2027-07-30T00:00:00.000Z'),
    });
    assert.equal(stale.findings[0]?.state, 'stale');
    assert.equal(stale.digestMatches, false);

    const changed = auditServiceDependencySignatures({
      signatures: [{ ...SIGNATURE, source: '', targetSuffixes: ['service.test', 'service.test'] }],
      expectedDigestSha256: '0'.repeat(64),
      now: () => new Date('2026-07-30T00:00:00.000Z'),
    });
    assert.equal(changed.status, 'invalid');
    assert.match(changed.findings[0]?.issues.join(' ') ?? '', /Duplicate target suffix|Source is not declared/u);
  });
});
