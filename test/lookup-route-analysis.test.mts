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
import {
  THREAT_INTELLIGENCE_CONTRACT_VERSION,
  THREAT_INTELLIGENCE_ENVELOPE_VERSION,
  THREAT_INTELLIGENCE_SCHEMA,
} from '../lib/threat-intelligence-types.mts';
import { buildRegistrarStanding } from '../lib/registrar-standing.mts';

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
      completedLookupDepth: 'fast',
    });

    assert.equal(analysis.caseDomain, 'example.test');
    assert.equal(analysis.caseEvidence.inputHostname, 'portal.example.test');
    assert.equal(analysis.lookupEvidenceDepth, 'fast');
    assert.equal(analysis.lookupObservedAt, '2026-07-01T01:05:00.000Z');
    assert.equal(analysis.comparison.counts.conflict, 0);
    assert.equal(analysis.evidenceTopologyTarget.label, 'example.test');
    assert.equal(analysis.evidenceTopologyTarget.detail, 'domain · fast lookup');
    assert.equal(analysis.caseEvidence.availability, 'registered');
    assert.equal(analysis.risk?.modelVersion, 8);
    assert.equal(analysis.opportunity?.modelVersion, 2);
    assert.equal(analysis.risk?.evidenceQuality.scanDepth, 'fast');
    assert.equal(analysis.risk?.evidenceQuality.state, 'partial');
    assert.equal(analysis.caseEvidence.opportunityModelVersion, 2);
    assert.ok(analysis.evidenceCoverage.entries.length > 0);
    assert.ok(analysis.lookupDecisionFacts.length > 0);
    assert.equal(analysis.lookupDecisionFacts[0]?.version, 1);
    assert.equal(
      analysis.lookupDecisionFacts.find((fact) => fact.id === 'lookup-evidence:rdap')?.evidenceState,
      'observed',
    );
    assert.equal(Object.isFrozen(analysis.lookupDecisionFacts), true);
    assert.equal(analysis.lookupDecisionSupport.version, 1);
    assert.equal(analysis.lookupReviewActionModel.version, 1);
    assert.equal(
      analysis.lookupReviewActionModel.recommendedNextReviews.total,
      analysis.lookupDecisionSupport.actions.length,
    );
    assert.equal(
      analysis.lookupReviewActionModel.recommendedNextReviews.total,
      analysis.lookupReviewActionModel.recommendedNextReviews.displayedCount
        + analysis.lookupReviewActionModel.recommendedNextReviews.omittedCount,
    );
    assert.equal(analysis.lookupClaimReadiness.version, 2);
    assert.equal(analysis.lookupInvestigationBrief.schemaVersion, 2);
    assert.equal(
      analysis.lookupInvestigationBrief.decisionFacts.total,
      analysis.lookupDecisionFacts.length,
    );
    assert.equal(
      analysis.lookupInvestigationBrief.decisionFacts.total,
      analysis.lookupInvestigationBrief.decisionFacts.displayed
        + analysis.lookupInvestigationBrief.decisionFacts.omitted,
    );
    assert.equal(Object.hasOwn(analysis.lookupInvestigationBrief, 'verifiedFacts'), false);
  });

  test('keeps registrar standing outside Risk and Opportunity scoring', () => {
    const baseline = response();
    const withStanding = response({
      registrarStanding: buildRegistrarStanding({
        registrarIanaId: '4318',
        now: new Date('2026-09-03T12:00:00.000Z'),
      }) as unknown as NonNullable<LookupHttpResponse['registrarStanding']>,
    });
    const analyse = (result: LookupHttpResponse) => buildLookupRouteAnalysis({
      result,
      lookupView: createLookupViewModel(result),
      profile: null,
      task: 'general',
      completedLookupDepth: 'deep',
    });
    const baselineAnalysis = analyse(baseline);
    const standingAnalysis = analyse(withStanding);
    assert.deepEqual(standingAnalysis.risk, baselineAnalysis.risk);
    assert.deepEqual(standingAnalysis.opportunity, baselineAnalysis.opportunity);
    assert.ok(standingAnalysis.lookupSummary.signals.some((signal) => (
      signal.label === 'Official termination notice found'
      && signal.tone === 'warn'
      && signal.detail?.includes('does not classify this domain')
    )));
  });

  test('does not infer Case hostname context from registrable or availability domains', () => {
    const { inputHostname: _inputHostname, ...withoutInputHostname } = response();
    const result = withoutInputHostname as LookupHttpResponse;
    const analysis = buildLookupRouteAnalysis({
      result,
      lookupView: createLookupViewModel(result),
      profile: null,
      task: 'general',
      completedLookupDepth: 'fast',
    });
    assert.equal(analysis.caseDomain, 'example.test');
    assert.equal(analysis.caseEvidence.inputHostname, null);
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
      completedLookupDepth: 'deep',
    });

    assert.deepEqual(analysis.comparison.fields, []);
    assert.deepEqual(analysis.registrarPublicationComparison.fields, []);
    assert.equal(analysis.lookupEvidenceDepth, 'deep');
    assert.equal(analysis.checkpointFacts.length, 0);
  });

  test('keeps profile-derived evidence inconclusive when browser-local profile context is unavailable', () => {
    const result = response();
    const analysis = buildLookupRouteAnalysis({
      result,
      lookupView: createLookupViewModel(result),
      profile: null,
      profileSourceState: 'unavailable',
      task: 'brand',
      completedLookupDepth: 'deep',
    });

    assert.equal(analysis.profileSourceState, 'unavailable');
    assert.match(analysis.profileContextLimitation ?? '', /trust, allowlist, resemblance, and official-reference conclusions remain inconclusive/u);
    assert.equal(analysis.caseEvidence.hasActiveBrandProfile, null);
    assert.equal(analysis.caseEvidence.idnReferenceMatch, null);
    assert.equal(analysis.caseEvidence.pageBaselineMatch, null);
    assert.equal(analysis.caseEvidence.profileContextState, 'unavailable');
    assert.match(analysis.caseEvidence.profileContextLimitation ?? '', /remain inconclusive/u);
    assert.equal(analysis.risk, null);
    assert.equal(analysis.riskSensitivity, null);
    assert.equal(analysis.caseEvidence.riskModelVersion, null);
    assert.equal(analysis.caseEvidence.riskScore, null);
    assert.deepEqual(analysis.caseEvidence.riskFactors, []);
    assert.deepEqual(analysis.profileSignals, {
      trusted: null,
      faviconMatch: null,
      faviconNearMatch: null,
      reusesOfficialAssets: null,
    });
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
        version: THREAT_INTELLIGENCE_ENVELOPE_VERSION,
        providers: [{
          schema: THREAT_INTELLIGENCE_SCHEMA,
          version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
          provider: { id: 'urlscan_search', label: 'Archived provider' },
          target: { type: 'domain', value: 'example.test', exposure: 'registrable_domain' },
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
      completedLookupDepth: 'deep',
    });

    assert.equal(analysis.lookupObservedAt, '2026-07-01T01:06:00.000Z');
    assert.equal(analysis.evidenceObservedAtById['external-urlscan_search'], '2026-07-01T01:06:00.000Z');
  });

  test('excludes unbound or unsupported provider records from evidence and Risk', () => {
    const baseProvider = {
      schema: THREAT_INTELLIGENCE_SCHEMA,
      version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
      provider: { id: 'urlscan_search', label: 'Archived provider' },
      target: { type: 'domain', value: 'other.example', exposure: 'registrable_domain' },
      state: 'success',
      findings: [{ category: 'phishing', lastObservedAt: '2026-07-01T01:05:00.000Z' }],
      observation: { observedAt: '2026-07-01T01:06:00.000Z', limitations: [] },
    };
    const { target: _target, ...providerWithoutTarget } = baseProvider;
    const result = response({
      threatIntelligence: {
        version: THREAT_INTELLIGENCE_ENVELOPE_VERSION + 1,
        providers: [
          baseProvider,
          { ...providerWithoutTarget, provider: { id: 'urlhaus_host' } },
        ],
      },
    });
    const lookupView = createLookupViewModel(result);
    const analysis = buildLookupRouteAnalysis({
      result,
      lookupView,
      profile: null,
      task: 'general',
      completedLookupDepth: 'deep',
    });

    assert.deepEqual(lookupView.threatIntelligence, {});
    assert.deepEqual(lookupView.threatIntelligenceProviders, []);
    assert.equal(analysis.externalRiskContext.eligibleProviderCount, 0);
    assert.equal(analysis.risk?.factors.some((factor) => factor.family === 'external-intelligence'), false);
    assert.equal(analysis.lookupObservedAt, '2026-07-01T01:05:00.000Z');
    assert.equal(analysis.evidenceObservedAtById['external-urlscan_search'], undefined);
  });

  test('requires an explicit observed source state before presenting task actions', () => {
    const taskActionIds = new Set([
      'review-acquisition-dependencies',
      'review-owned-posture',
      'review-page-identity',
    ]);
    for (const status of [undefined, '', 'pending', 123]) {
      const sourceStatus = status === undefined ? {} : { status };
      const result = response({
        availability: {
          applicable: true,
          domain: 'example.test',
          state: 'registered',
          confidence: 'high',
          deepScanComplete: true,
          dns: { source: 'dns', ...sourceStatus },
          http: { source: 'http', ...sourceStatus },
          tls: { source: 'tls', ...sourceStatus },
          pageIdentity: { source: 'html', ...sourceStatus },
          credentialSurfaceProfile: { source: 'html', ...sourceStatus },
          securityPosture: { source: 'derived', ...sourceStatus },
        },
      });
      for (const task of ['acquisition', 'brand', 'owned'] as const) {
        const analysis = buildLookupRouteAnalysis({
          result,
          lookupView: createLookupViewModel(result),
          profile: null,
          task,
          completedLookupDepth: 'deep',
        });
        assert.equal(
          analysis.lookupDecisionSupport.actions.some((action) => taskActionIds.has(action.id)),
          false,
          `${task} ${String(status)}`,
        );
      }
    }

    for (const status of ['success', 'partial']) {
      const result = response({
        availability: {
          applicable: true,
          domain: 'example.test',
          state: 'registered',
          confidence: 'high',
          deepScanComplete: true,
          dns: { source: 'dns', status },
          pageIdentity: { source: 'html', status },
          securityPosture: { source: 'derived', status },
        },
      });
      for (const [task, expectedAction] of [
        ['acquisition', 'review-acquisition-dependencies'],
        ['brand', 'review-page-identity'],
        ['owned', 'review-owned-posture'],
      ] as const) {
        const analysis = buildLookupRouteAnalysis({
          result,
          lookupView: createLookupViewModel(result),
          profile: null,
          task,
          completedLookupDepth: 'deep',
        });
        assert.ok(analysis.lookupDecisionSupport.actions.some((action) => action.id === expectedAction));
      }
    }
  });

  test('uses the completed request depth for generic targets without inferring from availability', () => {
    for (const type of ['ipv4', 'asn'] as const) {
      const query = type === 'ipv4' ? '192.0.2.10' : 'AS64497';
      const {
        registrableDomain: _registrableDomain,
        inputHostname: _inputHostname,
        isSubdomain: _isSubdomain,
        ...base
      } = response();
      const result: LookupHttpResponse = {
        ...base,
        query,
        type,
        availability: { applicable: false, state: 'unknown' },
      };
      for (const completedLookupDepth of ['fast', 'deep'] as const) {
        const analysis = buildLookupRouteAnalysis({
          result,
          lookupView: createLookupViewModel(result),
          profile: null,
          task: 'general',
          completedLookupDepth,
        });
        assert.equal(analysis.lookupEvidenceDepth, completedLookupDepth, `${type} ${completedLookupDepth}`);
        assert.equal(analysis.evidenceTopologyTarget.detail, `${type} · ${completedLookupDepth} lookup`);
      }
    }
  });
});
