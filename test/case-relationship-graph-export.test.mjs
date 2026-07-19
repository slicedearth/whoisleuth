import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildRelationshipGraphDocument,
  buildRelationshipGraphExport,
  MAX_RELATIONSHIP_GRAPH_EXPORT_BYTES,
  MAX_RELATIONSHIP_GRAPH_EXPORT_OBSERVATIONS_PER_RELATIONSHIP,
  RELATIONSHIP_GRAPH_EXPORT_SCHEMA,
  RELATIONSHIP_GRAPH_EXPORT_VERSION,
} from '../frontend/src/lib/analysis/case-relationship-graph-export.js';
import {
  CASE_RELATIONSHIP_GRAPH_VERSION,
  MAX_RELATIONSHIP_GRAPH_CASES,
  MAX_RELATIONSHIP_GRAPH_EDGES,
  MAX_RELATIONSHIP_GRAPH_RELATIONSHIPS,
} from '../frontend/src/lib/analysis/case-relationship-graph.js';
import { MISP_INDICATOR_EXPORT_VERSION } from '../frontend/src/lib/analysis/misp-indicator-export.js';
import { STIX_INDICATOR_EXPORT_VERSION } from '../frontend/src/lib/analysis/stix-indicator-export.js';

const NOW = '2026-07-19T00:00:00.000Z';

function summary(overrides = {}) {
  const observations = Array.from({ length: 10 }, (_, index) => ({
    id: `observation-${index}`,
    source: index % 2 ? 'lookup' : 'monitor',
    store: 'cases',
    observedAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    firstObservedAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    scanDepth: 'deep',
    status: 'success',
    complete: true,
    truncated: false,
    schemaVersions: { caseVersion: 2, ignored: 999 },
    limitations: [],
  }));
  return {
    version: 2,
    projectionVersion: 1,
    state: 'ready',
    generatedAt: NOW,
    groups: [{
      type: 'nameserver_set',
      label: 'Shared nameserver set',
      method: 'Exact retained normalized set',
      value: 'ns.shared.invalid',
      cases: [{ id: 'case-a', domain: 'a.invalid' }, { id: 'case-b', domain: 'b.invalid' }],
      campaigns: [],
      description: 'Retained evidence-backed pivot.',
      sources: ['lookup', 'monitor'],
      scanDepths: ['deep'],
      classifications: ['normalized'],
      firstObservedAt: '2026-07-01T00:00:00.000Z',
      lastObservedAt: '2026-07-10T00:00:00.000Z',
      complete: true,
      truncated: false,
      observations,
      omittedObservations: 2,
      limitations: ['Shared infrastructure does not establish ownership.'],
    }],
    sources: ['lookup', 'monitor'],
    scopeOptions: [],
    filterOptionsTruncated: false,
    truncated: false,
    limitations: ['Local relationship evidence is bounded.'],
    ...overrides,
  };
}

describe('relationship graph interchange export', () => {
  test('builds one versioned canonical graph with deterministic portable ids and provenance', () => {
    const document = buildRelationshipGraphDocument(summary(), { generatedAt: NOW, source: 'monitor' });
    assert.equal(document.schema, RELATIONSHIP_GRAPH_EXPORT_SCHEMA);
    assert.equal(document.version, RELATIONSHIP_GRAPH_EXPORT_VERSION);
    assert.equal(document.generatedAt, NOW);
    assert.equal(document.source.projectionVersion, 1);
    assert.equal(document.source.relationshipVersion, 2);
    assert.equal(document.source.graphVersion, CASE_RELATIONSHIP_GRAPH_VERSION);
    assert.equal(document.source.filters.source, 'monitor');
    assert.equal(document.graph.directed, false);
    assert.equal(document.graph.nodes.length, 3);
    assert.equal(document.graph.edges.length, 2);
    assert.ok(document.graph.nodes.every((node) => /^(case|relationship)-[0-9a-f]{16}$/.test(node.id)));
    assert.ok(document.graph.edges.every((edge) => /^edge-[0-9a-f]{16}$/.test(edge.id)));

    const relationship = document.graph.nodes.find((node) => node.kind === 'relationship');
    assert.equal(relationship.method, 'Exact retained normalized set');
    assert.deepEqual(relationship.certaintyClasses, ['normalized']);
    assert.deepEqual(relationship.sources, ['lookup', 'monitor']);
    assert.equal(relationship.firstObservedAt, '2026-07-01T00:00:00.000Z');
    assert.equal(relationship.lastObservedAt, '2026-07-10T00:00:00.000Z');
    assert.equal(relationship.complete, true);
    assert.equal(relationship.truncated, true);
    assert.equal(relationship.observationCount, 12);
    assert.equal(relationship.exportedObservationCount, MAX_RELATIONSHIP_GRAPH_EXPORT_OBSERVATIONS_PER_RELATIONSHIP);
    assert.equal(relationship.omittedObservationCount, 4);
    assert.deepEqual(relationship.observations[0].schemaVersions, { caseVersion: 2 });
    assert.equal(document.graph.truncated, true);
    assert.match(document.limitations.at(-1), /Transient focus, pin, hide/);
  });

  test('is deterministic for equivalent case order and excludes transient view state', () => {
    const original = summary();
    const reordered = structuredClone(original);
    reordered.groups[0].cases.reverse();
    const first = buildRelationshipGraphDocument(original, {
      generatedAt: NOW,
      hiddenIds: ['case:case-a'],
      pinnedIds: ['case:case-b'],
      groupCaseIds: ['case:case-a', 'case:case-b'],
      oneHop: true,
      focusId: 'case:case-a',
    });
    const second = buildRelationshipGraphDocument(reordered, { generatedAt: NOW });
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(first).includes('hiddenIds'), false);
    assert.equal(JSON.stringify(first).includes('pinnedIds'), false);
    assert.equal(JSON.stringify(first).includes('groupCaseIds'), false);
  });

  test('serializes JSON, GraphML, and GEXF from the same node and edge ids', () => {
    const options = { generatedAt: NOW };
    const json = buildRelationshipGraphExport(summary(), { ...options, format: 'json' });
    const graphml = buildRelationshipGraphExport(summary(), { ...options, format: 'graphml' });
    const gexf = buildRelationshipGraphExport(summary(), { ...options, format: 'gexf' });
    const document = JSON.parse(json.content);

    assert.equal(json.filename, 'whoisleuth-relationship-graph-2026-07-19.json');
    assert.equal(graphml.filename, 'whoisleuth-relationship-graph-2026-07-19.graphml');
    assert.equal(gexf.filename, 'whoisleuth-relationship-graph-2026-07-19.gexf');
    assert.equal(json.mimeType, 'application/json;charset=utf-8');
    assert.equal(graphml.mimeType, 'application/graphml+xml;charset=utf-8');
    assert.equal(gexf.mimeType, 'application/gexf+xml;charset=utf-8');
    assert.match(graphml.content, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<graphml /);
    assert.match(graphml.content, /edgedefault="undirected"/);
    assert.match(gexf.content, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<gexf /);
    assert.match(gexf.content, /defaultedgetype="undirected"/);
    for (const item of [...document.graph.nodes, ...document.graph.edges]) {
      assert.match(graphml.content, new RegExp(`id="${item.id}"`));
      assert.match(gexf.content, new RegExp(`id="${item.id}"`));
    }
    for (const output of [json, graphml, gexf]) {
      assert.ok(output.bytes > 0);
      assert.ok(output.bytes <= MAX_RELATIONSHIP_GRAPH_EXPORT_BYTES);
      assert.equal(output.nodeCount, 3);
      assert.equal(output.edgeCount, 2);
    }
  });

  test('inherits graph caps, discloses truncation, and excludes unrelated raw or analyst fields', () => {
    const fixture = summary();
    fixture.groups = Array.from({ length: MAX_RELATIONSHIP_GRAPH_RELATIONSHIPS + 1 }, (_, index) => ({
      ...structuredClone(fixture.groups[0]),
      value: `ns-${index}.bounded.invalid`,
      cases: [
        { id: `case-a-${index}`, domain: `a-${index}.invalid`, notes: ['analyst-note-marker'] },
        { id: `case-b-${index}`, domain: `b-${index}.invalid`, notes: ['analyst-note-marker'] },
      ],
      rawWhois: 'raw-upstream-marker',
      registrarContact: 'contact-marker',
    }));
    fixture.groups[0].observations[0].authorization = 'credential-marker';
    const output = buildRelationshipGraphExport(fixture, { generatedAt: NOW });
    const document = JSON.parse(output.content);
    const relationshipNodes = document.graph.nodes.filter((node) => node.kind === 'relationship');
    const caseNodes = document.graph.nodes.filter((node) => node.kind === 'case');
    assert.equal(relationshipNodes.length, MAX_RELATIONSHIP_GRAPH_RELATIONSHIPS);
    assert.equal(caseNodes.length, MAX_RELATIONSHIP_GRAPH_CASES);
    assert.ok(document.graph.edges.length <= MAX_RELATIONSHIP_GRAPH_EDGES);
    assert.equal(document.graph.truncated, true);
    assert.ok(output.bytes <= MAX_RELATIONSHIP_GRAPH_EXPORT_BYTES);
    assert.doesNotMatch(output.content, /raw-upstream-marker|contact-marker|credential-marker|analyst-note-marker/);
  });

  test('escapes XML metadata and replaces XML-invalid characters', () => {
    const fixture = summary();
    fixture.groups[0].method = 'Exact & reviewed <method> "quoted" \ud800';
    fixture.groups[0].limitations = ['Treat <shared> & "quoted" values cautiously.'];
    fixture.groups[0].observations[0].limitations = ['Invalid surrogate \ud800 replaced.'];
    const graphml = buildRelationshipGraphExport(fixture, { generatedAt: NOW, format: 'graphml' }).content;
    const gexf = buildRelationshipGraphExport(fixture, { generatedAt: NOW, format: 'gexf' }).content;
    for (const content of [graphml, gexf]) {
      assert.match(content, /Exact &amp; reviewed &lt;method&gt;/);
      assert.match(content, /&quot;quoted&quot;/);
      assert.doesNotMatch(content, /<method>/);
      assert.doesNotMatch(content, /\ud800/);
      assert.match(content, /&quot;quoted&quot; �/);
    }
  });

  test('returns an explicit empty document for invalid input without mutating it', () => {
    const input = { malformed: true };
    const before = structuredClone(input);
    const output = buildRelationshipGraphExport(input, { generatedAt: NOW });
    const document = JSON.parse(output.content);
    assert.equal(document.source.state, 'legacy');
    assert.deepEqual(document.graph.nodes, []);
    assert.deepEqual(document.graph.edges, []);
    assert.deepEqual(input, before);
  });

  test('rejects unknown formats and keeps STIX and MISP indicator contracts separate', () => {
    assert.throws(
      () => buildRelationshipGraphExport(summary(), { generatedAt: NOW, format: 'stix' }),
      /must be JSON, GraphML, or GEXF/i,
    );
    assert.throws(
      () => buildRelationshipGraphExport(summary(), { generatedAt: NOW, format: 'json\n' }),
      /must be JSON, GraphML, or GEXF/i,
    );
    assert.throws(
      () => buildRelationshipGraphExport(summary(), { generatedAt: NOW, format: 1 }),
      /must be JSON, GraphML, or GEXF/i,
    );
    assert.equal(STIX_INDICATOR_EXPORT_VERSION, 1);
    assert.equal(MISP_INDICATOR_EXPORT_VERSION, 1);
    assert.doesNotMatch(buildRelationshipGraphExport(summary(), { generatedAt: NOW }).content, /application\/stix|MISP event/);
  });
});
