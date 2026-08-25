import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLookupInvestigationBrief,
  formatLookupInvestigationBriefMarkdown,
  lookupInvestigationBriefFilename,
} from '../frontend/src/lib/analysis/lookup-investigation-brief.ts';
import { buildDecisionFacts } from '../packages/evidence/decision-fact.mts';
import type { LookupAssetGraph } from '../frontend/src/lib/analysis/lookup-asset-graph.ts';
import type {
  LookupDecisionSupport,
  LookupEvidenceQualityMatrix,
} from '../frontend/src/lib/analysis/lookup-decision-support.ts';

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
    expectedOutcome: 'Confirm which publication can support the current registry status.',
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
    requestDisclosure: null,
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
  version: 2,
  targetId: 'domain:example.test',
  nodes: [{ id: 'domain:example.test', kind: 'target', label: 'example.test', detail: 'Lookup target' }],
  edges: [],
  sources: [],
  truncated: false,
  limitations: ['Relationship evidence is point in time.'],
};

const decisionFacts = buildDecisionFacts([{
  id: 'lookup-decision:registry-status',
  question: 'What do the registration publications establish?',
  conclusion: 'Statuses differ. Registry publications differ.',
  importance: 'high',
  evidenceState: 'partial',
  freshness: 'current',
  consistency: 'contradictory',
  contributors: [{
    id: 'evidence:rdap',
    label: 'Registry RDAP',
    provenance: 'provider_reported',
    evidenceState: 'observed',
    references: ['#registry', 'lookup-evidence:rdap'],
    observedAt: '2026-07-31T00:00:00.000Z',
    limitations: [],
  }],
  references: ['#registry', 'lookup-evidence:rdap'],
  contradictions: ['The separately attributed publications differ.'],
  limitations: ['Source order does not decide authority.'],
  nextActions: [{
    id: 'review',
    label: 'Review registry evidence',
    reason: 'Resolve the status difference.',
    expectedOutcome: 'Record which publication can support the current status.',
    href: '#registry',
    importance: 'high',
  }],
}, {
  id: 'lookup-decision:http-limited',
  question: 'What did HTTP establish?',
  conclusion: 'HTTP is incomplete. The request did not settle.',
  importance: 'medium',
  evidenceState: 'partial',
  freshness: 'unknown',
  consistency: 'unknown',
  contributors: [{
    id: 'evidence:http',
    label: 'HTTP',
    provenance: 'direct_observation',
    evidenceState: 'partial',
    references: ['#evidence-http', 'lookup-evidence:http'],
    observedAt: '2026-07-31T00:00:00.000Z',
    limitations: ['The response was truncated.'],
  }],
  references: ['#evidence-http', 'lookup-evidence:http'],
  contradictions: [],
  limitations: ['The response was truncated.'],
  nextActions: [],
}]);

test('investigation brief carries the bounded canonical Decision Fact projection', () => {
  const brief = buildLookupInvestigationBrief({
    generatedAt: '2026-07-31T01:00:00.000Z',
    target: 'example.test',
    targetType: 'domain',
    task: 'incident',
    decisionSupport: support,
    decisionFacts,
    quality,
    graph,
  });
  assert.equal(brief.schemaVersion, 2);
  assert.equal(brief.decisionFacts.total, 2);
  assert.equal(brief.decisionFacts.displayed, 2);
  assert.equal(brief.decisionFacts.omitted, 0);
  assert.equal(brief.decisionFacts.contradictory, 1);
  assert.equal(brief.decisionFacts.unresolved, 1);
  assert.equal(brief.decisionFacts.facts[0]?.id, 'lookup-decision:http-limited');
  assert.equal(brief.decisionFacts.facts[1]?.sources.items[0]?.observedAt, '2026-07-31T00:00:00.000Z');
  assert.equal(Object.hasOwn(brief, 'verifiedFacts'), false);
  assert.equal(Object.hasOwn(brief, 'unknowns'), false);
  assert.match(brief.limitations.join(' '), /HTTP: Partial/u);
});

test('investigation brief Markdown escapes untrusted labels and has a stable filename', () => {
  const brief = buildLookupInvestigationBrief({
    generatedAt: '2026-07-31T01:00:00.000Z',
    target: '<example.test>',
    targetType: 'domain',
    task: 'incident',
    decisionSupport: support,
    decisionFacts,
    quality,
    graph,
  });
  const markdown = formatLookupInvestigationBriefMarkdown(brief);
  assert.match(markdown, /&lt;example\\.test&gt;/u);
  assert.match(markdown, /Canonical Decision Facts/u);
  assert.match(markdown, /Displaying 2 of 2 canonical Decision Facts; 0 omitted/u);
  assert.match(markdown, /Fact ID/u);
  assert.match(markdown, /Source references/u);
  assert.match(markdown, /Safe next actions/u);
  assert.equal(
    lookupInvestigationBriefFilename(brief),
    'whoisleuth-investigation-brief-example.test-2026-07-31.md',
  );
});
