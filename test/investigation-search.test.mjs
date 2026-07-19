import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildInvestigationSearchIndex,
  INVESTIGATION_SEARCH_SCHEMA,
  INVESTIGATION_SEARCH_VERSION,
  MAX_INVESTIGATION_SEARCH_QUERY_LENGTH,
  MAX_INVESTIGATION_SEARCH_RESULTS,
  MAX_INVESTIGATION_SEARCH_TOKENS,
  searchInvestigationIndex,
} from '../frontend/src/lib/analysis/investigation-search.ts';
import {
  buildInvestigationProjection,
  INVESTIGATION_PROJECTION_SCHEMA,
  INVESTIGATION_PROJECTION_VERSION,
} from '../frontend/src/lib/analysis/investigation-projection.ts';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model.js';
import { BRAND_PROFILE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/brand-profile-model.js';
import { CAMPAIGN_SCHEMA_VERSION } from '../frontend/src/lib/analysis/campaign-model.js';
import { RELATIONSHIP_EVIDENCE_VERSION } from '../frontend/src/lib/analysis/relationship-evidence.js';

const EARLY = '2026-07-01T00:00:00.000Z';
const LATE = '2026-07-19T00:00:00.000Z';
const SHA = 'a'.repeat(64);

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

function caseRecord(id, domain, overrides = {}) {
  return {
    id,
    domain,
    status: 'reviewing',
    disposition: 'unreviewed',
    source: 'lookup',
    evidenceHistory: [snapshot()],
    createdAt: EARLY,
    updatedAt: LATE,
    ...overrides,
  };
}

function projectionInput(overrides = {}) {
  return {
    cases: { version: CASE_SCHEMA_VERSION, cases: [] },
    campaigns: { version: CAMPAIGN_SCHEMA_VERSION, campaigns: [] },
    brandProfiles: { version: BRAND_PROFILE_SCHEMA_VERSION, profiles: [] },
    relationshipRows: [],
    ...overrides,
  };
}

function indexFor(input) {
  return buildInvestigationSearchIndex(buildInvestigationProjection(input, { generatedAt: LATE }));
}

describe('local investigation search index', () => {
  test('builds a versioned empty index from the current projection contract', () => {
    const index = indexFor(projectionInput());
    assert.equal(index.schema, INVESTIGATION_SEARCH_SCHEMA);
    assert.equal(index.version, INVESTIGATION_SEARCH_VERSION);
    assert.equal(index.state, 'ready');
    assert.equal(index.projectionVersion, INVESTIGATION_PROJECTION_VERSION);
    assert.equal(index.generatedAt, LATE);
    assert.equal(index.entityCount, 0);
    assert.equal(index.termCount, 0);
    assert.deepEqual(searchInvestigationIndex(index, ''), {
      state: 'idle', query: '', results: [], totalMatches: 0, truncated: false, detail: '',
    });
  });

  test('ranks exact canonical domains ahead of prefix and substring matches', () => {
    const index = indexFor(projectionInput({
      cases: { version: CASE_SCHEMA_VERSION, cases: [
        caseRecord('case-exact', 'portal.invalid'),
        caseRecord('case-prefix', 'portal-login.invalid'),
        caseRecord('case-substring', 'secure-portal.invalid'),
      ] },
    }));
    const response = searchInvestigationIndex(index, 'PORTAL.INVALID');
    assert.equal(response.state, 'results');
    assert.equal(response.results[0].canonical, 'portal.invalid');
    assert.equal(response.results[0].matchedField, 'canonical');
    assert.equal(response.results[0].score, 0);
  });

  test('searches case domains and pivots to the exact source case without network work', () => {
    const index = indexFor(projectionInput({
      cases: { version: CASE_SCHEMA_VERSION, cases: [caseRecord('case-source', 'candidate.invalid')] },
    }));
    const response = searchInvestigationIndex(index, 'candidate.invalid');
    const caseResult = response.results.find((result) => result.entityType === 'case');
    const domainResult = response.results.find((result) => result.entityType === 'domain');
    assert.equal(caseResult.href, '/monitor?case=case-source');
    assert.equal(caseResult.action, 'Open case');
    assert.equal(domainResult.href, '/monitor?case=case-source');
    assert.equal(domainResult.action, 'Open source case');
    assert.equal(domainResult.sourceStore, 'cases');
    assert.equal(domainResult.observedAt, LATE);
  });

  test('searches brand and campaign labels with exact passive pivots', () => {
    const index = indexFor(projectionInput({
      brandProfiles: { version: BRAND_PROFILE_SCHEMA_VERSION, profiles: [{
        id: 'profile-source',
        name: 'Reserved Identity',
        officialDomains: ['official.invalid'],
        createdAt: EARLY,
        updatedAt: LATE,
      }] },
      campaigns: { version: CAMPAIGN_SCHEMA_VERSION, campaigns: [{
        id: 'campaign-source',
        name: 'Priority Review',
        description: '',
        domains: ['candidate.invalid'],
        createdAt: EARLY,
        updatedAt: LATE,
      }] },
    }));
    const brand = searchInvestigationIndex(index, 'reserved identity').results.find((result) => result.entityType === 'brand');
    const campaign = searchInvestigationIndex(index, 'priority review').results.find((result) => result.entityType === 'campaign');
    assert.equal(brand.href, '/brands?profile=profile-source');
    assert.equal(brand.action, 'Open profile');
    assert.equal(campaign.href, '/monitor?view=campaigns&campaign=campaign-source');
    assert.equal(campaign.action, 'Open campaign');
  });

  test('searches retained nameserver, HTTP origin, favicon, and certificate identifiers', () => {
    const index = indexFor(projectionInput({
      cases: { version: CASE_SCHEMA_VERSION, cases: [caseRecord('case-source', 'candidate.invalid', {
        evidenceHistory: [snapshot({
          nameservers: ['ns1.shared.invalid'],
          httpSummaryVersion: 1,
          httpEvidenceStatus: 'success',
          httpFinalOrigin: 'https://landing.invalid',
          httpResponseStatus: 200,
        })],
      })] },
      relationshipRows: [{
        domain: 'scan.invalid',
        observedAt: LATE,
        source: 'bulk',
        scanDepth: 'deep',
        relationship: {
          version: RELATIONSHIP_EVIDENCE_VERSION,
          nameservers: [],
          faviconHash: SHA,
          certificateFingerprint: 'b'.repeat(64),
          truncated: false,
        },
      }],
    }));
    assert.equal(searchInvestigationIndex(index, 'ns1.shared.invalid').results[0].matchedField, 'canonical');
    assert.equal(searchInvestigationIndex(index, 'landing.invalid').results[0].entityType, 'http_origin');
    assert.equal(searchInvestigationIndex(index, SHA).results[0].entityType, 'favicon');
    const certificate = searchInvestigationIndex(index, 'b'.repeat(64)).results[0];
    assert.equal(certificate.entityType, 'certificate');
    assert.equal(certificate.href, '/lookup?q=scan.invalid');
  });

  test('matches bounded multi-term queries across known fields only', () => {
    const index = indexFor(projectionInput({
      campaigns: { version: CAMPAIGN_SCHEMA_VERSION, campaigns: [{
        id: 'campaign-source',
        name: 'Reserved Priority Review',
        description: 'This description must not be indexed',
        domains: [],
        createdAt: EARLY,
        updatedAt: LATE,
      }] },
    }));
    assert.equal(searchInvestigationIndex(index, 'reserved review').results[0].entityType, 'campaign');
    assert.equal(searchInvestigationIndex(index, 'description must').state, 'no_matches');
  });

  test('rejects non-text, control-containing, overlong, and over-token queries', () => {
    const index = indexFor(projectionInput());
    assert.equal(searchInvestigationIndex(index, null).state, 'invalid');
    assert.equal(searchInvestigationIndex(index, 'bad\nquery').state, 'invalid');
    assert.equal(searchInvestigationIndex(index, 'a'.repeat(MAX_INVESTIGATION_SEARCH_QUERY_LENGTH + 1)).state, 'invalid');
    assert.equal(searchInvestigationIndex(index, Array.from({ length: MAX_INVESTIGATION_SEARCH_TOKENS + 1 }, (_, indexValue) => `t${indexValue}`).join(' ')).state, 'invalid');
  });

  test('caps result output and reports partial deterministic matches', () => {
    const cases = Array.from({ length: MAX_INVESTIGATION_SEARCH_RESULTS + 5 }, (_, indexValue) => (
      caseRecord(`case-${indexValue}`, `candidate-${String(indexValue).padStart(3, '0')}.invalid`)
    ));
    const response = searchInvestigationIndex(indexFor(projectionInput({
      cases: { version: CASE_SCHEMA_VERSION, cases },
    })), 'candidate');
    assert.equal(response.state, 'results');
    assert.equal(response.results.length, MAX_INVESTIGATION_SEARCH_RESULTS);
    assert.ok(response.totalMatches > response.results.length);
    assert.equal(response.truncated, true);
    assert.match(response.detail, /first 50/);
  });

  test('keeps source partialness, truncation, and limitations visible', () => {
    const index = indexFor(projectionInput({
      cases: { version: CASE_SCHEMA_VERSION, cases: [caseRecord('case-source', 'candidate.invalid')] },
    }));
    const result = searchInvestigationIndex(index, 'candidate.invalid').results.find((item) => item.entityType === 'domain');
    assert.equal(result.complete, null);
    assert.equal(result.truncated, null);
    assert.ok(result.limitations.some((value) => value.includes('source-health')));
  });

  test('preserves explicit future and malformed source states without indexing their fields', () => {
    const index = indexFor(projectionInput({
      cases: { version: CASE_SCHEMA_VERSION + 1, cases: [caseRecord('future-case', 'future.invalid')] },
      campaigns: { malformed: true },
    }));
    assert.equal(index.sources.cases.state, 'unsupported');
    assert.equal(index.sources.campaigns.state, 'invalid');
    assert.equal(searchInvestigationIndex(index, 'future.invalid').state, 'no_matches');
    assert.ok(index.limitations.some((value) => value.includes('newer than supported')));
  });

  test('rejects malformed and future projection contracts before indexing', () => {
    const malformed = buildInvestigationSearchIndex({ schema: INVESTIGATION_PROJECTION_SCHEMA, version: 1 });
    const future = buildInvestigationSearchIndex({
      schema: INVESTIGATION_PROJECTION_SCHEMA,
      version: INVESTIGATION_PROJECTION_VERSION + 1,
      entities: [],
      observations: [],
    });
    assert.equal(malformed.state, 'invalid');
    assert.equal(future.state, 'unsupported');
    assert.equal(searchInvestigationIndex(future, 'anything').state, 'invalid');
  });

  test('is deterministic across source ordering and does not mutate projection input', () => {
    const cases = [caseRecord('case-b', 'b.invalid'), caseRecord('case-a', 'a.invalid')];
    const firstProjection = buildInvestigationProjection(projectionInput({
      cases: { version: CASE_SCHEMA_VERSION, cases },
    }), { generatedAt: LATE });
    const before = structuredClone(firstProjection);
    const secondProjection = buildInvestigationProjection(projectionInput({
      cases: { version: CASE_SCHEMA_VERSION, cases: [...cases].reverse() },
    }), { generatedAt: LATE });
    assert.deepEqual(buildInvestigationSearchIndex(firstProjection), buildInvestigationSearchIndex(secondProjection));
    assert.deepEqual(firstProjection, before);
  });
});
