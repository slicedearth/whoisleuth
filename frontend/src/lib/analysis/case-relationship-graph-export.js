// Pure, bounded interchange for the local relationship graph. All formats are
// serialized from one canonical document so provenance and limitations cannot
// drift between JSON and XML representations.

import { CASE_RELATIONSHIP_GRAPH_VERSION, projectCaseRelationshipGraph } from './case-relationship-graph.js';

export const RELATIONSHIP_GRAPH_EXPORT_SCHEMA = 'whoisleuth.relationship-graph';
export const RELATIONSHIP_GRAPH_EXPORT_VERSION = 1;
export const MAX_RELATIONSHIP_GRAPH_EXPORT_BYTES = 512 * 1024;
export const MAX_RELATIONSHIP_GRAPH_EXPORT_OBSERVATIONS_PER_RELATIONSHIP = 8;
export const MAX_RELATIONSHIP_GRAPH_EXPORT_LIMITATIONS = 12;

const CONTROL_RE = /[\x00-\x1f\x7f]/;
const FORMATS = new Set(['json', 'graphml', 'gexf']);
const FILTER_KEYS = ['type', 'source', 'period', 'completeness', 'scope'];

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value, maximum = 300) {
  if (typeof value !== 'string' || value.length > maximum * 8 || CONTROL_RE.test(value)) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maximum).trim();
}

function timestamp(value) {
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function version(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 1000 ? value : null;
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function integer(value, maximum = 1_000_000) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, maximum) : 0;
}

function strings(values, maximumItems = 20, maximumLength = 300) {
  const output = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values.slice(0, maximumItems * 4) : []) {
    const normalized = text(value, maximumLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= maximumItems) break;
  }
  return output;
}

function schemaVersions(value) {
  return Object.fromEntries(Object.entries(record(value))
    .filter(([key, item]) => /^[a-z][a-zA-Z0-9]{0,39}Version$/.test(key) && version(item) !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 20)
    .map(([key, item]) => [key, version(item)]));
}

function filters(options) {
  return Object.fromEntries(FILTER_KEYS.flatMap((key) => {
    const value = text(record(options)[key], 100);
    return value ? [[key, value]] : [];
  }));
}

function isoNow(value) {
  return timestamp(value) || new Date().toISOString();
}

// FNV-1a 64-bit produces stable XML-safe identifiers without exposing internal
// browser-store identifiers. Collision checks still fail closed below.
function digest(value) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function stableId(kind, semanticValue, seen) {
  const id = `${kind}-${digest(`${kind}\u0000${semanticValue}`)}`;
  const previous = seen.get(id);
  if (previous && previous !== semanticValue) {
    throw new Error('The relationship graph export produced a deterministic identifier collision.');
  }
  seen.set(id, semanticValue);
  return id;
}

function observation(value) {
  const item = record(value);
  return {
    id: text(item.id, 100),
    source: text(item.source, 40) || 'unknown',
    store: text(item.store, 40) || 'unknown',
    observedAt: timestamp(item.observedAt),
    firstObservedAt: timestamp(item.firstObservedAt),
    scanDepth: text(item.scanDepth, 20) || 'unknown',
    status: text(item.status, 20) || 'partial',
    complete: booleanOrNull(item.complete),
    truncated: booleanOrNull(item.truncated),
    schemaVersions: schemaVersions(item.schemaVersions),
    limitations: strings(item.limitations, 8, 300),
  };
}

function relationshipMetadata(node) {
  const retained = Array.isArray(node.observations)
    ? node.observations.slice(0, MAX_RELATIONSHIP_GRAPH_EXPORT_OBSERVATIONS_PER_RELATIONSHIP).map(observation)
    : [];
  const totalObservationCount = integer(node.observations?.length) + integer(node.omittedObservations);
  const omittedObservationCount = Math.max(0, totalObservationCount - retained.length);
  return {
    relationshipType: text(node.type, 40),
    value: text(node.value, 300),
    description: text(node.description, 300),
    method: text(node.method, 400),
    certaintyClasses: strings(node.classifications, 8, 40),
    sources: strings(node.sources, 20, 40),
    scanDepths: strings(node.scanDepths, 8, 20),
    firstObservedAt: timestamp(node.firstObservedAt),
    lastObservedAt: timestamp(node.lastObservedAt),
    complete: booleanOrNull(node.complete),
    truncated: node.truncated === true || omittedObservationCount > 0,
    observationCount: totalObservationCount,
    exportedObservationCount: retained.length,
    omittedObservationCount,
    observations: retained,
    limitations: strings(node.limitations, MAX_RELATIONSHIP_GRAPH_EXPORT_LIMITATIONS, 300),
  };
}

function outputFilters(graph) {
  return Object.fromEntries(FILTER_KEYS.map((key) => [key, text(graph.filters?.[key], 100) || 'all']));
}

/**
 * Builds the one canonical document used by all relationship graph exports.
 * Transient focus, pin, hide, and comparison-group options are deliberately
 * ignored; only the normalized evidence filters select export content.
 */
export function buildRelationshipGraphDocument(summary, options = {}) {
  const generatedAt = isoNow(record(options).generatedAt);
  const graph = projectCaseRelationshipGraph(summary, filters(options));
  const seenIds = new Map();
  const sourceToExportId = new Map();
  const nodes = [];

  for (const node of graph.caseNodes) {
    const canonical = text(node.label, 253);
    if (!canonical) continue;
    const id = stableId('case', canonical, seenIds);
    sourceToExportId.set(node.id, id);
    nodes.push({ id, kind: 'case', label: canonical, canonical });
  }

  for (const node of graph.relationshipNodes) {
    const metadata = relationshipMetadata(node);
    if (!metadata.relationshipType || !metadata.value) continue;
    const semantic = `${metadata.relationshipType}\u0000${metadata.value}`;
    const id = stableId('relationship', semantic, seenIds);
    sourceToExportId.set(node.id, id);
    nodes.push({
      id,
      kind: 'relationship',
      label: text(node.label, 100) || metadata.relationshipType,
      canonical: metadata.value,
      ...metadata,
    });
  }

  const relationshipBySourceId = new Map(graph.relationshipNodes.map((node) => [node.id, node]));
  const edges = [];
  for (const edge of graph.edges) {
    const source = sourceToExportId.get(edge.caseId);
    const target = sourceToExportId.get(edge.relationshipId);
    const relationship = relationshipBySourceId.get(edge.relationshipId);
    if (!source || !target || !relationship) continue;
    const metadata = relationshipMetadata(relationship);
    const id = stableId('edge', `${source}\u0000${target}`, seenIds);
    edges.push({
      id,
      source,
      target,
      kind: 'case_has_relationship',
      method: metadata.method,
      certaintyClasses: metadata.certaintyClasses,
      sources: metadata.sources,
      firstObservedAt: metadata.firstObservedAt,
      lastObservedAt: metadata.lastObservedAt,
      complete: metadata.complete,
      truncated: metadata.truncated,
      limitations: metadata.limitations,
    });
  }
  edges.sort((left, right) => left.source.localeCompare(right.source) || left.target.localeCompare(right.target));

  const observationTruncated = nodes.some((node) => node.kind === 'relationship' && 'truncated' in node && node.truncated === true);
  return {
    schema: RELATIONSHIP_GRAPH_EXPORT_SCHEMA,
    version: RELATIONSHIP_GRAPH_EXPORT_VERSION,
    generatedAt,
    source: {
      projectionVersion: version(summary?.projectionVersion),
      relationshipVersion: version(summary?.version),
      graphVersion: CASE_RELATIONSHIP_GRAPH_VERSION,
      state: text(graph.state, 40) || 'unknown',
      filters: outputFilters(graph),
    },
    graph: {
      directed: false,
      nodes,
      edges,
      truncated: graph.truncated === true || observationTruncated,
    },
    limitations: strings([
      ...(Array.isArray(graph.limitations) ? graph.limitations : []),
      'This export contains bounded, locally derived investigation pivots and does not establish ownership, coordination, intent, or maliciousness.',
      'Transient focus, pin, hide, and comparison-group view state is excluded from interchange exports.',
    ], MAX_RELATIONSHIP_GRAPH_EXPORT_LIMITATIONS, 300),
  };
}

function validXmlText(value) {
  let output = '';
  for (const character of String(value ?? '')) {
    const point = character.codePointAt(0) ?? 0xfffd;
    if (point === 0x09 || point === 0x0a || point === 0x0d
      || (point >= 0x20 && point <= 0xd7ff)
      || (point >= 0xe000 && point <= 0xfffd)
      || (point >= 0x10000 && point <= 0x10ffff)) output += character;
    else output += '\ufffd';
  }
  return output;
}

function xml(value) {
  return validXmlText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function scalar(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value);
  if (value === null || value === undefined) return '';
  return String(value);
}

const NODE_FIELDS = [
  ['kind', 'Kind'], ['canonical', 'Canonical value'], ['label', 'Label'],
  ['relationshipType', 'Relationship type'], ['value', 'Relationship value'], ['description', 'Description'],
  ['method', 'Comparison method'], ['certaintyClasses', 'Certainty classes'],
  ['sources', 'Sources'], ['scanDepths', 'Scan depths'], ['firstObservedAt', 'First observed'],
  ['lastObservedAt', 'Last observed'], ['complete', 'Complete'], ['truncated', 'Truncated'],
  ['observationCount', 'Observation count'], ['exportedObservationCount', 'Exported observation count'],
  ['omittedObservationCount', 'Omitted observation count'], ['observations', 'Source observations'],
  ['limitations', 'Limitations'],
];

const EDGE_FIELDS = [
  ['kind', 'Kind'], ['method', 'Comparison method'], ['certaintyClasses', 'Certainty classes'],
  ['sources', 'Sources'], ['firstObservedAt', 'First observed'], ['lastObservedAt', 'Last observed'],
  ['complete', 'Complete'], ['truncated', 'Truncated'], ['limitations', 'Limitations'],
];

function graphml(document) {
  const graphData = {
    schema: document.schema,
    version: document.version,
    generatedAt: document.generatedAt,
    source: document.source,
    truncated: document.graph.truncated,
    limitations: document.limitations,
  };
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    ...Object.keys(graphData).map((key) => `  <key id="graph_${xml(key)}" for="graph" attr.name="${xml(key)}" attr.type="string"/>`),
    ...NODE_FIELDS.map(([key, label]) => `  <key id="node_${xml(key)}" for="node" attr.name="${xml(label)}" attr.type="string"/>`),
    ...EDGE_FIELDS.map(([key, label]) => `  <key id="edge_${xml(key)}" for="edge" attr.name="${xml(label)}" attr.type="string"/>`),
    '  <graph id="whoisleuth-relationship-graph" edgedefault="undirected">',
    ...Object.entries(graphData).map(([key, value]) => `    <data key="graph_${xml(key)}">${xml(scalar(value))}</data>`),
  ];
  for (const node of document.graph.nodes) {
    lines.push(`    <node id="${xml(node.id)}">`, `      <data key="node_kind">${xml(node.kind)}</data>`, `      <data key="node_canonical">${xml(node.canonical || node.label)}</data>`);
    for (const [key] of NODE_FIELDS.slice(2)) {
      if (!(key in node)) continue;
      lines.push(`      <data key="node_${xml(key)}">${xml(scalar(node[key]))}</data>`);
    }
    lines.push('    </node>');
  }
  for (const edge of document.graph.edges) {
    lines.push(`    <edge id="${xml(edge.id)}" source="${xml(edge.source)}" target="${xml(edge.target)}">`);
    for (const [key] of EDGE_FIELDS) lines.push(`      <data key="edge_${xml(key)}">${xml(scalar(edge[key]))}</data>`);
    lines.push('    </edge>');
  }
  lines.push('  </graph>', '</graphml>', '');
  return lines.join('\n');
}

function gexf(document) {
  const metadata = JSON.stringify({
    schema: document.schema,
    version: document.version,
    generatedAt: document.generatedAt,
    source: document.source,
    truncated: document.graph.truncated,
    limitations: document.limitations,
  });
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gexf xmlns="http://gexf.net/1.3" version="1.3">',
    `  <meta lastmodifieddate="${xml(document.generatedAt.slice(0, 10))}"><creator>WHOISleuth</creator><description>${xml(metadata)}</description></meta>`,
    '  <graph mode="static" defaultedgetype="undirected">',
    '    <attributes class="node">',
    ...NODE_FIELDS.map(([key, label]) => `      <attribute id="node_${xml(key)}" title="${xml(label)}" type="string"/>`),
    '    </attributes>',
    '    <attributes class="edge">',
    ...EDGE_FIELDS.map(([key, label]) => `      <attribute id="edge_${xml(key)}" title="${xml(label)}" type="string"/>`),
    '    </attributes>',
    '    <nodes>',
  ];
  for (const node of document.graph.nodes) {
    lines.push(`      <node id="${xml(node.id)}" label="${xml(node.label)}">`, '        <attvalues>');
    for (const [key] of NODE_FIELDS) {
      const value = key === 'canonical' ? (node.canonical || node.label) : node[key];
      if (value === undefined) continue;
      lines.push(`          <attvalue for="node_${xml(key)}" value="${xml(scalar(value))}"/>`);
    }
    lines.push('        </attvalues>', '      </node>');
  }
  lines.push('    </nodes>', '    <edges>');
  for (const edge of document.graph.edges) {
    lines.push(`      <edge id="${xml(edge.id)}" source="${xml(edge.source)}" target="${xml(edge.target)}">`, '        <attvalues>');
    for (const [key] of EDGE_FIELDS) lines.push(`          <attvalue for="edge_${xml(key)}" value="${xml(scalar(edge[key]))}"/>`);
    lines.push('        </attvalues>', '      </edge>');
  }
  lines.push('    </edges>', '  </graph>', '</gexf>', '');
  return lines.join('\n');
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

/** Builds one deliberate local download contract for JSON, GraphML, or GEXF. */
export function buildRelationshipGraphExport(summary, options = {}) {
  const rawFormat = record(options).format;
  const format = rawFormat === undefined || rawFormat === null ? 'json' : text(rawFormat, 20).toLowerCase();
  if (!FORMATS.has(format)) throw new Error('Relationship graph export format must be JSON, GraphML, or GEXF.');
  const document = buildRelationshipGraphDocument(summary, options);
  const content = format === 'json'
    ? `${JSON.stringify(document, null, 2)}\n`
    : format === 'graphml'
      ? graphml(document)
      : gexf(document);
  const bytes = byteLength(content);
  if (bytes > MAX_RELATIONSHIP_GRAPH_EXPORT_BYTES) {
    throw new Error('The bounded relationship graph export exceeded its 512 KiB serialized limit. Narrow the graph filters and try again.');
  }
  const suffix = format === 'json' ? 'json' : format;
  const mimeType = format === 'json'
    ? 'application/json;charset=utf-8'
    : format === 'graphml'
      ? 'application/graphml+xml;charset=utf-8'
      : 'application/gexf+xml;charset=utf-8';
  return {
    version: RELATIONSHIP_GRAPH_EXPORT_VERSION,
    format,
    generatedAt: document.generatedAt,
    filename: `whoisleuth-relationship-graph-${document.generatedAt.slice(0, 10)}.${suffix}`,
    mimeType,
    content,
    bytes,
    nodeCount: document.graph.nodes.length,
    edgeCount: document.graph.edges.length,
    truncated: document.graph.truncated,
  };
}
