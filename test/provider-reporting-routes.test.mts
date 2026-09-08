import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TECHNOLOGY_PROFILE_VERSION } from '../lib/lookup-child-profile-contract.mts';
import { resolveProviderReportingRoutes } from '../frontend/src/lib/analysis/provider-reporting-routes.ts';

const OBSERVED_AT = '2026-09-04T02:00:00.000Z';

function profile(findings: unknown[]) {
  return {
    profileVersion: TECHNOLOGY_PROFILE_VERSION,
    source: 'derived',
    status: 'success',
    observedAt: OBSERVED_AT,
    findings,
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
    for (const profileVersion of [10, 11, TECHNOLOGY_PROFILE_VERSION]) {
      const result = resolveProviderReportingRoutes({ ...observed, profileVersion }, new Date('2026-09-05T00:00:00.000Z'));
      assert.deepEqual(result.routes.map((route) => route.providerId), ['netlify']);
      assert.equal(result.routes[0]?.observedAt, OBSERVED_AT);
    }
    for (const profileVersion of [9, TECHNOLOGY_PROFILE_VERSION + 1, '11', null]) {
      const result = resolveProviderReportingRoutes({ ...observed, profileVersion }, new Date('2026-09-05T00:00:00.000Z'));
      assert.equal(result.routes.length, 0);
      assert.equal(result.coverage.every((item) => item.state === 'not_collected'), true);
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
});
