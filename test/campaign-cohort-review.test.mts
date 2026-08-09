import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { BrandProfile } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import {
  buildCampaignCohortReview,
  CAMPAIGN_REGISTRATION_WINDOW_DAYS,
  MAX_CAMPAIGN_COHORT_MEMBERS,
} from '../frontend/src/lib/analysis/campaign-cohort-review.ts';
import { openOrCreateCase, updateCase, type CaseRecord } from '../frontend/src/lib/analysis/case-model.ts';
import { COMMON_INFRASTRUCTURE_SNAPSHOT } from '../frontend/src/lib/analysis/common-infrastructure.ts';
import type {
  CaseRelationshipGroup,
  CaseRelationshipSummary,
} from '../frontend/src/lib/analysis/case-relationships.ts';

const PROFILE_ID = 'profile_exact_scope';
const OTHER_PROFILE_ID = 'profile_other_scope';
const NOW = '2026-08-09T00:00:00.000Z';

function profile(id = PROFILE_ID, name = 'Example protection scope'): BrandProfile {
  return { id, name } as BrandProfile;
}

function addCase(
  cases: CaseRecord[],
  domain: string,
  profileIds: string[],
  evidence: Record<string, unknown>,
): { cases: CaseRecord[]; record: CaseRecord } {
  const opened = openOrCreateCase(cases, {
    domain,
    brandProfileIds: profileIds,
    evidence: { scanDepth: 'deep', availability: 'registered', confidence: 'high', ...evidence },
  }, NOW);
  return { cases: opened.cases, record: opened.record };
}

function addRegistrationPins(cases: CaseRecord[], record: CaseRecord, truncated = false): CaseRecord[] {
  let next = cases;
  for (const [field, label, value] of [
    ['registration.registrar', 'Registrar', record.evidenceHistory.at(-1)?.registrar],
    ['registration.created', 'Creation date', record.evidenceHistory.at(-1)?.createdDate],
  ] as const) {
    next = updateCase(next, record.id, {
      evidencePin: {
        field,
        category: 'registration',
        label,
        value,
        source: 'Registry publication fixture',
        sourceState: 'success',
        observedAt: NOW,
        collectionDepth: 'deep',
        completeness: 'complete',
        truncated,
      },
    }, NOW).cases;
  }
  return next;
}

function group(
  type: string,
  value: string,
  records: CaseRecord[],
  overrides: Partial<CaseRelationshipGroup> = {},
): CaseRelationshipGroup {
  return {
    type,
    label: `Shared ${type}`,
    method: 'Exact retained fixture',
    value,
    cases: records.map((record) => ({ id: record.id, domain: record.domain })),
    description: 'Fixture relationship.',
    sources: ['fixture source'],
    complete: true,
    truncated: false,
    limitations: [],
    ...overrides,
  };
}

function summary(groups: CaseRelationshipGroup[], truncated = false): CaseRelationshipSummary {
  return { version: 2, groups, truncated, limitations: [] };
}

function fixture() {
  let cases: CaseRecord[] = [];
  const first = addCase(cases, 'alpha.invalid', [PROFILE_ID], {
    registrar: 'Example Registrar, Inc.', createdDate: '2026-08-01T03:00:00Z',
  });
  cases = first.cases;
  const second = addCase(cases, 'beta.invalid', [PROFILE_ID], {
    registrar: 'example registrar inc', createdDate: '2026-08-08T03:00:00Z',
  });
  cases = second.cases;
  const third = addCase(cases, 'gamma.invalid', [PROFILE_ID], {
    registrar: 'Different Registrar', createdDate: '2026-08-20T00:00:00Z',
  });
  cases = third.cases;
  const unscoped = addCase(cases, 'outside.invalid', [OTHER_PROFILE_ID], {
    registrar: 'Example Registrar Inc', createdDate: '2026-08-02T00:00:00Z',
  });
  cases = unscoped.cases;
  cases = addRegistrationPins(cases, first.record);
  cases = addRegistrationPins(cases, second.record);
  cases = updateCase(cases, first.record.id, {
    assertion: { kind: 'hypothesis', statement: 'Analyst context must stay separate.', state: 'open' },
  }, '2026-08-09T01:00:00Z').cases;
  const records = Object.fromEntries(cases.map((record) => [record.domain, record])) as Record<string, CaseRecord>;
  const sharedAddress = COMMON_INFRASTRUCTURE_SNAPSHOT.sources
    .flatMap((source) => source.values)
    .find((value) => /^\d/u.test(value))
    ?.split('/')[0];
  assert.ok(sharedAddress);
  const relationships = summary([
    group('certificate', 'sha256:exact-fixture', [records['alpha.invalid']!, records['beta.invalid']!, records['outside.invalid']!]),
    group('favicon', 'phash:bounded-fixture', [records['beta.invalid']!, records['gamma.invalid']!]),
    group('ip_address', sharedAddress, [records['alpha.invalid']!, records['gamma.invalid']!]),
  ]);
  return { cases, records, relationships };
}

describe('campaign cohort review', () => {
  test('keeps exact profile scope and all four rationale kinds inspectable', () => {
    const source = fixture();
    const review = buildCampaignCohortReview({
      domains: Object.keys(source.records),
      cases: source.cases,
      profiles: [profile(), profile(OTHER_PROFILE_ID, 'Other scope')],
      relationshipSummary: source.relationships,
      selectedBrandProfileId: PROFILE_ID,
    });

    assert.equal(review.state, 'ready');
    assert.equal(review.selectedScope?.name, 'Example protection scope');
    assert.equal(review.scopedCaseCount, 3);
    assert.deepEqual(review.cohorts.flatMap((item) => item.members.map((member) => member.domain)).sort(), [
      'alpha.invalid', 'beta.invalid', 'gamma.invalid',
    ]);
    assert.deepEqual(review.rationaleCounts, {
      exact_link: 1,
      bounded_similarity: 1,
      temporal_cooccurrence: 1,
      common_infrastructure: 1,
    });
    assert.ok(review.cohorts.every((cohort) => cohort.rationales.every((rationale) =>
      rationale.members.every((member) => member.domain !== 'outside.invalid'))));
    const temporal = review.cohorts.flatMap((item) => item.rationales).find((item) => item.kind === 'temporal_cooccurrence');
    assert.equal(temporal?.spanDays, CAMPAIGN_REGISTRATION_WINDOW_DAYS);
    assert.equal(temporal?.completeness, 'complete');
    assert.match(temporal?.method ?? '', /pairwise retained creation-publication/u);
    const commonInfrastructure = review.cohorts.flatMap((item) => item.rationales)
      .find((item) => item.kind === 'common_infrastructure');
    assert.match(commonInfrastructure?.limitations.join(' ') ?? '', /source date/u);
    assert.match(commonInfrastructure?.limitations.join(' ') ?? '', /SHA-256 [a-f0-9]{64}/u);
    assert.equal(review.assertions.length, 1);
    assert.match(review.limitations.join(' '), /assertions are shown separately/u);
  });

  test('uses an unknown compact fallback and excludes dates outside the fixed window', () => {
    let cases: CaseRecord[] = [];
    const first = addCase(cases, 'first.invalid', [PROFILE_ID], {
      registrar: 'Boundary Registrar', createdDate: '2026-07-01T00:00:00Z',
    });
    cases = first.cases;
    const boundary = addCase(cases, 'boundary.invalid', [PROFILE_ID], {
      registrar: 'Boundary Registrar', createdDate: '2026-07-08T00:00:00Z',
    });
    cases = boundary.cases;
    const outside = addCase(cases, 'outside-window.invalid', [PROFILE_ID], {
      registrar: 'Boundary Registrar', createdDate: '2026-07-15T00:00:01Z',
    });
    cases = outside.cases;
    const review = buildCampaignCohortReview({
      domains: ['first.invalid', 'boundary.invalid', 'outside-window.invalid'],
      cases,
      profiles: [profile()],
      relationshipSummary: summary([]),
      selectedBrandProfileId: PROFILE_ID,
    });
    const temporal = review.cohorts.flatMap((item) => item.rationales).filter((item) => item.kind === 'temporal_cooccurrence');
    assert.equal(temporal.length, 1);
    assert.deepEqual(temporal[0]?.members.map((item) => item.domain), ['boundary.invalid', 'first.invalid']);
    assert.equal(temporal[0]?.completeness, 'unknown');
    assert.match(temporal[0]?.limitations.join(' ') ?? '', /compact Case snapshot/u);
    assert.deepEqual(review.ungroupedMembers.map((item) => item.domain), ['outside-window.invalid']);
  });

  test('keeps source failure and unresolved profile details explicit without inferring absence', () => {
    const source = fixture();
    const profilesUnavailable = buildCampaignCohortReview({
      domains: ['alpha.invalid', 'beta.invalid'],
      cases: source.cases,
      profiles: [],
      relationshipSummary: source.relationships,
      selectedBrandProfileId: PROFILE_ID,
      sourceStates: { cases: 'ready', profiles: 'unavailable', relationships: 'unavailable' },
    });
    assert.equal(profilesUnavailable.state, 'partial');
    assert.equal(profilesUnavailable.scopeOptions[0]?.state, 'details_unavailable');
    assert.equal(profilesUnavailable.selectedScope?.name, null);
    assert.match(profilesUnavailable.limitations.join(' '), /without implying that a profile was deleted/u);

    const unresolved = buildCampaignCohortReview({
      domains: ['alpha.invalid', 'beta.invalid'], cases: source.cases, profiles: [],
      relationshipSummary: source.relationships, selectedBrandProfileId: PROFILE_ID,
    });
    assert.equal(unresolved.scopeOptions[0]?.state, 'unresolved');
    assert.equal(unresolved.state, 'partial');

    const relationshipsLoading = buildCampaignCohortReview({
      domains: ['alpha.invalid', 'beta.invalid'], cases: source.cases, profiles: [profile()],
      relationshipSummary: source.relationships, selectedBrandProfileId: PROFILE_ID,
      sourceStates: { relationships: 'loading' },
    });
    assert.equal(relationshipsLoading.state, 'partial');

    const casesUnavailable = buildCampaignCohortReview({
      domains: ['alpha.invalid'], cases: source.cases, profiles: [profile()],
      relationshipSummary: source.relationships, selectedBrandProfileId: PROFILE_ID,
      sourceStates: { cases: 'unavailable' },
    });
    assert.equal(casesUnavailable.state, 'unavailable');
    assert.equal(casesUnavailable.linkedCaseCount, 0);
    assert.equal(casesUnavailable.scopeOptions.length, 0);

    const invalidState = buildCampaignCohortReview({
      domains: ['alpha.invalid'], cases: source.cases, profiles: [profile()],
      relationshipSummary: source.relationships, selectedBrandProfileId: PROFILE_ID,
      sourceStates: { relationships: 'future-state' as never },
    });
    assert.equal(invalidState.sources.relationships, 'unavailable');
  });

  test('keeps cohort identity stable across source order and analyst assertion changes', () => {
    const source = fixture();
    const input = {
      domains: Object.keys(source.records), cases: source.cases, profiles: [profile()],
      relationshipSummary: source.relationships, selectedBrandProfileId: PROFILE_ID,
    };
    const first = buildCampaignCohortReview(input);
    const changedCases = updateCase(source.cases, source.records['beta.invalid']!.id, {
      assertion: { statement: 'A second independent analyst note.', kind: 'unknown' },
    }, '2026-08-09T02:00:00Z').cases;
    const second = buildCampaignCohortReview({
      ...input,
      cases: changedCases,
      relationshipSummary: summary([...source.relationships.groups].reverse()),
    });
    assert.deepEqual(first.cohorts.map((item) => item.id), second.cohorts.map((item) => item.id));
    assert.deepEqual(first.cohorts.map((item) => item.rationales.map((rationale) => rationale.id)), second.cohorts.map((item) => item.rationales.map((rationale) => rationale.id)));
    assert.equal(first.assertions.length + 1, second.assertions.length);
  });

  test('sorts before rationale caps and rejects every duplicate interactive identity', () => {
    const source = fixture();
    const members = [source.records['alpha.invalid']!, source.records['beta.invalid']!];
    const groups = Array.from({ length: 26 }, (_, index) => group('certificate', `certificate-${String(index).padStart(2, '0')}`, members));
    const input = {
      domains: members.map((item) => item.domain), cases: source.cases, profiles: [profile()],
      selectedBrandProfileId: PROFILE_ID,
    };
    const forward = buildCampaignCohortReview({ ...input, relationshipSummary: summary(groups) });
    const reversed = buildCampaignCohortReview({ ...input, relationshipSummary: summary([...groups].reverse()) });
    assert.deepEqual(forward.cohorts.map((item) => item.id), reversed.cohorts.map((item) => item.id));
    assert.deepEqual(
      forward.cohorts.flatMap((item) => item.rationales.map((rationale) => rationale.id)),
      reversed.cohorts.flatMap((item) => item.rationales.map((rationale) => rationale.id)),
    );
    assert.equal(forward.rationaleCounts.exact_link, 25);
    assert.equal(forward.omissions.rationales, 1);

    const duplicate = buildCampaignCohortReview({
      ...input,
      relationshipSummary: summary([groups[0]!, { ...groups[0]! }]),
    });
    assert.equal(duplicate.rationaleCounts.exact_link, 0);
    assert.equal(duplicate.omissions.rationales, 2);
    assert.equal(duplicate.truncated, true);
    const ids = duplicate.cohorts.flatMap((item) => item.rationales.map((rationale) => rationale.id));
    assert.equal(new Set(ids).size, ids.length);
  });

  test('keeps pin truncation, widespread qualification, and upstream omission counts explicit', () => {
    let cases: CaseRecord[] = [];
    const first = addCase(cases, 'pin-first.invalid', [PROFILE_ID], {
      registrar: 'Pin Registrar', createdDate: '2026-08-01T00:00:00Z',
    });
    cases = first.cases;
    const second = addCase(cases, 'pin-second.invalid', [PROFILE_ID], {
      registrar: 'Pin Registrar', createdDate: '2026-08-08T00:00:00Z',
    });
    cases = second.cases;
    cases = addRegistrationPins(cases, first.record, true);
    cases = addRegistrationPins(cases, second.record);
    const records = Object.fromEntries(cases.map((record) => [record.domain, record])) as Record<string, CaseRecord>;
    const widespread = group('nameserver_set', 'ns1.shared.invalid|ns2.shared.invalid', [
      records['pin-first.invalid']!, records['pin-second.invalid']!,
    ], {
      commonality: 'widespread',
      commonalityExplanation: 'Observed across the complete bounded local Case sample.',
    });
    const review = buildCampaignCohortReview({
      domains: Object.keys(records), cases, profiles: [profile()],
      relationshipSummary: summary([widespread], true), selectedBrandProfileId: PROFILE_ID,
    });
    const temporal = review.cohorts.flatMap((item) => item.rationales).find((item) => item.kind === 'temporal_cooccurrence');
    const infrastructure = review.cohorts.flatMap((item) => item.rationales).find((item) => item.kind === 'common_infrastructure');
    assert.equal(temporal?.completeness, 'partial');
    assert.match(temporal?.limitations.join(' ') ?? '', /supporting registration pin was truncated/u);
    assert.match(infrastructure?.limitations.join(' ') ?? '', /complete bounded local Case sample/u);
    assert.equal(review.upstreamRelationshipTruncated, true);
    assert.equal(Object.values(review.omissions).reduce((total, value) => total + value, 0), 0);
    assert.equal(review.truncated, true);
  });

  test('bounds hostile collections and reports omissions instead of scanning indefinitely', () => {
    const template = fixture().records['alpha.invalid']!;
    const cases = Array.from({ length: 600 }, (_, index) => ({
      ...template,
      id: `case-${index}`,
      domain: `case-${index}.invalid`,
      brandProfileIds: [PROFILE_ID],
      assertions: Array.from({ length: 50 }, (_, assertionIndex) => ({
        ...template.assertions[0],
        id: `assertion-${index}-${assertionIndex}`,
        statement: `Assertion ${index}-${assertionIndex}`,
      })),
    } as CaseRecord));
    const domains = cases.map((item) => item.domain);
    const relationshipGroups = Array.from({ length: 250 }, (_, index) => group(
      'certificate', `certificate-${index}`, [cases[0]!, cases[1]!],
    ));
    const review = buildCampaignCohortReview({
      domains,
      cases,
      profiles: Array.from({ length: 150 }, (_, index) => profile(index === 0 ? PROFILE_ID : `profile-${index}`, `Profile ${index}`)),
      relationshipSummary: summary(relationshipGroups, true),
      selectedBrandProfileId: PROFILE_ID,
    });
    assert.equal(review.memberCount, MAX_CAMPAIGN_COHORT_MEMBERS);
    assert.ok(review.omissions.campaignMembers > 0);
    assert.ok(review.omissions.caseInputs > 0);
    assert.ok(review.omissions.profileInputs > 0);
    assert.ok(review.omissions.relationshipGroups > 0);
    assert.ok(review.omissions.rationales > 0);
    assert.ok(review.omissions.assertions > 0);
    assert.equal(review.truncated, true);
  });
});
