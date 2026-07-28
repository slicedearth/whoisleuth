import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  appendCaseAction,
  appendCaseDecision,
  appendCaseEvidencePin,
  MAX_CASE_ACTIONS,
  MAX_CASE_DECISIONS,
  MAX_CASE_EVIDENCE_PINS,
  normalizeCaseActions,
  normalizeCaseDecisions,
  normalizeCaseEvidencePins,
  updateCaseAction,
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
});

describe('case store integration', () => {
  test('new response records survive normalization, export, and import', () => {
    const created = caseModel.createCase({
      domain: 'response.example',
      evidencePin: { label: 'Observed URL', value: 'https://response.example/path', observedAt: NOW },
      decision: { summary: 'Review', rationale: 'An analyst review is required.' },
      action: { recipient: 'security@example.test', type: 'security_contact_report' },
    }, NOW);
    const payload = caseModel.buildCaseExport([created], NOW);
    const imported = requiredValue(caseModel.mergeCases([], payload).cases[0]);
    assert.equal(imported.evidencePins.length, 1);
    assert.equal(imported.decisions.length, 1);
    assert.equal(imported.actions.length, 1);
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
    }, LATER);
    assert.equal(result.record.evidenceHistory.length, 1);
    assert.equal(result.record.evidencePins.length, 1);
    assert.equal(result.record.decisions.length, 1);
    assert.equal(result.record.actions.length, 1);
  });
});
