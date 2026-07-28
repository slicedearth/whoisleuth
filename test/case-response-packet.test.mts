import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildCaseResponsePacket,
  buildCaseResponsePreflight,
  buildResponsePacketProfilePreview,
  caseResponsePacketFilename,
  CASE_RESPONSE_PACKET_SCHEMA,
  CASE_RESPONSE_PACKET_VERSION,
  MAX_ABUSIVE_URLS,
  RESPONSE_PACKET_PROFILES,
  verifyCaseResponsePacketIntegrity,
} from '../frontend/src/lib/analysis/case-response-packet.ts';
import { createCase, updateCase } from '../frontend/src/lib/analysis/case-model.ts';

const NOW = '2026-07-28T02:00:00.000Z';

function reviewedCase() {
  const created = createCase({
    domain: 'report.example',
    status: 'escalated',
    disposition: 'confirmed_abuse',
    evidence: { availability: 'registered', capturedAt: NOW },
  }, NOW);
  const reasoned = updateCase([created], created.id, {
    evidencePin: { label: 'Observed path', value: 'A credential form was observed.', observedAt: NOW },
    decision: { summary: 'Escalate', rationale: 'The selected evidence requires external review.' },
  }, NOW).record;
  return updateCase([reasoned], reasoned.id, {
    action: {
      type: 'registrar_report',
      recipient: 'Registrar abuse desk',
      contactSource: 'RDAP entity role',
      state: 'submitted',
      reference: 'CASE-123',
      outcome: 'Acknowledgement pending.',
    },
  }, NOW).record;
}

describe('case response packet', () => {
  test('builds reviewable JSON, Markdown, and email without a submission action', async () => {
    const result = await buildCaseResponsePacket(reviewedCase(), {
      profile: 'registrar',
      category: 'Credential phishing',
      affectedParty: 'Example service',
      abusiveUrls: ['https://report.example/sign-in?campaign=one'],
      observedHarm: 'The page requested account credentials.',
      observedAt: NOW,
      contacts: [
        {
          kind: 'registrar',
          contact: 'abuse@example.test',
          source: 'registrar RDAP',
          limitations: ['The mailbox has not been verified as monitored.'],
        },
        {
          kind: 'security_txt',
          contact: 'security@example.test',
          source: 'security.txt',
        },
      ],
    }, NOW);
    assert.equal(result.json.schema, CASE_RESPONSE_PACKET_SCHEMA);
    assert.equal(result.json.schemaVersion, CASE_RESPONSE_PACKET_VERSION);
    assert.equal(result.json.reviewRequired, true);
    assert.equal(result.json.submissionPerformed, false);
    assert.equal(result.json.profile.id, 'registrar');
    assert.match(result.json.profile.subject, /Reviewed domain abuse report/u);
    assert.equal(result.json.contacts.length, 2);
    assert.equal(result.json.provenance.evidencePinCount, 1);
    assert.equal(result.json.provenance.decisionCount, 1);
    assert.equal(result.json.provenance.observationAge.band, 'under_24_hours');
    assert.equal(result.json.escalationHistory.length, 1);
    assert.equal(result.json.escalationHistory[0]?.reference, 'CASE-123');
    assert.equal(result.json.preflight.canExport, true);
    assert.equal(result.json.preflight.status, 'ready_for_review');
    assert.equal(result.json.preflight.actionSummary.submitted, 1);
    assert.match(result.json.integrity.digestSha256, /^[a-f0-9]{64}$/u);
    assert.equal(await verifyCaseResponsePacketIntegrity(result.json), true);
    assert.match(result.markdown, /Separately routed|Escalation contacts/u);
    assert.match(result.markdown, /registrar RDAP/u);
    assert.match(result.markdown, /Canonical packet SHA-256/u);
    assert.match(result.email, /was not submitted automatically/u);
    assert.doesNotMatch(result.email, /mailto:/u);
  });

  test('requires all incident facts and at least one exact safe URL', async () => {
    const base = {
      category: 'Phishing',
      affectedParty: 'Example service',
      observedHarm: 'A credential request was observed.',
      observedAt: NOW,
    };
    await assert.rejects(buildCaseResponsePacket(reviewedCase(), { ...base, abusiveUrls: [] }, NOW), /required/u);
    await assert.rejects(buildCaseResponsePacket(reviewedCase(), { ...base, abusiveUrls: ['javascript:alert(1)'] }, NOW), /required/u);
    await assert.rejects(buildCaseResponsePacket(reviewedCase(), { ...base, abusiveUrls: ['https://user:secret@report.example/'] }, NOW), /required/u);
  });

  test('bounds and deduplicates URLs and contact routes', async () => {
    const urls = Array.from({ length: MAX_ABUSIVE_URLS + 5 }, (_, index) => `https://report.example/path-${index}`);
    urls.push(urls[0] ?? '');
    const result = await buildCaseResponsePacket(reviewedCase(), {
      category: 'Phishing',
      affectedParty: 'Example service',
      abusiveUrls: urls,
      observedHarm: 'A credential request was observed.',
      observedAt: NOW,
      contacts: [
        { kind: 'registry', contact: 'https://registry.example/report' },
        { kind: 'registry', contact: 'https://registry.example/report' },
        { kind: 'unknown', contact: 'ignored' },
      ],
    }, NOW);
    assert.equal(result.json.incident.abusiveUrls.length, MAX_ABUSIVE_URLS);
    assert.equal(result.json.contacts.length, 1);
  });

  test('removes every control character from packet fields and rendered drafts', async () => {
    const result = await buildCaseResponsePacket(reviewedCase(), {
      profile: 'security_contact',
      category: 'Credential\rphishing\nreview\u0007',
      affectedParty: 'Example\tservice\u007fteam',
      abusiveUrls: ['https://report.example/sign-in'],
      observedHarm: 'A credential\rform\nwas\u0007observed.',
      observedAt: NOW,
      contacts: [{
        kind: 'registrar',
        contact: 'abuse@example.test\r\n\u0007',
        source: 'registrar\tRDAP\u007f',
        limitations: ['Monitoring\rstatus\nis\u0007unknown.'],
      }],
    }, NOW);
    const control = /[\u0000-\u001f\u007f]/u;
    const renderedControl = /[\u0000-\u0009\u000b-\u001f\u007f]/u;
    const contact = result.json.contacts[0];

    for (const value of [
      result.json.incident.category,
      result.json.incident.affectedParty,
      result.json.incident.observedHarm,
      contact?.contact ?? '',
      contact?.source ?? '',
      ...(contact?.limitations ?? []),
    ]) {
      assert.doesNotMatch(value, control);
    }
    assert.doesNotMatch(result.markdown, renderedControl);
    assert.doesNotMatch(result.email, renderedControl);
    assert.match(result.email, /^Subject: Reviewed security finding: report\.example \(Credential phishing review\)$/mu);
  });

  test('marks old evidence for refresh and detects packet changes', async () => {
    const result = await buildCaseResponsePacket(reviewedCase(), {
      category: 'Phishing',
      affectedParty: 'Example service',
      abusiveUrls: ['https://report.example/sign-in'],
      observedHarm: 'A credential request was observed.',
      observedAt: '2026-07-01T00:00:00.000Z',
    }, NOW);
    assert.equal(result.json.provenance.observationAge.band, 'over_seven_days');
    assert.equal(result.json.provenance.observationAge.refreshRecommended, true);
    assert.equal(result.json.preflight.status, 'review_cautions');
    assert.equal(
      result.json.preflight.checks.find((item) => item.id === 'evidence_freshness')?.state,
      'caution',
    );
    assert.match(result.markdown, /Refresh evidence before submission/u);

    result.json.incident.observedHarm = 'Changed after export';
    assert.equal(await verifyCaseResponsePacketIntegrity(result.json), false);
  });

  test('preflight blocks missing incident facts and keeps review gaps explicit', () => {
    const preflight = buildCaseResponsePreflight(reviewedCase(), {
      category: '',
      affectedParty: '',
      abusiveUrls: [],
      observedHarm: '',
      observedAt: null,
      contacts: [],
    }, NOW);
    assert.equal(preflight.canExport, false);
    assert.equal(preflight.status, 'needs_input');
    assert.equal(preflight.counts.block, 1);
    assert.equal(preflight.checks.find((item) => item.id === 'recipient_route')?.state, 'caution');
  });

  test('uses bounded path-safe filenames', () => {
    const filename = caseResponsePacketFilename('../REPORT.example', 'json', NOW);
    assert.equal(filename, 'whoisleuth-response-..-report.example-2026-07-28.json');
    assert.doesNotMatch(filename, /\//u);
  });

  test('defines audience-specific inclusion, exclusion, redaction, attachment, and follow-up previews', () => {
    assert.deepEqual(
      RESPONSE_PACKET_PROFILES.map((profile) => profile.id),
      ['registrar', 'registry', 'network_hosting', 'security_contact', 'browser_blocklist', 'internal_soc'],
    );
    const preview = buildResponsePacketProfilePreview(reviewedCase(), {
      profile: 'network_hosting',
      category: 'Credential phishing',
      abusiveUrls: ['https://report.example/sign-in'],
      observedAt: NOW,
      contacts: [],
    });
    assert.equal(preview.id, 'network_hosting');
    assert.match(preview.audience, /Hosting provider/u);
    assert.ok(preview.includedEvidence.length > 0);
    assert.ok(preview.excludedEvidence.length > 0);
    assert.ok(preview.redactions.length > 0);
    assert.ok(preview.attachments.length > 0);
    assert.ok(preview.followUpFields.length > 0);
    assert.match(preview.missingEvidence.join(' '), /Network or hosting contact route/u);
  });

  test('keeps fixed-recipient profile gaps visible without blocking local export', () => {
    const input = {
      profile: 'registry',
      category: 'Phishing',
      affectedParty: 'Example service',
      abusiveUrls: ['https://report.example/sign-in'],
      observedHarm: 'A credential request was observed.',
      observedAt: NOW,
      contacts: [{ kind: 'registrar', contact: 'abuse@example.test' }],
    };
    const preflight = buildCaseResponsePreflight(reviewedCase(), input, NOW);
    assert.equal(preflight.canExport, true);
    assert.equal(preflight.status, 'review_cautions');
    assert.equal(
      preflight.checks.find((item) => item.id === 'profile_recipient')?.state,
      'caution',
    );
  });
});
