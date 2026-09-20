import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TECHNOLOGY_PROFILE_VERSION } from '../lib/lookup-child-profile-contract.mts';
import { resolveProviderReportingRoutes } from '../frontend/src/lib/analysis/provider-reporting-routes.ts';

const OBSERVED_AT = '2026-09-04T02:00:00.000Z';

function profile(findings: Record<string, unknown>[]) {
  return {
    version: 1, scanMode: 'deep', durationMs: null, complete: true, truncated: false, limitations: [], diagnostics: {},
    profileVersion: TECHNOLOGY_PROFILE_VERSION,
    source: 'derived',
    status: 'success',
    observedAt: OBSERVED_AT,
    findings: findings.map(finding => ({
      name: 'Retained provider indicator', category: 'delivery platform',
      evidence: Array.isArray(finding.roles) ? finding.roles.map(role => ({ source: 'passive response header', role, description: 'Retained response-header indicator' })) : [],
      ...finding,
    })),
    browserLibraryProfile: null,
  };
}

describe('provider reporting-route catalogue', () => {
  test('separates application-platform and observed-edge matches', () => {
    const result = resolveProviderReportingRoutes(profile([
      { id: 'netlify', confidence: 'medium', roles: ['application_platform'] },
      { id: 'cloudflare', confidence: 'high', roles: ['observed_edge'] },
    ]), new Date('2026-09-05T00:00:00.000Z'));

    assert.deepEqual(result.routes.map((route) => [route.providerId, route.role]), [
      ['netlify', 'application_platform'],
      ['cloudflare', 'observed_edge'],
    ]);
    assert.equal(result.routes[0]?.observedAt, OBSERVED_AT);
    assert.match(result.routes[1]?.limitations.join(' ') ?? '', /does not identify the origin host/u);
  });

  test('does not match a provider name with the wrong or embedded role', () => {
    const result = resolveProviderReportingRoutes(profile([
      { id: 'netlify', confidence: 'medium', roles: ['observed_edge'] },
      { id: 'cloudflare', confidence: 'high', roles: ['embedded_dependency'] },
      { id: 'vercel', confidence: 'medium', roles: ['framework_runtime'] },
    ]), new Date('2026-09-05T00:00:00.000Z'));
    assert.equal(result.routes.length, 0);
  });

  test('withholds an expired catalogue route and reports the stale state', () => {
    const result = resolveProviderReportingRoutes(profile([
      { id: 'fastly', confidence: 'medium', roles: ['observed_edge'] },
    ]), new Date('2027-03-04T00:00:00.000Z'));
    assert.equal(result.routes.length, 0);
    assert.equal(result.coverage.find((item) => item.role === 'observed_edge')?.state, 'stale');
  });

  test('retains published profile evidence without accepting unknown detector versions', () => {
    const observed = profile([{ id: 'netlify', confidence: 'medium', roles: ['application_platform'] }]);
    for (const profileVersion of [11, TECHNOLOGY_PROFILE_VERSION]) {
      const result = resolveProviderReportingRoutes({ ...observed, profileVersion }, new Date('2026-09-05T00:00:00.000Z'));
      assert.deepEqual(result.routes.map((route) => route.providerId), ['netlify']);
      assert.equal(result.routes[0]?.observedAt, OBSERVED_AT);
    }
    const legacy = { ...observed, profileVersion: 10, findings: [{ id: 'netlify', name: 'Retained provider indicator',
      category: 'delivery platform', confidence: 'medium', evidence: [{ source: 'resource origin', description: 'Retained resource indicator' }] }] };
    assert.equal(resolveProviderReportingRoutes(legacy, new Date('2026-09-05T00:00:00Z')).routes.length, 0,
      'a supported historical profile without attributed roles cannot authorise a provider route');
    assert.equal(resolveProviderReportingRoutes({ ...observed, profileVersion: 10 }, new Date('2026-09-05T00:00:00Z')).routes.length, 0,
      'role fields cannot be injected into a historical contract that did not declare them');
    for (const profileVersion of [9, TECHNOLOGY_PROFILE_VERSION + 1, '11', null]) {
      const result = resolveProviderReportingRoutes({ ...observed, profileVersion }, new Date('2026-09-05T00:00:00.000Z'));
      assert.equal(result.routes.length, 0);
      assert.equal(result.coverage.every((item) => item.state === 'unavailable'), true);
    }
  });

  test('ignores malformed and unattributed technology profiles', () => {
    for (const value of [
      null,
      profile([{ id: 'netlify', confidence: 'medium', roles: 'application_platform' }]),
      { ...profile([]), source: 'imported' },
      { ...profile([]), observedAt: 'not-a-time' },
    ]) {
      const result = resolveProviderReportingRoutes(value, new Date('2026-09-05T00:00:00.000Z'));
      assert.equal(result.routes.length, 0);
    }
  });

  test('distinguishes an absent source from present evidence that cannot be interpreted', () => {
    const now = new Date('2026-09-05T00:00:00Z');
    assert.ok(resolveProviderReportingRoutes(null, now).coverage.every((item) => item.state === 'not_collected'));
    for (const value of [{}, { ...profile([]), source: 'imported' }, { ...profile([]), status: 'error' }]) {
      assert.ok(resolveProviderReportingRoutes(value, now).coverage.every((item) => item.state === 'unavailable'));
    }
  });

  test('source and evaluation clocks must be explicit, calendar-valid and temporally possible', () => {
    const observed = profile([{ id: 'netlify', confidence: 'medium', roles: ['application_platform'] }]);
    for (const observedAt of ['', '2026-09-04', '2026-02-29T00:00:00Z', '2026-09-06T00:00:00Z']) {
      const result = resolveProviderReportingRoutes({ ...observed, observedAt }, new Date('2026-09-05T00:00:00Z'));
      assert.equal(result.routes.length, 0, observedAt);
      assert.ok(result.coverage.every((item) => item.state === 'unavailable'));
    }
    for (const now of [new Date('invalid'), new Date('+010000-01-01T00:00:00Z')]) {
      const result = resolveProviderReportingRoutes(observed, now);
      assert.equal(result.routes.length, 0);
      assert.ok(result.coverage.every((item) => item.state === 'unavailable'));
    }
    const nonCanonical = resolveProviderReportingRoutes({ ...observed, observedAt: '2026-09-04T12:00:00+10:00' }, new Date(OBSERVED_AT));
    assert.equal(nonCanonical.routes.length, 0, 'retained profiles require canonical observation timestamps');
    const exact = resolveProviderReportingRoutes(observed, new Date(OBSERVED_AT));
    assert.equal(exact.routes.length, 1);
    assert.equal(exact.routes[0]?.observedAt, OBSERVED_AT);
  });

  test('catalogue review start and expiry remain independent of retained technology observation time', () => {
    const observed = { ...profile([{ id: 'netlify', confidence: 'medium', roles: ['application_platform'] }]), observedAt: '2026-09-01T00:00:00.000Z' };
    const before = resolveProviderReportingRoutes(observed, new Date('2026-09-03T23:59:59.999Z'));
    assert.equal(before.routes.length, 0);
    assert.equal(before.coverage[0]?.state, 'unavailable');
    assert.equal(resolveProviderReportingRoutes(observed, new Date('2026-09-04T00:00:00Z')).routes.length, 1);
    assert.equal(resolveProviderReportingRoutes(observed, new Date('2027-03-03T23:59:59.999Z')).routes.length, 1);
    const expired = resolveProviderReportingRoutes({ ...observed, observedAt: '2027-03-04T00:00:00.000Z' }, new Date('2027-03-04T00:00:00Z'));
    assert.equal(expired.routes.length, 0);
    assert.equal(expired.coverage[0]?.state, 'stale');
  });

  test('duplicate provider findings cannot select an arbitrary role or confidence', () => {
    const findings = [
      { id: 'netlify', confidence: 'medium', roles: ['application_platform'] },
      { id: 'netlify', confidence: 'high', roles: ['embedded_dependency'] },
    ];
    for (const values of [findings, [...findings].reverse()]) {
      const result = resolveProviderReportingRoutes(profile(values), new Date('2026-09-05T00:00:00Z'));
      assert.equal(result.routes.length, 0);
      assert.ok(result.coverage.every((item) => item.state === 'unavailable'));
    }
  });

  test('route admission requires the complete attributed profile, not just a provider identifier', () => {
    const valid = profile([{ id: 'netlify', confidence: 'medium', roles: ['application_platform'] }]);
    const now = new Date('2026-09-05T00:00:00Z');
    assert.equal(resolveProviderReportingRoutes(valid, now).routes.length, 1);
    const mutations: Record<string, unknown>[] = [
      { version: 99 }, { scanMode: 'fast' }, { durationMs: -1 }, { complete: false }, { truncated: true },
      { diagnostics: { unsafe: { raw: 'unretained input' } } }, { limitations: 'not an array' }, { browserLibraryProfile: undefined },
      { findings: [{ ...valid.findings[0], evidence: [] }] },
      { findings: [{ ...valid.findings[0], evidence: [{ source: 'unknown', role: 'application_platform', description: 'Unsupported source' }] }] },
      { findings: [{ ...valid.findings[0], evidence: [{ source: 'resource origin', role: 'embedded_dependency', description: 'An embedded asset is not an application platform' }] }] },
      { findings: [{ ...valid.findings[0], roles: ['application_platform', 'application_platform'] }] },
      { findings: [{ ...valid.findings[0], name: '' }] },
      { findings: Array.from({ length: 25 }, (_, index) => ({ ...valid.findings[0], id: `indicator-${index}` })) },
    ];
    for (const mutation of mutations) {
      const result = resolveProviderReportingRoutes({ ...valid, ...mutation }, now);
      assert.deepEqual(result.routes, [], JSON.stringify(mutation));
      assert.ok(result.coverage.every(item => item.state === 'unavailable'));
    }
    const partial = resolveProviderReportingRoutes({ ...valid, status: 'partial', complete: false, truncated: true,
      limitations: ['Other bounded signals were not retained'] }, now);
    assert.equal(partial.routes.length, 1, 'a valid retained finding remains usable within a partial profile');
  });
});
