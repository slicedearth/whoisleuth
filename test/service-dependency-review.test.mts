import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildServiceDependencyReview } from '../frontend/src/lib/analysis/service-dependency-review.ts';

describe('service dependency review projection', () => {
  test('surfaces external and in-domain aliases without claiming a vulnerability', () => {
    const review = buildServiceDependencyReview({
      domain: 'example.test',
      dnsEvidence: {
        source: 'dns',
        complete: true,
        diagnostics: {
          cname: { status: 'success' },
          https: { status: 'success' },
          ns: { status: 'not_found' },
          mx: { status: 'not_found' },
        },
      },
      dnsRecords: {
        cname: ['edge.external.test'],
        https: [{
          mode: 'alias',
          target: 'service.example.test',
          serviceUnavailable: false,
        }],
      },
    });

    assert.ok(review);
    assert.equal(review.state, 'observed');
    assert.equal(review.dependencies.length, 2);
    assert.equal(review.dependencies[0]?.relation, 'external');
    assert.equal(review.dependencies[1]?.relation, 'in_domain');
    assert.deepEqual(review.dependencies.map((item) => item.state), ['unsupported', 'unsupported']);
    assert.match(review.limitations.join(' '), /None establishes dangling status, vulnerability/u);
  });

  test('classifies reviewed scope and bounded service signatures without testing claimability', () => {
    const review = buildServiceDependencyReview({
      domain: 'example.test',
      authorizedScope: 'expected.service.test\nbad target\nEXPECTED.SERVICE.TEST.',
      signatures: [{
        id: 'fixture-hosting',
        label: 'Fixture hosting service',
        targetSuffixes: ['service.test'],
      }],
      dnsEvidence: {
        source: 'dns',
        complete: true,
        diagnostics: {
          cname: { status: 'success' },
          https: { status: 'not_found' },
          ns: { status: 'not_found' },
          mx: { status: 'not_found' },
        },
      },
      dnsRecords: {
        cname: ['tenant.expected.service.test', 'other.external.test'],
        https: [],
      },
    });

    assert.ok(review);
    assert.deepEqual(review.authorizedScope, ['expected.service.test']);
    assert.equal(review.dependencies[0]?.scope, 'authorized');
    assert.equal(review.dependencies[0]?.signatureId, 'fixture-hosting');
    assert.equal(review.dependencies[0]?.serviceFamily, 'Fixture hosting service');
    assert.equal(review.dependencies[0]?.state, 'candidate');
    assert.equal(review.dependencies[1]?.state, 'unsupported');
    assert.equal(review.dependencies[1]?.scope, 'outside');
    assert.doesNotMatch(JSON.stringify(review.dependencies), /claimable|vulnerable/iu);
    assert.match(review.limitations.join(' '), /local comparison aids only/u);
  });

  test('reports complete point-in-time non-observation without calling it safe', () => {
    const review = buildServiceDependencyReview({
      domain: 'example.test',
      dnsEvidence: {
        source: 'dns',
        complete: true,
        diagnostics: {
          cname: { status: 'not_found' },
          https: { status: 'not_found' },
          ns: { status: 'not_found' },
          mx: { status: 'not_found' },
        },
      },
      dnsRecords: { cname: [], https: [] },
    });

    assert.ok(review);
    assert.equal(review.state, 'not_observed');
    assert.match(review.label, /No alias dependency observed in this capture/u);
    assert.doesNotMatch(review.label, /safe/iu);
  });

  test('preserves resolver failure as unavailable', () => {
    const review = buildServiceDependencyReview({
      domain: 'example.test',
      dnsEvidence: {
        source: 'dns',
        complete: false,
        diagnostics: {
          cname: { status: 'error' },
        },
      },
      dnsRecords: { cname: [] },
    });

    assert.ok(review);
    assert.equal(review.state, 'unavailable');
    assert.match(review.nextSteps[0] ?? '', /Refresh complete DNS evidence/u);
  });

  test('keeps an omitted extended HTTPS query unavailable when no CNAME was observed', () => {
    const review = buildServiceDependencyReview({
      domain: 'example.test',
      dnsEvidence: {
        source: 'dns',
        complete: true,
        diagnostics: {
          cname: { status: 'not_found' },
        },
      },
      dnsRecords: { cname: [] },
    });

    assert.ok(review);
    assert.equal(review.state, 'unavailable');
  });

  test('rejects malformed targets and bounds dependency count', () => {
    const review = buildServiceDependencyReview({
      domain: 'EXAMPLE.TEST.',
      dnsEvidence: {
        source: 'dns',
        complete: true,
        diagnostics: { cname: { status: 'success' } },
      },
      dnsRecords: {
        cname: [
          'bad target',
          'duplicate.external.test',
          'DUPLICATE.EXTERNAL.TEST.',
          ...Array.from({ length: 30 }, (_, index) => `edge-${index}.external.test`),
        ],
      },
    });

    assert.ok(review);
    assert.equal(review.dependencies.length, 20);
    assert.equal(review.dependencies.filter((item) => item.target === 'duplicate.external.test').length, 1);
  });

  test('separates active, unresolved, unsupported, and reviewed false-positive states', () => {
    const review = buildServiceDependencyReview({
      domain: 'example.test',
      authorizedScope: ['active.service.test'],
      falsePositiveTargets: ['ignored.service.test'],
      signatures: [{
        id: 'fixture-hosting',
        label: 'Fixture hosting service',
        targetSuffixes: ['service.test'],
      }],
      dnsEvidence: {
        source: 'dns',
        complete: true,
        diagnostics: {
          cname: { status: 'success' },
          https: { status: 'not_found' },
          ns: { status: 'success' },
          mx: { status: 'success' },
        },
      },
      dnsRecords: {
        cname: ['active.service.test', 'unresolved.service.test', 'ignored.service.test'],
        https: [],
        ns: ['ns.external.test'],
        mx: [{ priority: 10, exchange: 'mail.external.test' }],
      },
      httpEvidence: {
        source: 'http',
        finalUrl: 'https://active.service.test/ignored/path?token=secret',
      },
    });

    assert.ok(review);
    assert.deepEqual(review.dependencies.map((item) => [item.recordType, item.target, item.state]), [
      ['CNAME', 'active.service.test', 'active'],
      ['CNAME', 'unresolved.service.test', 'unresolved'],
      ['CNAME', 'ignored.service.test', 'false_positive'],
      ['NS', 'ns.external.test', 'unsupported'],
      ['MX', 'mail.external.test', 'unsupported'],
      ['HTTP', 'active.service.test', 'active'],
    ]);
    assert.match(review.limitations.join(' '), /None establishes dangling status/u);
    assert.doesNotMatch(JSON.stringify(review), /token=secret/u);
  });

  test('qualifies exact passive deprovision cues, stale observations, and incomplete evidence conservatively', () => {
    const signature = [{
      id: 'fixture-hosting',
      label: 'Fixture hosting service',
      targetSuffixes: ['service.test'],
      reviewedAt: '2026-07-01',
      provenance: 'Reviewed fixture catalogue',
      deprovisionPageTitles: ['site not found'],
    }];
    const evidence = {
      source: 'dns',
      complete: true,
      diagnostics: {
        cname: { status: 'success' },
        https: { status: 'not_found' },
        ns: { status: 'not_found' },
        mx: { status: 'not_found' },
      },
    };
    const current = buildServiceDependencyReview({
      domain: 'example.test',
      authorizedScope: ['tenant.service.test'],
      signatures: signature,
      dnsEvidence: evidence,
      dnsRecords: { cname: ['tenant.service.test'], https: [], ns: [], mx: [] },
      pageTitle: ' Site   Not Found ',
      observedAt: '2026-07-29T08:00:00.000Z',
      now: '2026-07-30T08:00:00.000Z',
    });
    assert.equal(current?.dependencies[0]?.qualification, 'known_deprovision_pattern');
    assert.match(current?.dependencies[0]?.qualificationDetail ?? '', /manual verification cue/u);
    assert.equal(current?.dependencies[0]?.signatureReviewedAt, '2026-07-01');
    assert.equal(current?.dependencies[0]?.signatureProvenance, 'Reviewed fixture catalogue');

    const stale = buildServiceDependencyReview({
      domain: 'example.test',
      signatures: signature,
      dnsEvidence: evidence,
      dnsRecords: { cname: ['tenant.service.test'], https: [], ns: [], mx: [] },
      pageTitle: 'site not found',
      observedAt: '2026-05-01T08:00:00.000Z',
      now: '2026-07-30T08:00:00.000Z',
    });
    assert.equal(stale?.dependencies[0]?.qualification, 'stale_evidence');

    const incomplete = buildServiceDependencyReview({
      domain: 'example.test',
      signatures: signature,
      dnsEvidence: { ...evidence, complete: false },
      dnsRecords: { cname: ['tenant.service.test'], https: [], ns: [], mx: [] },
      pageTitle: 'site not found',
    });
    assert.equal(incomplete?.dependencies[0]?.qualification, 'inconclusive');
    assert.doesNotMatch(JSON.stringify(current), /claimable":true|vulnerable":true/u);
  });
});
