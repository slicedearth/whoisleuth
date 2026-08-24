import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildCertificateReviewInbox } from '../frontend/src/lib/analysis/certificate-review-inbox.ts';
import { buildAnalystReviewInbox } from '../frontend/src/lib/analysis/analyst-review-inbox.ts';
import { normalizeBrandProfile } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import { createCase } from '../frontend/src/lib/analysis/case-model.ts';
import { requiredValue } from './value-assertions.mts';
import { LOOKUP_EVIDENCE_SCHEMA_VERSION } from '../lib/evidence-export.mts';
import {
  emptyAnalystReviewStateStore,
  setAnalystReviewDecision,
} from '../frontend/src/lib/analysis/analyst-review-state.ts';

const NOW = '2026-08-23T00:00:00.000Z';
const CERTIFICATE_DIGEST = 'a'.repeat(64);
const EVENT_ID = 'b'.repeat(64);
const SPKI_DIGEST = 'c'.repeat(64);

function profile() {
  return requiredValue(normalizeBrandProfile({
    id: 'certificate-profile',
    name: 'Certificate profile',
    officialDomains: ['certificate-review.example'],
    desiredPostureBaselines: [{
      domain: 'certificate-review.example',
      caa: ['0 issue fixture-ca.example'],
      tlsIssuer: 'Fixture issuer',
      tlsSanPatterns: ['certificate-review.example'],
      tlsSpkiSha256: SPKI_DIGEST,
      updatedAt: NOW,
    }],
    createdAt: NOW,
    updatedAt: NOW,
  }));
}

function certificateCase(
  issuer = 'Fixture issuer',
  notAfter = '2026-12-01T00:00:00.000Z',
  options: Readonly<{ digest?: string; eventId?: string; observedAt?: string }> = {},
) {
  const digest = options.digest ?? CERTIFICATE_DIGEST;
  const eventId = options.eventId ?? EVENT_ID;
  const observedAt = options.observedAt ?? NOW;
  return createCase({
    domain: 'certificate-review.example',
    source: 'import',
    evidencePin: {
      label: 'Retained certificate publication',
      value: digest,
      field: 'certificateSha256',
      category: 'certificate',
      source: 'Certificate publication import',
      sourceSchema: { collection: 'external_observations', schema: 'whoisleuth.certificate-observation-rows', version: 1 },
      observedAt,
      completeness: 'complete',
      limitations: [],
      certificateObservation: {
        eventId,
        logId: 'fixture-log',
        certificateSha256: digest,
        issuer,
        notAfter,
        dnsNameCount: 1,
        namesComplete: true,
      },
    },
  }, NOW);
}

function retainedFact(field: string, value: string) {
  return createCase({
    domain: 'certificate-review.example',
    source: 'lookup',
    evidencePin: {
      label: field,
      value,
      field,
      category: field.includes('caa') ? 'dns' : 'tls',
      source: 'Retained Deep lookup fact',
      sourceSchema: { collection: 'lookup', schema: 'whoisleuth.lookup-evidence', version: LOOKUP_EVIDENCE_SCHEMA_VERSION },
      observedAt: NOW,
      completeness: 'complete',
      limitations: [],
    },
  }, NOW);
}

describe('central retained certificate review inbox', () => {
  test('keeps missing live TLS, CAA, and SPKI evidence explicitly unavailable', () => {
    const inbox = buildCertificateReviewInbox([profile()], [], { now: NOW });
    assert.equal(inbox.profileCount, 1);
    assert.equal(inbox.domainCount, 1);
    assert.ok(inbox.findings.some((finding) => finding.evidenceClass === 'live_tls' && finding.state === 'unavailable'));
    assert.ok(inbox.findings.some((finding) => finding.evidenceClass === 'caa' && finding.state === 'unavailable'));
    assert.ok(inbox.findings.some((finding) => finding.evidenceClass === 'spki' && finding.state === 'unavailable'));
    assert.ok(inbox.findings.every((finding) => finding.item.completeness !== 'complete'));
  });

  test('separates historical publication, certificate digest, SPKI, and CAA context', () => {
    const inbox = buildCertificateReviewInbox([profile()], [
      certificateCase(),
      retainedFact('tls.issuer', 'Fixture issuer'),
      retainedFact('tls.san_dns_names', 'certificate-review.example'),
      retainedFact('tls.certificate_sha256', CERTIFICATE_DIGEST),
      retainedFact('tls.spkiSha256', SPKI_DIGEST),
      retainedFact('dns.caa', '0 issue fixture-ca.example'),
    ], { now: NOW });
    const publication = requiredValue(inbox.findings.find((finding) => finding.evidenceClass === 'certificate_transparency'));
    assert.equal(publication.kind, 'expected_observation');
    assert.equal(publication.state, 'expected');
    assert.equal(publication.certificateSha256, CERTIFICATE_DIGEST);
    assert.equal(publication.spkiSha256, null);
    assert.match(publication.limitations.join(' '), /not proof of live deployment/iu);
    assert.ok(inbox.findings.some((finding) => finding.evidenceClass === 'live_tls' && finding.state === 'expected'));
    const digest = requiredValue(inbox.findings.find((finding) => finding.evidenceClass === 'certificate_digest'));
    assert.equal(digest.kind, 'retained_certificate_digest');
    assert.equal(digest.certificateSha256, CERTIFICATE_DIGEST);
    assert.equal(digest.spkiSha256, null);
    assert.equal(inbox.findings.find((finding) => finding.evidenceClass === 'spki')?.kind, 'expected_observation');
    assert.equal(inbox.findings.find((finding) => finding.evidenceClass === 'spki')?.state, 'expected');
    assert.equal(inbox.findings.find((finding) => finding.evidenceClass === 'caa')?.kind, 'expected_observation');
    assert.equal(inbox.findings.find((finding) => finding.evidenceClass === 'caa')?.state, 'expected');
  });

  test('keeps routine expected observations informational until an explicit review becomes due', () => {
    const records = [certificateCase()];
    const initial = buildCertificateReviewInbox([profile()], records, { now: NOW });
    const expected = requiredValue(initial.findings.find((finding) => (
      finding.evidenceClass === 'certificate_transparency' && finding.state === 'expected'
    )));
    assert.equal(initial.reviewItems.some((item) => item.subjectKey === expected.item.subjectKey), false);

    const currentDecision = setAnalystReviewDecision(emptyAnalystReviewStateStore(), expected.item, {
      disposition: 'expected',
      rationale: 'The exact retained publication matches the reviewed posture.',
      reviewedAt: '2026-08-22T00:00:00.000Z',
      expiresAt: '2026-08-24T00:00:00.000Z',
    });
    const current = buildCertificateReviewInbox([profile()], records, { now: NOW, reviewState: currentDecision });
    assert.equal(current.reviewItems.some((item) => item.subjectKey === expected.item.subjectKey), false);
    assert.ok(current.reviewAdmission.currentSubjectKeys?.includes(expected.item.subjectKey));
    const unified = buildAnalystReviewInbox({
      reviewState: currentDecision,
      projectedItems: current.reviewItems,
      projectedAdmissions: [current.reviewAdmission],
    }, NOW);
    assert.equal(unified.items.some((item) => item.subjectKey === expected.item.subjectKey), false);
    assert.equal(unified.items.some((item) => item.kind === 'orphaned_state'), false);

    const dueDecision = setAnalystReviewDecision(emptyAnalystReviewStateStore(), expected.item, {
      disposition: 'expected',
      rationale: 'The exact retained publication was expected only through the reviewed window.',
      reviewedAt: '2026-08-21T00:00:00.000Z',
      expiresAt: '2026-08-22T00:00:00.000Z',
    });
    const due = buildCertificateReviewInbox([profile()], records, { now: NOW, reviewState: dueDecision });
    assert.ok(due.reviewItems.some((item) => item.subjectKey === expected.item.subjectKey));
  });

  test('keeps live TLS, CT publication, certificate digest, and SPKI comparisons independent', () => {
    const inbox = buildCertificateReviewInbox([profile()], [
      certificateCase('Different CT issuer'),
      retainedFact('tls.issuer', 'Fixture issuer'),
      retainedFact('tls.san_dns_names', 'certificate-review.example · unexpected.example'),
      retainedFact('tls.certificate_sha256', 'd'.repeat(64)),
      retainedFact('tls.spkiSha256', SPKI_DIGEST),
    ], { now: NOW });
    assert.equal(inbox.findings.find((finding) => finding.evidenceClass === 'certificate_transparency')?.state, 'review');
    assert.ok(inbox.findings.some((finding) => finding.evidenceClass === 'live_tls' && finding.kind === 'expected_observation'));
    assert.ok(inbox.findings.some((finding) => finding.evidenceClass === 'live_tls' && finding.kind === 'unexpected_san'));
    assert.equal(inbox.findings.find((finding) => finding.evidenceClass === 'certificate_digest')?.certificateSha256, 'd'.repeat(64));
    assert.equal(inbox.findings.find((finding) => finding.evidenceClass === 'spki')?.spkiSha256, SPKI_DIGEST);
  });

  test('projects issuer differences and expiry without making an issuance claim', () => {
    const issuerInbox = buildCertificateReviewInbox([profile()], [certificateCase('Different issuer')], { now: NOW });
    const issuer = requiredValue(issuerInbox.findings.find((finding) => finding.evidenceClass === 'certificate_transparency'));
    assert.equal(issuer.kind, 'unexpected_issuer');
    assert.equal(issuer.state, 'review');

    const expiredInbox = buildCertificateReviewInbox([profile()], [certificateCase('Fixture issuer', '2026-08-22T00:00:00.000Z')], { now: NOW });
    const expired = requiredValue(expiredInbox.findings.find((finding) => finding.kind === 'expired_acknowledgement'));
    assert.equal(expired.state, 'expired');
    assert.equal(expired.item.dueAt, '2026-08-22T00:00:00.000Z');
    assert.match(expired.detail, /lifecycle/iu);
  });

  test('keeps an unconfigured CT publication as historical context without deployment confirmation', () => {
    const historicalProfile = requiredValue(normalizeBrandProfile({
      id: 'historical-certificate-profile',
      name: 'Historical certificate profile',
      officialDomains: ['certificate-review.example'],
      desiredPostureBaselines: [{
        domain: 'certificate-review.example',
        updatedAt: NOW,
      }],
      createdAt: NOW,
      updatedAt: NOW,
    }));
    const inbox = buildCertificateReviewInbox([historicalProfile], [certificateCase()], { now: NOW });
    const historical = requiredValue(inbox.findings.find((finding) => finding.evidenceClass === 'certificate_transparency'));
    assert.equal(historical.kind, 'historical_ct_no_deployment');
    assert.equal(historical.state, 'review');
    assert.match(historical.detail, /without live deployment confirmation/iu);
  });

  test('keeps an unreviewed certificate renewal open until an analyst records an expectation', () => {
    const inbox = buildCertificateReviewInbox([profile()], [
      certificateCase('Fixture issuer', '2026-12-01T00:00:00.000Z', {
        observedAt: '2026-08-21T00:00:00.000Z',
      }),
      certificateCase('Fixture issuer', '2026-12-01T00:00:00.000Z', {
        digest: 'd'.repeat(64),
        eventId: 'e'.repeat(64),
        observedAt: '2026-08-22T00:00:00.000Z',
      }),
    ], { now: NOW });
    const renewal = requiredValue(inbox.findings.find((finding) => finding.kind === 'renewal'));
    assert.equal(renewal.state, 'review');
    assert.match(renewal.detail, /before treating it as an expected renewal/iu);
  });

  test('recognises a matching renewal inside a reviewed change window without overriding posture differences', () => {
    const reviewedProfile = requiredValue(normalizeBrandProfile({
      ...profile(),
      desiredPostureBaselines: [{
        ...profile().desiredPostureBaselines[0],
        approvedChangeWindows: [{
          startsAt: '2026-08-21T12:00:00.000Z',
          endsAt: '2026-08-22T12:00:00.000Z',
          summary: 'Reviewed certificate rotation',
        }],
      }],
    }));
    const expected = buildCertificateReviewInbox([reviewedProfile], [
      certificateCase('Fixture issuer', '2026-12-01T00:00:00.000Z', {
        observedAt: '2026-08-21T00:00:00.000Z',
      }),
      certificateCase('Fixture issuer', '2026-12-01T00:00:00.000Z', {
        digest: 'd'.repeat(64),
        eventId: 'e'.repeat(64),
        observedAt: '2026-08-22T00:00:00.000Z',
      }),
    ], { now: NOW });
    const expectedRenewal = requiredValue(expected.findings.find((finding) => finding.kind === 'expected_renewal'));
    assert.equal(expectedRenewal.state, 'expected');
    assert.equal(expected.reviewItems.some((item) => item.subjectKey === expectedRenewal.item.subjectKey), false);

    const changedIssuer = buildCertificateReviewInbox([reviewedProfile], [
      certificateCase('Fixture issuer', '2026-12-01T00:00:00.000Z', {
        observedAt: '2026-08-21T00:00:00.000Z',
      }),
      certificateCase('Different issuer', '2026-12-01T00:00:00.000Z', {
        digest: 'd'.repeat(64),
        eventId: 'e'.repeat(64),
        observedAt: '2026-08-22T00:00:00.000Z',
      }),
    ], { now: NOW });
    assert.ok(changedIssuer.findings.some((finding) => finding.kind === 'unexpected_issuer' && finding.state === 'review'));
  });

  test('uses a stable subject key while material retained evidence changes', () => {
    const first = buildCertificateReviewInbox([profile()], [certificateCase('Different issuer')], { now: NOW });
    const second = buildCertificateReviewInbox([profile()], [certificateCase('Another issuer')], { now: NOW });
    const firstItem = requiredValue(first.findings.find((finding) => finding.kind === 'unexpected_issuer')).item;
    const secondItem = requiredValue(second.findings.find((finding) => finding.kind === 'unexpected_issuer')).item;
    assert.equal(firstItem.subjectKey, secondItem.subjectKey);
    assert.notEqual(firstItem.materialFingerprint, secondItem.materialFingerprint);
  });
});
