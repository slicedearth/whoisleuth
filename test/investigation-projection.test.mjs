import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildInvestigationProjection,
  INVESTIGATION_PROJECTION_SCHEMA,
  INVESTIGATION_PROJECTION_VERSION,
  MAX_PROJECTION_OBSERVATIONS,
} from '../frontend/src/lib/analysis/investigation-projection.ts';
import { CASE_SCHEMA_VERSION, MAX_CASES } from '../frontend/src/lib/analysis/case-model.js';
import { BRAND_PROFILE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/brand-profile-model.js';
import { CAMPAIGN_SCHEMA_VERSION } from '../frontend/src/lib/analysis/campaign-model.js';
import { createPageBaseline } from '../frontend/src/lib/analysis/page-baseline.js';
import {
  MAX_NAMESERVERS_PER_ROW,
  MAX_RELATIONSHIP_ROWS,
  RELATIONSHIP_EVIDENCE_VERSION,
} from '../frontend/src/lib/analysis/relationship-evidence.js';
import {
  RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
  createRelationshipObservation,
} from '../frontend/src/lib/analysis/relationship-observation-model.ts';

const EARLY = '2026-07-01T00:00:00.000Z';
const LATE = '2026-07-19T00:00:00.000Z';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function snapshot(overrides = {}) {
  return {
    capturedAt: LATE,
    scanDepth: 'deep',
    source: 'lookup',
    availability: 'registered',
    nameservers: [],
    ...overrides,
  };
}

function caseRecord(id, domain, evidenceHistory = [snapshot()], overrides = {}) {
  return {
    id,
    domain,
    status: 'reviewing',
    disposition: 'unreviewed',
    source: 'lookup',
    evidenceHistory,
    createdAt: EARLY,
    updatedAt: LATE,
    ...overrides,
  };
}

function currentInput(overrides = {}) {
  return {
    cases: { version: CASE_SCHEMA_VERSION, cases: [] },
    campaigns: { version: CAMPAIGN_SCHEMA_VERSION, campaigns: [] },
    brandProfiles: { version: BRAND_PROFILE_SCHEMA_VERSION, profiles: [] },
    relationshipRows: [],
    ...overrides,
  };
}

function entity(result, type, predicate = () => true) {
  return result.entities.find((item) => item.type === type && predicate(item));
}

function relationship(result, type) {
  return result.relationships.find((item) => item.type === type);
}

function pageBaseline(overrides = {}) {
  const pageIdentity = {
    identityVersion: 3,
    version: 1,
    status: 'success',
    observedAt: EARLY,
    scanMode: 'deep',
    source: 'html',
    complete: true,
    truncated: false,
    canonical: { url: 'https://www.official.invalid/path?discarded=yes' },
    fingerprints: {
      fingerprintVersion: 1,
      normalizedHtml: { algorithm: 'sha256', value: SHA_A, tokenCount: 20, truncated: false },
      domStructure: { algorithm: 'sha256', value: SHA_B, nodeCount: 10, parser: 'static-tag-sequence-v1', truncated: false },
      resourceHosts: { algorithm: 'set-sha256', value: null, values: [], truncated: false },
      identifiers: { algorithm: 'set-sha256', value: null, values: [], truncated: false },
      complete: true,
      truncated: false,
    },
    ...overrides,
  };
  return createPageBaseline('official.invalid', { faviconHash: SHA_C, pageIdentity });
}

describe('typed local investigation projection', () => {
  test('returns a stable empty current contract without touching browser globals', () => {
    const result = buildInvestigationProjection({}, { generatedAt: LATE });
    assert.equal(result.schema, INVESTIGATION_PROJECTION_SCHEMA);
    assert.equal(result.version, INVESTIGATION_PROJECTION_VERSION);
    assert.equal(result.generatedAt, LATE);
    assert.deepEqual(result.counts, { entities: 0, observations: 0, relationships: 0 });
    assert.deepEqual(result.sources, {
      cases: { state: 'absent', version: null, records: 0, truncated: false },
      campaigns: { state: 'absent', version: null, records: 0, truncated: false },
      brandProfiles: { state: 'absent', version: null, records: 0, truncated: false },
      relationshipRows: { state: 'absent', version: null, records: 0, truncated: false },
      relationshipObservations: { state: 'absent', version: null, records: 0, truncated: false },
    });
    assert.equal(result.truncated, false);
  });

  test('projects cases, domains, nameserver sets, and comparable final origins with provenance', () => {
    const evidence = snapshot({
      firstCapturedAt: EARLY,
      nameservers: ['NS2.SHARED.INVALID.', 'ns1.shared.invalid'],
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'partial',
      httpFinalOrigin: 'https://Landing.Invalid/private?discarded=yes',
      httpResponseStatus: 200,
      riskModelVersion: 5,
      riskScore: 22,
    });
    const result = buildInvestigationProjection(currentInput({
      cases: { version: CASE_SCHEMA_VERSION, cases: [caseRecord('case-a', 'A.INVALID', [evidence])] },
    }), { generatedAt: LATE });

    assert.equal(entity(result, 'domain').properties.domain, 'a.invalid');
    assert.deepEqual(entity(result, 'nameserver_set').properties.nameservers, ['ns1.shared.invalid', 'ns2.shared.invalid']);
    assert.equal(entity(result, 'http_origin').properties.origin, 'https://landing.invalid');
    assert.equal(relationship(result, 'case_documents_domain').classification, 'direct');
    assert.equal(relationship(result, 'domain_uses_nameserver_set').classification, 'normalized');
    assert.equal(relationship(result, 'domain_reached_http_origin').classification, 'normalized');
    assert.equal(relationship(result, 'domain_uses_nameserver_set').firstObservedAt, EARLY);
    assert.equal(relationship(result, 'domain_uses_nameserver_set').lastObservedAt, LATE);

    const observation = result.observations.find((item) => item.kind === 'case_evidence');
    assert.equal(observation.source, 'lookup');
    assert.equal(observation.scanDepth, 'deep');
    assert.equal(observation.status, 'partial');
    assert.equal(observation.complete, null);
    assert.equal(observation.truncated, null);
    assert.deepEqual(observation.schemaVersions, { case: CASE_SCHEMA_VERSION, riskModel: 5, httpSummary: 1 });
    assert.match(observation.limitations[0], /source-health/);
  });

  test('does not create deep-only origin edges from fast or depth-unknown evidence', () => {
    const http = {
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpFinalOrigin: 'https://landing.invalid',
      httpResponseStatus: 200,
    };
    const result = buildInvestigationProjection(currentInput({
      cases: { version: CASE_SCHEMA_VERSION, cases: [
        caseRecord('case-fast', 'fast.invalid', [snapshot({ ...http, scanDepth: 'fast' })]),
        caseRecord('case-unknown', 'unknown.invalid', [snapshot({ ...http, scanDepth: 'unknown' })]),
      ] },
    }), { generatedAt: LATE });
    assert.equal(entity(result, 'http_origin'), undefined);
    assert.equal(relationship(result, 'domain_reached_http_origin'), undefined);
    assert.ok(result.observations.some((item) => item.scanDepth === 'unknown'
      && item.limitations.some((value) => value.includes('not comparable'))));
  });

  test('projects brands, official domains, favicon identity, campaigns, and derived case membership', () => {
    const profile = {
      id: 'brand-a',
      name: 'Reserved Brand',
      officialDomains: ['OFFICIAL.INVALID'],
      officialFaviconHash: SHA_A,
      createdAt: EARLY,
      updatedAt: LATE,
    };
    const campaign = {
      id: 'campaign-a',
      name: 'Reserved campaign',
      domains: ['candidate.invalid'],
      createdAt: EARLY,
      updatedAt: LATE,
    };
    const result = buildInvestigationProjection(currentInput({
      cases: { version: CASE_SCHEMA_VERSION, cases: [caseRecord('case-a', 'candidate.invalid')] },
      campaigns: { version: CAMPAIGN_SCHEMA_VERSION, campaigns: [campaign] },
      brandProfiles: { version: BRAND_PROFILE_SCHEMA_VERSION, profiles: [profile] },
    }), { generatedAt: LATE });

    assert.equal(entity(result, 'brand').label, 'Reserved Brand');
    assert.equal(entity(result, 'favicon').properties.sha256, SHA_A);
    assert.equal(entity(result, 'campaign').label, 'Reserved campaign');
    assert.equal(relationship(result, 'brand_declares_official_domain').classification, 'direct');
    assert.equal(relationship(result, 'brand_declares_official_favicon').classification, 'direct');
    assert.equal(relationship(result, 'campaign_contains_domain').classification, 'direct');
    assert.equal(relationship(result, 'campaign_contains_case').classification, 'derived');
    assert.match(relationship(result, 'campaign_contains_case').method, /canonical-domain match/);
  });

  test('preserves official-site baseline completeness, truncation, and model versions', () => {
    const baseline = pageBaseline();
    const result = buildInvestigationProjection(currentInput({
      brandProfiles: { version: BRAND_PROFILE_SCHEMA_VERSION, profiles: [{
        id: 'brand-a',
        name: 'Reserved Brand',
        officialDomains: ['official.invalid'],
        pageBaseline: baseline,
        createdAt: EARLY,
        updatedAt: LATE,
      }] },
    }), { generatedAt: LATE });
    const observation = result.observations.find((item) => item.kind === 'brand_page_baseline');
    assert.equal(observation.status, 'success');
    assert.equal(observation.complete, true);
    assert.equal(observation.truncated, false);
    assert.deepEqual(observation.schemaVersions, {
      brandProfile: BRAND_PROFILE_SCHEMA_VERSION,
      pageBaseline: 1,
      pageIdentity: 3,
      pageFingerprint: 1,
    });
    assert.equal(relationship(result, 'domain_observed_favicon').complete, true);
  });

  test('projects exact scan-local favicon and certificate identities when current evidence is supplied', () => {
    const result = buildInvestigationProjection(currentInput({
      relationshipRows: [{
        domain: 'candidate.invalid',
        observedAt: LATE,
        scanDepth: 'deep',
        source: 'bulk',
        relationship: {
          version: RELATIONSHIP_EVIDENCE_VERSION,
          nameservers: ['NS.CANDIDATE.INVALID.'],
          faviconHash: SHA_A.toUpperCase(),
          certificateFingerprint: SHA_B.toUpperCase(),
          truncated: false,
        },
      }],
    }), { generatedAt: LATE });
    assert.equal(entity(result, 'favicon').properties.sha256, SHA_A);
    assert.equal(entity(result, 'certificate').properties.sha256, SHA_B);
    assert.equal(relationship(result, 'domain_observed_favicon').classification, 'normalized');
    assert.equal(relationship(result, 'domain_presented_certificate').classification, 'normalized');
    assert.match(relationship(result, 'domain_presented_certificate').method, /native TLS leaf-certificate/);
    assert.ok(entity(result, 'certificate').observationIds.length > 0);
  });

  test('projects analyst-retained Bulk relationships as separately attributed derived evidence', () => {
    const retained = createRelationshipObservation({
      type: 'ip_address',
      label: 'Shared IP address',
      method: 'Exact normalized address',
      normalizedValue: '192.0.2.20',
      value: '192.0.2.20',
      domains: ['first.invalid', 'second.invalid'],
      description: 'Bounded retained pivot.',
    }, {
      observedAt: EARLY,
      retainedAt: LATE,
      complete: true,
      truncated: false,
      sourceVersion: RELATIONSHIP_EVIDENCE_VERSION,
      limitations: ['Shared hosting is common.'],
    });
    const result = buildInvestigationProjection(currentInput({
      relationshipObservations: {
        version: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
        observations: [retained],
      },
    }), { generatedAt: LATE });
    const retainedObservation = result.observations.find((item) => item.kind === 'retained_relationship_observation');
    const retainedRelationship = relationship(result, 'domain_resolved_to_ip');

    assert.equal(result.sources.relationshipObservations.state, 'supported');
    assert.equal(entity(result, 'ip_address').properties.ipAddress, '192.0.2.20');
    assert.equal(retainedObservation.store, 'relationshipObservations');
    assert.equal(retainedObservation.source, 'bulk_relationship_analysis');
    assert.equal(retainedObservation.status, 'success');
    assert.deepEqual(retainedObservation.schemaVersions, {
      relationshipEvidence: RELATIONSHIP_EVIDENCE_VERSION,
      relationshipObservation: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
    });
    assert.equal(retainedRelationship.classification, 'derived');
    assert.equal(result.relationships.filter((item) => item.type === 'domain_resolved_to_ip').length, 2);
    assert.match(retainedRelationship.limitations.join(' '), /explicit analyst action/i);
  });

  test('drops malformed identity values and absent deep evidence without negative edges', () => {
    const result = buildInvestigationProjection(currentInput({
      relationshipRows: [{
        domain: 'candidate.invalid',
        observedAt: LATE,
        relationship: {
          version: RELATIONSHIP_EVIDENCE_VERSION,
          nameservers: ['not a hostname'],
          faviconHash: 'not-a-hash',
          certificateFingerprint: 'not-a-certificate',
          truncated: false,
        },
      }],
    }), { generatedAt: LATE });
    assert.equal(entity(result, 'nameserver_set'), undefined);
    assert.equal(entity(result, 'favicon'), undefined);
    assert.equal(entity(result, 'certificate'), undefined);
    assert.equal(result.relationships.length, 0);
  });

  test('reapplies scan-local field caps and discloses partial relationship evidence', () => {
    const result = buildInvestigationProjection(currentInput({
      relationshipRows: [{
        domain: 'candidate.invalid',
        observedAt: LATE,
        relationship: {
          version: RELATIONSHIP_EVIDENCE_VERSION,
          nameservers: Array.from({ length: MAX_NAMESERVERS_PER_ROW + 1 }, (_, index) => `ns${index}.invalid`),
          truncated: false,
        },
      }],
    }), { generatedAt: LATE });
    const observation = result.observations[0];
    assert.equal(observation.status, 'partial');
    assert.equal(observation.truncated, true);
    assert.equal(entity(result, 'nameserver_set').properties.nameservers.length, MAX_NAMESERVERS_PER_ROW);
    assert.equal(result.truncated, true);
  });

  test('refuses future store and relationship schemas while preserving explicit source states', () => {
    const result = buildInvestigationProjection(currentInput({
      cases: { version: CASE_SCHEMA_VERSION + 1, cases: [caseRecord('future', 'future.invalid')] },
      campaigns: { version: CAMPAIGN_SCHEMA_VERSION + 1, campaigns: [] },
      brandProfiles: { version: BRAND_PROFILE_SCHEMA_VERSION + 1, profiles: [] },
      relationshipRows: [{
        domain: 'future.invalid',
        observedAt: LATE,
        relationship: { version: RELATIONSHIP_EVIDENCE_VERSION + 1 },
      }],
      relationshipObservations: {
        version: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION + 1,
        observations: [],
      },
    }), { generatedAt: LATE });
    assert.equal(result.sources.cases.state, 'unsupported');
    assert.equal(result.sources.campaigns.state, 'unsupported');
    assert.equal(result.sources.brandProfiles.state, 'unsupported');
    assert.equal(result.sources.relationshipObservations.state, 'unsupported');
    assert.equal(result.entities.length, 0);
    assert.ok(result.limitations.some((value) => value.includes(`cases schema ${CASE_SCHEMA_VERSION + 1}`)));
    assert.ok(result.limitations.some((value) => value.includes(`relationship observation used unsupported schema ${RELATIONSHIP_EVIDENCE_VERSION + 1}`)));
  });

  test('reports malformed source collections without interpreting their unknown fields', () => {
    const result = buildInvestigationProjection({
      cases: { version: CASE_SCHEMA_VERSION, records: [{ domain: 'hidden.invalid' }] },
      campaigns: 'invalid',
      brandProfiles: 42,
      relationshipRows: {},
    }, { generatedAt: LATE });
    assert.deepEqual(Object.values(result.sources).map((source) => source.state), ['invalid', 'invalid', 'invalid', 'invalid', 'absent']);
    assert.equal(result.entities.length, 0);
    assert.equal(result.limitations.filter((value) => value.includes('malformed')).length, 4);
  });

  test('is deterministic across source ordering and does not mutate input', () => {
    const records = [
      caseRecord('case-b', 'b.invalid', [snapshot({ nameservers: ['ns.shared.invalid'] })]),
      caseRecord('case-a', 'a.invalid', [snapshot({ nameservers: ['ns.shared.invalid'] })]),
    ];
    const firstInput = currentInput({ cases: { version: CASE_SCHEMA_VERSION, cases: records } });
    const secondInput = currentInput({ cases: { version: CASE_SCHEMA_VERSION, cases: [...records].reverse() } });
    const before = structuredClone(firstInput);
    const first = buildInvestigationProjection(firstInput, { generatedAt: LATE });
    const second = buildInvestigationProjection(secondInput, { generatedAt: LATE });
    assert.deepEqual(first, second);
    assert.deepEqual(firstInput, before);
  });

  test('merges repeated relationship evidence with bounded source observations and first/last times', () => {
    const result = buildInvestigationProjection(currentInput({
      cases: { version: CASE_SCHEMA_VERSION, cases: [caseRecord('case-a', 'a.invalid', [
        snapshot({ capturedAt: EARLY, nameservers: ['ns.shared.invalid'], riskScore: 10 }),
        snapshot({ capturedAt: LATE, nameservers: ['ns.shared.invalid'], riskScore: 20 }),
      ])] },
    }), { generatedAt: LATE });
    const relation = relationship(result, 'domain_uses_nameserver_set');
    assert.equal(relation.firstObservedAt, EARLY);
    assert.equal(relation.lastObservedAt, LATE);
    assert.equal(relation.sourceObservationIds.length, 2);
    assert.equal(relation.complete, null);
    assert.equal(relation.truncated, null);
  });

  test('discloses source caps before projection instead of silently interpreting oversized arrays', () => {
    const cases = Array.from({ length: MAX_CASES + 1 }, (_, index) => (
      caseRecord(`case-${index}`, `d${index}.invalid`, [], { updatedAt: new Date(Date.parse(LATE) - index * 1000).toISOString() })
    ));
    const rows = Array.from({ length: MAX_RELATIONSHIP_ROWS + 1 }, () => null);
    const result = buildInvestigationProjection(currentInput({
      cases: { version: CASE_SCHEMA_VERSION, cases },
      relationshipRows: rows,
    }), { generatedAt: LATE });
    assert.equal(result.sources.cases.records, MAX_CASES);
    assert.equal(result.sources.cases.truncated, true);
    assert.equal(result.sources.relationshipRows.records, MAX_RELATIONSHIP_ROWS);
    assert.equal(result.sources.relationshipRows.truncated, true);
    assert.equal(result.truncated, true);
    assert.ok(result.limitations.some((value) => value.includes(`cases exceeded ${MAX_CASES}`)));
  });

  test('caps the aggregate observation projection and discloses partial output', () => {
    const cases = Array.from({ length: 161 }, (_, caseIndex) => {
      const evidence = Array.from({ length: 25 }, (_, snapshotIndex) => snapshot({
        capturedAt: new Date(Date.parse(EARLY) + snapshotIndex * 60_000).toISOString(),
        riskScore: snapshotIndex,
      }));
      return caseRecord(`case-${caseIndex}`, `d${caseIndex}.invalid`, evidence);
    });
    const result = buildInvestigationProjection(currentInput({
      cases: { version: CASE_SCHEMA_VERSION, cases },
    }), { generatedAt: LATE });
    assert.equal(result.observations.length, MAX_PROJECTION_OBSERVATIONS);
    assert.equal(result.truncated, true);
    assert.ok(result.relationships.every((item) => item.sourceObservationIds.every((id) => (
      result.observations.some((observation) => observation.id === id)
    ))));
  });
});
