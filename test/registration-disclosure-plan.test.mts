import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRegistrationDisclosurePlan,
  registrationDisclosureFilename,
} from '../frontend/src/lib/analysis/registration-disclosure-plan.ts';

const observed = {
  domain: 'Example.Test',
  observedAt: '2026-08-04T01:02:03Z',
  registryRdapEndpoint: 'https://rdap.example.test/domain/example.test',
  registrarName: 'Example Registrar',
  registrarRdapEndpoint: 'https://registrar.example.test/rdap/domain/example.test',
  redactions: [{ name: 'Registrant Email', method: 'removal', reason: 'Server policy', prePath: '$.entities[0]' }],
};

test('registration disclosure plan keeps evidence and analyst claims separate', () => {
  const plan = buildRegistrationDisclosurePlan(observed, {
    purpose: 'cybersecurity-investigation',
    justification: 'The requested contact is needed to investigate a documented impersonation incident.',
    requestedFields: ['registrant-email'],
    publicDataReviewed: true,
    dataMinimised: true,
    rightsImpactConsidered: true,
    currentProcessReviewed: true,
    gtldScopeReviewed: true,
    registrarParticipationReviewed: true,
    requesterMaterialsReady: true,
    caseReference: 'CASE-104',
  }, '2026-08-04T02:00:00Z');

  assert.equal(plan.readiness, 'ready_for_manual_review');
  assert.equal(plan.submissionPerformed, false);
  assert.equal(plan.entitlementDetermined, false);
  assert.equal(plan.schemaVersion, 2);
  assert.equal(plan.serviceHandoff.submissionPerformed, false);
  assert.equal(plan.serviceHandoff.portalUrl, 'https://rdrs.icann.org/');
  assert.deepEqual(plan.observedEvidence.redactions, [{ name: 'Registrant Email', method: 'removal', reason: 'Server policy' }]);
  assert.deepEqual(plan.analystRequest.requestedFields, ['registrant-email']);
  assert.equal(plan.analystRequest.justification.includes('impersonation'), true);
  assert.equal(registrationDisclosureFilename(plan), 'whoisleuth-example.test-registration-disclosure-plan.json');
});

test('registration disclosure plan fails closed when review inputs are missing', () => {
  const plan = buildRegistrationDisclosurePlan({ domain: 'example.test', redactions: [] }, {}, '2026-08-04T02:00:00Z');
  assert.equal(plan.readiness, 'needs_input');
  assert.ok(plan.counts.block >= 6);
  assert.equal(plan.checks.find((item) => item.id === 'public-gap')?.state, 'caution');
  assert.match(plan.unknowns.join(' '), /eligible/i);
});

test('registration disclosure plan bounds and filters untrusted values', () => {
  const plan = buildRegistrationDisclosurePlan({
    domain: 'EXAMPLE.TEST\nignored',
    registryRdapEndpoint: 'http://insecure.example.test/',
    redactions: Array.from({ length: 80 }, (_, index) => ({ name: `Field ${index}`, reason: 'x'.repeat(500) })),
  }, {
    purpose: 'invented',
    requestedFields: ['registrant-email', 'invented', 'registrant-email'],
    justification: 'x'.repeat(9000),
  }, '2026-08-04T02:00:00Z');

  assert.equal(plan.observedEvidence.registryRdapEndpoint, null);
  assert.equal(plan.observedEvidence.redactions.length, 40);
  assert.equal(plan.observedEvidence.redactionsTruncated, true);
  assert.equal(plan.observedEvidence.redactions[0]?.reason?.length, 240);
  assert.deepEqual(plan.analystRequest.requestedFields, ['registrant-email']);
  assert.equal(plan.analystRequest.purpose, null);
  assert.equal(plan.analystRequest.justification.length, 4000);
});
