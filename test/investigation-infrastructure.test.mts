import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  investigationInfrastructure, investigationInfrastructureRelationships,
  type InvestigationInfrastructureOptions,
} from '../packages/investigation/investigation-infrastructure.mts';
import { buildInvestigationSearchIndex, investigationHistory, markInvestigationSearchSourcesUnavailable } from '../packages/investigation/investigation-search.mts';
import { INVESTIGATION_PROJECTION_SCHEMA, INVESTIGATION_PROJECTION_VERSION } from '../packages/investigation/investigation-projection.mts';

const EARLY = '2026-07-01T00:00:00.000Z', LATE = '2026-07-19T00:00:00.000Z';
function entity(id: string, type = 'domain', canonical = `${id}.example`, observationIds = ['early']) {
  return { id, type, canonical, label: canonical, properties: {}, observationIds, observationsTruncated: false };
}
function observation(id: string, entityIds: string[], store = 'cases', observedAt = EARLY) {
  return { id, kind: 'case_evidence', store, recordId: `incident-${id}`, source: 'fixture', observedAt,
    complete: true, truncated: false, limitations: [] as string[], entityIds };
}
function edge(id: string, from: string, to: string, sourceObservationIds = ['early']) {
  return { id, type: 'domain_resolved_to_ip', from, to, classification: 'direct', method: 'Imported exact DNS A observation',
    sourceObservationIds, sourceObservationsTruncated: false, complete: true, truncated: false, limitations: [] as string[] };
}
function fixture() {
  return { schema: INVESTIGATION_PROJECTION_SCHEMA, version: INVESTIGATION_PROJECTION_VERSION, generatedAt: LATE,
    sources: Object.fromEntries(['cases', 'campaigns', 'brandProfiles', 'relationshipRows', 'relationshipObservations']
      .map(name => [name, { state: 'supported', version: 1, records: 1, truncated: false }])),
    entities: [entity('first'), entity('second'), entity('address', 'ip_address', '192.0.2.4', ['early', 'late'])],
    observations: [observation('early', ['first', 'address']), observation('late', ['second', 'address'], 'cases', LATE)],
    relationships: [edge('first-address', 'first', 'address'), edge('second-address', 'second', 'address', ['late'])],
    truncated: false, limitations: [] as string[] };
}
function inventory(input: ReturnType<typeof fixture>, options: InvestigationInfrastructureOptions = {}) {
  return investigationInfrastructure(input, buildInvestigationSearchIndex(input), options);
}

test('retained infrastructure keeps exact shared identities and independent dated source edges', () => {
  const input = fixture(), before = structuredClone(input);
  const result = inventory(input, { type: 'ip_address' });
  assert.equal(result.total, 1);
  assert.equal(result.admittedCount, 3);
  assert.equal(result.rows[0]?.observationCount, 2);
  assert.equal(result.rows[0]?.relationshipCount, 2);
  assert.equal(result.rows[0]?.firstObservedAt, EARLY);
  assert.equal(result.rows[0]?.lastObservedAt, LATE);
  const related = investigationInfrastructureRelationships(input, 'address');
  assert.equal(related.relationshipCount, 2);
  assert.deepEqual(new Set(related.rows.map(row => row.source?.recordId)), new Set(['incident-early', 'incident-late']));
  assert.ok(related.rows.every(row => row.source?.href.startsWith('/monitor?case=')));
  assert.deepEqual(input, before);
});

test('inventory filters and searches the complete eligible set before paging', () => {
  const input = fixture();
  input.entities = Array.from({ length: 123 }, (_, index) => entity(`host-${index}`, 'domain', `target-${index}.example`));
  input.entities.unshift(...Array.from({ length: 70 }, (_, index) => entity(`case-${index}`, 'case', `incident-${index}`)));
  input.relationships = [];
  const pages = [1, 2, 3].map(page => inventory(input, { query: 'target', type: 'domain', page }));
  assert.deepEqual(pages.map(result => result.rows.length), [50, 50, 23]);
  assert.ok(pages.every(result => result.total === 123 && result.pageCount === 3));
  assert.equal(new Set(pages.flatMap(result => result.rows.map(row => row.entityId))).size, 123);
  assert.equal(inventory(input, { query: 'target', page: 999 }).page, 3);
});

test('source and date filters use independent observations rather than the preferred search source', () => {
  const input = fixture();
  input.observations.push(observation('campaign', ['address'], 'campaigns', LATE));
  const result = inventory(input, { type: 'ip_address', store: 'campaigns', observedSince: LATE });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0]?.observationCount, 3);
  assert.equal(inventory(input, { type: 'ip_address', store: 'campaigns', observedSince: '2026-07-20T00:00:00.000Z' }).total, 0);
  assert.equal(inventory(input, { store: 'relationshipObservations', observedSince: EARLY }).total, 0);
});

test('reverse membership recovers real dated sources beyond the capped entity reference list', () => {
  const input = fixture();
  input.entities = [entity('shared')]; input.relationships = [];
  input.observations = Array.from({ length: 123 }, (_, index) => observation(`source-${index}`, ['shared'], 'cases', new Date(Date.parse(EARLY) + index * 60_000).toISOString()));
  input.entities[0]!.observationIds = input.observations.slice(0, 100).map(row => row.id);
  input.entities[0]!.observationsTruncated = true;
  assert.equal(inventory(input).rows[0]?.observationCount, 123);
  const history = [1, 2, 3].flatMap(page => investigationHistory(input, 'shared', page).entries);
  assert.equal(new Set(history.map(row => row.id)).size, 123);
  // A usable explicit reverse link also permits search when forward refs fail.
  input.entities[0]!.observationIds = ['not-retained'];
  assert.equal(inventory(input, { query: 'shared.example' }).total, 1);
});

test('conflicting entity, observation and edge IDs fail closed rather than choosing array order', () => {
  const input = fixture();
  input.entities.push({ ...input.entities[0]!, canonical: '' });
  let result = inventory(input);
  assert.ok(result.rows.every(row => row.entityId !== 'first'));
  assert.equal(investigationInfrastructureRelationships(input, 'first').state, 'unavailable');
  input.observations.push({ ...input.observations[1]!, observedAt: 'invalid-time' });
  const related = investigationInfrastructureRelationships(input, 'address');
  assert.equal(related.rows.length, 1);
  assert.equal(related.rows[0]?.source, null);
  assert.equal(related.partial, true);
  input.relationships.push({ ...input.relationships[1]!, type: 'future-relationship' });
  result = inventory(input);
  assert.equal(investigationInfrastructureRelationships(input, 'address').relationshipCount, 0);
  assert.ok(result.partial);
  assert.match(result.limitations.join(' '), /ambiguous/u);
});

test('missing sources remain browsable unknowns and retained pivots never fall back to Lookup', () => {
  const input = fixture();
  input.entities.push(entity('orphan', 'certificate', 'a'.repeat(64), ['missing']));
  input.observations[0]!.store = 'relationshipRows';
  const result = inventory(input, { type: 'certificate' });
  assert.equal(result.rows[0]?.observationCount, 0);
  assert.equal(result.rows[0]?.searchable, false);
  assert.equal(result.rows[0]?.partial, true);
  const related = investigationInfrastructureRelationships(input, 'first');
  assert.equal(related.rows[0]?.source?.href, '');
  assert.equal(investigationHistory(input, 'first').entries[0]?.href, '');
});

test('one-hop edges use only explicit source references, never intersecting or nearby graph observations', () => {
  const input = fixture();
  input.observations.push(observation('nearby', ['first', 'address'], 'cases', LATE));
  input.relationships[0]!.sourceObservationIds = ['missing'];
  const related = investigationInfrastructureRelationships(input, 'first');
  assert.equal(related.total, 1);
  assert.equal(related.rows[0]?.source, null);
  assert.ok(related.rows[0]?.partial);
  assert.equal(related.rows[0]?.from.canonical, 'first.example');
});

test('relationship source pages retain all admitted sources without accumulating an expanded output', () => {
  const input = fixture();
  input.observations = Array.from({ length: 123 }, (_, index) => observation(`source-${index}`, ['first', 'address']));
  input.relationships = [edge('first-address', 'first', 'address', input.observations.map(row => row.id))];
  input.relationships[0]!.sourceObservationsTruncated = true;
  const pages = [1, 2].map(page => investigationInfrastructureRelationships(input, 'address', page));
  assert.equal(pages[0]?.total, 100);
  assert.equal(pages[0]?.relationshipCount, 1);
  assert.equal(pages[0]?.pageCount, 2);
  assert.equal(new Set(pages.flatMap(result => result.rows.map(row => row.source?.id))).size, 100);
  assert.ok(pages.every(result => result.partial));
  assert.equal(inventory(input).rows.find(row => row.entityId === 'address')?.observationCount, 123);
});

test('malformed filters, queries and unsupported envelopes cannot produce a successful inventory', () => {
  const input = fixture(), index = buildInvestigationSearchIndex(input);
  assert.equal(inventory(input, { observedSince: '2026-07-19' }).state, 'invalid');
  assert.equal(inventory(input, { query: '\u0000' }).state, 'invalid');
  assert.equal(inventory(input, { type: 'network' as never }).state, 'invalid');
  assert.equal(inventory(input, { store: 'future-store' as never }).state, 'invalid');
  assert.equal(investigationInfrastructure({ ...input, version: 99 }, index).state, 'unavailable');
  assert.equal(investigationInfrastructureRelationships(input, ' address ').state, 'unavailable');
});

test('relationship/source row identities cannot collide through separators or an unavailable placeholder', () => {
  const input = fixture();
  input.observations = [observation('b:c', ['first', 'address']), observation('c', ['first', 'address']), observation('unavailable', ['first', 'address'])];
  input.relationships = [edge('a', 'first', 'address', ['b:c']), edge('a:b', 'first', 'address', ['c']),
    edge('with-missing', 'first', 'address', ['unavailable', 'missing'])];
  const result = investigationInfrastructureRelationships(input, 'address');
  assert.equal(result.rows.length, 4);
  assert.equal(new Set(result.rows.map(row => row.id)).size, 4);
  assert.equal(result.rows.filter(row => !row.source).length, 1);
});

test('partial and unavailable coverage remain separate from pagination and provider claims', () => {
  const input = fixture();
  input.observations[0]!.complete = false;
  const index = markInvestigationSearchSourcesUnavailable(buildInvestigationSearchIndex(input), ['campaigns']);
  const result = investigationInfrastructure(input, index);
  assert.equal(result.pageCount, 1);
  assert.equal(result.partial, true);
  assert.equal(result.rows.find(row => row.entityId === 'first')?.partial, true);
  assert.match(result.limitations.join(' '), /routing ASN.*not available/u);
  assert.match(result.limitations.join(' '), /wildcard patterns.*not retained/u);
  assert.match(result.limitations.join(' '), /Case domain.*queried owner/u);
  assert.doesNotMatch(JSON.stringify(result.rows), /currentOrigin|providerRole|routingAsn/u);
});
