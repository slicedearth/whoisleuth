import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DOMAIN_ASSURANCE_INPUT_SCHEMA,
  DOMAIN_ASSURANCE_VERSION,
  buildDomainAssurance,
} from '../lib/domain-assurance.mts';

const NOW = '2026-08-04T00:00:00.000Z';

describe('domain assurance', () => {
  test('requires explicit zones for current inputs and rejects reader-only version 1', () => {
    const fixture = (version: number) => ({
      schema: DOMAIN_ASSURANCE_INPUT_SCHEMA,
      version,
      kind: 'planned-change',
      domain: 'change.example',
      change: {
        reference: 'CHG-TIME',
        startsAt: '2026-08-05T00:00:00',
        endsAt: '2026-08-05T01:00:00',
        milestones: [{
          id: 'publish',
          label: 'Publish planned change',
          expectedBy: '2026-08-05T00:30:00',
          evidenceSource: 'Saved change record',
          state: 'planned',
          observedAt: null,
          evidenceReference: null,
        }],
        rollbackCriteria: [{
          id: 'availability',
          condition: 'Availability declines',
          owner: 'Change owner',
          state: 'not_checked',
        }],
        postChangeChecks: [{
          id: 'dns',
          label: 'DNS matches the planned state',
          expectedState: 'Planned records observed',
          evidenceSource: 'Saved DNS evidence',
          state: 'not_checked',
          evidenceReference: null,
        }],
      },
    });
    assert.throws(() => buildDomainAssurance(fixture(DOMAIN_ASSURANCE_VERSION), NOW), /explicit timezone/u);
    assert.throws(() => buildDomainAssurance(fixture(1), NOW), /version 2/u);
  });

  test('keeps planned change observations and rollback decisions explicitly attributed', () => {
    const document = buildDomainAssurance({
      schema: DOMAIN_ASSURANCE_INPUT_SCHEMA,
      version: DOMAIN_ASSURANCE_VERSION,
      kind: 'planned-change',
      domain: 'change.example',
      change: {
        reference: 'CHG-42',
        startsAt: '2026-08-05T00:00:00Z',
        endsAt: '2026-08-05T02:00:00Z',
        milestones: [{
          id: 'delegation', label: 'Delegation published', expectedBy: '2026-08-05T00:30:00Z',
          evidenceSource: 'Authoritative DNS observation', state: 'observed',
          observedAt: '2026-08-05T00:20:00Z', evidenceReference: 'packet:delegation',
        }],
        rollbackCriteria: [{ id: 'servfail', condition: 'Authoritative responses fail', owner: 'Change lead', state: 'not_met' }],
        postChangeChecks: [{
          id: 'mail', label: 'Mail policy resolves', expectedState: 'Expected MX and DMARC',
          evidenceSource: 'Saved DNS evidence', state: 'matched', evidenceReference: 'packet:mail',
        }],
      },
    }, NOW);
    assert.equal(document.result.kind, 'planned-change');
    assert.equal(document.result.review.state, 'ready');
    assert.equal(document.result.milestones[0]?.evidenceReference, 'packet:delegation');
    assert.match(document.limitations.join(' '), /analyst-authored/u);
  });

  test('reports cross-domain recovery concentration and unknown fields without inferring control', () => {
    const document = buildDomainAssurance({
      schema: DOMAIN_ASSURANCE_INPUT_SCHEMA,
      version: DOMAIN_ASSURANCE_VERSION,
      kind: 'recovery-dependencies',
      assets: [
        {
          domain: 'one.example',
          dependencies: { registrar: 'Registrar A', dns: 'DNS A', recovery: 'Mailbox A' },
          readiness: { registrarRecoveryTested: true, dnsRecoveryTested: true, recoveryMfaProtected: true },
        },
        {
          domain: 'two.example',
          dependencies: { registrar: 'Registrar A', dns: 'DNS B', recovery: 'Mailbox A' },
          readiness: { registrarRecoveryTested: false, dnsRecoveryTested: null, recoveryMfaProtected: true },
        },
      ],
    }, NOW);
    assert.equal(document.result.kind, 'recovery-dependencies');
    assert.equal(document.result.review.state, 'needs_review');
    assert.deepEqual(document.result.concentrations.map((entry) => entry.dependencyType), ['recovery', 'registrar']);
    assert.deepEqual(document.result.concentrations.map((entry) => entry.provider), ['Mailbox A', 'Registrar A']);
    assert.ok(document.result.unknownDependencies > 0);
    assert.match(document.result.review.reasons.join(' '), /1 recovery readiness check is recorded as not ready/u);
  });

  test('keeps unchecked retirement controls distinct from negative checks', () => {
    const document = buildDomainAssurance({
      schema: DOMAIN_ASSURANCE_INPUT_SCHEMA,
      version: DOMAIN_ASSURANCE_VERSION,
      kind: 'retirement',
      domain: 'retired.example',
      checks: {
        autoRenewDisabled: false,
        registrarLockMaintained: true,
      },
    }, NOW);
    assert.equal(document.result.kind, 'retirement');
    assert.equal(document.result.review.state, 'needs_review');
    assert.match(document.result.review.reasons.join(' '), /expected retirement state.*Auto-renew is intentionally configured.*not confirmed/u);
    assert.equal(document.result.checks.find((check) => check.id === 'autoRenewDisabled')?.state, 'not_confirmed');
    assert.equal(document.result.checks.find((check) => check.id === 'mailRetired')?.state, 'not_checked');
  });

  test('accepts bounded analyst-defined retirement checks in version 2', () => {
    const document = buildDomainAssurance({
      schema: DOMAIN_ASSURANCE_INPUT_SCHEMA,
      version: 2,
      kind: 'retirement',
      domain: 'retired.example',
      checks: { autoRenewDisabled: true },
      customChecks: [
        { id: 'vendor-offboarding', label: 'External service access is removed', expected: true, value: true },
        { id: 'archive-review', label: 'Required records are archived', expected: true, value: null },
        { id: 'redirect-disabled', label: 'Legacy redirect is disabled', expected: false, value: true },
      ],
    }, NOW);
    assert.equal(document.version, 2);
    assert.equal(document.result.kind, 'retirement');
    assert.equal(document.result.checks.find((check) => check.id === 'vendor-offboarding')?.state, 'confirmed');
    assert.equal(document.result.checks.find((check) => check.id === 'archive-review')?.state, 'not_checked');
    assert.equal(document.result.checks.find((check) => check.id === 'redirect-disabled')?.state, 'not_confirmed');
    assert.equal(document.result.review.state, 'needs_review');
  });

  test('rejects reader-only version 1 and duplicate current custom retirement checks', () => {
    const base = {
      schema: DOMAIN_ASSURANCE_INPUT_SCHEMA,
      kind: 'retirement',
      domain: 'retired.example',
      checks: { autoRenewDisabled: true },
    } as const;
    assert.throws(() => buildDomainAssurance({
      ...base,
      version: 1,
      customChecks: [],
    }, NOW), /version 2/u);
    assert.throws(() => buildDomainAssurance({
      ...base,
      version: 2,
      customChecks: [
        { id: 'archive-review', label: 'First', expected: true, value: true },
        { id: 'archive-review', label: 'Second', expected: true, value: true },
      ],
    }, NOW), /duplicated/u);
    assert.throws(() => buildDomainAssurance({
      ...base,
      version: 2,
      customChecks: Array.from({ length: 21 }, (_, index) => ({
        id: `custom-${index}`, label: `Custom ${index}`, expected: true, value: null,
      })),
    }, NOW), /0 to 20 items/u);
  });

  test('rejects secret-like oversized labels and observed states without evidence references', () => {
    assert.throws(() => buildDomainAssurance({
      schema: DOMAIN_ASSURANCE_INPUT_SCHEMA,
      version: DOMAIN_ASSURANCE_VERSION,
      kind: 'planned-change',
      domain: 'change.example',
      change: {
        reference: 'CHG-1', startsAt: '2026-08-05T00:00:00Z', endsAt: '2026-08-05T01:00:00Z',
        milestones: [{
          id: 'dns', label: 'DNS', expectedBy: '2026-08-05T00:30:00Z', evidenceSource: 'DNS',
          state: 'observed', observedAt: '2026-08-05T00:20:00Z',
        }],
        rollbackCriteria: [{ id: 'x', condition: 'Failure', owner: 'Lead', state: 'not_met' }],
        postChangeChecks: [{ id: 'y', label: 'Check', expectedState: 'OK', evidenceSource: 'DNS', state: 'not_checked' }],
      },
    }, NOW), /require observedAt and evidenceReference/u);
  });

  test('explains every negative planned-change state', () => {
    const document = buildDomainAssurance({
      schema: DOMAIN_ASSURANCE_INPUT_SCHEMA,
      version: DOMAIN_ASSURANCE_VERSION,
      kind: 'planned-change',
      domain: 'change.example',
      change: {
        reference: 'CHG-2', startsAt: '2026-08-05T00:00:00Z', endsAt: '2026-08-05T01:00:00Z',
        milestones: [{
          id: 'dns', label: 'DNS', expectedBy: '2026-08-05T00:30:00Z', evidenceSource: 'DNS',
          state: 'missed', observedAt: '2026-08-05T00:40:00Z', evidenceReference: 'packet:dns',
        }],
        rollbackCriteria: [{ id: 'x', condition: 'Failure', owner: 'Lead', state: 'met' }],
        postChangeChecks: [{
          id: 'y', label: 'Check', expectedState: 'OK', evidenceSource: 'DNS',
          state: 'unexpected', evidenceReference: 'packet:check',
        }],
      },
    }, NOW);
    assert.equal(document.result.kind, 'planned-change');
    assert.equal(document.result.review.state, 'needs_review');
    assert.deepEqual(document.result.review.reasons, [
      'One or more change milestones were missed.',
      'One or more rollback criteria were met.',
      'One or more post-change checks produced an unexpected result.',
    ]);
  });

  test('rejects unknown fields and evidence on unfinished checks', () => {
    assert.throws(() => buildDomainAssurance({
      schema: DOMAIN_ASSURANCE_INPUT_SCHEMA,
      version: DOMAIN_ASSURANCE_VERSION,
      kind: 'retirement',
      domain: 'retired.example',
      checks: { autoRenewDisabled: true },
      credential: 'must-not-be-accepted',
    }, NOW), /unknown field: credential/u);

    assert.throws(() => buildDomainAssurance({
      schema: DOMAIN_ASSURANCE_INPUT_SCHEMA,
      version: DOMAIN_ASSURANCE_VERSION,
      kind: 'planned-change',
      domain: 'change.example',
      change: {
        reference: 'CHG-3', startsAt: '2026-08-05T00:00:00Z', endsAt: '2026-08-05T01:00:00Z',
        milestones: [{
          id: 'dns', label: 'DNS', expectedBy: '2026-08-05T00:30:00Z', evidenceSource: 'DNS',
          state: 'planned', evidenceReference: 'stale-reference',
        }],
        rollbackCriteria: [{ id: 'x', condition: 'Failure', owner: 'Lead', state: 'not_checked' }],
        postChangeChecks: [{ id: 'y', label: 'Check', expectedState: 'OK', evidenceSource: 'DNS', state: 'not_checked' }],
      },
    }, NOW), /cannot contain observation evidence/u);
  });
});
