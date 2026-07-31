import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCertificatePolicyReview } from '../frontend/src/lib/analysis/certificate-policy-review.ts';
import type { DesiredPostureBaseline } from '../frontend/src/lib/analysis/brand-profile-model.ts';

const baseline: DesiredPostureBaseline = {
  version: 1,
  domain: 'example.test',
  nameservers: [],
  ds: [],
  mx: [],
  caa: [],
  tlsIssuer: 'Example Issuer',
  tlsSpkiSha256: 'a'.repeat(64),
  registrarLock: 'unconfigured',
  renewalReviewAt: null,
  suppressions: [],
  note: '',
  previousObservation: null,
  updatedAt: '2026-07-31T00:00:00.000Z',
};

test('certificate policy review aligns a recognized issuer with target CAA', () => {
  const review = buildCertificatePolicyReview({
    dnsEvidence: { source: 'dns', status: 'success', complete: true, records: {} },
    dnsRecords: { caa: [{ tag: 'issue', value: 'letsencrypt.org', critical: 0 }] },
    tlsEvidence: { source: 'tls', status: 'success', complete: true },
    tlsIssuer: { organization: "Let's Encrypt" },
    tlsPublicKey: { fingerprintSha256: 'a'.repeat(64) },
    baseline: { ...baseline, tlsIssuer: "Let's Encrypt" },
  });
  assert.equal(review.findings.find((item) => item.id === 'caa')?.state, 'aligned');
  assert.equal(review.findings.find((item) => item.id === 'expected_issuer')?.state, 'aligned');
  assert.equal(review.findings.find((item) => item.id === 'expected_spki')?.state, 'aligned');
});

test('certificate policy review reports apparent mismatch without claiming historic violation', () => {
  const review = buildCertificatePolicyReview({
    dnsEvidence: { source: 'dns', status: 'success', complete: true },
    dnsRecords: { caa: [{ tag: 'issue', value: 'pki.goog', critical: 0 }] },
    tlsEvidence: { source: 'tls', status: 'success', complete: true },
    tlsIssuer: { organization: "Let's Encrypt" },
  });
  const caa = review.findings.find((item) => item.id === 'caa');
  assert.equal(caa?.state, 'apparently_outside_current_policy');
  assert.match(caa?.limitations.join(' ') ?? '', /cannot establish which policy applied/u);
});

test('absent target CAA remains indeterminate because parent inheritance was not collected', () => {
  const review = buildCertificatePolicyReview({
    dnsEvidence: { source: 'dns', status: 'not_found', complete: true },
    dnsRecords: { caa: [] },
    tlsEvidence: { source: 'tls', status: 'success', complete: true },
    tlsIssuer: { organization: 'Example Issuer' },
  });
  const caa = review.findings.find((item) => item.id === 'caa');
  assert.equal(caa?.state, 'no_target_policy_observed');
  assert.match(caa?.detail ?? '', /Parent-label inheritance was not collected/u);
});

test('unavailable current evidence never becomes a mismatch', () => {
  const review = buildCertificatePolicyReview({
    dnsEvidence: { source: 'dns', status: 'partial', complete: false },
    dnsRecords: { caa: [{ tag: 'issue', value: 'pki.goog', critical: 0 }] },
    tlsEvidence: { source: 'tls', status: 'partial', complete: false },
    tlsIssuer: {},
    baseline,
  });
  assert.equal(review.findings.find((item) => item.id === 'caa')?.state, 'indeterminate');
  assert.equal(review.findings.find((item) => item.id === 'expected_issuer')?.state, 'indeterminate');
  assert.equal(review.findings.find((item) => item.id === 'expected_spki')?.state, 'indeterminate');
});
