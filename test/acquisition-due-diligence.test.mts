import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildAcquisitionDueDiligence } from '../frontend/src/lib/analysis/acquisition-due-diligence.ts';

describe('acquisition due-diligence projection', () => {
  test('keeps a registry non-existence observation separate from acquisition eligibility', () => {
    const review = buildAcquisitionDueDiligence({
      availability: {
        state: 'available',
        confidence: 'high',
        source: 'rdap',
      },
      registryInsights: {
        publications: [{ state: 'complete' }],
        lifecycle: { rawStatuses: [], locks: { client: false, server: false } },
      },
    });

    assert.equal(review.state, 'unregistered_observation');
    assert.equal(review.version, 2);
    assert.equal(review.items[0]?.state, 'authoritative');
    assert.match(review.items[0]?.detail ?? '', /at collection time/u);
    assert.match(review.nextSteps[0] ?? '', /eligibility, price, and contractual terms/u);
    assert.match(review.limitations[0] ?? '', /does not value a domain/u);
  });

  test('maps observed transition dependencies and keeps registry policy as manual review', () => {
    const review = buildAcquisitionDueDiligence({
      availability: {
        domain: 'candidate.example',
        state: 'registered',
        confidence: 'high',
        source: 'rdap',
      },
      registryInsights: {
        lifecycle: {
          rawStatuses: ['client transfer prohibited'],
          locks: { client: true, server: false },
        },
        publications: [{ state: 'complete' }],
      },
      activationContext: {
        web: { state: 'response_observed' },
        mail: { state: 'authenticated_mail' },
      },
      dnsEvidence: { source: 'dns', complete: true },
      dnsRecords: {
        a: ['192.0.2.10'],
        aaaa: [],
        cname: [],
        ns: ['ns1.example'],
        mx: [{ priority: 10, exchange: 'mail.example' }],
        spf: ['v=spf1 -all'],
        dmarc: ['v=DMARC1; p=reject'],
      },
      tlsEvidence: { source: 'tls', status: 'success', complete: true },
    });

    assert.deepEqual(
      review.transitionDependencies.map((item) => item.id),
      ['nameservers', 'web', 'mail', 'tls'],
    );
    assert.ok(review.transitionDependencies.every((item) => item.state === 'observed'));
    assert.equal(review.policyChecks.length, 3);
    assert.equal(review.policyChecks[0]?.state, 'review');
    assert.match(review.policyChecks[0]?.label ?? '', /\.example eligibility/u);
    assert.match(review.policyChecks[2]?.detail ?? '', /lock evidence was observed/u);
  });

  test('keeps incomplete transition sources unavailable', () => {
    const review = buildAcquisitionDueDiligence({
      availability: { domain: 'candidate.example', state: 'unknown' },
      registryInsights: { publications: [{ state: 'unavailable' }] },
      dnsEvidence: { source: 'dns', complete: false },
      dnsRecords: {},
      tlsEvidence: { source: 'tls', status: 'error', complete: false },
    });

    assert.equal(review.transitionDependencies[0]?.state, 'unavailable');
    assert.equal(review.transitionDependencies[1]?.state, 'unavailable');
    assert.equal(review.transitionDependencies[2]?.state, 'unavailable');
    assert.equal(review.transitionDependencies[3]?.state, 'unavailable');
    assert.equal(review.policyChecks[1]?.state, 'unavailable');
    assert.match(review.policyChecks[1]?.detail ?? '', /No usable registry publication/u);
  });

  test('organizes lifecycle, transfer, service, and contact observations without predicting release', () => {
    const review = buildAcquisitionDueDiligence({
      availability: {
        state: 'expiring',
        confidence: 'medium',
        source: 'rdap',
        expiryDateIso: '2026-08-10T00:00:00.000Z',
        expiresInDays: 13,
      },
      registryInsights: {
        lifecycle: {
          stage: 'redemption',
          label: 'Redemption period',
          rawStatuses: ['redemption period', 'client transfer prohibited'],
          locks: { client: true, server: false },
        },
        publications: [{ state: 'complete' }],
        abuseRouting: [{ channel: 'email' }],
      },
      activationContext: {
        web: { state: 'response_observed', label: 'Web response observed' },
        mail: { state: 'mail_auth_gap', label: 'Mail authentication gap' },
      },
    });

    assert.equal(review.state, 'review_transition');
    assert.equal(review.items[1]?.state, 'review');
    assert.equal(review.items[2]?.state, 'observed');
    assert.equal(review.items[3]?.state, 'observed');
    assert.equal(review.items[4]?.state, 'observed');
    assert.match(review.items[1]?.detail ?? '', /does not guarantee deletion/u);
  });

  test('preserves unavailable source states rather than inferring clean lifecycle or service evidence', () => {
    const review = buildAcquisitionDueDiligence({
      availability: { state: 'unknown', confidence: 'low' },
      registryInsights: {
        publications: [
          { state: 'unavailable' },
          { state: 'partial' },
        ],
      },
      activationContext: {
        web: { state: 'inconclusive' },
        mail: { state: 'inconclusive' },
      },
    });

    assert.equal(review.state, 'incomplete');
    assert.equal(review.items[0]?.state, 'unavailable');
    assert.equal(review.items[1]?.state, 'unavailable');
    assert.equal(review.items[2]?.state, 'unavailable');
    assert.equal(review.items[3]?.state, 'unavailable');
    assert.equal(review.items[4]?.state, 'unavailable');
    assert.match(review.label, /5 due-diligence areas unavailable/u);
  });

  test('treats a sale signal as a review lead rather than a verified offer', () => {
    const review = buildAcquisitionDueDiligence({
      availability: {
        state: 'for_sale',
        confidence: 'medium',
        source: 'rdap',
      },
    });

    assert.equal(review.state, 'sale_signal');
    assert.equal(review.items[0]?.state, 'review');
    assert.match(review.items[0]?.detail ?? '', /not a verified offer, price, or ownership statement/u);
  });
});
