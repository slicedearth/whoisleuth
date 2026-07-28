import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  EVIDENCE_TOPOLOGY_VERSION,
  MAX_EVIDENCE_TOPOLOGY_NODES,
  buildLookupEvidenceTopologyNodes,
  horizontalConnectionPath,
  normalizeEvidenceTopologyStatus,
  projectEvidenceTopology,
} from '../frontend/src/lib/analysis/evidence-topology.ts';
import type { EvidenceTopologyInput } from '../frontend/src/lib/analysis/evidence-topology.ts';

describe('evidence topology projection', () => {
  test('uses bounded deterministic D3 geometry without changing source attribution', () => {
    const nodes: EvidenceTopologyInput[] = [
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
    const nodes: EvidenceTopologyInput[] = Array.from({ length: MAX_EVIDENCE_TOPOLOGY_NODES + 4 }, (_, index) => ({
      id: index === 1 ? 'source-0' : `source-${index}`,
      label: `Source ${index} ${'x'.repeat(80)}`,
      detail: 'y'.repeat(300),
      status: 'success',
      href: index === 0 ? 'https://outside.invalid/' : index === 2 ? '#valid-anchor' : '#bad?anchor',
      side: index % 2 ? 'left' as const : 'right' as const,
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

  test('builds separately attributed lookup nodes from bounded source records', () => {
    const nodes = buildLookupEvidenceTopologyNodes({
      targetType: 'domain',
      diagnostics: {
        rdap: { status: 'success', endpoint: 'https://rdap.example.test/domain/example.test', transportSecurity: 'https' },
        whois: { status: 'partial' },
      },
      registrarRdap: { status: 'unsupported' },
      observedNetworkContext: { contextVersion: 1, status: 'success' },
      observedNetworkEndpoint: { address: '192.0.2.44' },
      dnsEvidence: { source: 'dns', status: 'success', complete: false },
      reverseDns: { source: 'reverse_dns', status: 'not_found', complete: true },
      reverseDnsRecords: { ptr: [] },
      httpEvidence: { source: 'http', status: 'success', complete: true, transportSecurity: 'https' },
      httpResponse: { status: 200 },
      tlsEvidence: { source: 'tls', status: 'success', complete: true, protocol: 'TLSv1.3' },
      pageIdentity: { source: 'html', status: 'success', complete: true, title: 'Example page' },
      structuredDataIdentity: { source: 'html', status: 'partial', complete: false, entities: [{ type: 'Organization' }] },
      technologyProfile: { source: 'derived', status: 'success', complete: true, findings: [{ id: 'server' }] },
      securityPosture: { source: 'derived', status: 'partial', complete: false },
      securityPostureSummary: { label: 'Review required' },
    });

    assert.equal(nodes.find((node) => node.id === 'registry-rdap')?.family, 'registry');
    assert.equal(nodes.find((node) => node.id === 'dns')?.status, 'partial');
    assert.equal(nodes.find((node) => node.id === 'network')?.detail, '192.0.2.44');
    assert.equal(nodes.find((node) => node.id === 'structured-identity')?.detail, '1 publisher-declared entity');
    assert.equal(nodes.find((node) => node.id === 'technology')?.provenance, 'derived');
    assert.equal(nodes.find((node) => node.id === 'posture')?.status, 'partial');
    assert.equal(nodes.some((node) => node.id === 'security-txt'), false);
  });

  test('omits domain-only nodes for a non-domain target with no source evidence', () => {
    const nodes = buildLookupEvidenceTopologyNodes({
      targetType: 'ipv4',
      diagnostics: { rdap: { status: 'success' } },
    });

    assert.deepEqual(nodes.map((node) => node.id), ['registry-rdap']);
    assert.equal(nodes[0]?.label, 'RDAP');
  });
});
