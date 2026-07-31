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
  tlsSanPatterns: ['example.test', '*.example.test'],
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
    tlsAltNames: { dnsNames: ['example.test', 'www.example.test'] },
    baseline: { ...baseline, tlsIssuer: "Let's Encrypt" },
  });
  assert.equal(review.findings.find((item) => item.id === 'caa')?.state, 'aligned');
  assert.equal(review.findings.find((item) => item.id === 'expected_issuer')?.state, 'aligned');
  assert.equal(review.findings.find((item) => item.id === 'expected_san')?.state, 'aligned');
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

test('completed inherited CAA is used as the effective certificate-policy source', () => {
  const review = buildCertificatePolicyReview({
    dnsEvidence: {
      source: 'dns',
      status: 'success',
      complete: true,
      caaPolicy: {
        policyVersion: 1,
        source: 'dns',
        status: 'success',
        complete: true,
        truncated: false,
        effectiveOwner: 'example.test',
        inherited: true,
        records: [{ tag: 'issue', value: 'letsencrypt.org', critical: 0 }],
      },
    },
    dnsRecords: { caa: [] },
    tlsEvidence: { source: 'tls', status: 'success', complete: true },
    tlsIssuer: { organization: "Let's Encrypt" },
  });
  const caa = review.findings.find((item) => item.id === 'caa');
  assert.equal(caa?.state, 'aligned');
  assert.match(caa?.detail ?? '', /at example\.test/u);
});

test('unavailable current evidence never becomes a mismatch', () => {
  const review = buildCertificatePolicyReview({
    dnsEvidence: { source: 'dns', status: 'partial', complete: false },
    dnsRecords: { caa: [{ tag: 'issue', value: 'pki.goog', critical: 0 }] },
    tlsEvidence: { source: 'tls', status: 'partial', complete: false },
    tlsIssuer: {},
    tlsAltNames: {},
    baseline,
  });
  assert.equal(review.findings.find((item) => item.id === 'caa')?.state, 'indeterminate');
  assert.equal(review.findings.find((item) => item.id === 'expected_issuer')?.state, 'indeterminate');
  assert.equal(review.findings.find((item) => item.id === 'expected_san')?.state, 'indeterminate');
  assert.equal(review.findings.find((item) => item.id === 'expected_spki')?.state, 'indeterminate');
});

test('certificate policy review reports missing reviewed SAN patterns without treating extra names as malicious', () => {
  const review = buildCertificatePolicyReview({
    dnsEvidence: { source: 'dns', status: 'success', complete: true },
    dnsRecords: { caa: [] },
    tlsEvidence: { source: 'tls', status: 'success', complete: true },
    tlsIssuer: { organization: 'Example Issuer' },
    tlsAltNames: { dnsNames: ['example.test', 'deep.unexpected.example.test'] },
    baseline,
  });
  const finding = review.findings.find((item) => item.id === 'expected_san');
  assert.equal(finding?.state, 'changed');
  assert.match(finding?.limitations.join(' ') ?? '', /do not establish compromise/u);
});
