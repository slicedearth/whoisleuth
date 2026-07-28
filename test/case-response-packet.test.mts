import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildCaseResponsePacket,
  caseResponsePacketFilename,
  CASE_RESPONSE_PACKET_SCHEMA,
  CASE_RESPONSE_PACKET_VERSION,
  MAX_ABUSIVE_URLS,
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
  return updateCase([created], created.id, {
    evidencePin: { label: 'Observed path', value: 'A credential form was observed.', observedAt: NOW },
    decision: { summary: 'Escalate', rationale: 'The selected evidence requires external review.' },
  }, NOW).record;
}

describe('case response packet', () => {
  test('builds reviewable JSON, Markdown, and email without a submission action', () => {
    const result = buildCaseResponsePacket(reviewedCase(), {
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
    assert.equal(result.json.contacts.length, 2);
    assert.equal(result.json.provenance.evidencePinCount, 1);
    assert.equal(result.json.provenance.decisionCount, 1);
    assert.match(result.markdown, /Separately routed|Escalation contacts/u);
    assert.match(result.markdown, /registrar RDAP/u);
    assert.match(result.email, /was not submitted automatically/u);
    assert.doesNotMatch(result.email, /mailto:/u);
  });

  test('requires all incident facts and at least one exact safe URL', () => {
    const base = {
      category: 'Phishing',
      affectedParty: 'Example service',
      observedHarm: 'A credential request was observed.',
      observedAt: NOW,
    };
    assert.throws(() => buildCaseResponsePacket(reviewedCase(), { ...base, abusiveUrls: [] }, NOW), /required/u);
    assert.throws(() => buildCaseResponsePacket(reviewedCase(), { ...base, abusiveUrls: ['javascript:alert(1)'] }, NOW), /required/u);
    assert.throws(() => buildCaseResponsePacket(reviewedCase(), { ...base, abusiveUrls: ['https://user:secret@report.example/'] }, NOW), /required/u);
  });

  test('bounds and deduplicates URLs and contact routes', () => {
    const urls = Array.from({ length: MAX_ABUSIVE_URLS + 5 }, (_, index) => `https://report.example/path-${index}`);
    urls.push(urls[0] ?? '');
    const result = buildCaseResponsePacket(reviewedCase(), {
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

  test('uses bounded path-safe filenames', () => {
    const filename = caseResponsePacketFilename('../REPORT.example', 'json', NOW);
    assert.equal(filename, 'whoisleuth-response-..-report.example-2026-07-28.json');
    assert.doesNotMatch(filename, /\//u);
  });
});
