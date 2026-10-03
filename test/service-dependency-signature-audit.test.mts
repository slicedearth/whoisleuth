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
// Independently hashed fixed JSON fixture, not a value returned by the auditor.
const SIGNATURE_DIGEST = 'f90ed6c0b97e6090f074b5dcf53ccae5ee9930d3caca9b0d783e336fa3ecd0a8';

describe('service-dependency signature audit', () => {
  test('accepts a fresh digest-backed catalogue', () => {
    const report = auditServiceDependencySignatures({
      signatures: [SIGNATURE],
      expectedDigestSha256: SIGNATURE_DIGEST,
      now: () => new Date('2026-07-30T00:00:00.000Z'),
    });
    assert.equal(report.schema, SERVICE_DEPENDENCY_SIGNATURE_AUDIT_SCHEMA);
    assert.equal(report.status, 'current');
    assert.equal(report.summary.current, 1);
    assert.equal(report.calculatedDigestSha256, SIGNATURE_DIGEST);
    const changed = auditServiceDependencySignatures({
      signatures: [{ ...SIGNATURE, label: 'Changed fixture service' }],
      expectedDigestSha256: SIGNATURE_DIGEST,
      now: () => new Date('2026-07-30T00:00:00.000Z'),
    });
    assert.equal(changed.status, 'invalid');
    assert.equal(changed.digestMatches, false);
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
