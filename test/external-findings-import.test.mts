import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  EXTERNAL_FINDINGS_SCHEMA,
  EXTERNAL_FINDINGS_VERSION,
  MAX_EXTERNAL_FINDINGS_PER_DOMAIN,
  mergeExternalFindingsIntoCases,
  parseExternalFindingsDocument,
} from '../frontend/src/lib/analysis/external-findings-import.ts';
import { createCase } from '../frontend/src/lib/analysis/case-model.ts';

const NOW = '2026-07-28T04:00:00.000Z';

function document(overrides: Record<string, unknown> = {}) {
  return {
    schema: EXTERNAL_FINDINGS_SCHEMA,
    schemaVersion: EXTERNAL_FINDINGS_VERSION,
    source: { name: 'Local analyst export', reference: 'offline collection' },
    findings: [{
      domain: 'review.example',
      category: 'page',
      evidenceClass: 'provider_report',
      summary: 'A login form was reported in a retained external observation.',
      observedAt: '2026-07-27T01:00:00.000Z',
      completeness: 'partial',
      limitations: ['Rendered behavior was not retained.'],
      reference: 'finding-17',
    }],
    ...overrides,
  };
}

describe('strict external findings import', () => {
  test('normalizes the documented inert schema', () => {
    const parsed = parseExternalFindingsDocument(document());
    assert.equal(parsed.source.name, 'Local analyst export');
    assert.equal(parsed.findings[0]?.domain, 'review.example');
    assert.equal(parsed.findings[0]?.reference, 'finding-17');
    assert.equal(parsed.findings[0]?.evidenceClass, 'provider_report');
  });

  test('migrates version 1 to a provider report and preserves deployment observations', () => {
    const { evidenceClass: _evidenceClass, ...legacyFinding } = document().findings[0]!;
    const legacy = document({ schemaVersion: 1, findings: [legacyFinding] });
    assert.equal(parseExternalFindingsDocument(legacy).findings[0]?.evidenceClass, 'provider_report');
    const deployment = document({ findings: [{ ...document().findings[0], evidenceClass: 'deployment_observation' }] });
    assert.equal(parseExternalFindingsDocument(deployment).findings[0]?.evidenceClass, 'deployment_observation');
  });

  test('rejects future schemas, additional fields, controls, and unsupported categories', () => {
    assert.throws(() => parseExternalFindingsDocument(document({ schemaVersion: 3 })), /schema version 1 or 2/u);
    assert.throws(() => parseExternalFindingsDocument({ ...document(), executable: 'no' }), /additional top-level/u);
    assert.throws(() => parseExternalFindingsDocument(document({
      findings: [{ ...document().findings[0], summary: 'bad\u0000value' }],
    })), /control characters/u);
    assert.throws(() => parseExternalFindingsDocument(document({
      findings: [{ ...document().findings[0], category: 'ownership' }],
    })), /category is unsupported/u);
  });

  test('rejects a single-domain import beyond the evidence-pin budget boundary', () => {
    assert.throws(() => parseExternalFindingsDocument(document({
      findings: Array.from({ length: MAX_EXTERNAL_FINDINGS_PER_DOMAIN + 1 }, (_, index) => ({
        ...document().findings[0],
        summary: `Finding ${index}`,
      })),
    })), /per-domain limit/u);
  });

  test('adds local evidence pins without changing analyst status or disposition', () => {
    const current = createCase({
      domain: 'review.example',
      status: 'resolved',
      disposition: 'false_positive',
      source: 'lookup',
    }, NOW);
    const parsed = parseExternalFindingsDocument(document());
    const merged = mergeExternalFindingsIntoCases([current], parsed, NOW);
    const record = merged.cases[0];
    assert.equal(merged.casesUpdated, 1);
    assert.equal(merged.findingsAdded, 1);
    assert.equal(record?.status, 'resolved');
    assert.equal(record?.disposition, 'false_positive');
    assert.equal(record?.evidencePins[0]?.source, 'Provider report: Local analyst export');
    assert.match(record?.evidencePins[0]?.limitations[0] ?? '', /did not collect or independently verify/u);
  });

  test('creates missing cases and makes repeated imports idempotent', () => {
    const parsed = parseExternalFindingsDocument(document());
    const first = mergeExternalFindingsIntoCases([], parsed, NOW);
    const second = mergeExternalFindingsIntoCases(first.cases, parsed, NOW);
    assert.equal(first.casesCreated, 1);
    assert.equal(first.findingsAdded, 1);
    assert.equal(second.findingsAdded, 0);
    assert.equal(second.duplicatesSkipped, 1);
    assert.equal(second.cases[0]?.evidencePins.length, 1);
  });
});
