import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildCtEventFindings } from '../cli/ct-event-intake.mts';
import {
  EXTERNAL_OBSERVATION_MAPPING_SCHEMA,
  mapExternalObservations,
} from '../cli/external-observation-mapping.mts';
import { buildOpenAssetModelBridge } from '../cli/open-asset-model-bridge.mts';
import { parseExternalFindingsDocument } from '../frontend/src/lib/analysis/external-findings-import.ts';

const NOW = '2026-08-05T10:00:00.000Z';

function mappingInput() {
  return {
    schema: EXTERNAL_OBSERVATION_MAPPING_SCHEMA,
    version: 1,
    source: { name: 'Local source fixture', reference: 'fixture:batch', collectedAt: NOW },
    profile: {
      id: 'fixture-profile', version: 1,
      domainField: 'target.domain', summaryField: 'finding.summary', observedAtField: 'time.observed',
      referenceField: 'finding.reference', completenessField: 'finding.completeness',
      category: 'reputation', evidenceClass: 'provider_report',
      limitations: ['Fixture data only.'],
    },
    records: [{
      target: { domain: 'Portal.Example.Test' },
      finding: { summary: 'Fixture observation', reference: 'fixture:1', completeness: 'partial' },
      time: { observed: NOW },
    }],
  };
}

describe('external observation mapping and asset bridge', () => {
  test('applies a non-executable dotted-field profile into browser-compatible findings', () => {
    const document = mapExternalObservations(mappingInput());
    assert.equal(parseExternalFindingsDocument(document).findings[0]?.domain, 'portal.example.test');
    assert.equal(document.findings[0]?.completeness, 'partial');
    assert.match(document.findings[0]?.limitations.join(' ') ?? '', /profile fixture-profile version 1/iu);
  });

  test('rejects prototype paths, unsupported completeness, and additional fields', () => {
    const unsafe = mappingInput();
    unsafe.profile.domainField = '__proto__.domain';
    assert.throws(() => mapExternalObservations(unsafe), /safe bounded dotted field path/iu);
    const incomplete = mappingInput();
    incomplete.records[0]!.finding.completeness = 'successful';
    assert.throws(() => mapExternalObservations(incomplete), /completeness is unsupported/iu);
    assert.throws(() => mapExternalObservations({ ...mappingInput(), executable: true }), /unknown field/iu);
  });

  test('projects certificate findings into bounded documented asset and relation vocabulary', () => {
    const findings = buildCtEventFindings({
      schema: 'whoisleuth.ct-event-batch', version: 1,
      source: { name: 'Local certificate fixture', reference: null, collectedAt: NOW },
      events: [{
        logId: 'fixture:1', observedAt: NOW, certificateSha256: 'a'.repeat(64),
        dnsNames: ['certificate.example.test'], issuer: 'Fixture issuer', notAfter: '2026-12-01T00:00:00Z',
        completeness: 'complete', limitations: [],
      }],
    });
    const bridge = buildOpenAssetModelBridge(findings, NOW);
    assert.deepEqual(bridge.assets.map((asset) => asset.type), ['FQDN', 'TLSCertificate']);
    assert.equal(bridge.relations[0]?.label, 'san_dns_name');
    assert.equal('confidence' in bridge.relations[0]!, false);
    assert.match(bridge.limitations.join(' '), /receiving tools must still validate/iu);
  });

  test('rejects malformed certificate digests and does not treat non-address DNS fields as address relations', () => {
    const findings = buildCtEventFindings({
      schema: 'whoisleuth.ct-event-batch', version: 1,
      source: { name: 'Local certificate fixture', reference: null, collectedAt: NOW },
      events: [{
        logId: 'fixture:1', observedAt: NOW, certificateSha256: 'a'.repeat(64),
        dnsNames: ['certificate.example.test'], issuer: null, notAfter: null,
        completeness: 'complete', limitations: [],
      }],
    });
    const malformed = {
      ...findings,
      findings: findings.findings.map((finding, index) => index === 0 ? {
        ...finding,
        structuredObservation: { ...finding.structuredObservation!, value: 'not-a-digest' },
      } : finding),
    };
    assert.throws(() => buildOpenAssetModelBridge(malformed, NOW), /SHA-256 hexadecimal digest/iu);

    const dns = {
      ...findings,
      findings: findings.findings.map((finding, index) => index === 0 ? {
        ...finding,
        category: 'dns' as const,
        structuredObservation: {
          ...finding.structuredObservation!,
          sourceSchema: 'whoisleuth.dns-observation-rows' as const,
          field: 'TXT',
          value: '192.0.2.1',
        },
      } : finding),
    };
    const bridge = buildOpenAssetModelBridge(dns, NOW);
    assert.deepEqual(bridge.assets.map((asset) => asset.type), ['FQDN']);
    assert.equal(bridge.relations.length, 0);
  });
});
