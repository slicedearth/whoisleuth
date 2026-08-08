import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildInvestigationSearchIndex,
  INVESTIGATION_SEARCH_SCHEMA,
  INVESTIGATION_SEARCH_VERSION,
  MAX_INVESTIGATION_SEARCH_QUERY_LENGTH,
  MAX_RECENT_INVESTIGATION_RESULTS,
  MAX_INVESTIGATION_SEARCH_RESULTS,
  MAX_INVESTIGATION_SEARCH_TOKENS,
  markInvestigationSearchSourcesUnavailable,
  recentInvestigationResults,
  searchInvestigationIndex,
  unavailableInvestigationSearchIndex,
} from '../frontend/src/lib/analysis/investigation-search.ts';
import {
  buildInvestigationProjection,
  INVESTIGATION_PROJECTION_SCHEMA,
  INVESTIGATION_PROJECTION_VERSION,
} from '../frontend/src/lib/analysis/investigation-projection.ts';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model.ts';
import { BRAND_PROFILE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import { CAMPAIGN_SCHEMA_VERSION } from '../frontend/src/lib/analysis/campaign-model.ts';
import { RELATIONSHIP_EVIDENCE_VERSION } from '../frontend/src/lib/analysis/relationship-evidence.ts';
import {
  RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
  createRelationshipObservation,
} from '../frontend/src/lib/analysis/relationship-observation-model.ts';

const EARLY = '2026-07-01T00:00:00.000Z';
const LATE = '2026-07-19T00:00:00.000Z';
const SHA = 'a'.repeat(64);

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    capturedAt: LATE,
    scanDepth: 'deep',
    source: 'lookup',
    availability: 'registered',
    nameservers: [],
    ...overrides,
  };
}

function caseRecord(id: string, domain: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

function projectionInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cases: { version: CASE_SCHEMA_VERSION, cases: [] },
    campaigns: { version: CAMPAIGN_SCHEMA_VERSION, campaigns: [] },
    brandProfiles: { version: BRAND_PROFILE_SCHEMA_VERSION, profiles: [] },
    relationshipRows: [],
    ...overrides,
  };
}

function indexFor(input: unknown) {
  return buildInvestigationSearchIndex(buildInvestigationProjection(input, { generatedAt: LATE }));
}

describe('local investigation search index', () => {
  test('represents an unavailable browser-local search as an explicit bounded state', () => {
    const index = unavailableInvestigationSearchIndex(`  ${'Search failed. '.repeat(40)}  `);
    assert.equal(index.state, 'invalid');
    assert.equal(index.generatedAt, null);
    assert.equal(index.projectionVersion, null);
    assert.deepEqual(index.entries, []);
    assert.equal(index.limitations.length, 1);
    assert.ok(requiredValue(index.limitations[0]).length <= 300);
    assert.match(requiredValue(index.limitations[0]), /^Search failed\./);
  });

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

  test('keeps fulfilled search results while marking a rejected source unavailable', () => {
    const index = markInvestigationSearchSourcesUnavailable(indexFor(projectionInput({
      cases: { version: CASE_SCHEMA_VERSION, cases: [caseRecord('case-available', 'available.invalid')] },
    })), ['campaigns']);
    assert.equal(index.state, 'ready');
    assert.equal(index.sources.campaigns.state, 'unavailable');
    assert.equal(searchInvestigationIndex(index, 'available.invalid').state, 'results');
    assert.equal(searchInvestigationIndex(index, 'not-retained.invalid').state, 'no_matches');
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
    assert.equal(requiredValue(response.results[0]).canonical, 'portal.invalid');
    assert.equal(requiredValue(response.results[0]).matchedField, 'canonical');
    assert.equal(requiredValue(response.results[0]).score, 0);
  });

  test('projects a bounded recent-work list without requiring a search query', () => {
    const index = indexFor(projectionInput({
      cases: { version: CASE_SCHEMA_VERSION, cases: [
        caseRecord('case-early', 'early.invalid', {
          updatedAt: EARLY,
          evidenceHistory: [snapshot({ capturedAt: EARLY })],
        }),
        caseRecord('case-late', 'late.invalid'),
        ...Array.from({ length: 5 }, (_, position) => caseRecord(
          `case-extra-${position}`,
          `extra-${position}.invalid`,
          { updatedAt: new Date(Date.parse(EARLY) + position * 1_000).toISOString() },
        )),
      ] },
    }));
    const recent = recentInvestigationResults(index);
    assert.equal(recent.length, MAX_RECENT_INVESTIGATION_RESULTS);
    assert.equal(recent[0]?.observedAt, LATE);
    assert.ok(recent.every((result) => result.matchedField === 'canonical' && result.matchedValue === result.canonical));
    assert.deepEqual(
      recent.map((result) => result.observedAt),
      [...recent].map((result) => result.observedAt).sort((left, right) => right.localeCompare(left)),
    );
    assert.deepEqual(recentInvestigationResults(unavailableInvestigationSearchIndex('Unavailable.')), []);
  });

  test('searches case domains and pivots to the exact source case without network work', () => {
    const index = indexFor(projectionInput({
      cases: { version: CASE_SCHEMA_VERSION, cases: [caseRecord('case-source', 'candidate.invalid')] },
    }));
    const response = searchInvestigationIndex(index, 'candidate.invalid');
    const caseResult = response.results.find((result) => result.entityType === 'case');
    const domainResult = response.results.find((result) => result.entityType === 'domain');
    assert.ok(caseResult);
    assert.ok(domainResult);
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
    assert.ok(brand);
    assert.ok(campaign);
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
    assert.equal(requiredValue(searchInvestigationIndex(index, 'ns1.shared.invalid').results[0]).matchedField, 'canonical');
    assert.equal(requiredValue(searchInvestigationIndex(index, 'landing.invalid').results[0]).entityType, 'http_origin');
    assert.equal(requiredValue(searchInvestigationIndex(index, SHA).results[0]).entityType, 'favicon');
    const certificate = requiredValue(searchInvestigationIndex(index, 'b'.repeat(64)).results[0]);
    assert.equal(certificate.entityType, 'certificate');
    assert.equal(certificate.href, '/lookup?q=scan.invalid');
  });

  test('searches analyst-retained relationship values and opens the exact Monitor record', () => {
    const retained = createRelationshipObservation({
      type: 'tracking_identifier',
      label: 'Shared tracking identifier',
      method: 'Exact public identifier',
      normalizedValue: 'tag-container:GTM-RETAINED',
      value: 'tag-container:GTM-RETAINED',
      domains: ['first.invalid', 'second.invalid'],
      description: 'Bounded retained pivot.',
    }, {
      observedAt: LATE,
      retainedAt: LATE,
      complete: true,
      sourceVersion: RELATIONSHIP_EVIDENCE_VERSION,
    });
    const index = indexFor(projectionInput({
      cases: { version: CASE_SCHEMA_VERSION, cases: [caseRecord('case-retained-domain', 'first.invalid', {
        evidenceHistory: [snapshot({ capturedAt: EARLY })],
      })] },
      relationshipObservations: {
        version: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
        observations: [retained],
      },
    }));
    const result = requiredValue(searchInvestigationIndex(index, 'GTM-RETAINED').results[0]);

    assert.equal(result.entityType, 'tracking_identifier');
    assert.equal(result.sourceStore, 'relationshipObservations');
    assert.equal(result.href, `/monitor?view=relationships&observation=${retained.id}`);
    assert.equal(result.action, 'Open retained observation');
    assert.equal(result.classification, 'derived');
    const domain = searchInvestigationIndex(index, 'first.invalid').results.find((item) => item.entityType === 'domain');
    assert.ok(domain);
    assert.equal(domain.href, '/monitor?case=case-retained-domain');
    assert.equal(domain.action, 'Open source case');
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
    assert.equal(requiredValue(searchInvestigationIndex(index, 'reserved review').results[0]).entityType, 'campaign');
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
    assert.ok(result);
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
