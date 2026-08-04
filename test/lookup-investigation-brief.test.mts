import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLookupInvestigationBrief,
  formatLookupInvestigationBriefMarkdown,
  lookupInvestigationBriefFilename,
} from '../frontend/src/lib/analysis/lookup-investigation-brief.ts';
import type { LookupAssetGraph } from '../frontend/src/lib/analysis/lookup-asset-graph.ts';
import type {
  LookupDecisionSupport,
  LookupEvidenceQualityMatrix,
} from '../frontend/src/lib/analysis/lookup-decision-support.ts';
import type { LookupSummaryModel } from '../frontend/src/lib/analysis/lookup-summary-model.ts';

const summary: LookupSummaryModel = {
  signals: [],
  diagnostics: [],
  facts: [{
    label: 'Registrar',
    value: 'Example Registrar',
    detail: 'Normalized registration source value',
    provenance: {
      sources: ['Registry RDAP'],
      observedAt: '2026-07-31T00:00:00.000Z',
      fieldFamilies: ['registrar'],
      normalization: 'Normalized entity name',
      completeness: 'complete',
      limitations: [],
      conflicts: [],
      decisionImpact: 'Review the sponsoring registrar.',
    },
  }],
};

const support: LookupDecisionSupport = {
  version: 1,
  guidance: {
    task: 'incident',
    label: 'Incident response',
    summary: 'Review current evidence before preparing a response.',
    questions: ['What behavior was observed?'],
    prioritySections: ['overview'],
  },
  entries: [{
    id: 'registry-status',
    state: 'conflict',
    importance: 'high',
    title: 'Statuses differ',
    detail: 'Registry publications differ.',
    sources: ['Registry RDAP', 'WHOIS'],
    href: '#registry',
  }, {
    id: 'http-limited',
    state: 'uncertain',
    importance: 'medium',
    title: 'HTTP is incomplete',
    detail: 'The request did not settle.',
    sources: ['HTTP'],
    href: '#evidence-quality',
  }],
  actions: [{
    id: 'review',
    label: 'Review registry evidence',
    reason: 'Resolve the status difference.',
    href: '#registry',
    priority: 'high',
  }],
  counts: { conflicts: 1, uncertainties: 1 },
};

const quality: LookupEvidenceQualityMatrix = {
  version: 1,
  observedAt: '2026-07-31T00:00:00.000Z',
  totalMs: 100,
  entries: [{
    id: 'http',
    label: 'HTTP',
    category: 'web',
    endpointClass: 'Bounded HTTP collection',
    description: 'A bounded homepage request.',
    state: 'partial',
    statusLabel: 'Partial',
    truncated: true,
    observedAt: '2026-07-31T00:00:00.000Z',
    ageDays: 0,
    durationMs: 100,
    timingOutcome: 'fulfilled',
    refreshAvailable: false,
    limitations: ['The response was truncated.'],
    supports: ['Website state'],
  }],
  completeCount: 2,
  limitedCount: 1,
  stale: false,
  ageDays: 0,
  freshnessPolicy: { version: 1, id: 'task-default', task: 'incident', thresholdsDays: { registration: 14, network: 1, web: 1 } },
};

const graph: LookupAssetGraph = {
  version: 1,
  targetId: 'domain:example.test',
  nodes: [{ id: 'domain:example.test', kind: 'target', label: 'example.test', detail: 'Lookup target' }],
  edges: [],
  truncated: false,
  limitations: ['Relationship evidence is point in time.'],
};

test('investigation brief separates facts, contradictions, unknowns, and actions', () => {
  const brief = buildLookupInvestigationBrief({
    generatedAt: '2026-07-31T01:00:00.000Z',
    target: 'example.test',
    targetType: 'domain',
    task: 'incident',
    summary,
    decisionSupport: support,
    quality,
    graph,
  });
  assert.equal(brief.schemaVersion, 1);
  assert.equal(brief.verifiedFacts.length, 1);
  assert.equal(brief.contradictions.length, 1);
  assert.equal(brief.unknowns.length, 1);
  assert.equal(brief.nextActions.length, 1);
  assert.match(brief.limitations.join(' '), /HTTP: Partial/u);
});

test('investigation brief Markdown escapes untrusted labels and has a stable filename', () => {
  const brief = buildLookupInvestigationBrief({
    generatedAt: '2026-07-31T01:00:00.000Z',
    target: '<example.test>',
    targetType: 'domain',
    task: 'incident',
    summary,
    decisionSupport: support,
    quality,
    graph,
  });
  const markdown = formatLookupInvestigationBriefMarkdown(brief);
  assert.match(markdown, /&lt;example\\.test&gt;/u);
  assert.match(markdown, /Contradictory evidence/u);
  assert.equal(
    lookupInvestigationBriefFilename(brief),
    'whoisleuth-investigation-brief-example.test-2026-07-31.md',
  );
});
