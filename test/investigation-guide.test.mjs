import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInvestigationGuide,
  INVESTIGATION_GUIDE_STAGES,
  INVESTIGATION_GUIDE_VERSION,
  investigationGuideHref,
  investigationGuideStageForPath,
  MAX_INVESTIGATION_GUIDE_DOMAIN_LENGTH,
  normalizeInvestigationGuideDomain,
  parseInvestigationGuide,
  visitInvestigationGuide,
} from '../frontend/src/lib/analysis/investigation-guide.js';

const STARTED_AT = '2026-07-18T01:00:00.000Z';
const UPDATED_AT = '2026-07-18T01:05:00.000Z';

test('creates a versioned guide for one canonical domain', () => {
  const guide = createInvestigationGuide('Portal.Example.Test.', STARTED_AT);
  assert.deepEqual(guide, {
    version: INVESTIGATION_GUIDE_VERSION,
    domain: 'portal.example.test',
    createdAt: STARTED_AT,
    updatedAt: STARTED_AT,
    visitedStages: [],
  });
});

test('rejects URL-like, control-bearing, whitespace, IP, undotted, and oversized targets', () => {
  for (const value of [
    'https://example.test/path', 'example.test:443', 'user@example.test', 'two domains.test',
    'bad\n.example', '127.0.0.1', 'localhost', 'a'.repeat(MAX_INVESTIGATION_GUIDE_DOMAIN_LENGTH + 1), null,
  ]) assert.equal(normalizeInvestigationGuideDomain(value), '');
});

test('normalizes IDN hostnames without mutating the input', () => {
  const value = 'café.example';
  assert.equal(normalizeInvestigationGuideDomain(value), 'xn--caf-dma.example');
  assert.equal(value, 'café.example');
});

test('parses only the current bounded schema and known unique stages', () => {
  const parsed = parseInvestigationGuide({
    version: 1,
    domain: 'example.test',
    createdAt: STARTED_AT,
    updatedAt: UPDATED_AT,
    visitedStages: ['lookup', 'invented', 'lookup', 'discover', 'bulk', 'monitor', 'lookup', 'discover', 'extra'],
    rawEvidence: 'must not escape',
  });
  assert.deepEqual(parsed.visitedStages, ['lookup', 'discover', 'bulk', 'monitor']);
  assert.equal('rawEvidence' in parsed, false);
  for (const value of [null, [], { version: 2 }, { version: 1, domain: 'bad' }, {
    version: 1, domain: 'example.test', createdAt: 'bad', updatedAt: UPDATED_AT,
  }]) assert.equal(parseInvestigationGuide(value), null);
});

test('records navigation separately from evidence completion and does not mutate source state', () => {
  const original = createInvestigationGuide('example.test', STARTED_AT);
  const visited = visitInvestigationGuide(original, '/lookup', UPDATED_AT);
  assert.deepEqual(original.visitedStages, []);
  assert.deepEqual(visited.visitedStages, ['lookup']);
  assert.equal(visited.updatedAt, UPDATED_AT);
  assert.deepEqual(visitInvestigationGuide(visited, '/lookup', '2026-07-18T01:10:00.000Z'), visited);
  assert.deepEqual(visitInvestigationGuide(visited, '/registry-support', UPDATED_AT), visited);
  assert.equal('completedStages' in visited, false);
});

test('maps only the four existing workflow routes and emits safe stage links', () => {
  assert.deepEqual(INVESTIGATION_GUIDE_STAGES.map((stage) => stage.id), ['lookup', 'discover', 'bulk', 'monitor']);
  assert.equal(investigationGuideStageForPath('/lookup')?.id, 'lookup');
  assert.equal(investigationGuideStageForPath('/monitor/case')?.id, 'monitor');
  assert.equal(investigationGuideStageForPath('/dashboard'), null);
  assert.equal(investigationGuideHref('lookup', 'café.example'), '/lookup?q=xn--caf-dma.example');
  assert.equal(investigationGuideHref('discover', 'example.test'), '/discover?q=example.test');
  assert.equal(investigationGuideHref('bulk', 'example.test'), '/bulk');
  assert.equal(investigationGuideHref('monitor', 'example.test'), '/monitor?view=cases');
  assert.equal(investigationGuideHref('invented', 'example.test'), '/dashboard');
  assert.equal(investigationGuideHref('lookup', 'bad input'), '/dashboard');
});
