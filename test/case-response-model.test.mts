import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  appendCaseAction,
  appendCaseAssertion,
  appendCaseDecision,
  appendCaseEvidencePin,
  appendCaseEvidencePins,
  appendCaseManualTrailEvent,
  appendCaseSighting,
  buildCaseActionOutcomeSummary,
  buildCaseInvestigationTrail,
  MAX_CASE_ACTIONS,
  MAX_CASE_DECISIONS,
  MAX_CASE_EVIDENCE_PINS,
  normalizeCaseActions,
  normalizeCaseDecisions,
  normalizeCaseEvidencePins,
  normalizeCaseSightings,
  updateCaseAction,
  updateCaseAssertion,
} from '../frontend/src/lib/analysis/case-response-model.ts';
import * as caseModel from '../frontend/src/lib/analysis/case-model.ts';
import { requiredValue } from './value-assertions.mts';

const NOW = '2026-07-28T01:00:00.000Z';
const LATER = '2026-07-29T01:00:00.000Z';

describe('case response record normalization', () => {
  test('pins keep bounded provenance and explicit completeness', () => {
    const pins = appendCaseEvidencePin([], {
      label: 'Observed form',
      value: 'A credential form was present.',
      source: 'deep lookup',
      observedAt: NOW,
      completeness: 'partial',
      limitations: ['Rendered JavaScript was not evaluated.'],
    }, NOW);
    const pin = requiredValue(pins[0]);
    assert.equal(pin.label, 'Observed form');
    assert.equal(pin.completeness, 'partial');
    assert.deepEqual(pin.limitations, ['Rendered JavaScript was not evaluated.']);
  });

  test('decisions retain only valid references to existing pins', () => {
    const pins = appendCaseEvidencePin([], { label: 'Fact', value: 'Observed value' }, NOW);
    const pin = requiredValue(pins[0]);
    const decisions = appendCaseDecision([], {
      summary: 'Escalate for review',
      rationale: 'The selected evidence warrants a provider review.',
      evidencePinIds: [pin.id, 'missing-pin'],
    }, NOW, new Set([pin.id]));
    assert.deepEqual(requiredValue(decisions[0]).evidencePinIds, [pin.id]);
  });

  test('checkpoints append bounded selected facts with typed provenance metadata', () => {
    const pins = appendCaseEvidencePins([], [
      {
        checkpointId: 'checkpoint-one',
        field: 'dns.mx',
        category: 'dns',
        label: 'MX hosts',
        value: 'mx.response.example',
        source: 'DNS',
        sourceState: 'success',
        sourceSchema: {
          collection: 'lookup_result',
          schema: 'whoisleuth.lookup-evidence',
          version: 21,
        },
        observedAt: NOW,
        collectionDepth: 'deep',
        completeness: 'complete',
        truncated: false,
      },
      {
        checkpointId: 'checkpoint-one',
        field: 'tls.protocol',
        category: 'tls',
        label: 'TLS protocol',
        value: 'TLSv1.3',
        source: 'TLS',
        sourceState: 'partial',
        observedAt: NOW,
        collectionDepth: 'deep',
        completeness: 'partial',
        truncated: true,
      },
    ], NOW);
    assert.equal(pins.length, 2);
    assert.equal(pins[0]?.field, 'dns.mx');
    assert.equal(pins[0]?.sourceSchema?.version, 21);
    assert.equal(pins[1]?.truncated, true);
  });

  test('actions keep contact provenance and can record a later outcome', () => {
    const actions = appendCaseAction([], {
      type: 'registrar_report',
      recipient: 'abuse@example.test',
      contactSource: 'registrar RDAP',
      contactLimitations: ['Contact monitoring is not verified.'],
      state: 'ready_for_review',
    }, NOW);
    const action = requiredValue(actions[0]);
    const updated = updateCaseAction(actions, {
      id: action.id,
      state: 'acknowledged',
      reference: 'CASE-123',
      outcome: 'Provider acknowledged the report.',
    }, LATER);
    assert.equal(requiredValue(updated[0]).state, 'acknowledged');
    assert.equal(requiredValue(updated[0]).reference, 'CASE-123');
    assert.equal(requiredValue(updated[0]).updatedAt, LATER);
  });

  test('action summaries separate active, overdue, follow-up, and recorded outcomes', () => {
    const actions = normalizeCaseActions([
      {
        id: 'submitted',
        type: 'registrar_report',
        recipient: 'Registrar response desk',
        state: 'submitted',
        dueAt: '2026-07-27T01:00:00.000Z',
        followUpAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'resolved',
        type: 'registry_report',
        recipient: 'Registry response desk',
        state: 'resolved',
        outcome: 'The reported path was removed.',
        createdAt: NOW,
        updatedAt: LATER,
      },
    ], NOW);
    const summary = buildCaseActionOutcomeSummary(actions, LATER);
    assert.deepEqual({
      total: summary.total,
      active: summary.active,
      submitted: summary.submitted,
      acknowledged: summary.acknowledged,
      resolved: summary.resolved,
      closed: summary.closed,
      overdue: summary.overdue,
      followUpDue: summary.followUpDue,
      withOutcome: summary.withOutcome,
    }, {
      total: 2,
      active: 1,
      submitted: 1,
      acknowledged: 0,
      resolved: 1,
      closed: 0,
      overdue: 1,
      followUpDue: 1,
      withOutcome: 1,
    });
    assert.equal(summary.latestOutcomes[0]?.outcome, 'The reported path was removed.');
  });

  test('keeps analyst assertions distinct from evidence and derives an explicit trail', () => {
    const pins = appendCaseEvidencePin([], { label: 'Registration', value: 'Observed as registered' }, NOW);
    const pin = requiredValue(pins[0]);
    const assertions = appendCaseAssertion([], {
      kind: 'hypothesis',
      statement: 'The domain may be related to the reviewed campaign.',
      rationale: 'Infrastructure overlap needs independent verification.',
      evidencePinIds: [pin.id, 'missing-pin'],
    }, NOW, new Set([pin.id]));
    const assertion = requiredValue(assertions[0]);
    assert.equal(assertion.kind, 'hypothesis');
    assert.deepEqual(assertion.evidencePinIds, [pin.id]);
    assert.deepEqual(assertion.evidenceRelations, [{ evidencePinId: pin.id, stance: 'supports' }]);
    const resolved = updateCaseAssertion(assertions, { id: assertion.id, state: 'resolved' }, LATER, new Set([pin.id]));
    assert.equal(requiredValue(resolved[0]).state, 'resolved');

    const manualTrail = appendCaseManualTrailEvent([], {
      kind: 'pivot',
      summary: 'Reviewed the certificate relationship.',
      target: 'certificate fingerprint',
    }, LATER);
    const trail = buildCaseInvestigationTrail({ assertions: resolved, manualTrail });
    assert.equal(trail.length, 2);
    assert.equal(trail[0]?.kind, 'assertion');
    assert.equal(trail[1]?.kind, 'manual');
  });

  test('retains explicit supporting, contradicting, and unresolved hypothesis evidence', () => {
    const pins = [
      requiredValue(appendCaseEvidencePin([], { label: 'Registration', value: 'Observed' }, NOW)[0]),
      requiredValue(appendCaseEvidencePin([], { label: 'Hosting', value: 'Different network' }, NOW)[0]),
      requiredValue(appendCaseEvidencePin([], { label: 'Certificate', value: 'Incomplete' }, NOW)[0]),
    ];
    const validIds = new Set(pins.map((pin) => pin.id));
    const assertions = appendCaseAssertion([], {
      kind: 'hypothesis',
      statement: 'The observations may describe related infrastructure.',
      evidenceRelations: [
        { evidencePinId: pins[0]?.id, stance: 'supports' },
        { evidencePinId: pins[1]?.id, stance: 'contradicts' },
        { evidencePinId: pins[2]?.id, stance: 'unresolved' },
        { evidencePinId: 'missing-pin', stance: 'supports' },
      ],
    }, NOW, validIds);

    const assertion = requiredValue(assertions[0]);
    assert.deepEqual(assertion.evidenceRelations?.map((item) => item.stance), ['supports', 'contradicts', 'unresolved']);
    assert.deepEqual(assertion.evidencePinIds, pins.map((pin) => pin.id));
  });

  test('keeps deployment, provider, and analyst sighting states source-qualified', () => {
    const pin = requiredValue(appendCaseEvidencePin([], {
      label: 'Observed certificate',
      value: 'Leaf certificate fingerprint was retained.',
    }, NOW)[0]);
    const deployment = requiredValue(appendCaseSighting([], {
      state: 'observed_by_deployment',
      category: 'certificate',
      source: 'WHOISleuth deep lookup',
      observedAt: NOW,
      completeness: 'partial',
      evidencePinId: pin.id,
      limitations: ['One point-in-time handshake.'],
    }, NOW, new Set([pin.id]))[0]);
    const reviewed = requiredValue(appendCaseSighting([deployment], {
      state: 'not_reproduced',
      category: 'certificate',
      source: 'Manual analyst review',
      observedAt: LATER,
      completeness: 'inconclusive',
      evidencePinId: 'missing-pin',
    }, LATER, new Set([pin.id]))[1]);
    assert.equal(deployment.sourceClass, 'deployment');
    assert.equal(reviewed.sourceClass, 'analyst');
    assert.equal(reviewed.evidencePinId, null);
    assert.deepEqual(deployment.limitations, ['One point-in-time handshake.']);
    assert.equal(normalizeCaseSightings([{ state: 'missing', source: 'invalid' }], NOW).length, 0);
    const trail = buildCaseInvestigationTrail({ sightings: [deployment, reviewed] });
    assert.deepEqual(trail.map((item) => item.kind), ['sighting', 'sighting']);
  });

  test('collections reject malformed entries and enforce record caps', () => {
    const pins = Array.from({ length: MAX_CASE_EVIDENCE_PINS + 5 }, (_, index) => ({
      label: `Pin ${index}`,
      value: `Value ${index}`,
      createdAt: new Date(Date.parse(NOW) + index * 1000).toISOString(),
    }));
    const decisions = Array.from({ length: MAX_CASE_DECISIONS + 5 }, (_, index) => ({
      summary: `Decision ${index}`,
      rationale: `Rationale ${index}`,
      createdAt: new Date(Date.parse(NOW) + index * 1000).toISOString(),
    }));
    const actions = Array.from({ length: MAX_CASE_ACTIONS + 5 }, (_, index) => ({
      recipient: `owner-${index}`,
      createdAt: new Date(Date.parse(NOW) + index * 1000).toISOString(),
    }));
    assert.equal(normalizeCaseEvidencePins([...pins, null, {}], NOW).length, MAX_CASE_EVIDENCE_PINS);
    assert.equal(normalizeCaseDecisions([...decisions, null, {}], NOW).length, MAX_CASE_DECISIONS);
    assert.equal(normalizeCaseActions([...actions, null, {}], NOW).length, MAX_CASE_ACTIONS);
  });

  test('removes every control character from normalized analyst records', () => {
    const control = /[\u0000-\u001f\u007f]/u;
    const pin = requiredValue(appendCaseEvidencePin([], {
      label: 'Observed\rform\n\u0007',
      value: 'Credential\trequest\u007fdetected',
      source: 'deep\rlookup\n',
      limitations: ['Rendered\rcontent\nwas\u0007not evaluated.'],
    }, NOW)[0]);
    const decision = requiredValue(appendCaseDecision([], {
      summary: 'Escalate\rfor\nreview',
      rationale: 'Selected\tevidence\u007frequires review.',
    }, NOW)[0]);
    const action = requiredValue(appendCaseAction([], {
      recipient: 'abuse@example.test\r\n\u0007',
      contactSource: 'registrar\tRDAP\u007f',
      contactLimitations: ['Monitoring\rstatus\nis\u0007unknown.'],
      reference: 'CASE\r123\n\u0007',
      outcome: 'Pending\tprovider\u007freview.',
    }, NOW)[0]);

    for (const value of [
      pin.label,
      pin.value,
      pin.source,
      ...pin.limitations,
      decision.summary,
      decision.rationale,
      action.recipient,
      action.contactSource,
      ...action.contactLimitations,
      action.reference ?? '',
      action.outcome ?? '',
    ]) {
      assert.doesNotMatch(value, control);
    }
  });
});

describe('case store integration', () => {
  test('new response records survive normalization, export, and import', () => {
    const created = caseModel.createCase({
      domain: 'response.example',
      evidencePin: { label: 'Observed URL', value: 'https://response.example/path', observedAt: NOW },
      decision: { summary: 'Review', rationale: 'An analyst review is required.' },
      action: { recipient: 'security@example.test', type: 'security_contact_report' },
      assertion: { kind: 'unknown', statement: 'The operator remains unknown.' },
      trailEvent: { kind: 'review', summary: 'Reviewed the retained evidence.' },
      sighting: { state: 'reported_by_provider', category: 'website', source: 'Reviewed provider report', observedAt: NOW },
    }, NOW);
    const payload = caseModel.buildCaseExport([created], NOW);
    const imported = requiredValue(caseModel.mergeCases([], payload).cases[0]);
    assert.equal(imported.evidencePins.length, 1);
    assert.equal(imported.decisions.length, 1);
    assert.equal(imported.actions.length, 1);
    assert.equal(imported.assertions.length, 1);
    assert.equal(imported.manualTrail.length, 1);
    assert.equal(imported.sightings.length, 1);
    assert.equal(imported.sightings[0]?.sourceClass, 'provider');
    assert.equal(imported.actions[0]?.type, 'security_contact_report');
  });

  test('updates append response records without replacing collected evidence', () => {
    const created = caseModel.createCase({
      domain: 'response.example',
      evidence: { availability: 'registered', capturedAt: NOW },
    }, NOW);
    const result = caseModel.updateCase([created], created.id, {
      evidencePin: { label: 'Registration', value: 'Registered', observedAt: NOW },
      decision: { summary: 'Monitor', rationale: 'Retain for comparison.' },
      action: { recipient: 'internal queue', type: 'internal_review' },
      assertion: { kind: 'next_step', statement: 'Verify the contact destination.' },
      trailEvent: { kind: 'handoff', summary: 'Handed off for internal review.' },
      sighting: { state: 'analyst_confirmed', category: 'website', source: 'Manual analyst review', observedAt: LATER },
    }, LATER);
    assert.equal(result.record.evidenceHistory.length, 1);
    assert.equal(result.record.evidencePins.length, 1);
    assert.equal(result.record.decisions.length, 1);
    assert.equal(result.record.actions.length, 1);
    assert.equal(result.record.assertions.length, 1);
    assert.equal(result.record.manualTrail.length, 1);
    assert.equal(result.record.sightings.length, 1);
  });
});
