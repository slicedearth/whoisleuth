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

  test('rejects reader-only version 1 and preserves current deployment observations', () => {
    assert.throws(() => parseExternalFindingsDocument(document({ schemaVersion: 1 })), /schema version 4/u);
    const deployment = document({ findings: [{ ...document().findings[0], evidenceClass: 'deployment_observation' }] });
    assert.equal(parseExternalFindingsDocument(deployment).findings[0]?.evidenceClass, 'deployment_observation');
  });

  test('requires explicit zones in schema 4 and rejects reader-only timestamps', () => {
    const zoneLess = '2026-07-27T12:00:00.000';
    assert.throws(() => parseExternalFindingsDocument(document({
      source: { name: 'Current import', reference: null, collectedAt: zoneLess },
      findings: [{ ...document().findings[0], observedAt: zoneLess }],
    })), /explicit timezone/u);

    assert.throws(() => parseExternalFindingsDocument(document({
      schemaVersion: 3,
      source: { name: 'Legacy import', reference: null, collectedAt: zoneLess },
      findings: [{ ...document().findings[0], observedAt: zoneLess }],
    })), /schema version 4/u);

    const offset = parseExternalFindingsDocument(document({
      source: { name: 'Current import', reference: null, collectedAt: '2026-07-27T12:00:00.000+01:00' },
      findings: [{ ...document().findings[0], observedAt: '2026-07-27T12:00:00.000+01:00' }],
    }));
    assert.equal(offset.findings[0]?.observedAt, '2026-07-27T11:00:00.000Z');
  });

  test('rejects future schemas, additional fields, controls, and unsupported categories', () => {
    assert.throws(() => parseExternalFindingsDocument(document({ schemaVersion: 5 })), /schema version 4/u);
    assert.throws(() => parseExternalFindingsDocument({ ...document(), executable: 'no' }), /additional top-level/u);
    assert.throws(() => parseExternalFindingsDocument(document({
      findings: [{ ...document().findings[0], summary: 'bad\u0000value' }],
    })), /control characters/u);
    assert.throws(() => parseExternalFindingsDocument(document({
      findings: [{ ...document().findings[0], category: 'ownership' }],
    })), /category is unsupported/u);
  });

  test('requires complete, matching event metadata only on certificate observations', () => {
    const structuredObservation = {
      sourceSchema: 'whoisleuth.certificate-observation-rows',
      sourceVersion: 1,
      field: 'certificateSha256',
      value: 'a'.repeat(64),
      issuer: 'Fixture issuer',
      notAfter: '2026-12-01T00:00:00.000Z',
      eventId: 'b'.repeat(64),
      logId: 'fixture-log',
      certificateSha256: 'a'.repeat(64),
      dnsNameCount: 2,
      namesComplete: true,
    };
    const certificate = {
      ...document().findings[0],
      category: 'certificate',
      structuredObservation,
    };
    const parsed = parseExternalFindingsDocument(document({ findings: [certificate] }));
    assert.equal(parsed.findings[0]?.structuredObservation?.eventId, 'b'.repeat(64));
    assert.throws(() => parseExternalFindingsDocument(document({
      schemaVersion: 3,
      findings: [certificate],
    })), /schema version 4/u);
    assert.throws(() => parseExternalFindingsDocument(document({
      findings: [{ ...certificate, structuredObservation: { ...structuredObservation, certificateSha256: 'c'.repeat(64) } }],
    })), /digest must match/u);
    assert.throws(() => parseExternalFindingsDocument(document({
      findings: [{ ...certificate, structuredObservation: { ...structuredObservation, executable: true } }],
    })), /additional fields/u);
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
      closure: {
        reason: 'false_positive',
        summary: 'The analyst deliberately closed the retained false-positive case.',
        limitations: ['This closure does not establish remediation or safety.'],
      },
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
    assert.equal(record?.sightings[0]?.state, 'reported_by_provider');
    assert.equal(record?.sightings[0]?.evidencePinId, record?.evidencePins[0]?.id);
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
    assert.equal(second.cases[0]?.sightings.length, 1);
  });
});
