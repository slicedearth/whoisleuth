import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CT_EVENT_BATCH_SCHEMA,
  MAX_CT_EXTERNAL_DOMAINS,
  buildCtEventFindings,
} from '../cli/ct-event-intake.mts';
import { parseExternalFindingsDocument } from '../frontend/src/lib/analysis/external-findings-import.ts';
import { mergeExternalFindingsIntoCases } from '../frontend/src/lib/analysis/external-findings-import.ts';

const NOW = '2026-08-05T07:00:00.000Z';

function event(index: number, dnsNames = [`host-${index}.example.test`]) {
  return {
    logId: `fixture-log:${index}`,
    observedAt: NOW,
    certificateSha256: index.toString(16).padStart(64, '0'),
    dnsNames,
    issuer: 'Fixture issuer',
    notAfter: '2026-11-01T00:00:00Z',
    completeness: 'complete',
    limitations: [],
  };
}

function batch(events: unknown[]) {
  return {
    schema: CT_EVENT_BATCH_SCHEMA,
    version: 1,
    source: { name: 'Local certificate event fixture', reference: null, collectedAt: NOW },
    events,
  };
}

describe('certificate event intake', () => {
  test('normalises wildcard names into browser-compatible source-qualified findings', () => {
    const document = buildCtEventFindings(batch([
      event(1, ['*.Portal.Example.Test', 'portal.example.test', 'api.example.test']),
    ]));
    const parsed = parseExternalFindingsDocument(document);
    assert.equal(parsed.findings.length, 2);
    assert.deepEqual(parsed.findings.map((finding) => finding.domain), ['api.example.test', 'portal.example.test']);
    assert.equal(parsed.findings[0]?.evidenceClass, 'deployment_observation');
    assert.equal(parsed.findings[0]?.structuredObservation?.sourceSchema, 'whoisleuth.certificate-observation-rows');
    assert.equal(parsed.findings[0]?.structuredObservation?.dnsNameCount, 2);
    assert.equal(parsed.findings[0]?.structuredObservation?.namesComplete, true);
    assert.match(parsed.findings[0]?.structuredObservation?.eventId ?? '', /^[a-f0-9]{64}$/u);
    assert.match(parsed.findings[0]?.limitations.join(' ') ?? '', /not proof/iu);

    const merged = mergeExternalFindingsIntoCases([], parsed, NOW);
    const retained = merged.cases.find((item) => item.domain === 'api.example.test')?.evidencePins[0]?.certificateObservation;
    assert.equal(retained?.issuer, 'Fixture issuer');
    assert.equal(retained?.dnsNameCount, 2);
    assert.equal(retained?.namesComplete, true);
    assert.equal(retained?.certificateSha256, event(1).certificateSha256);
  });

  test('marks retained certificate names incomplete when browser import bounds omit members', () => {
    const names = Array.from({ length: 30 }, (_, index) => `host-${String(index).padStart(2, '0')}.example.test`);
    const parsed = parseExternalFindingsDocument(buildCtEventFindings(batch([event(8, names)])));
    assert.equal(parsed.findings.length, MAX_CT_EXTERNAL_DOMAINS);
    assert.equal(new Set(parsed.findings.map((finding) => finding.structuredObservation?.eventId)).size, 1);
    assert.ok(parsed.findings.every((finding) => finding.structuredObservation?.dnsNameCount === names.length));
    assert.ok(parsed.findings.every((finding) => finding.structuredObservation?.namesComplete === false));
    assert.match(parsed.findings[0]?.limitations.join(' ') ?? '', /did not retain every DNS name/iu);
  });

  test('deduplicates events and respects browser domain and per-domain import ceilings', () => {
    const repeated = Array.from({ length: 24 }, (_, index) => event(index + 1, ['a-same.example.test']));
    const manyDomains = Array.from({ length: 40 }, (_, index) => event(index + 30, [`host-${index}.example.test`]));
    const document = buildCtEventFindings(batch([...repeated, repeated[0], ...manyDomains]));
    const parsed = parseExternalFindingsDocument(document);
    assert.equal(new Set(parsed.findings.map((finding) => finding.domain)).size, MAX_CT_EXTERNAL_DOMAINS);
    assert.equal(parsed.findings.filter((finding) => finding.domain === 'a-same.example.test').length, 20);
    assert.match(parsed.findings[0]?.limitations.join(' ') ?? '', /deterministic order/iu);
  });

  test('rejects malformed digests, unsupported completeness, and unknown fields', () => {
    const malformed = event(1);
    malformed.certificateSha256 = 'not-a-digest';
    assert.throws(() => buildCtEventFindings(batch([malformed])), /SHA-256/iu);
    assert.throws(() => buildCtEventFindings(batch([{ ...event(2), completeness: 'unknown' }])), /complete or partial/iu);
    assert.throws(() => buildCtEventFindings({ ...batch([event(3)]), executable: true }), /unknown field/iu);
  });
});
