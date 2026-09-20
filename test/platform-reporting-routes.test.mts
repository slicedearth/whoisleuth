import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  INCIDENT_PLATFORMS,
  PLATFORM_REPORTING_ROUTES,
  incidentPlatformForUrl,
  platformReportingCatalogueHealth,
  resolvePlatformReportingRoutes,
} from '../packages/cases/platform-reporting-routes.mts';

describe('platform reporting routes', () => {
  test('matches only exact reviewed platform host suffixes', () => {
    assert.equal(incidentPlatformForUrl('https://www.instagram.com/example/p/7')?.id, 'instagram');
    assert.equal(incidentPlatformForUrl('https://subdomain.x.com/example/status/7')?.id, 'x');
    assert.equal(incidentPlatformForUrl('https://x.com.attacker.example/status/7'), null);
    assert.equal(incidentPlatformForUrl('https://user:secret@t.me/example'), null);
  });

  test('offers generic and type-specific routes without inferring a violation', () => {
    const generic = resolvePlatformReportingRoutes('https://www.tiktok.com/@example/video/7', [], new Date('2026-09-04T00:00:00Z'));
    assert.equal(generic.state, 'found');
    assert.deepEqual(generic.routes.map((route) => route.id), ['tiktok-report']);
    const rights = resolvePlatformReportingRoutes('https://www.tiktok.com/@example/video/7', ['copyright_infringement'], new Date('2026-09-04T00:00:00Z'));
    assert.deepEqual(rights.routes.map((route) => route.id), ['tiktok-report', 'tiktok-copyright']);
    assert.match(rights.limitation, /not policy breach/iu);
  });

  test('fails closed when catalogue guidance reaches its recheck date', () => {
    const result = resolvePlatformReportingRoutes('https://t.me/example/7', ['copyright_infringement'], new Date('2027-03-04T00:00:00Z'));
    assert.equal(result.state, 'stale');
    assert.deepEqual(result.routes, []);
    assert.match(result.limitation, /recheck date/iu);
  });

  test('warns for the final review month and becomes stale at the exact deadline', () => {
    const beforeReview = platformReportingCatalogueHealth(new Date('2026-09-03T23:59:59.999Z'));
    assert.equal(beforeReview.state, 'unavailable');
    assert.equal(beforeReview.ageDays, null);
    const reviewed = platformReportingCatalogueHealth(new Date('2026-09-04T00:00:00Z'));
    assert.equal(reviewed.state, 'current');
    assert.equal(reviewed.ageDays, 0);
    const current = platformReportingCatalogueHealth(new Date('2027-02-01T00:00:00.000Z'));
    const limited = platformReportingCatalogueHealth(new Date('2027-02-02T00:00:00.000Z'));
    const stale = platformReportingCatalogueHealth(new Date('2027-03-04T00:00:00.000Z'));
    assert.equal(current.state, 'current');
    assert.equal(limited.state, 'limited');
    assert.equal(limited.reviewDueInDays, 30);
    assert.equal(stale.state, 'stale');
    assert.equal(stale.reviewDueInDays, 0);
    assert.throws(() => platformReportingCatalogueHealth(new Date('invalid')), /valid review time/iu);
  });

  test('withholds platform routes when the evaluation clock is unavailable or predates their review', () => {
    for (const now of [new Date('invalid'), new Date('2026-09-03T23:59:59.999Z')]) {
      const result = resolvePlatformReportingRoutes('https://t.me/example/7', [], now);
      assert.equal(result.platform?.id, 'telegram');
      assert.equal(result.state, 'unavailable');
      assert.deepEqual(result.routes, []);
      assert.doesNotMatch(result.limitation, /reached their recheck date/iu);
    }
    assert.equal(resolvePlatformReportingRoutes('https://t.me/example/7', [], new Date('2026-09-04T00:00:00Z')).state, 'found');
    assert.equal(resolvePlatformReportingRoutes('https://t.me/example/7', [], new Date('2027-03-03T23:59:59.999Z')).state, 'found');
  });

  test('keeps every route on an official platform-controlled origin with reviewed dates and preparation guidance', () => {
    const roots = new Set(INCIDENT_PLATFORMS.flatMap((platform) => platform.hosts));
    roots.add('meta.com');
    assert.equal(new Set(PLATFORM_REPORTING_ROUTES.map((route) => route.id)).size, PLATFORM_REPORTING_ROUTES.length);
    for (const route of PLATFORM_REPORTING_ROUTES) {
      const guidance = new URL(route.guidanceUrl);
      assert.ok([...roots].some((root) => guidance.hostname === root || guidance.hostname.endsWith(`.${root}`))
        || guidance.hostname === 'support.google.com'
        || guidance.hostname === 'help.x.com');
      if (route.channel === 'url') {
        const contact = new URL(route.contact);
        assert.equal(contact.protocol, 'https:');
      } else {
        assert.match(route.contact, /^[^@\s]+@[^@\s]+\.[^@\s]+$/u);
      }
      assert.equal(route.reviewedAt, '2026-09-04');
      assert.equal(route.reviewAfter, '2027-03-04');
      assert.ok(route.preparation.length >= 3);
      assert.ok(route.privacyNote.length > 20);
    }
  });
});
