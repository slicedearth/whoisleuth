import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  EVIDENCE_TOPOLOGY_VERSION,
  MAX_EVIDENCE_TOPOLOGY_NODES,
  horizontalConnectionPath,
  normalizeEvidenceTopologyStatus,
  projectEvidenceTopology,
} from '../frontend/src/lib/analysis/evidence-topology.ts';

describe('evidence topology projection', () => {
  test('uses bounded deterministic D3 geometry without changing source attribution', () => {
    const nodes = [
      { id: 'registry-rdap', label: 'Registry RDAP', detail: 'Authoritative registry publication', status: 'success', href: '#evidence-registry', side: 'left', glyph: 'R', family: 'registry' },
      { id: 'dns', label: 'DNS', detail: 'One record family was unavailable', status: 'partial', href: '#evidence-dns', side: 'right', glyph: 'D', family: 'network' },
      { id: 'technology', label: 'Technology', detail: 'Derived from bounded website evidence', status: 'observed', href: '#evidence-technology', side: 'right', provenance: 'derived', glyph: 'T' },
    ];
    const first = projectEvidenceTopology({ label: 'example.test', detail: 'Domain', status: 'registered' }, nodes);
    const second = projectEvidenceTopology({ label: 'example.test', detail: 'Domain', status: 'registered' }, nodes);

    assert.deepEqual(first, second);
    assert.equal(first.version, EVIDENCE_TOPOLOGY_VERSION);
    assert.equal(first.nodes.length, 3);
    assert.equal(first.edges.length, 3);
    assert.equal(first.counts.success, 2);
    assert.equal(first.counts.partial, 1);
    assert.equal(first.nodes.find((node) => node.id === 'technology')?.provenance, 'derived');
    assert.equal(first.nodes.find((node) => node.id === 'technology')?.family, 'derived');
    assert.equal(first.nodes.find((node) => node.id === 'dns')?.family, 'network');
    assert.ok(first.edges.every((edge) => /^M.+C.+$/u.test(edge.path)));
  });

  test('caps nodes and strings, deduplicates ids, and rejects unsafe anchors', () => {
    const nodes = Array.from({ length: MAX_EVIDENCE_TOPOLOGY_NODES + 4 }, (_, index) => ({
      id: index === 1 ? 'source-0' : `source-${index}`,
      label: `Source ${index} ${'x'.repeat(80)}`,
      detail: 'y'.repeat(300),
      status: 'success',
      href: index === 0 ? 'https://outside.invalid/' : index === 2 ? '#valid-anchor' : '#bad?anchor',
      side: index % 2 ? 'left' : 'right',
    }));
    const graph = projectEvidenceTopology({ label: 'z'.repeat(200) }, nodes);

    assert.equal(graph.nodes.length, MAX_EVIDENCE_TOPOLOGY_NODES);
    assert.equal(graph.truncated, true);
    assert.ok(graph.nodes.every((node) => node.label.length <= 40 && node.detail.length <= 120));
    assert.equal(graph.nodes.find((node) => node.id === 'source-0')?.href, '');
    assert.equal(graph.nodes.find((node) => node.id === 'source-2')?.href, '#valid-anchor');
    assert.ok(graph.nodes.every((node) => node.family === 'registry'));
  });

  test('preserves explicit incomplete and failure states instead of implying absence', () => {
    assert.equal(normalizeEvidenceTopologyStatus('success', { complete: false }), 'partial');
    assert.equal(normalizeEvidenceTopologyStatus('success', { truncated: true }), 'partial');
    assert.equal(normalizeEvidenceTopologyStatus('not_found'), 'not_found');
    assert.equal(normalizeEvidenceTopologyStatus('unsupported'), 'unsupported');
    assert.equal(normalizeEvidenceTopologyStatus('inconclusive'), 'inconclusive');
    assert.equal(normalizeEvidenceTopologyStatus('rate_limited'), 'rate_limited');
    assert.equal(normalizeEvidenceTopologyStatus('timeout'), 'error');
    assert.equal(normalizeEvidenceTopologyStatus('something-new'), 'unknown');
  });

  test('creates a curved horizontal connector', () => {
    assert.equal(horizontalConnectionPath({ x: 10, y: 20 }, { x: 110, y: 60 }), 'M10,20C60,20,60,60,110,60');
  });
});
