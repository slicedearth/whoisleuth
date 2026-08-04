import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DOMAIN_ASSURANCE_INPUT_SCHEMA,
  buildDomainAssurance,
} from '../lib/domain-assurance.mts';

const NOW = '2026-08-04T00:00:00.000Z';

describe('domain assurance', () => {
  test('keeps planned change observations and rollback decisions explicitly attributed', () => {
    const document = buildDomainAssurance({
      schema: DOMAIN_ASSURANCE_INPUT_SCHEMA,
      version: 1,
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
      version: 1,
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
      version: 1,
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

  test('rejects secret-like oversized labels and observed states without evidence references', () => {
    assert.throws(() => buildDomainAssurance({
      schema: DOMAIN_ASSURANCE_INPUT_SCHEMA,
      version: 1,
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
      version: 1,
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
      version: 1,
      kind: 'retirement',
      domain: 'retired.example',
      checks: { autoRenewDisabled: true },
      credential: 'must-not-be-accepted',
    }, NOW), /unknown field: credential/u);

    assert.throws(() => buildDomainAssurance({
      schema: DOMAIN_ASSURANCE_INPUT_SCHEMA,
      version: 1,
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
