import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createLookupViewModel,
  type LookupHttpResponse,
} from '../lib/lookup-response-contract.mts';
import {
  buildLookupRouteAnalysis,
  latestLookupTimestamp,
} from '../frontend/src/lib/analysis/lookup-route-analysis.ts';

function response(overrides: Partial<LookupHttpResponse> = {}): LookupHttpResponse {
  return {
    query: 'portal.example.test',
    type: 'domain',
    inputHostname: 'portal.example.test',
    registrableDomain: 'example.test',
    isSubdomain: true,
    observedAt: '2026-07-01T01:00:00.000Z',
    rdap: {
      fetchedAt: '2026-07-01T01:02:00.000Z',
      parsed: {
        domain: 'EXAMPLE.TEST',
        registrar: { name: 'Example Registrar' },
        createdDate: '2024-01-01T00:00:00.000Z',
      },
    },
    whois: {
      parsed: {
        domainName: 'EXAMPLE.TEST',
        registrar: 'Example Registrar',
        contactsByRole: {},
      },
      chain: [],
    },
    availability: {
      applicable: true,
      domain: 'example.test',
      state: 'registered',
      confidence: 'high',
      deepScanComplete: false,
      dns: {
        source: 'dns',
        status: 'success',
        complete: true,
        observedAt: '2026-07-01T01:03:00.000Z',
        records: { a: ['192.0.2.10'], mx: [] },
      },
      http: {
        source: 'http',
        status: 'success',
        observedAt: '2026-07-01T01:04:00.000Z',
        response: { status: 200 },
      },
      tls: {
        source: 'tls',
        status: 'success',
        observedAt: '2026-07-01T01:05:00.000Z',
        certificate: {},
      },
    },
    diagnostics: {
      rdap: { status: 'success', fetchedAt: '2026-07-01T01:02:00.000Z' },
      whois: { status: 'complete', queriedAt: '2026-07-01T01:01:00.000Z' },
      availability: { status: 'complete' },
    },
    ...overrides,
  };
}

describe('Lookup route analysis', () => {
  test('builds the route evidence model from one normalized response view', () => {
    const result = response();
    const analysis = buildLookupRouteAnalysis({
      result,
      lookupView: createLookupViewModel(result),
      profile: null,
      task: 'general',
    });

    assert.equal(analysis.caseDomain, 'example.test');
    assert.equal(analysis.lookupEvidenceDepth, 'fast');
    assert.equal(analysis.lookupObservedAt, '2026-07-01T01:05:00.000Z');
    assert.equal(analysis.comparison.counts.conflict, 0);
    assert.equal(analysis.evidenceTopologyTarget.label, 'example.test');
    assert.equal(analysis.evidenceTopologyTarget.detail, 'domain · fast lookup');
    assert.equal(analysis.caseEvidence.availability, 'registered');
    assert.equal(analysis.risk?.modelVersion, 7);
    assert.equal(analysis.opportunity?.modelVersion, 2);
    assert.equal(analysis.risk?.evidenceQuality.scanDepth, 'fast');
    assert.equal(analysis.risk?.evidenceQuality.state, 'partial');
    assert.equal(analysis.caseEvidence.opportunityModelVersion, 2);
    assert.ok(analysis.evidenceCoverage.entries.length > 0);
  });

  test('keeps non-domain registry comparisons neutral and bounded', () => {
    const result = response({
      query: '192.0.2.10',
      type: 'ipv4',
      availability: { applicable: false, state: 'unknown' },
    });
    const analysis = buildLookupRouteAnalysis({
      result,
      lookupView: createLookupViewModel(result),
      profile: null,
      task: 'incident',
    });

    assert.deepEqual(analysis.comparison.fields, []);
    assert.deepEqual(analysis.registrarPublicationComparison.fields, []);
    assert.equal(analysis.lookupEvidenceDepth, 'deep');
    assert.equal(analysis.checkpointFacts.length, 0);
  });

  test('selects the newest valid observation timestamp', () => {
    assert.equal(
      latestLookupTimestamp(
        'not-a-date',
        ['2026-01-01T00:00:00.000Z', null],
        '2026-02-01T00:00:00.000Z',
      ),
      '2026-02-01T00:00:00.000Z',
    );
    assert.equal(latestLookupTimestamp(undefined, 'invalid'), null);
  });

  test('uses the provider observation envelope for external-intelligence freshness', () => {
    const result = response({
      observedAt: '2026-07-01T01:00:00.000Z',
      threatIntelligence: {
        providers: [{
          provider: { id: 'urlscan_search', label: 'Archived provider' },
          state: 'not_found',
          findings: [],
          observation: { observedAt: '2026-07-01T01:06:00.000Z', limitations: [] },
        }],
      },
    });
    const analysis = buildLookupRouteAnalysis({
      result,
      lookupView: createLookupViewModel(result),
      profile: null,
      task: 'general',
    });

    assert.equal(analysis.lookupObservedAt, '2026-07-01T01:06:00.000Z');
    assert.equal(analysis.evidenceObservedAtById['external-urlscan_search'], '2026-07-01T01:06:00.000Z');
  });
});
