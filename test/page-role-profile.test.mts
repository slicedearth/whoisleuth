import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const {
  PAGE_ROLE_PROFILE_VERSION,
  analyzePageRole,
} = await import('../lib/page-role-profile.mts');

const observedAt = '2026-07-29T01:02:03.000Z';

describe('bounded page-role profile', () => {
  test('classifies several review roles with fixed evidence labels', () => {
    const result = analyzePageRole({
      html: `
        <main>
          <form class="login-form"><input autocomplete="username"><input type="password"></form>
          <form class="checkout"><input autocomplete="cc-number"></form>
        </main>
      `,
      pageTitle: 'Account sign in',
      observedAt,
    });

    assert.equal(result.pageRoleProfileVersion, PAGE_ROLE_PROFILE_VERSION);
    assert.equal(result.source, 'derived');
    assert.equal(result.status, 'success');
    assert.equal(result.observedAt, observedAt);
    assert.equal(result.primaryRole, 'authentication');
    assert.deepEqual(result.findings.map((finding) => finding.role), [
      'authentication',
      'commerce',
      'content',
    ]);
    assert.doesNotMatch(JSON.stringify(result), /login-form|cc-number|Account sign in/u);
  });

  test('puts an access challenge before a credential form', () => {
    const result = analyzePageRole({
      html: '<form class="cf-chl"><input type="password"><div class="turnstile"></div></form>',
      pageTitle: 'Just a moment',
    });

    assert.equal(result.primaryRole, 'access_challenge');
    assert.equal(result.findings[0]?.confidence, 'high');
    assert.equal(result.findings[1]?.role, 'authentication');
  });

  test('uses existing parked evidence without treating it as ownership or availability proof', () => {
    const result = analyzePageRole({
      html: '<main class="domain-for-sale"></main>',
      activityStatus: 'parked',
    });

    const parked = result.findings.find((finding) => finding.role === 'parked_sale');
    assert.equal(parked?.confidence, 'high');
    assert.match(result.limitations.join(' '), /not proof/iu);
  });

  test('returns an explicit unclassified role and propagates truncation', () => {
    const result = analyzePageRole({
      html: 'x'.repeat(300_001),
      sourceTruncated: true,
    });

    assert.equal(result.primaryRole, 'unknown');
    assert.equal(result.status, 'partial');
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
  });
});
