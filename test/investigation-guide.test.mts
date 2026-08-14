import { requiredValue } from './value-assertions.mts';
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
  investigationGuideApprovedHref,
  investigationGuideHref,
  investigationGuideRecipe,
  investigationGuideStageForPath,
  investigationGuideStagesForGuide,
  investigationGuideStagesForRecipe,
  investigationGuideSummaryFilename,
  MAX_INVESTIGATION_GUIDE_DOMAIN_LENGTH,
  MAX_INVESTIGATION_GUIDE_REVIEW_NOTE_LENGTH,
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

test('defines six fixed bounded investigation and response recipes with complete stage guidance', () => {
  assert.deepEqual(INVESTIGATION_RECIPES.map((recipe) => recipe.id), [
    'brand_sweep',
    'infrastructure_pivot',
    'new_domain_triage',
    'credential_impersonation_response',
    'mail_abuse_response',
    'domain_control_change_response',
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
  assert.ok(guide);
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

test('normalizes deployed version 1 navigation into the current new-domain triage schema', () => {
  const legacy = {
    version: INVESTIGATION_GUIDE_LEGACY_VERSION,
    domain: 'Example.Test.',
    createdAt: STARTED_AT,
    updatedAt: OPENED_AT,
    visitedStages: ['lookup', 'invented', 'lookup', 'bulk', 'monitor', 'extra'],
    rawEvidence: 'must not escape',
  };
  const parsed = parseInvestigationGuide(legacy);
  assert.ok(parsed);
  assert.equal(parsed.version, INVESTIGATION_GUIDE_VERSION);
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
  assert.ok(parsed);
  assert.equal(parsed.status, 'active');
  assert.equal(parsed.stages.length, 5);
  assert.deepEqual(parsed.stages.find((stage) => stage.id === 'discover'), {
    id: 'discover',
    outcome: 'partial',
    approvedAt: APPROVED_AT,
    openedAt: OPENED_AT,
    reviewNote: null,
    updatedAt: COMPLETED_AT,
  });
  assert.equal('rawEvidence' in parsed, false);
  const discover = parsed.stages.find((stage) => stage.id === 'discover');
  assert.ok(discover);
  assert.equal('raw' in discover, false);
});

test('rejects malformed and future records without treating them as an empty recipe', () => {
  for (const value of [null, [], { version: INVESTIGATION_GUIDE_VERSION + 1 }, { version: 2, domain: 'bad' }, {
    version: 2,
    recipeId: 'new_domain_triage',
    domain: 'example.test',
    createdAt: 'bad',
    updatedAt: OPENED_AT,
  }]) assert.equal(parseInvestigationGuide(value), null);
});

test('requires explicit zones for current guides and migrates legacy guide instants as UTC', () => {
  const current = createInvestigationGuide('example.test', 'new_domain_triage', STARTED_AT);
  assert.ok(current);
  const zoneLess = '2026-01-15T12:00:00.000';
  assert.equal(parseInvestigationGuide({ ...current, createdAt: zoneLess, updatedAt: zoneLess }), null);
  const legacy = parseInvestigationGuide({
    ...current,
    version: 4,
    createdAt: zoneLess,
    updatedAt: zoneLess,
    stages: current.stages.map((stage) => ({ ...stage, updatedAt: zoneLess })),
  });
  assert.equal(legacy?.createdAt, '2026-01-15T12:00:00.000Z');
  assert.ok(legacy?.stages.every((stage) => stage.updatedAt === '2026-01-15T12:00:00.000Z'));
  assert.equal(parseInvestigationGuide({
    ...current,
    createdAt: '2026-01-15T12:00:00.000+01:00',
    updatedAt: '2026-01-15T12:00:00.000+01:00',
  })?.createdAt, '2026-01-15T11:00:00.000Z');
});

test('does not reinterpret response recipe identifiers under pre-response guide versions', () => {
  const current = createInvestigationGuide('review.example', 'mail_abuse_response', STARTED_AT);
  assert.ok(current);
  assert.equal(parseInvestigationGuide({ ...current, version: 4 }), null);
  assert.equal(parseInvestigationGuide(current)?.recipeId, 'mail_abuse_response');
});

test('custom templates retain allowlisted stages and cannot remove mandatory request gates', () => {
  const guide = createInvestigationGuide('example.test', 'new_domain_triage', STARTED_AT, {
    id: 'focused-review',
    label: 'Focused review',
    summary: 'Review only the collection and disposition steps.',
    recipeId: 'new_domain_triage',
    stages: [
      {
        id: 'lookup',
        label: 'Collect focused evidence',
        expectedEvidence: 'A reviewed bounded result.',
        completionCriteria: 'Source states have been reviewed.',
        instructions: ['Run the Deep lookup.', 'Review source limitations.'],
        requiresApproval: false,
      },
      { id: 'bulk', enabled: false },
      {
        id: 'monitor',
        label: 'Record the decision',
        requiresApproval: true,
      },
      { id: 'invented', label: 'Do not keep' },
    ],
  });
  assert.ok(guide);
  assert.equal(guide.template?.label, 'Focused review');
  assert.deepEqual(investigationGuideStagesForGuide(guide).map((stage) => stage.id), ['lookup', 'monitor']);
  assert.equal(requiredValue(investigationGuideStagesForGuide(guide)[0]).requiresApproval, true);
  assert.equal(requiredValue(investigationGuideStagesForGuide(guide)[1]).requiresApproval, true);
  assert.deepEqual(visitInvestigationGuide(guide, '/lookup', OPENED_AT), guide);
  const approved = approveInvestigationGuideStage(guide, 'lookup', APPROVED_AT);
  assert.equal(requiredValue(approved?.stages[0]).approvedAt, APPROVED_AT);
  const restarted = restartInvestigationGuide(approved, COMPLETED_AT);
  assert.equal(restarted?.template?.id, 'focused-review');
  assert.deepEqual(restarted?.stages.map((stage) => stage.id), ['lookup', 'monitor']);
  const summary = buildInvestigationGuideSummary(restarted, COMPLETED_AT);
  assert.deepEqual(summary?.template, { id: 'focused-review', label: 'Focused review' });
  assert.deepEqual(summary?.stages.map((stage) => stage.id), ['lookup', 'monitor']);
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
  assert.equal(investigationGuideHref('brands', 'review.example', 'mail_abuse_response'), '/brands');
  assert.equal(investigationGuideHref('monitor', 'review.example', 'credential_impersonation_response'), '/monitor?view=cases&investigation=1&response=1&domain=review.example#case-review-queue');
  assert.equal(investigationGuideHref('lookup', 'example.test', 'brand_sweep'), '/bulk#results');
  assert.equal(investigationGuideHref('lookup', 'example.test', 'brand_sweep', 'candidate.example'), '/lookup?q=candidate.example&depth=deep#query');
  assert.equal(investigationGuideHref('invented', 'example.test', 'brand_sweep'), '/dashboard');
});

test('response playbooks stay manual, end in Case preflight, and never claim submission', () => {
  for (const recipeId of [
    'credential_impersonation_response',
    'mail_abuse_response',
    'domain_control_change_response',
  ] as const) {
    const guide = createInvestigationGuide('review.example', recipeId, STARTED_AT);
    assert.ok(guide);
    const recipe = investigationGuideRecipe(recipeId);
    assert.ok(recipe);
    assert.equal(recipe.stages.at(-1)?.workspace, 'monitor');
    assert.match(recipe.stages.at(-1)?.detail || '', /record|response|packet/iu);
    assert.match(recipe.stages.at(-1)?.requestImpact || '', /never|no request/iu);
    assert.doesNotMatch(JSON.stringify(recipe), /automatically sends|automatic submission|confirmed malicious/iu);
    assert.equal(investigationGuideApprovedHref(guide, 'monitor').includes('response=1'), true);
  }
});

test('routes an approved reviewed brand candidate set through its dedicated Bulk handoff', () => {
  const brand = createInvestigationGuide('portal.example.test', 'brand_sweep', STARTED_AT);
  assert.ok(brand);
  assert.equal(investigationGuideApprovedHref(brand, 'bulk'), '/bulk?investigation=portal.example.test#domains');

  const reviewed = setInvestigationGuideReviewDomains(brand, ['candidate.example'], OPENED_AT);
  assert.ok(reviewed);
  assert.equal(investigationGuideApprovedHref(reviewed, 'bulk'), '/bulk?source=discover#domains');

  const triage = createInvestigationGuide('portal.example.test', 'new_domain_triage', STARTED_AT);
  assert.ok(triage);
  assert.equal(investigationGuideApprovedHref(triage, 'bulk'), '/bulk?investigation=portal.example.test#domains');
  assert.equal(investigationGuideApprovedHref(reviewed, 'invented'), '/dashboard');
});

test('stores one bounded analyst-selected focus domain without changing the official target', () => {
  const original = createInvestigationGuide('portal.example.test', 'brand_sweep', STARTED_AT);
  const focused = setInvestigationGuideFocusDomain(original, 'Candidate.Example.', OPENED_AT);
  assert.ok(original);
  assert.ok(focused);
  assert.equal(original.focusDomain, null);
  assert.equal(focused.domain, 'portal.example.test');
  assert.equal(focused.focusDomain, 'candidate.example');
  assert.equal(focused.updatedAt, OPENED_AT);
  assert.deepEqual(setInvestigationGuideFocusDomain(focused, 'bad domain', COMPLETED_AT), focused);
  const triage = createInvestigationGuide('portal.example.test', 'new_domain_triage', STARTED_AT);
  assert.deepEqual(setInvestigationGuideFocusDomain(triage, 'candidate.example', OPENED_AT), triage);
});

test('carries bounded canonical peer sets without mutating the starting domain', () => {
  const original = createInvestigationGuide('portal.example.test', 'new_domain_triage', STARTED_AT);
  const values = [
    'Peer.Example.',
    'portal.example.test',
    ...Array.from({ length: MAX_INVESTIGATION_GUIDE_REVIEW_DOMAINS + 5 }, (_, index) => `peer-${index}.example`),
    'bad domain',
  ];
  const updated = setInvestigationGuideReviewDomains(original, values, OPENED_AT);
  assert.ok(original);
  assert.ok(updated);
  assert.equal(original.reviewDomains.length, 1);
  assert.equal(updated.domain, 'portal.example.test');
  assert.equal(updated.reviewDomains[0], 'portal.example.test');
  assert.equal(updated.reviewDomains[1], 'peer.example');
  assert.equal(updated.reviewDomains.length, MAX_INVESTIGATION_GUIDE_REVIEW_DOMAINS);
  assert.equal(updated.reviewDomainsTruncated, true);
  assert.equal(updated.updatedAt, OPENED_AT);

  const brand = createInvestigationGuide('portal.example.test', 'brand_sweep', STARTED_AT);
  const brandUpdated = setInvestigationGuideReviewDomains(brand, values, OPENED_AT);
  assert.ok(brandUpdated);
  assert.deepEqual(brandUpdated.reviewDomains.slice(0, 2), ['peer.example', 'portal.example.test']);
  assert.equal(brandUpdated.reviewDomains.includes('portal.example.test'), true);
  assert.equal(brandUpdated.reviewDomainsTruncated, true);
  assert.equal(brandUpdated.updatedAt, OPENED_AT);
});

test('records opened stages separately from outcomes and does not mutate source state', () => {
  const original = createInvestigationGuide('example.test', 'new_domain_triage', STARTED_AT);
  assert.ok(original);
  assert.deepEqual(visitInvestigationGuide(original, '/lookup', OPENED_AT), original);
  const approved = approveInvestigationGuideStage(original, 'lookup', APPROVED_AT);
  const visited = visitInvestigationGuide(approved, '/lookup', OPENED_AT);
  assert.ok(visited);
  assert.equal(requiredValue(original.stages[0]).openedAt, null);
  assert.equal(requiredValue(visited.stages[0]).openedAt, OPENED_AT);
  assert.equal(requiredValue(visited.stages[0]).outcome, 'pending');
  assert.deepEqual(visitInvestigationGuide(visited, '/lookup', COMPLETED_AT), visited);
  assert.deepEqual(visitInvestigationGuide(visited, '/discover', COMPLETED_AT), visited);
});

test('requires explicit collection approval but approval never opens or completes a stage', () => {
  const original = createInvestigationGuide('example.test', 'brand_sweep', STARTED_AT);
  const approved = approveInvestigationGuideStage(original, 'discover', APPROVED_AT);
  assert.ok(approved);
  const discover = approved.stages.find((stage) => stage.id === 'discover');
  assert.ok(discover);
  assert.equal(discover.approvedAt, APPROVED_AT);
  assert.equal(discover.openedAt, null);
  assert.equal(discover.outcome, 'pending');
  assert.deepEqual(approveInvestigationGuideStage(approved, 'discover', COMPLETED_AT), approved);
  assert.deepEqual(approveInvestigationGuideStage(original, 'brands', APPROVED_AT), original);
});

test('complete and partial outcomes require an opened stage while partial and skipped reviews retain a reason', () => {
  const original = createInvestigationGuide('example.test', 'new_domain_triage', STARTED_AT);
  assert.ok(original);
  assert.deepEqual(setInvestigationGuideStageOutcome(original, 'lookup', 'complete', COMPLETED_AT), original);
  assert.deepEqual(setInvestigationGuideStageOutcome(original, 'bulk', 'skipped', COMPLETED_AT), original);
  const skipped = setInvestigationGuideStageOutcome(
    original,
    'bulk',
    'skipped',
    COMPLETED_AT,
    'Peer comparison deferred until a second domain is selected.',
  );
  assert.ok(skipped);
  const skippedStage = skipped.stages.find((stage) => stage.id === 'bulk');
  assert.ok(skippedStage);
  assert.equal(skippedStage.outcome, 'skipped');
  assert.equal(skippedStage.reviewNote, 'Peer comparison deferred until a second domain is selected.');
  const approved = approveInvestigationGuideStage(original, 'lookup', APPROVED_AT);
  const opened = visitInvestigationGuide(approved, '/lookup', OPENED_AT);
  assert.deepEqual(setInvestigationGuideStageOutcome(opened, 'lookup', 'partial', COMPLETED_AT), opened);
  const partial = setInvestigationGuideStageOutcome(
    opened,
    'lookup',
    'partial',
    COMPLETED_AT,
    `  Registry source unavailable.\n${'x'.repeat(MAX_INVESTIGATION_GUIDE_REVIEW_NOTE_LENGTH)}  `,
  );
  assert.ok(partial);
  const partialStage = partial.stages.find((stage) => stage.id === 'lookup');
  assert.ok(partialStage);
  assert.equal(partialStage.outcome, 'partial');
  assert.equal(partialStage.reviewNote?.startsWith('Registry source unavailable. '), true);
  assert.equal(partialStage.reviewNote?.length, MAX_INVESTIGATION_GUIDE_REVIEW_NOTE_LENGTH);
  assert.equal(partial.updatedAt, COMPLETED_AT);
  const reopened = setInvestigationGuideStageOutcome(partial, 'lookup', 'pending', '2026-07-20T01:07:00.000Z');
  assert.equal(reopened?.stages.find((stage) => stage.id === 'lookup')?.reviewNote, null);
});

test('pause blocks stage mutation until the recipe is resumed', () => {
  const original = createInvestigationGuide('example.test', 'new_domain_triage', STARTED_AT);
  const paused = setInvestigationGuideStatus(original, 'paused', APPROVED_AT);
  assert.ok(paused);
  assert.equal(paused.status, 'paused');
  assert.deepEqual(visitInvestigationGuide(paused, '/lookup', OPENED_AT), paused);
  assert.deepEqual(approveInvestigationGuideStage(paused, 'lookup', OPENED_AT), paused);
  assert.deepEqual(setInvestigationGuideStageOutcome(paused, 'bulk', 'skipped', OPENED_AT), paused);
  const resumed = setInvestigationGuideStatus(paused, 'active', COMPLETED_AT);
  assert.ok(resumed);
  assert.equal(resumed.status, 'active');
});

test('restart preserves the recipe and target but clears all progress', () => {
  const original = createInvestigationGuide('example.test', 'infrastructure_pivot', STARTED_AT);
  const opened = visitInvestigationGuide(original, '/lookup', OPENED_AT);
  const approved = approveInvestigationGuideStage(opened, 'bulk', APPROVED_AT);
  const restarted = restartInvestigationGuide(approved, COMPLETED_AT);
  assert.ok(restarted);
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
  assert.ok(summary);
  assert.equal(summary.schema, INVESTIGATION_GUIDE_EXPORT_SCHEMA);
  assert.equal(summary.version, INVESTIGATION_GUIDE_EXPORT_VERSION);
  assert.deepEqual(summary.target, { type: 'domain', value: 'example.test' });
  assert.deepEqual(summary.stages[0], {
    id: 'lookup',
    workspace: 'lookup',
    outcome: 'complete',
    approved: true,
    opened: true,
    reviewNote: null,
    updatedAt: COMPLETED_AT,
  });
  const keys: string[] = [];
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
