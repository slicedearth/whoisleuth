import test from 'node:test';
import assert from 'node:assert/strict';

import {
  approveInvestigationGuideStage,
  buildInvestigationGuideSummary,
  createInvestigationGuide,
  INVESTIGATION_GUIDE_EXPORT_SCHEMA,
  INVESTIGATION_GUIDE_EXPORT_VERSION,
  INVESTIGATION_GUIDE_LEGACY_VERSION,
  INVESTIGATION_GUIDE_VERSION,
  INVESTIGATION_RECIPES,
  investigationGuideHref,
  investigationGuideRecipe,
  investigationGuideStageForPath,
  investigationGuideStagesForRecipe,
  investigationGuideSummaryFilename,
  MAX_INVESTIGATION_GUIDE_DOMAIN_LENGTH,
  MAX_INVESTIGATION_GUIDE_REVIEW_DOMAINS,
  normalizeInvestigationGuideDomain,
  parseInvestigationGuide,
  restartInvestigationGuide,
  setInvestigationGuideFocusDomain,
  setInvestigationGuideReviewDomains,
  setInvestigationGuideStageOutcome,
  setInvestigationGuideStatus,
  visitInvestigationGuide,
} from '../frontend/src/lib/analysis/investigation-guide.ts';

const STARTED_AT = '2026-07-20T01:00:00.000Z';
const OPENED_AT = '2026-07-20T01:05:00.000Z';
const APPROVED_AT = '2026-07-20T01:04:00.000Z';
const COMPLETED_AT = '2026-07-20T01:06:00.000Z';

test('defines three fixed bounded recipes with complete stage guidance', () => {
  assert.deepEqual(INVESTIGATION_RECIPES.map((recipe) => recipe.id), [
    'brand_sweep',
    'infrastructure_pivot',
    'new_domain_triage',
  ]);
  for (const recipe of INVESTIGATION_RECIPES) {
    assert.ok(recipe.stages.length >= 3 && recipe.stages.length <= 5);
    assert.equal(new Set(recipe.stages.map((stage) => stage.id)).size, recipe.stages.length);
    for (const stage of recipe.stages) {
      assert.ok(stage.detail);
      assert.ok(stage.expectedEvidence);
      assert.ok(stage.requestImpact);
      assert.ok(stage.prerequisite);
      assert.ok(stage.completionCriteria);
      assert.equal(stage.instructions.length, 3);
      assert.ok(stage.instructions.every(Boolean));
      assert.equal(stage.path, `/${stage.workspace}`);
    }
  }
});

test('creates a versioned recipe for one canonical domain without starting or completing a stage', () => {
  const guide = createInvestigationGuide('Portal.Example.Test.', 'infrastructure_pivot', STARTED_AT);
  assert.equal(guide.version, INVESTIGATION_GUIDE_VERSION);
  assert.equal(guide.recipeId, 'infrastructure_pivot');
  assert.equal(guide.domain, 'portal.example.test');
  assert.equal(guide.focusDomain, null);
  assert.deepEqual(guide.reviewDomains, ['portal.example.test']);
  assert.equal(guide.reviewDomainsTruncated, false);
  assert.equal(guide.status, 'active');
  assert.deepEqual(guide.stages.map(({ id, outcome, approvedAt, openedAt }) => ({ id, outcome, approvedAt, openedAt })), [
    { id: 'lookup', outcome: 'pending', approvedAt: null, openedAt: null },
    { id: 'bulk', outcome: 'pending', approvedAt: null, openedAt: null },
    { id: 'monitor', outcome: 'pending', approvedAt: null, openedAt: null },
  ]);
});

test('rejects unknown recipes and URL-like, control-bearing, whitespace, IP, undotted, and oversized targets', () => {
  for (const value of [
    'https://example.test/path', 'example.test:443', 'user@example.test', 'two domains.test',
    'bad\n.example', '127.0.0.1', 'localhost', 'a'.repeat(MAX_INVESTIGATION_GUIDE_DOMAIN_LENGTH + 1), null,
  ]) assert.equal(normalizeInvestigationGuideDomain(value), '');
  assert.equal(createInvestigationGuide('example.test', 'unknown', STARTED_AT), null);
});

test('normalizes IDN hostnames without mutating the input', () => {
  const value = 'café.example';
  assert.equal(normalizeInvestigationGuideDomain(value), 'xn--caf-dma.example');
  assert.equal(value, 'café.example');
});

test('normalizes deployed version 1 navigation into new-domain triage version 2', () => {
  const legacy = {
    version: INVESTIGATION_GUIDE_LEGACY_VERSION,
    domain: 'Example.Test.',
    createdAt: STARTED_AT,
    updatedAt: OPENED_AT,
    visitedStages: ['lookup', 'invented', 'lookup', 'bulk', 'monitor', 'extra'],
    rawEvidence: 'must not escape',
  };
  const parsed = parseInvestigationGuide(legacy);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.recipeId, 'new_domain_triage');
  assert.equal(parsed.domain, 'example.test');
  assert.deepEqual(parsed.reviewDomains, ['example.test']);
  assert.deepEqual(parsed.stages.map((stage) => [stage.id, stage.openedAt]), [
    ['lookup', OPENED_AT],
    ['bulk', OPENED_AT],
    ['monitor', OPENED_AT],
  ]);
  assert.equal('rawEvidence' in parsed, false);
  assert.equal(legacy.version, 1);
});

test('parses current records through fixed stage and field allowlists', () => {
  const current = createInvestigationGuide('example.test', 'brand_sweep', STARTED_AT);
  const parsed = parseInvestigationGuide({
    ...current,
    status: 'invented',
    stages: [
      { id: 'discover', outcome: 'partial', approvedAt: APPROVED_AT, openedAt: OPENED_AT, updatedAt: COMPLETED_AT, raw: 'drop' },
      { id: 'discover', outcome: 'complete', approvedAt: null, openedAt: null, updatedAt: STARTED_AT },
      { id: 'invented', outcome: 'complete', updatedAt: STARTED_AT },
    ],
    rawEvidence: 'drop',
  });
  assert.equal(parsed.status, 'active');
  assert.equal(parsed.stages.length, 5);
  assert.deepEqual(parsed.stages.find((stage) => stage.id === 'discover'), {
    id: 'discover',
    outcome: 'partial',
    approvedAt: APPROVED_AT,
    openedAt: OPENED_AT,
    updatedAt: COMPLETED_AT,
  });
  assert.equal('rawEvidence' in parsed, false);
  assert.equal('raw' in parsed.stages.find((stage) => stage.id === 'discover'), false);
});

test('rejects malformed and future records without treating them as an empty recipe', () => {
  for (const value of [null, [], { version: 3 }, { version: 2, domain: 'bad' }, {
    version: 2,
    recipeId: 'new_domain_triage',
    domain: 'example.test',
    createdAt: 'bad',
    updatedAt: OPENED_AT,
  }]) assert.equal(parseInvestigationGuide(value), null);
});

test('maps recipe stages to existing tool routes with safe target handoff', () => {
  assert.equal(investigationGuideRecipe('brand_sweep')?.label, 'Brand sweep');
  assert.equal(investigationGuideStagesForRecipe('invented').length, 0);
  assert.equal(investigationGuideStageForPath('/lookup', 'new_domain_triage')?.id, 'lookup');
  assert.equal(investigationGuideStageForPath('/monitor/case', 'infrastructure_pivot')?.id, 'monitor');
  assert.equal(investigationGuideStageForPath('/discover', 'infrastructure_pivot'), null);
  assert.equal(investigationGuideHref('lookup', 'café.example', 'new_domain_triage'), '/lookup?q=xn--caf-dma.example&depth=deep#query');
  assert.equal(investigationGuideHref('discover', 'example.test', 'brand_sweep'), '/discover?q=example.test#discovery-seed');
  assert.equal(investigationGuideHref('discover', 'portal.example.test', 'brand_sweep'), '/discover?q=example.test#discovery-seed');
  assert.equal(investigationGuideHref('bulk', 'example.test', 'brand_sweep'), '/bulk?investigation=example.test#domains');
  assert.equal(investigationGuideHref('monitor', 'example.test', 'new_domain_triage'), '/monitor?view=cases&investigation=1&domain=example.test#case-review-queue');
  assert.equal(investigationGuideHref('brands', 'example.test', 'brand_sweep'), '/brands?new=1&domain=example.test#official-domains');
  assert.equal(investigationGuideHref('lookup', 'example.test', 'brand_sweep'), '/bulk#results');
  assert.equal(investigationGuideHref('lookup', 'example.test', 'brand_sweep', 'candidate.example'), '/lookup?q=candidate.example&depth=deep#query');
  assert.equal(investigationGuideHref('invented', 'example.test', 'brand_sweep'), '/dashboard');
});

test('stores one bounded analyst-selected focus domain without changing the official target', () => {
  const original = createInvestigationGuide('portal.example.test', 'brand_sweep', STARTED_AT);
  const focused = setInvestigationGuideFocusDomain(original, 'Candidate.Example.', OPENED_AT);
  assert.equal(original.focusDomain, null);
  assert.equal(focused.domain, 'portal.example.test');
  assert.equal(focused.focusDomain, 'candidate.example');
  assert.equal(focused.updatedAt, OPENED_AT);
  assert.deepEqual(setInvestigationGuideFocusDomain(focused, 'bad domain', COMPLETED_AT), focused);
  const triage = createInvestigationGuide('portal.example.test', 'new_domain_triage', STARTED_AT);
  assert.deepEqual(setInvestigationGuideFocusDomain(triage, 'candidate.example', OPENED_AT), triage);
});

test('carries a bounded canonical peer set for non-brand review without mutating the starting domain', () => {
  const original = createInvestigationGuide('portal.example.test', 'new_domain_triage', STARTED_AT);
  const values = [
    'Peer.Example.',
    'portal.example.test',
    ...Array.from({ length: MAX_INVESTIGATION_GUIDE_REVIEW_DOMAINS + 5 }, (_, index) => `peer-${index}.example`),
    'bad domain',
  ];
  const updated = setInvestigationGuideReviewDomains(original, values, OPENED_AT);
  assert.equal(original.reviewDomains.length, 1);
  assert.equal(updated.domain, 'portal.example.test');
  assert.equal(updated.reviewDomains[0], 'portal.example.test');
  assert.equal(updated.reviewDomains[1], 'peer.example');
  assert.equal(updated.reviewDomains.length, MAX_INVESTIGATION_GUIDE_REVIEW_DOMAINS);
  assert.equal(updated.reviewDomainsTruncated, true);
  assert.equal(updated.updatedAt, OPENED_AT);

  const brand = createInvestigationGuide('portal.example.test', 'brand_sweep', STARTED_AT);
  assert.deepEqual(setInvestigationGuideReviewDomains(brand, values, OPENED_AT), brand);
});

test('records opened stages separately from outcomes and does not mutate source state', () => {
  const original = createInvestigationGuide('example.test', 'new_domain_triage', STARTED_AT);
  assert.deepEqual(visitInvestigationGuide(original, '/lookup', OPENED_AT), original);
  const approved = approveInvestigationGuideStage(original, 'lookup', APPROVED_AT);
  const visited = visitInvestigationGuide(approved, '/lookup', OPENED_AT);
  assert.equal(original.stages[0].openedAt, null);
  assert.equal(visited.stages[0].openedAt, OPENED_AT);
  assert.equal(visited.stages[0].outcome, 'pending');
  assert.deepEqual(visitInvestigationGuide(visited, '/lookup', COMPLETED_AT), visited);
  assert.deepEqual(visitInvestigationGuide(visited, '/discover', COMPLETED_AT), visited);
});

test('requires explicit collection approval but approval never opens or completes a stage', () => {
  const original = createInvestigationGuide('example.test', 'brand_sweep', STARTED_AT);
  const approved = approveInvestigationGuideStage(original, 'discover', APPROVED_AT);
  const discover = approved.stages.find((stage) => stage.id === 'discover');
  assert.equal(discover.approvedAt, APPROVED_AT);
  assert.equal(discover.openedAt, null);
  assert.equal(discover.outcome, 'pending');
  assert.deepEqual(approveInvestigationGuideStage(approved, 'discover', COMPLETED_AT), approved);
  assert.deepEqual(approveInvestigationGuideStage(original, 'brands', APPROVED_AT), original);
});

test('complete and partial outcomes require an opened stage while skipped remains explicit', () => {
  const original = createInvestigationGuide('example.test', 'new_domain_triage', STARTED_AT);
  assert.deepEqual(setInvestigationGuideStageOutcome(original, 'lookup', 'complete', COMPLETED_AT), original);
  const skipped = setInvestigationGuideStageOutcome(original, 'bulk', 'skipped', COMPLETED_AT);
  assert.equal(skipped.stages.find((stage) => stage.id === 'bulk').outcome, 'skipped');
  const approved = approveInvestigationGuideStage(original, 'lookup', APPROVED_AT);
  const opened = visitInvestigationGuide(approved, '/lookup', OPENED_AT);
  const partial = setInvestigationGuideStageOutcome(opened, 'lookup', 'partial', COMPLETED_AT);
  assert.equal(partial.stages.find((stage) => stage.id === 'lookup').outcome, 'partial');
  assert.equal(partial.updatedAt, COMPLETED_AT);
});

test('pause blocks stage mutation until the recipe is resumed', () => {
  const original = createInvestigationGuide('example.test', 'new_domain_triage', STARTED_AT);
  const paused = setInvestigationGuideStatus(original, 'paused', APPROVED_AT);
  assert.equal(paused.status, 'paused');
  assert.deepEqual(visitInvestigationGuide(paused, '/lookup', OPENED_AT), paused);
  assert.deepEqual(approveInvestigationGuideStage(paused, 'lookup', OPENED_AT), paused);
  assert.deepEqual(setInvestigationGuideStageOutcome(paused, 'bulk', 'skipped', OPENED_AT), paused);
  const resumed = setInvestigationGuideStatus(paused, 'active', COMPLETED_AT);
  assert.equal(resumed.status, 'active');
});

test('restart preserves the recipe and target but clears all progress', () => {
  const original = createInvestigationGuide('example.test', 'infrastructure_pivot', STARTED_AT);
  const opened = visitInvestigationGuide(original, '/lookup', OPENED_AT);
  const approved = approveInvestigationGuideStage(opened, 'bulk', APPROVED_AT);
  const restarted = restartInvestigationGuide(approved, COMPLETED_AT);
  assert.equal(restarted.recipeId, 'infrastructure_pivot');
  assert.equal(restarted.domain, 'example.test');
  assert.equal(restarted.createdAt, COMPLETED_AT);
  assert.ok(restarted.stages.every((stage) => stage.outcome === 'pending' && !stage.approvedAt && !stage.openedAt));
});

test('builds a deterministic compact summary without evidence or analyst-owned content', () => {
  const original = createInvestigationGuide('example.test', 'new_domain_triage', STARTED_AT);
  const approved = approveInvestigationGuideStage(original, 'lookup', APPROVED_AT);
  const opened = visitInvestigationGuide(approved, '/lookup', OPENED_AT);
  const completed = setInvestigationGuideStageOutcome(opened, 'lookup', 'complete', COMPLETED_AT);
  const summary = buildInvestigationGuideSummary(completed, '2026-07-20T02:00:00.000Z');
  assert.equal(summary.schema, INVESTIGATION_GUIDE_EXPORT_SCHEMA);
  assert.equal(summary.version, INVESTIGATION_GUIDE_EXPORT_VERSION);
  assert.deepEqual(summary.target, { type: 'domain', value: 'example.test' });
  assert.deepEqual(summary.stages[0], {
    id: 'lookup',
    workspace: 'lookup',
    outcome: 'complete',
    approved: true,
    opened: true,
    updatedAt: COMPLETED_AT,
  });
  const keys = [];
  JSON.stringify(summary, (key, value) => {
    if (key) keys.push(key);
    return value;
  });
  for (const excluded of ['rawEvidence', 'notes', 'credentials', 'providerResponse', 'riskScore']) {
    assert.equal(keys.includes(excluded), false);
  }
  assert.equal(buildInvestigationGuideSummary(completed, 'bad'), null);
});

test('creates a bounded safe summary filename', () => {
  const guide = createInvestigationGuide('café.example', 'new_domain_triage', STARTED_AT);
  const filename = investigationGuideSummaryFilename(guide, '2026-07-20T02:00:00.000Z');
  assert.equal(filename, 'whoisleuth-recipe-xn--caf-dma.example-2026-07-20T02-00-00-000Z.json');
  assert.ok(filename.length < 220);
  assert.equal(investigationGuideSummaryFilename(null, 'bad'), 'whoisleuth-investigation-recipe.json');
});
