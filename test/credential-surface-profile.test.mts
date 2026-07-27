import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const {
  CREDENTIAL_SURFACE_PROFILE_VERSION,
  analyzeCredentialSurfaceProfile,
} = await import('../lib/credential-surface-profile.mts');
const {
  MAX_ATTRIBUTES_PER_TAG,
  MAX_STATIC_FORMS,
  MAX_STATIC_INPUTS,
} = await import('../lib/static-html-analysis.mts');

const observedAt = '2026-07-27T04:05:06.000Z';

function profile(html: string, options: Record<string, unknown> = {}) {
  return analyzeCredentialSurfaceProfile({
    html,
    baseUrl: 'https://portal.example/start',
    observedAt,
    ...options,
  });
}

describe('bounded credential-surface profiling', () => {
  test('classifies semantic input purposes and fixed form relationships only', () => {
    const result = profile(`
      <form method="post" action="/session?token=secret">
        <input type="email" name="private-email">
        <input type="text" autocomplete="username" value="private-user">
        <input type="password" autocomplete="current-password" placeholder="Private password">
        <input inputmode="numeric" autocomplete="one-time-code">
        <input type="text" autocomplete="cc-number">
      </form>
      <form method="get" action="https://identity.example/login?account=private"></form>
      <form></form>
      <form method="dialog" action="http://portal.example/cleartext"></form>
    `);

    assert.equal(result.credentialSurfaceVersion, CREDENTIAL_SURFACE_PROFILE_VERSION);
    assert.equal(result.status, 'success');
    assert.equal(result.complete, true);
    assert.equal(result.source, 'html');
    assert.equal(result.observedAt, observedAt);
    assert.deepEqual(result.inputs, {
      count: 5,
      classifiedCount: 5,
      categories: { password: 1, email: 1, username: 1, one_time_code: 1, payment: 1 },
    });
    assert.deepEqual(result.forms, {
      count: 4,
      methods: { missing: 1, get: 1, post: 1, dialog: 1, other: 0 },
      actions: { sameOrigin: 1, external: 2, missing: 1, cleartext: 1, unclassified: 0 },
    });
    assert.doesNotMatch(
      JSON.stringify(result),
      /private-email|private-user|private password|token=|account=|\/session|\/login|\/cleartext/iu,
    );
  });

  test('keeps overlapping declarations explicit and excludes hidden or disabled inputs', () => {
    const result = profile(`
      <input type="email" autocomplete="username email">
      <input type="hidden" autocomplete="current-password">
      <input type="password" disabled>
      <input type="text">
    `);

    assert.deepEqual(result.inputs, {
      count: 4,
      classifiedCount: 1,
      categories: { password: 0, email: 1, username: 1, one_time_code: 0, payment: 0 },
    });
    assert.match(result.limitations.join(' '), /counts can overlap/iu);
  });

  test('ignores inert comments, templates, scripts, and ordinary page text', () => {
    const result = profile(`
      <!-- <form><input type="password"></form> -->
      <template><form><input type="email"></form></template>
      <script>const markup = '<form><input autocomplete="cc-number"></form>';</script>
      <p>password email username one-time-code cc-number</p>
      <form><input autocomplete="one-time-code"></form>
    `);

    assert.equal(result.forms.count, 1);
    assert.equal(result.inputs.count, 1);
    assert.deepEqual(result.inputs.categories, {
      password: 0, email: 0, username: 0, one_time_code: 1, payment: 0,
    });
  });

  test('marks unsafe action metadata partial without retaining it', () => {
    const result = profile(`
      <form method="other" action="javascript:collect('secret')"></form>
      <form action="https://user:password@external.example/private"></form>
    `);

    assert.equal(result.status, 'partial');
    assert.equal(result.complete, false);
    assert.equal(result.truncated, false);
    assert.equal(result.forms.methods.other, 1);
    assert.equal(result.forms.actions.unclassified, 2);
    assert.equal(result.diagnostics.unclassifiedActions, 2);
    assert.doesNotMatch(JSON.stringify(result), /javascript:collect|secret|user:password|\/private/iu);
  });

  test('does not classify controls whose security-relevant attributes fall beyond the attribute cap', () => {
    const filler = Array.from({ length: MAX_ATTRIBUTES_PER_TAG }, (_, index) => `data-fixture-${index}="value"`).join(' ');
    const result = profile(`
      <form ${filler} action="https://identity.example/private"></form>
      <input ${filler} type="password" name="private-field">
    `);

    assert.equal(result.status, 'partial');
    assert.equal(result.forms.methods.other, 1);
    assert.equal(result.forms.actions.unclassified, 1);
    assert.equal(result.inputs.classifiedCount, 0);
    assert.equal(result.inputs.categories.password, 0);
    assert.doesNotMatch(JSON.stringify(result), /identity\.example|private-field|\/private/iu);
  });

  test('enforces form, input, and upstream capture boundaries deterministically', () => {
    const forms = Array.from({ length: MAX_STATIC_FORMS + 1 }, () => '<form method="post"></form>').join('');
    const inputs = Array.from({ length: MAX_STATIC_INPUTS + 1 }, () => '<input type="password">').join('');
    const result = profile(`${forms}${inputs}`, { sourceTruncated: true });

    assert.equal(result.status, 'partial');
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
    assert.equal(result.forms.count, MAX_STATIC_FORMS);
    assert.equal(result.inputs.count, MAX_STATIC_INPUTS);
    assert.equal(result.inputs.categories.password, MAX_STATIC_INPUTS);
    assert.match(result.limitations.join(' '), /captured homepage body was truncated/iu);
    assert.match(result.limitations.join(' '), /attribute-classification boundary/iu);
    assert.match(result.limitations.join(' '), new RegExp(`first ${MAX_STATIC_FORMS} forms and ${MAX_STATIC_INPUTS} input`));
  });
});
