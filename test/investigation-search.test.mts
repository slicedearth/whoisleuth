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
  MAX_INVESTIGATION_SEARCH_TERM_BYTES,
  MAX_INVESTIGATION_SEARCH_ENTITIES,
  MAX_INVESTIGATION_SEARCH_TERMS_PER_ENTITY,
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
    inputHostname: null,
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

function indexedProjection(count: number, nameservers = 0, longTerms = false) {
  return {
    schema: INVESTIGATION_PROJECTION_SCHEMA, version: INVESTIGATION_PROJECTION_VERSION, generatedAt: LATE,
    sources: Object.fromEntries(['cases', 'campaigns', 'brandProfiles', 'relationshipRows', 'relationshipObservations']
      .map((source) => [source, { state: 'supported', version: 1, records: source === 'relationshipRows' ? 1 : 0, truncated: false }])),
    entities: Array.from({ length: count }, (_, position) => ({
      id: `entry-${position}`, type: 'domain', canonical: `item-${position}.example`, label: `item-${position}.example`,
      properties: { domain: `item-${position}.example`, nameservers: Array.from({ length: nameservers }, (_, item) =>
        `ns${item}.item-${position}.${longTerms ? `${'long'.repeat(55)}.` : ''}example`) },
      observationIds: ['source-observation'], observationsTruncated: false,
    })),
    observations: [{ id: 'source-observation', kind: 'scan_relationship_evidence', store: 'relationshipRows', recordId: 'source.example',
      source: 'retained_scan', observedAt: LATE, complete: true, truncated: false, limitations: [] as string[] }],
    relationships: [], truncated: false, limitations: [] as string[],
  };
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
          inputHostname: 'candidate.invalid',
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

  test('searches canonical infrastructure retained only through imported Case observations', () => {
    const certificateFingerprint = 'c'.repeat(64);
    const importedSource = 'Provider report: Reviewed observations';
    const index = indexFor(projectionInput({
      cases: { version: CASE_SCHEMA_VERSION, cases: [caseRecord('case-imported', 'observed.invalid', {
        evidencePins: [
          {
            id: 'pin-ip',
            field: 'A',
            category: 'dns',
            label: 'External DNS finding',
            value: '192.0.2.44',
            source: importedSource,
            sourceSchema: {
              collection: 'external_observations',
              schema: 'whoisleuth.dns-observation-rows',
              version: 1,
            },
            observedAt: EARLY,
            completeness: 'complete',
            limitations: ['Imported and not independently verified.'],
            createdAt: LATE,
          },
          {
            id: 'pin-certificate',
            field: 'fingerprintSha256',
            category: 'certificate',
            label: 'External certificate finding',
            value: certificateFingerprint,
            source: importedSource,
            sourceSchema: {
              collection: 'external_observations',
              schema: 'whoisleuth.certificate-observation-rows',
              version: 1,
            },
            observedAt: LATE,
            completeness: 'partial',
            limitations: [],
            createdAt: LATE,
          },
        ],
      })] },
    }));

    const ip = requiredValue(searchInvestigationIndex(index, '192.0.2.44').results[0]);
    const certificate = requiredValue(searchInvestigationIndex(index, certificateFingerprint).results[0]);
    assert.equal(ip.entityType, 'ip_address');
    assert.equal(ip.source, importedSource);
    assert.equal(ip.sourceStore, 'cases');
    assert.equal(ip.observedAt, EARLY);
    assert.equal(ip.complete, true);
    assert.equal(ip.href, '/monitor?case=case-imported');
    assert.equal(certificate.entityType, 'certificate');
    assert.equal(certificate.source, importedSource);
    assert.equal(certificate.observedAt, LATE);
    assert.equal(certificate.complete, false);
    assert.equal(certificate.href, '/monitor?case=case-imported');
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
    assert.match(response.detail, /matches 1–50/);
  });

  test('pages through every indexed result with exact ordering, bounded pages and safe invalid-page defaults', () => {
    const index = buildInvestigationSearchIndex(indexedProjection(123));
    const all = [1, 2, 3].flatMap((page) => searchInvestigationIndex(index, 'item-', { page }).results);
    assert.equal(all.length, 123);
    assert.equal(new Set(all.map((item) => item.entityId)).size, 123);
    assert.match(searchInvestigationIndex(index, 'item-', { page: 3 }).detail, /101–123 of 123/u);
    assert.deepEqual(searchInvestigationIndex(index, 'item-', { page: 999 }).results, all.slice(100));
    for (const page of [0, -1, Number.NaN, 1.5]) {
      assert.deepEqual(searchInvestigationIndex(index, 'item-', { page }).results, all.slice(0, 50));
    }
    assert.equal(searchInvestigationIndex(index, 'item-', { pageSize: 1000 }).results.length, 50);
    assert.equal(searchInvestigationIndex(index, 'item-', { pageSize: 3, page: 2 }).results[0]!.entityId, all[3]!.entityId);
  });

  test('indexes the full admitted rich projection without a second independent term-count ceiling', () => {
    const index = buildInvestigationSearchIndex(indexedProjection(MAX_INVESTIGATION_SEARCH_ENTITIES, 20));
    assert.equal(index.entityCount, 6000);
    assert.equal(index.termCount, 126000);
    assert.equal(index.truncated, false);
    assert.equal(searchInvestigationIndex(index, 'ns19.item-5999.example').results[0]?.entityId, 'entry-5999');
    assert.equal(markInvestigationSearchSourcesUnavailable(index, []), index);
    const marked = markInvestigationSearchSourcesUnavailable(index, ['campaigns']);
    assert.equal(marked.entries, index.entries);
    assert.equal(marked.truncated, true);
    assert.match(searchInvestigationIndex(marked, 'unmatched').detail, /coverage is partial/u);
  });

  test('exact matching retains Unicode-expanded terms and does not introduce fuzzy results', () => {
    const projection = indexedProjection(1);
    const entity = requiredValue(projection.entities[0]);
    entity.label = '\uFDFA'.repeat(30);
    const index = buildInvestigationSearchIndex(projection);
    assert.equal(searchInvestigationIndex(index, '\uFDFA'.repeat(30)).results[0]?.entityId, entity.id);
    assert.equal(searchInvestigationIndex(index, 'itm-0').totalMatches, 0);
    assert.equal(searchInvestigationIndex(index, 'bad\nquery').state, 'invalid');
  });

  test('retains every canonical identity before optional fields consume the UTF-8 term budget', () => {
    const index = buildInvestigationSearchIndex(indexedProjection(2000, 20, true));
    assert.equal(index.entityCount, 2000);
    const bytes = index.entries.reduce((total, entry) => total + entry.terms.reduce((sum, term) => sum + Buffer.byteLength(term.normalized), 0), 0);
    assert.ok(bytes <= MAX_INVESTIGATION_SEARCH_TERM_BYTES);
    assert.ok(bytes > MAX_INVESTIGATION_SEARCH_TERM_BYTES - 300);
    assert.equal(index.truncated, true);
    assert.equal(searchInvestigationIndex(index, 'item-1999.example').results[0]?.entityId, 'entry-1999');
    assert.ok(index.limitations.some((value) => /Search omissions: [1-9][0-9]* eligible terms/u.test(value)));
  });

  test('per-item omissions and mandatory coverage notes survive full optional limitation arrays', () => {
    const projection = indexedProjection(1, 80);
    projection.limitations = Array.from({ length: 20 }, (_, index) => `Optional projection note ${index}.`);
    projection.observations[0]!.limitations = Array.from({ length: 20 }, (_, index) => `Optional source note ${index}.`);
    const index = buildInvestigationSearchIndex(projection);
    assert.equal(index.entries[0]!.terms.length, MAX_INVESTIGATION_SEARCH_TERMS_PER_ENTITY);
    assert.equal(index.entries[0]!.termsTruncated, true);
    assert.equal(index.truncated, true);
    assert.match(index.limitations[0]!, /coverage is partial/u);
    assert.ok(index.limitations.some((value) => value.includes('16 uninspected nameserver values')));
    assert.ok(index.entries[0]!.limitations.some((value) => value.includes('Search retained 32 of 65')));
    assert.ok(index.entries[0]!.limitations.some((value) => value.includes('16 additional nameserver values')));
  });

  test('does not choose arbitrary duplicate identities or invent observation clocks', () => {
    const duplicated = indexedProjection(1);
    duplicated.observations.push({ ...duplicated.observations[0]!, source: 'other_retained_source' });
    const ambiguous = buildInvestigationSearchIndex(duplicated);
    assert.equal(ambiguous.entityCount, 0);
    assert.equal(ambiguous.truncated, true);
    assert.ok(ambiguous.limitations.some((value) => value.includes('2 duplicate-identity rows')));
    const undated = indexedProjection(1);
    undated.observations[0]!.observedAt = '2026-09-01T00:00:00';
    const missingTime = buildInvestigationSearchIndex(undated);
    assert.equal(missingTime.entityCount, 0);
    assert.equal(missingTime.truncated, true);
    assert.ok(missingTime.limitations.some((value) => value.includes('1 malformed or undated rows')));
  });

  test('rejects duplicate identities even when a conflicting row is malformed and does not repair source identifiers', () => {
    const projection = indexedProjection(1);
    projection.observations.push({ ...projection.observations[0]!, observedAt: 'not-a-time' });
    const duplicate = buildInvestigationSearchIndex(projection);
    assert.equal(duplicate.entityCount, 0);
    assert.match(duplicate.limitations.join(' '), /2 duplicate-identity rows/u);
    const altered = indexedProjection(1);
    altered.observations[0]!.recordId = ' source.example ';
    assert.equal(buildInvestigationSearchIndex(altered).entityCount, 0);
    const references = indexedProjection(1);
    references.entities[0]!.observationIds = ['source-observation', ' source-observation ', ...Array.from({ length: 100 }, (_, index) => `missing-${index}`)];
    const limited = buildInvestigationSearchIndex(references);
    assert.equal(limited.entityCount, 1);
    assert.equal(limited.truncated, true);
    assert.match(limited.limitations.join(' '), /1 entities with capped or invalid source references/u);
    assert.equal(limited.entries[0]!.observedAt, '2026-07-19T00:00:00.000Z');
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
