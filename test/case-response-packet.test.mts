import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildCaseResponsePacket,
  buildCaseResponsePreflight,
  buildCaseResponseReadiness,
  buildCaseResponseReviewDigest,
  buildResponsePacketProfilePreview,
  CASE_RESPONSE_PREFLIGHT_EVIDENCE_SCOPE,
  caseResponsePacketFilename,
  CASE_RESPONSE_PACKET_SCHEMA,
  CASE_RESPONSE_PACKET_VERSION,
  MAX_ABUSIVE_URLS,
  MAX_RESPONSE_ACTION_HISTORY,
  RESPONSE_AUTHORISATION_CONFIRMATION_IDS,
  RESPONSE_PACKET_PROFILES,
  RESPONSE_READINESS_ROW_IDS,
  verifyCaseResponsePacketIntegrity,
} from '../frontend/src/lib/analysis/case-response-packet.ts';
import { createCase, updateCase } from '../frontend/src/lib/analysis/case-model.ts';

const NOW = '2026-07-28T02:00:00.000Z';

function reviewedCase() {
  const created = createCase({
    domain: 'report.example',
    status: 'escalated',
    disposition: 'confirmed_abuse',
    evidence: {
      inputHostname: 'login.report.example',
      scanDepth: 'deep',
      availability: 'registered',
      capturedAt: NOW,
    },
  }, NOW);
  const reasoned = updateCase([created], created.id, {
    evidencePin: { label: 'Observed path', value: 'A credential form was observed.', observedAt: NOW },
    decision: { summary: 'Escalate', rationale: 'The selected evidence requires external review.' },
  }, NOW).record;
  let record = updateCase([reasoned], reasoned.id, {
    action: {
      type: 'registrar_report',
      recipient: 'Registrar abuse desk',
      contactSource: 'RDAP entity role',
    },
  }, NOW).record;
  const actionId = record.actions[0]!.id;
  const states = ['ready_for_review', 'reviewed', 'authorised', 'submitted'] as const;
  for (const [index, nextState] of states.entries()) {
    const at = new Date(Date.parse(NOW) + (index + 1) * 60_000).toISOString();
    record = updateCase([record], record.id, {
      actionUpdate: {
        id: actionId,
        transition: { nextState, sourceClass: 'analyst', provenance: `analyst_${nextState}` },
      },
    }, at).record;
  }
  record = updateCase([record], record.id, {
    actionUpdate: {
      id: actionId,
      transition: {
        nextState: 'acknowledged',
        sourceClass: 'provider',
        provenance: 'provider_acknowledgement',
        reference: 'CASE-123',
        providerOutcome: 'accepted_for_review',
        outcomeDetail: 'Acknowledged for provider review.',
      },
    },
  }, '2026-07-28T02:10:00.000Z').record;
  return updateCase([record], record.id, {
    observedEffectReview: {
      state: 'still_observed',
      observedAt: '2026-07-28T02:20:00.000Z',
      sourceClass: 'analyst',
      source: 'Independent fixture review',
      completeness: 'partial',
      limitations: ['Only the retained path was reviewed.'],
    },
  }, '2026-07-28T02:20:00.000Z').record;
}

function packetInput() {
  return {
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
        observedAt: NOW,
        limitations: ['The mailbox has not been verified as monitored.'],
      },
      {
        kind: 'security_txt',
        contact: 'security@example.test',
        source: 'security.txt',
        observedAt: NOW,
      },
    ],
    selectedEvidencePinIds: [] as string[],
    readiness: {
      infrastructureResponsibility: {
        state: 'complete',
        detail: 'The selected registration evidence identifies the registrar role at observation time.',
        limitations: ['Registrar responsibility is limited to the documented policy route.'],
      },
      authorityReview: {
        state: 'complete',
        detail: 'The analyst confirmed authority for this exact recipient and scope.',
        limitations: [],
      },
      contradictionsReview: {
        state: 'complete',
        detail: 'The analyst reviewed the exact packet inputs for contradictory evidence.',
        limitations: ['This review is limited to the selected browser-local evidence.'],
      },
      sourceLimitations: {
        state: 'partial',
        detail: 'Known source limitations are explicitly retained.',
        limitations: ['The contact route was not tested.'],
      },
    },
    artefactReferences: [{
      id: 'capture-one',
      label: 'Reviewed capture metadata',
      mediaType: 'image/png',
      capturedAt: NOW,
      source: 'analyst capture',
      digestSha256: 'a'.repeat(64),
      byteLength: 1024,
      limitations: ['The raw capture is not embedded in this packet.'],
      rawPayload: 'must not be retained',
    }],
  };
}

describe('case response packet', () => {
  test('refuses retired packet versions before current v7 output', async () => {
    for (const version of [5, 6] as const) {
      assert.equal(await verifyCaseResponsePacketIntegrity({
        schema: CASE_RESPONSE_PACKET_SCHEMA,
        schemaVersion: version,
      } as Parameters<typeof verifyCaseResponsePacketIntegrity>[0]), false);
    }
  });

  test('builds reviewable JSON, Markdown, and email without a submission action', async () => {
    const caseRecord = reviewedCase();
    const input = packetInput();
    input.selectedEvidencePinIds = [caseRecord.evidencePins[0]!.id];
    const result = await buildCaseResponsePacket(caseRecord, input, NOW);
    assert.equal(result.json.schema, CASE_RESPONSE_PACKET_SCHEMA);
    assert.equal(result.json.schemaVersion, CASE_RESPONSE_PACKET_VERSION);
    assert.equal(result.json.reviewRequired, true);
    assert.equal(result.json.submissionPerformed, false);
    assert.equal(result.json.authorisation.status, 'draft');
    assert.equal(result.json.profile.id, 'registrar');
    assert.match(result.json.profile.subject, /Reviewed domain abuse report/u);
    assert.equal(result.json.contacts.length, 2);
    assert.equal(result.json.provenance.evidencePinCount, 1);
    assert.equal(result.json.provenance.decisionCount, 1);
    assert.equal(result.json.provenance.observationAge.band, 'under_24_hours');
    assert.equal(result.json.escalationHistory.length, 1);
    assert.equal(result.json.escalationHistory[0]?.reference, 'CASE-123');
    assert.equal(result.json.escalationHistory[0]?.transitions.length, 6);
    assert.equal(result.json.responseLifecycle.providerOutcomeState, 'available');
    assert.equal(result.json.responseLifecycle.latestProviderOutcome?.occurredAt, '2026-07-28T02:10:00.000Z');
    assert.equal(result.json.responseLifecycle.observedChangeState, 'missing');
    assert.equal(result.json.responseLifecycle.latestObservedEffect?.observedAt, '2026-07-28T02:20:00.000Z');
    assert.equal(result.json.responseLifecycle.latestObservedChangeAt, null);
    assert.equal(result.json.artefactReferences.length, 1);
    assert.equal(JSON.stringify(result.json).includes('must not be retained'), false);
    assert.equal(JSON.stringify(result.json).includes('login.report.example'), false);
    assert.equal(result.markdown.includes('login.report.example'), false);
    assert.equal(result.email.includes('login.report.example'), false);
    assert.deepEqual(result.json.readiness.rows.map((row) => row.id), RESPONSE_READINESS_ROW_IDS);
    assert.equal(result.json.preflight.canExport, true);
    assert.equal(result.json.preflight.status, 'ready_for_review');
    assert.equal(result.json.preflight.actionSummary.acknowledged, 1);
    assert.match(result.json.integrity.digestSha256, /^[a-f0-9]{64}$/u);
    assert.equal(await verifyCaseResponsePacketIntegrity(result.json), true);
    assert.match(result.markdown, /Separately routed|Escalation contacts/u);
    assert.match(result.markdown, /registrar RDAP/u);
    assert.match(result.markdown, /Canonical packet SHA-256/u);
    assert.match(result.email, /was not submitted automatically/u);
    assert.doesNotMatch(result.email, /mailto:/u);
  });

  test('binds every explicit authorisation confirmation to exact canonical reviewed inputs', async () => {
    const caseRecord = reviewedCase();
    const input = packetInput();
    input.selectedEvidencePinIds = [caseRecord.evidencePins[0]!.id];
    const reviewedInputDigestSha256 = await buildCaseResponseReviewDigest(caseRecord, input, NOW);
    const confirmed = {
      ...input,
      authorisation: {
        reviewedInputDigestSha256,
        confirmedAt: NOW,
        confirmations: Object.fromEntries(RESPONSE_AUTHORISATION_CONFIRMATION_IDS.map((id) => [id, true])),
      },
    };
    const authorised = await buildCaseResponsePacket(caseRecord, confirmed, NOW);
    assert.equal(authorised.json.authorisation.status, 'authorised');
    assert.equal(authorised.json.authorisation.digestMatches, true);
    assert.deepEqual(authorised.json.authorisation.missingConfirmations, []);
    assert.match(authorised.email, /bound to explicit review confirmations/iu);

    const materiallyChanged = await buildCaseResponsePacket(caseRecord, {
      ...confirmed,
      observedHarm: 'The page requested credentials and a one-time code.',
    }, NOW);
    assert.equal(materiallyChanged.json.authorisation.status, 'draft');
    assert.equal(materiallyChanged.json.authorisation.digestMatches, false);
    assert.match(materiallyChanged.json.authorisation.limitations.join(' '), /material inputs changed.*stale/iu);

    const missingOne = await buildCaseResponsePacket(caseRecord, {
      ...input,
      authorisation: {
        reviewedInputDigestSha256,
        confirmedAt: NOW,
        confirmations: Object.fromEntries(RESPONSE_AUTHORISATION_CONFIRMATION_IDS.map((id) => [id, id !== 'privacyRedactions'])),
      },
    }, NOW);
    assert.equal(missingOne.json.authorisation.status, 'draft');
    assert.deepEqual(missingOne.json.authorisation.missingConfirmations, ['privacyRedactions']);

    const withoutContradictionReview = {
      ...input,
      readiness: {
        infrastructureResponsibility: input.readiness.infrastructureResponsibility,
        authorityReview: input.readiness.authorityReview,
        sourceLimitations: input.readiness.sourceLimitations,
      },
    };
    const noContradictionDigest = await buildCaseResponseReviewDigest(caseRecord, withoutContradictionReview, NOW);
    const unreviewedContradictions = await buildCaseResponsePacket(caseRecord, {
      ...withoutContradictionReview,
      authorisation: {
        reviewedInputDigestSha256: noContradictionDigest,
        confirmedAt: NOW,
        confirmations: Object.fromEntries(RESPONSE_AUTHORISATION_CONFIRMATION_IDS.map((id) => [id, true])),
      },
    }, NOW);
    assert.equal(unreviewedContradictions.json.readiness.rows.find((row) => row.id === 'contradictions')?.state, 'not_provided');
    assert.equal(unreviewedContradictions.json.authorisation.status, 'draft');

    const futureConfirmation = await buildCaseResponsePacket(caseRecord, {
      ...confirmed,
      authorisation: {
        ...confirmed.authorisation,
        confirmedAt: '2026-07-28T02:06:00.001Z',
      },
    }, NOW);
    assert.equal(futureConfirmation.json.authorisation.status, 'draft');
    assert.equal(futureConfirmation.json.authorisation.confirmedAt, null);
    assert.match(futureConfirmation.json.authorisation.limitations.join(' '), /No valid confirmation time/iu);
  });

  test('uses only the five explicit readiness states for every profile-specific row', () => {
    const caseRecord = reviewedCase();
    const input = packetInput();
    input.selectedEvidencePinIds = [caseRecord.evidencePins[0]!.id];
    const readiness = buildCaseResponseReadiness(caseRecord, input, NOW);
    assert.deepEqual(readiness.rows.map((row) => row.id), RESPONSE_READINESS_ROW_IDS);
    assert.equal(readiness.rows.length, 10);
    assert.equal(readiness.rows.every((row) => ['complete', 'partial', 'stale', 'unavailable', 'not_provided'].includes(row.state)), true);
    assert.equal(readiness.rows.find((row) => row.id === 'recipient_route')?.state, 'complete');
    assert.equal(readiness.rows.find((row) => row.id === 'authority_review')?.state, 'complete');
    assert.equal(readiness.rows.find((row) => row.id === 'contradictions')?.state, 'complete');
    assert.equal(readiness.rows.find((row) => row.id === 'source_limitations')?.state, 'partial');
  });

  test('reports bounded packet action omissions and withholds provider timing conservatively', async () => {
    let caseRecord = reviewedCase();
    for (let index = caseRecord.actions.length; index <= MAX_RESPONSE_ACTION_HISTORY; index += 1) {
      caseRecord = updateCase([caseRecord], caseRecord.id, {
        action: { type: 'internal_review', recipient: `Bounded local reviewer ${index}` },
      }, new Date(Date.parse(NOW) + index * 60_000).toISOString()).record;
    }
    const input = packetInput();
    input.selectedEvidencePinIds = [caseRecord.evidencePins[0]!.id];
    const result = await buildCaseResponsePacket(caseRecord, input, new Date(Date.parse(NOW) + 3_600_000).toISOString());
    assert.equal(result.json.escalationHistory.length, MAX_RESPONSE_ACTION_HISTORY);
    assert.equal(result.json.escalationHistoryOmitted, 1);
    assert.match(result.json.escalationHistoryLimitations.join(' '), /earlier Case response action.*omitted/iu);
    assert.equal(result.json.responseLifecycle.providerOutcomeState, 'ambiguous');
    assert.equal(result.json.responseLifecycle.latestProviderOutcome, null);
    assert.match(result.markdown, /Earlier actions omitted from packet projection: 1/iu);
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

  test('keeps case-response preflight case-owned when transient Lookup facts are unavailable', () => {
    assert.deepEqual(CASE_RESPONSE_PREFLIGHT_EVIDENCE_SCOPE, {
      version: 1,
      owner: 'case',
      inputs: [
        'incident_fields', 'evidence_pins', 'analyst_decisions', 'analyst_assertions',
        'recipient_routes', 'case_disposition', 'case_actions',
      ],
      lookupDecisionFacts: 'unavailable',
      limitation: 'Lookup Decision Facts are transient and are not copied into browser-local cases. Case-response preflight evaluates only explicit case-owned records and analyst-entered incident context; it does not reconstruct Decision Facts from weaker saved fields.',
    });
    const input = {
      category: '', affectedParty: '', abusiveUrls: [], observedHarm: '', observedAt: null, contacts: [],
    };
    const caseRecord = reviewedCase();
    const baseline = buildCaseResponsePreflight(caseRecord, input, NOW);
    const withUnavailableFacts = buildCaseResponsePreflight(
      caseRecord,
      { ...input, decisionFacts: [{ id: 'must-not-be-consumed' }] } as typeof input,
      NOW,
    );
    assert.deepEqual(withUnavailableFacts, baseline);
    assert.equal(JSON.stringify(withUnavailableFacts).includes('must-not-be-consumed'), false);
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
