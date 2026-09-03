import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  INCIDENT_PLATFORMS,
  PLATFORM_REPORTING_ROUTES,
  incidentPlatformForUrl,
  resolvePlatformReportingRoutes,
} from '../frontend/src/lib/analysis/platform-reporting-routes.ts';

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
