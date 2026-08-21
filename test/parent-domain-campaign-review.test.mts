import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildParentDomainCampaignReview,
  buildParentDomainCampaignReviewExport,
  MAX_PARENT_DOMAIN_CAMPAIGN_REVIEW_BYTES,
  MAX_PARENT_DOMAIN_HOSTNAMES,
  MAX_PARENT_DOMAIN_LIMITATIONS,
  MAX_PARENT_DOMAIN_OBSERVATIONS,
  MAX_PARENT_DOMAIN_PARENTS,
  MAX_PARENT_DOMAIN_PROVENANCE_PER_HOSTNAME,
  MAX_PARENT_DOMAIN_SOURCE_RECORDS,
  serializeParentDomainCampaignReviewExport,
  validateParentDomainCampaignReviewExport,
} from '../frontend/src/lib/analysis/parent-domain-campaign-review.ts';
import {
  createCase,
  updateCase,
  type CaseRecord,
} from '../frontend/src/lib/analysis/case-model.ts';

const FIRST = '2026-08-01T00:00:00.000Z';

function evidence(hostname: string, ordinal = 1) {
  return {
    inputHostname: hostname,
    scanDepth: 'deep',
    availability: 'registered',
    confidence: 'high',
    riskModelVersion: 1,
    riskScore: ordinal,
  };
}

function caseWithHostnames(domain: string, hostnames: readonly string[], id = `case-${domain.replaceAll('.', '-')}`): CaseRecord {
  if (!hostnames.length) {
    return { ...createCase({ domain, source: 'manual' }, FIRST), id };
  }
  let record = { ...createCase({ domain, source: 'lookup', evidence: evidence(hostnames[0] ?? domain, 1) }, FIRST), id };
  let records = [record];
  for (let index = 1; index < hostnames.length; index += 1) {
    record = updateCase(records, id, {
      source: 'lookup',
      evidence: evidence(hostnames[index] ?? domain, index + 1),
    }, `2026-08-${String(Math.min(28, index + 1)).padStart(2, '0')}T00:00:00.000Z`).record;
    records = [record];
  }
  return record;
}

function campaign(domains: readonly string[], id = 'campaign-parent-scope') {
  return { id, name: 'Reserved parent scope', description: '', domains: [...domains], createdAt: FIRST, updatedAt: FIRST };
}

describe('bounded parent-domain campaign review', () => {
  test('groups two exact child hostnames retained on one Case with full provenance', () => {
    const record = caseWithHostnames('example.test', ['login.example.test', 'account.example.test']);
    const review = buildParentDomainCampaignReview(campaign(['example.test']), [record]);
    assert.equal(review.state, 'ready');
    assert.equal(review.parents.length, 1);
    const parent = review.parents[0];
    assert.equal(parent?.registrableParent, 'example.test');
    assert.equal(parent?.childHostnameCount, 2);
    assert.deepEqual(parent?.hostnames.map((item) => item.hostname), ['account.example.test', 'login.example.test']);
    assert.deepEqual(parent?.affectedCaseIds, [record.id]);
    assert.ok(parent?.hostnames.every((item) => item.observations.every((item) => (
      item.store === 'browser_case_evidence_snapshot'
      && item.campaignMemberDomain === 'example.test'
      && item.schemaVersion === 14
      && item.observationTime !== null
      && item.scanDepth === 'deep'
    ))));
  });

  test('qualifies parent apex plus child, but duplicate apex observations alone remain insufficient', () => {
    const apexAndChild = caseWithHostnames('example.test', ['example.test', 'login.example.test']);
    const grouped = buildParentDomainCampaignReview(campaign(['example.test']), [apexAndChild]);
    assert.equal(grouped.state, 'ready');
    assert.deepEqual(grouped.parents[0]?.hostnames.map((item) => item.kind), ['apex', 'child']);

    const duplicateApex = caseWithHostnames('example.test', ['example.test', 'example.test']);
    const insufficient = buildParentDomainCampaignReview(campaign(['example.test']), [duplicateApex]);
    assert.equal(insufficient.state, 'insufficient_evidence');
    assert.equal(insufficient.parents.length, 0);
    assert.match(insufficient.limitations.join(' '), /not proof that no child hostname exists/iu);
  });

  test('groups direct child Case targets across multiple exact campaign members using local retention time only', () => {
    const first = caseWithHostnames('one.example.test', [], 'case-one');
    const second = caseWithHostnames('two.example.test', [], 'case-two');
    const review = buildParentDomainCampaignReview(campaign([first.domain, second.domain]), [second, first]);
    assert.equal(review.state, 'ready');
    assert.deepEqual(review.parents[0]?.affectedCaseIds, ['case-one', 'case-two']);
    for (const hostname of review.parents[0]?.hostnames ?? []) {
      assert.equal(hostname.observations[0]?.store, 'browser_case_record');
      assert.equal(hostname.observations[0]?.observationTime, null);
      assert.equal(hostname.observations[0]?.localRetentionTime, FIRST);
    }
  });

  test('uses established ICANN public-suffix semantics and keeps private suffixes as host context', () => {
    const publicSuffix = caseWithHostnames('example.co.uk', ['one.example.co.uk', 'two.example.co.uk']);
    const privateSuffix = caseWithHostnames('github.io', ['one.example.github.io', 'two.example.github.io']);
    const review = buildParentDomainCampaignReview(
      campaign(['example.co.uk', 'github.io']),
      [publicSuffix, privateSuffix],
    );
    assert.deepEqual(review.parents.map((item) => item.registrableParent), ['example.co.uk', 'github.io']);
  });

  test('does not derive hostnames from certificate, DNS, HTTP, page, tracking, pins, assertions, or arbitrary text', () => {
    const base = caseWithHostnames('example.test', []);
    const record = {
      ...base,
      notes: [{ id: 'note-private', body: 'login.example.test', createdAt: FIRST }],
      tags: ['account.example.test'],
      evidencePins: [{
        id: 'pin-1', checkpointId: null, field: 'certificate.names', category: 'certificate', label: 'Names',
        value: 'one.example.test, two.example.test', source: 'Certificate', sourceState: 'complete', sourceSchema: null,
        observedAt: FIRST, collectionDepth: 'deep', completeness: 'complete', truncated: false,
        transitionExpectation: 'preserve', limitations: [], createdAt: FIRST, certificateObservation: null,
      }],
      assertions: [{
        id: 'assertion-1', kind: 'hypothesis', statement: 'three.example.test', rationale: null,
        evidencePinIds: [], evidenceRelations: [], state: 'open', createdAt: FIRST, updatedAt: FIRST,
      }],
      evidenceHistory: [{
        ...caseWithHostnames('example.test', ['example.test']).evidenceHistory[0]!,
        inputHostname: null,
        nameservers: ['ns.one.example.test'],
        httpFinalOrigin: 'https://redirect.example.test',
        pageTitle: 'four.example.test',
      }],
    } satisfies CaseRecord;
    const review = buildParentDomainCampaignReview(campaign(['example.test']), [record]);
    assert.equal(review.state, 'insufficient_evidence');
    assert.equal(review.counts.acceptedObservations, 0);
  });

  test('preserves loading, unavailable, unsupported, future-schema, partial, and insufficient states', () => {
    const record = caseWithHostnames('example.test', ['one.example.test', 'two.example.test']);
    for (const state of ['loading', 'unavailable', 'unsupported', 'future_schema'] as const) {
      const review = buildParentDomainCampaignReview(campaign(['example.test']), [record], state);
      assert.equal(review.state, state);
      assert.equal(review.parents.length, 0);
    }
    assert.equal(buildParentDomainCampaignReview(campaign(['example.test']), [record], 'partial').state, 'partial');
    assert.equal(buildParentDomainCampaignReview(campaign(['example.test']), [], 'ready').state, 'insufficient_evidence');
  });

  test('sorts deterministically and does not mutate source containers', () => {
    const first = caseWithHostnames('example.test', ['z.example.test', 'a.example.test']);
    const second = caseWithHostnames('other.test', ['b.other.test', 'a.other.test']);
    const records = [second, first];
    const before = structuredClone(records);
    const left = buildParentDomainCampaignReview(campaign(['other.test', 'example.test']), records);
    const right = buildParentDomainCampaignReview(campaign(['example.test', 'other.test']), [...records].reverse());
    assert.deepEqual(left, right);
    assert.deepEqual(records, before);
    assert.deepEqual(left.parents.map((item) => item.registrableParent), ['example.test', 'other.test']);
  });

  test('uses locale-independent code-unit ordering for portable review content', () => {
    const records = [
      caseWithHostnames('example.test', ['z.example.test', 'a.example.test']),
      caseWithHostnames('other.test', ['b.other.test', 'a.other.test']),
    ];
    const originalLocaleCompare = String.prototype.localeCompare;
    Object.defineProperty(String.prototype, 'localeCompare', {
      configurable: true,
      value: () => { throw new Error('localeCompare was consulted'); },
      writable: true,
    });
    try {
      const review = buildParentDomainCampaignReview(campaign(['other.test', 'example.test']), records);
      const portable = buildParentDomainCampaignReviewExport(
        campaign(['other.test', 'example.test']),
        review,
        FIRST,
      );
      assert.deepEqual(review.parents.map((item) => item.registrableParent), ['example.test', 'other.test']);
      assert.doesNotThrow(() => validateParentDomainCampaignReviewExport(portable));
    } finally {
      Object.defineProperty(String.prototype, 'localeCompare', {
        configurable: true,
        value: originalLocaleCompare,
        writable: true,
      });
    }
  });

  test('rejects hostile containers before traversal and leaves future-schema records untouched', () => {
    const hostile: unknown[] = new Array(1);
    Object.defineProperty(hostile, '0', { enumerable: true, get: () => { throw new Error('getter ran'); } });
    assert.throws(
      () => buildParentDomainCampaignReview(campaign(['example.test']), hostile, 'ready'),
      /accessor properties are not supported/iu,
    );
    assert.equal(
      buildParentDomainCampaignReview(campaign(['example.test']), hostile, 'future_schema').state,
      'future_schema',
    );
  });

  test('applies every collection cap before accumulation and exposes exact omitted counts', () => {
    const memberDomains = Array.from({ length: 51 }, (_, index) => `member-${index}.test`);
    const memberBound = buildParentDomainCampaignReview(campaign(memberDomains), []);
    assert.equal(memberBound.omissions.campaignMembers, 1);

    const sourceBound = buildParentDomainCampaignReview(campaign([]), Array.from({ length: MAX_PARENT_DOMAIN_SOURCE_RECORDS + 1 }, () => ({})));
    assert.equal(sourceBound.omissions.sourceRecords, 1);

    const duplicate = caseWithHostnames('example.test', ['one.example.test', 'two.example.test']);
    const duplicateBound = buildParentDomainCampaignReview(campaign(['example.test']), [duplicate, { ...duplicate, id: 'case-duplicate' }]);
    assert.equal(duplicateBound.omissions.caseRecords, 1);

    const snapshotOverflow = { ...duplicate, evidenceHistory: Array.from({ length: 26 }, (_, index) => ({
      ...duplicate.evidenceHistory[index % duplicate.evidenceHistory.length]!,
      id: `snapshot-overflow-${index}`,
    })) };
    const snapshotBound = buildParentDomainCampaignReview(campaign(['example.test']), [snapshotOverflow]);
    assert.equal(snapshotBound.omissions.snapshotRecords, 1);

    const observationCases = Array.from({ length: 13 }, (_, caseIndex) => {
      const parent = `observed-${caseIndex}.test`;
      return caseWithHostnames(parent, Array.from({ length: 25 }, (_, hostIndex) => `host-${hostIndex}.${parent}`));
    });
    const observationBound = buildParentDomainCampaignReview(campaign(observationCases.map((item) => item.domain)), observationCases);
    assert.equal(observationBound.counts.acceptedObservations, MAX_PARENT_DOMAIN_OBSERVATIONS);
    assert.equal(observationBound.omissions.observations, 25);
    assert.equal(observationBound.counts.distinctHostnames, MAX_PARENT_DOMAIN_HOSTNAMES);
    assert.equal(observationBound.omissions.hostnames, 100);
    assert.equal(observationBound.parents.length, 12);
    assert.equal(observationBound.omissions.parents, 0);

    const parentCases = Array.from({ length: MAX_PARENT_DOMAIN_PARENTS + 1 }, (_, index) => {
      const parent = `parent-${index}.test`;
      return caseWithHostnames(parent, [`one.${parent}`, `two.${parent}`]);
    });
    const parentBound = buildParentDomainCampaignReview(campaign(parentCases.map((item) => item.domain)), parentCases);
    assert.equal(parentBound.parents.length, MAX_PARENT_DOMAIN_PARENTS);
    assert.equal(parentBound.omissions.parents, 1);
    assert.equal(parentBound.omissions.hostnames, 2);

    const sharedBase = caseWithHostnames('example.test', ['shared.example.test']);
    const provenanceCases = Array.from({ length: MAX_PARENT_DOMAIN_PROVENANCE_PER_HOSTNAME + 1 }, (_, index) => ({
      ...sharedBase,
      id: `case-shared-${index}`,
      domain: `member-${index}.example.test`,
    }));
    const provenanceBound = buildParentDomainCampaignReview(campaign(provenanceCases.map((item) => item.domain)), provenanceCases);
    const shared = provenanceBound.parents[0]?.hostnames.find((item) => item.hostname === 'shared.example.test');
    assert.equal(shared?.observations.length, MAX_PARENT_DOMAIN_PROVENANCE_PER_HOSTNAME);
    assert.equal(provenanceBound.omissions.provenance, 1);

    const limitationCases = structuredClone(observationCases) as CaseRecord[];
    limitationCases[0]!.evidenceHistory = [...limitationCases[0]!.evidenceHistory, limitationCases[0]!.evidenceHistory[0]!];
    limitationCases[0]!.evidenceHistory[0]!.inputHostname = null;
    limitationCases[0]!.evidenceHistory[1]!.inputHostname = 'mismatch.other.test';
    const limitationCampaign = campaign([...limitationCases.map((item) => item.domain), 'missing-member.test']);
    const limitationBound = buildParentDomainCampaignReview(limitationCampaign, limitationCases, 'partial');
    assert.equal(limitationBound.limitations.length, MAX_PARENT_DOMAIN_LIMITATIONS);
    assert.ok(limitationBound.omissions.limitations > 0);
  });
});

describe('parent-domain campaign review export', () => {
  test('is deterministic at a fixed time, validates its schema, and excludes private Case fields and transient selection', () => {
    const record = caseWithHostnames('example.test', ['one.example.test', 'two.example.test']);
    const privateRecord = {
      ...record,
      notes: [{ id: 'note-private', body: 'PRIVATE-NOTE-CONTENT', createdAt: FIRST }],
      tags: ['PRIVATE-TAG-CONTENT'],
    };
    const sourceCampaign = campaign(['example.test']);
    const review = buildParentDomainCampaignReview(sourceCampaign, [privateRecord]);
    const left = buildParentDomainCampaignReviewExport(sourceCampaign, review, FIRST);
    const right = buildParentDomainCampaignReviewExport(sourceCampaign, review, FIRST);
    assert.deepEqual(left, right);
    validateParentDomainCampaignReviewExport(left);
    const serialized = serializeParentDomainCampaignReviewExport(left);
    assert.equal(serialized, serializeParentDomainCampaignReviewExport(right));
    assert.equal(serialized.includes('PRIVATE-NOTE-CONTENT'), false);
    assert.equal(serialized.includes('PRIVATE-TAG-CONTENT'), false);
    assert.equal(serialized.includes('selected'), false);
    assert.match(serialized, /one\.example\.test/u);
    assert.match(serialized, /two\.example\.test/u);
  });

  test('rejects future and undeclared roots and enforces the byte ceiling before download', () => {
    const sourceCampaign = campaign(['example.test']);
    const review = buildParentDomainCampaignReview(sourceCampaign, [caseWithHostnames('example.test', ['one.example.test', 'two.example.test'])]);
    const document = buildParentDomainCampaignReviewExport(sourceCampaign, review, FIRST);
    assert.throws(() => validateParentDomainCampaignReviewExport({ ...document, version: 2 }), /unsupported/iu);
    assert.throws(() => validateParentDomainCampaignReviewExport({ ...document, extra: true }), /undeclared/iu);
    const nestedPrivateField = structuredClone(document) as unknown as Record<string, unknown>;
    const nestedReview = nestedPrivateField.review as { parents: Array<{ hostnames: Array<{ observations: Array<Record<string, unknown>> }> }> };
    nestedReview.parents[0]!.hostnames[0]!.observations[0]!.notes = ['Private note'];
    assert.throws(() => validateParentDomainCampaignReviewExport(nestedPrivateField), /undeclared/iu);
    const overObservationCap = structuredClone(document) as unknown as {
      review: { counts: { acceptedObservations: number } };
    };
    overObservationCap.review.counts.acceptedObservations = MAX_PARENT_DOMAIN_OBSERVATIONS + 1;
    assert.throws(() => validateParentDomainCampaignReviewExport(overObservationCap), /accepted observation count/iu);
    const inconsistentHostnameCount = structuredClone(document) as unknown as {
      review: { counts: { distinctHostnames: number } };
    };
    inconsistentHostnameCount.review.counts.distinctHostnames += 1;
    assert.throws(() => validateParentDomainCampaignReviewExport(inconsistentHostnameCount), /inconsistent/iu);
    const oversized = {
      ...document,
      review: { ...document.review, limitations: ['x'.repeat(MAX_PARENT_DOMAIN_CAMPAIGN_REVIEW_BYTES)] },
    };
    assert.throws(() => serializeParentDomainCampaignReviewExport(oversized), /exceeds.*byte limit/iu);
  });
});
