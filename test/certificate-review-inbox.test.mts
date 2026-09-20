import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildCertificateReviewInbox } from '../frontend/src/lib/analysis/certificate-review-inbox.ts';
import { buildAnalystReviewInbox } from '../frontend/src/lib/analysis/analyst-review-inbox.ts';
import { normalizeBrandProfile } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import { createCase, serializeCaseStore, MAX_CASE_STORE_BYTES } from '../frontend/src/lib/analysis/case-model.ts';
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
  test('does not borrow a baseline edit time when live evidence is missing', () => {
    const inbox = buildCertificateReviewInbox([profile()], [], { now: NOW });
    assert.ok(inbox.findings.length > 0);
    assert.ok(inbox.findings.every((entry) => entry.observedAt === '' && entry.item.age === 'unknown'));
  });

  test('retains equal-time live facts as an order-invariant review instead of choosing a value', () => {
    const first = { ...retainedFact('tls.issuer', 'Fixture issuer'), id: 'issuer-one' };
    const second = { ...retainedFact('tls.issuer', 'Different issuer'), id: 'issuer-two' };
    const single = buildCertificateReviewInbox([profile()], [first], { now: NOW }).findings.find((entry) => entry.label.startsWith('Expected live TLS issuer'))!;
    const select = (records: typeof first[]) => buildCertificateReviewInbox([profile()], records, { now: NOW }).findings.find((entry) => entry.label.startsWith('Review retained TLS issuer'))!;
    const ambiguous = select([first, second]);
    assert.equal(ambiguous.state, 'partial');
    assert.equal(ambiguous.kind, 'ambiguous_observation');
    assert.equal(ambiguous.item.completeness, 'inconclusive');
    assert.equal(ambiguous.item.caseId, null);
    assert.match(ambiguous.detail, /2 retained facts in 2 Cases/u);
    assert.deepEqual(select([second, first]), ambiguous);
    assert.equal(ambiguous.item.subjectKey, single.item.subjectKey);
    assert.notEqual(ambiguous.item.materialFingerprint, single.item.materialFingerprint);
    const older = { ...second, evidencePins: second.evidencePins.map((pin) => ({ ...pin, observedAt: '2026-08-22T00:00:00.000Z' })) };
    assert.equal(buildCertificateReviewInbox([profile()], [first, older], { now: NOW }).findings.find((entry) => entry.label.startsWith('Expected live TLS issuer'))?.item.caseId, first.id);
  });

  test('retains uncertainty for undated, future, unusable and source-incomplete field evidence', () => {
    const first = retainedFact('tls.issuer', 'Fixture issuer');
    for (const observedAt of ['', '2026-02-30T00:00:00Z', '2026-08-24T00:00:00Z']) {
      const record = { ...first, evidencePins: first.evidencePins.map((pin) => ({ ...pin, observedAt })) };
      const result = buildCertificateReviewInbox([profile()], [record], { now: NOW });
      const issuer = result.findings.find((entry) => entry.label.startsWith('Review retained TLS issuer'))!;
      assert.equal(issuer.state, 'partial');
      assert.equal(issuer.item.age, 'unknown');
      assert.ok(!result.findings.some((entry) => entry.label.startsWith('Expected live TLS issuer')));
    }
    const expiry = retainedFact('tls.valid_to', '2026-08-22T00:00:00Z');
    const malformed = { ...expiry, id: 'malformed-expiry', evidencePins: expiry.evidencePins.map((pin) => ({ ...pin, value: '2026-02-30T00:00:00Z', observedAt: '2026-08-23T00:00:00Z' })) };
    const older = { ...expiry, evidencePins: expiry.evidencePins.map((pin) => ({ ...pin, observedAt: '2026-08-22T00:00:00Z' })) };
    const invalid = buildCertificateReviewInbox([profile()], [older, malformed], { now: NOW });
    assert.ok(!invalid.findings.some((entry) => entry.kind === 'expired_acknowledgement'));
    assert.ok(invalid.findings.some((entry) => /unusable value/u.test(entry.detail) && entry.notAfter === null));
    for (const [field, value] of [['tls.issuer', 'Fixture issuer'], ['tls.san_dns_names', 'certificate-review.example'], ['tls.spki_sha256', SPKI_DIGEST], ['dns.caa', '0 issue fixture-ca.example']] as const) {
      const record = retainedFact(field, value);
      record.evidencePins[0]!.sourceState = 'inconclusive';
      const result = buildCertificateReviewInbox([profile()], [record], { now: NOW });
      const incomplete = result.findings.find((entry) => entry.kind === 'incomplete_observation');
      assert.ok(incomplete);
      assert.equal(incomplete.state, 'partial');
      assert.doesNotMatch(incomplete.label, /Expected|Unexpected/u);
    }
  });

  test('does not infer renewals between equal-time or undated publication events', () => {
    const first = certificateCase();
    const second = certificateCase('Fixture issuer', '2026-12-01T00:00:00Z', { digest: 'd'.repeat(64), eventId: 'e'.repeat(64) });
    for (const records of [[first, second], [second, first], [{ ...first, evidencePins: first.evidencePins.map((pin) => ({ ...pin, observedAt: '' })) }, second]]) {
      const result = buildCertificateReviewInbox([profile()], records, { now: NOW });
      const publications = result.findings.filter((entry) => entry.evidenceClass === 'certificate_transparency');
      assert.equal(publications.length, 2);
      assert.ok(publications.every((entry) => entry.kind !== 'renewal' && entry.kind !== 'expected_renewal'));
      assert.ok(publications.some((entry) => entry.limitations.some((limitation) => /do not establish a certificate renewal sequence/u.test(limitation))));
    }
    const future = certificateCase('Fixture issuer', '2026-12-01T00:00:00Z', { observedAt: '2026-08-24T00:00:00Z' });
    const publication = buildCertificateReviewInbox([profile()], [future], { now: NOW }).findings.find((entry) => entry.evidenceClass === 'certificate_transparency')!;
    assert.equal(publication.item.age, 'unknown');
    assert.equal(publication.kind, 'incomplete_observation');
    assert.equal(publication.state, 'partial');
  });

  test('uses protocol-owned CAA comparison without folding case-sensitive payloads', () => {
    const configured = profile();
    configured.desiredPostureBaselines[0]!.caa = ['0 iodef https://report.example/CaseSensitive'];
    const different = buildCertificateReviewInbox([configured], [retainedFact('dns.caa', '0 iodef https://report.example/casesensitive')], { now: NOW });
    assert.equal(different.findings.find((entry) => entry.evidenceClass === 'caa')?.state, 'review');
    const matching = buildCertificateReviewInbox([configured], [retainedFact('dns.caa', '0 IODEF "https://REPORT.EXAMPLE/CaseSensitive"')], { now: NOW });
    assert.equal(matching.findings.find((entry) => entry.evidenceClass === 'caa')?.state, 'expected');
    const malformed = buildCertificateReviewInbox([configured], [retainedFact('dns.caa', 'arbitrary retained text')], { now: NOW });
    assert.equal(malformed.findings.find((entry) => entry.evidenceClass === 'caa')?.kind, 'ambiguous_observation');
  });

  test('fingerprints more than 2,000 ambiguous pins without dropping admitted candidates', () => {
    const template = retainedFact('tls.issuer', 'Fixture issuer');
    const records = Array.from({ length: 51 }, (_, index) => ({
      ...template, id: `cohort-case-${index}`,
      evidencePins: Array.from({ length: 40 }, (_, pinIndex) => ({ ...template.evidencePins[0]!, id: `cohort-pin-${index}-${pinIndex}` })),
    }));
    assert.ok(Buffer.byteLength(serializeCaseStore(records)) < MAX_CASE_STORE_BYTES);
    const selected = (input: typeof records) => buildCertificateReviewInbox([profile()], input, { now: NOW }).findings.find((entry) => entry.kind === 'ambiguous_observation')!;
    const first = selected(records);
    assert.match(first.detail, /2040 retained facts in 51 Cases/u);
    assert.deepEqual(selected([...records].reverse()), first);
    records[50]!.evidencePins[39]!.value = 'Changed retained issuer';
    assert.notEqual(selected(records).item.materialFingerprint, first.item.materialFingerprint);
  });
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
