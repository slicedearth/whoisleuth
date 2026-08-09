import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_BRAND_REVIEW_CASES,
  MAX_BRAND_REVIEW_PROFILES,
  MAX_BRAND_REVIEW_ROWS,
  MAX_UNRESOLVED_BRAND_PROFILE_REFERENCES,
  brandProfileDeletionImpact,
  buildBrandReviewInbox,
} from '../frontend/src/lib/analysis/brand-review-inbox.ts';
import { normalizeBrandProfile, type BrandProfile } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import { normalizeCase, type CaseRecord } from '../frontend/src/lib/analysis/case-model.ts';
import { requiredValue } from './value-assertions.mts';

const NOW = '2026-08-08T08:00:00.000Z';

function profile(id: string, name = id, officialDomains: string[] = []): BrandProfile {
  return requiredValue(normalizeBrandProfile({ id, name, officialDomains }, { nowIso: NOW }));
}

function caseRecord(
  id: string,
  domain: string,
  brandProfileIds: string[],
  overrides: Record<string, unknown> = {},
): CaseRecord {
  return requiredValue(normalizeCase({
    id,
    domain,
    status: 'reviewing',
    disposition: 'unreviewed',
    brandProfileIds,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }, undefined, NOW));
}

describe('transient Brand review inbox', () => {
  test('keys existing source-aware review rows to the active explicit association only', () => {
    const active = profile('profile-active', 'Active profile', ['matching.invalid']);
    const other = profile('profile-other', 'Other profile');
    const linked = caseRecord('case-linked', 'unrelated.invalid', [active.id]);
    const nameMatchOnly = caseRecord('case-name-match', 'matching.invalid', []);
    const otherLinked = caseRecord('case-other', 'other.invalid', [other.id]);
    const inbox = buildBrandReviewInbox({
      cases: [linked, nameMatchOnly, otherLinked],
      profiles: [active, other],
      activeProfileId: active.id,
    }, NOW);

    assert.deepEqual(inbox.activeProfile, { id: active.id, name: active.name });
    assert.equal(inbox.associatedCaseCount, 1);
    assert.deepEqual(inbox.items.map((item) => item.caseId), ['case-linked']);
    assert.equal(inbox.items[0]?.source, 'Browser-local case');
    assert.equal(inbox.items[0]?.completeness, 'inconclusive');
    assert.equal(inbox.items[0]?.brandProfileId, active.id);
    assert.match(inbox.items[0]?.href ?? '', /case=case-linked/u);
    assert.equal(inbox.items.some((item) => item.caseId === 'case-name-match'), false);
    assert.match(inbox.limitations.join(' '), /never used to infer a Case association/iu);
  });

  test('derives review rows after association scoping so unrelated global saturation cannot hide an urgent action', () => {
    const active = profile('profile-scoped', 'Scoped profile');
    const action = (id: string, dueAt: string) => ({
      id,
      type: 'network_hosting_report',
      recipient: 'Reserved fixture recipient',
      contactSource: 'manual',
      contactLimitations: [],
      dueAt,
      state: 'planned',
      reference: null,
      followUpAt: null,
      outcome: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const unrelated = Array.from({ length: 250 }, (_, index) => caseRecord(
      `unrelated-${index}`,
      `unrelated-${index}.invalid`,
      [],
      {
        disposition: 'suspicious',
        actions: [action(`unrelated-action-${index}-a`, '2026-08-01T00:00:00.000Z'), action(`unrelated-action-${index}-b`, '2026-08-01T00:00:00.000Z')],
      },
    ));
    const associated = caseRecord('associated-action', 'associated-action.invalid', [active.id], {
      disposition: 'suspicious',
      actions: [action('associated-urgent', NOW)],
    });

    const inbox = buildBrandReviewInbox({
      cases: [...unrelated, associated],
      profiles: [active],
      activeProfileId: active.id,
    }, NOW);

    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0]?.id, 'action:associated-action:associated-urgent');
    assert.equal(inbox.items[0]?.priority, 'urgent');
    assert.equal(inbox.items[0]?.kind, 'case_action');
  });

  test('preserves limited source provenance and limitations from the analyst inbox', () => {
    const active = profile('profile-source', 'Source review');
    const linked = caseRecord('case-source', 'source-review.invalid', [active.id], {
      disposition: 'suspicious',
      evidencePins: [{
        id: 'pin-source',
        checkpointId: null,
        field: 'whois.registrar',
        category: 'registration',
        label: 'WHOIS registrar',
        value: 'Unavailable',
        source: 'whois',
        sourceState: 'partial',
        sourceSchema: null,
        observedAt: NOW,
        collectionDepth: 'deep',
        completeness: 'partial',
        truncated: false,
        transitionExpectation: null,
        limitations: ['The source did not answer completely.'],
        createdAt: NOW,
      }],
    });
    const inbox = buildBrandReviewInbox({ cases: [linked], profiles: [active], activeProfileId: active.id }, NOW);
    const gap = inbox.items.find((item) => item.kind === 'evidence_gap');
    assert.ok(gap);
    assert.deepEqual(gap.sourceIds, ['whois']);
    assert.equal(gap.completeness, 'partial');
    assert.match(gap.detail, /limited evidence pin/iu);
    assert.match(inbox.limitations.join(' '), /Partial and inconclusive source states remain review prompts/iu);
  });

  test('retains and reports unresolved references after a profile disappears without changing the case', () => {
    const removed = profile('profile-removed', 'Removed profile');
    const linked = caseRecord('case-unresolved', 'unresolved.invalid', [removed.id]);
    const before = structuredClone(linked.brandProfileIds);
    const resolved = buildBrandReviewInbox({ cases: [linked], profiles: [removed], activeProfileId: removed.id }, NOW);
    assert.deepEqual(resolved.unresolvedReferences, []);

    const unresolved = buildBrandReviewInbox({ cases: [linked], profiles: [], activeProfileId: removed.id }, NOW);
    assert.deepEqual(linked.brandProfileIds, before);
    assert.equal(unresolved.activeProfile, null);
    assert.deepEqual(unresolved.unresolvedReferences[0], {
      id: 'case-unresolved:profile-removed',
      brandProfileId: 'profile-removed',
      caseId: 'case-unresolved',
      caseDomain: 'unresolved.invalid',
      href: '/monitor?view=cases&case=case-unresolved',
    });
  });

  test('enforces case, profile, review-row, and unresolved-reference inspection bounds', () => {
    const profiles = Array.from({ length: MAX_BRAND_REVIEW_PROFILES + 1 }, (_, index) => profile(`profile-${index}`));
    const cases = Array.from({ length: MAX_BRAND_REVIEW_CASES + 1 }, (_, index) => (
      caseRecord(`case-${index}`, `case-${index}.invalid`, ['profile-0'])
    ));
    const bounded = buildBrandReviewInbox({ cases, profiles, activeProfileId: 'profile-0' }, NOW);
    assert.equal(bounded.items.length, MAX_BRAND_REVIEW_ROWS);
    assert.equal(bounded.associatedCaseCount, MAX_BRAND_REVIEW_CASES);
    assert.equal(bounded.truncated, true);

    const unresolvedCases = Array.from({ length: 13 }, (_, caseIndex) => caseRecord(
      `unresolved-case-${caseIndex}`,
      `unresolved-${caseIndex}.invalid`,
      Array.from({ length: 8 }, (_, refIndex) => `missing-${caseIndex}-${refIndex}`),
    ));
    const unresolved = buildBrandReviewInbox({ cases: unresolvedCases, profiles: [] }, NOW);
    assert.equal(unresolved.unresolvedReferences.length, MAX_UNRESOLVED_BRAND_PROFILE_REFERENCES);
    assert.equal(unresolved.truncated, true);
  });

  test('keeps loading and unavailable local sources explicit instead of claiming an empty inbox', () => {
    const loading = buildBrandReviewInbox({
      cases: [],
      profiles: [],
      sourceStates: { cases: 'loading', profiles: 'loading' },
    }, NOW);
    assert.deepEqual(loading.sources, { cases: 'loading', profiles: 'loading', activePreference: 'ready' });
    const unavailable = buildBrandReviewInbox({
      cases: [],
      profiles: [],
      sourceStates: { cases: 'unavailable', profiles: 'ready' },
    }, NOW);
    assert.deepEqual(unavailable.sources, { cases: 'unavailable', profiles: 'ready', activePreference: 'ready' });
    assert.deepEqual(unavailable.items, []);
    assert.deepEqual(unavailable.unresolvedReferences, []);

    const preferenceUnavailable = buildBrandReviewInbox({
      cases: [caseRecord('case-preference', 'preference.invalid', ['profile-preference'])],
      profiles: [profile('profile-preference')],
      activeProfileId: 'profile-preference',
      sourceStates: { cases: 'loading', profiles: 'ready', activePreference: 'unavailable' },
    }, NOW);
    assert.deepEqual(preferenceUnavailable.sources, { cases: 'loading', profiles: 'ready', activePreference: 'unavailable' });
    assert.equal(preferenceUnavailable.activeProfile, null);
    assert.deepEqual(preferenceUnavailable.items, []);
  });

  test('discloses exact loaded deletion impact and preserves uncertainty after a failed Case read', () => {
    const linked = caseRecord('case-impact', 'impact.invalid', ['profile-impact']);
    const other = caseRecord('case-other-impact', 'other-impact.invalid', []);
    assert.equal(
      brandProfileDeletionImpact([linked, other], 'profile-impact', 'ready'),
      '1 linked case will retain this identifier and appear unresolved after deletion.',
    );
    assert.equal(
      brandProfileDeletionImpact([], 'profile-impact', 'unavailable'),
      'Linked-case impact cannot be checked because cases could not be read. Any retained associations will remain unchanged.',
    );
  });
});
