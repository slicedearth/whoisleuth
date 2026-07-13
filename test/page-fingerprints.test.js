const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  PAGE_FINGERPRINT_VERSION,
  MAX_FINGERPRINT_SOURCE_BYTES,
  MAX_FINGERPRINT_TOKENS,
  MAX_VISIBLE_TEXT_TOKENS,
  MAX_FORM_FINGERPRINTS,
  MAX_FORM_CONTROLS,
  createPageFingerprints,
} = require('../lib/page-fingerprints');

const BASE_OPTIONS = Object.freeze({ baseUrl: 'https://example.com/start' });

function fingerprints(html, options = {}) {
  return createPageFingerprints(html, { ...BASE_OPTIONS, ...options });
}

describe('page fingerprints', () => {
  test('returns independently versioned exact, normalized, text, DOM, form, host, and identifier components', () => {
    const result = fingerprints(`
      <html><body><h1>Account centre</h1>
      <form method="post" action="https://collect.example/session"><input type="password"></form>
      <img src="https://cdn.example/logo.png"><script>GTM-AB12</script></body></html>
    `, {
      resources: { externalOrigins: ['https://cdn.example'], truncated: false },
      trackingIdentifiers: [{ type: 'tag-container', value: 'GTM-AB12' }],
    });

    assert.equal(result.fingerprintVersion, PAGE_FINGERPRINT_VERSION);
    assert.match(result.exact.value, /^[a-f0-9]{64}$/);
    assert.equal(result.exact.algorithm, 'sha256');
    assert.equal(result.normalizedHtml.algorithm, 'sha256');
    assert.match(result.normalizedHtml.value, /^[a-f0-9]{64}$/);
    assert.equal(result.visibleText.algorithm, 'simhash64-v1');
    assert.match(result.visibleText.value, /^[a-f0-9]{16}$/);
    assert.equal(result.domStructure.algorithm, 'sha256');
    assert.equal(result.domStructure.parser, 'static-tag-sequence-v1');
    assert.equal(result.formStructure.formCount, 1);
    assert.equal(result.formStructure.controlCount, 1);
    assert.deepEqual(result.resourceHosts.values, ['cdn.example']);
    assert.deepEqual(result.identifiers.values, [{ type: 'tag-container', value: 'GTM-AB12' }]);
    assert.equal(result.complete, true);
  });

  test('uses the exact captured-response byte hash when it is supplied', () => {
    const result = fingerprints('<main>decoded text</main>', {
      exactBodyHash: { algorithm: 'sha256', value: 'A'.repeat(64), scope: 'captured-prefix', bytes: 123 },
    });
    assert.deepEqual(result.exact, {
      algorithm: 'sha256', value: 'a'.repeat(64), scope: 'captured-prefix', bytes: 123,
      source: 'captured-response-bytes',
    });
  });

  test('rejects malformed supplied body hashes and falls back to decoded markup', () => {
    const result = fingerprints('<main>fallback</main>', {
      exactBodyHash: { algorithm: 'sha1', value: 'secret', scope: 'complete-body', bytes: 8 },
    });
    assert.equal(result.exact.source, 'decoded-markup');
    assert.match(result.exact.value, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(result), /secret/);
  });

  test('normalization removes routine volatility while the exact digest still changes', () => {
    const first = fingerprints(`
      <!-- deployment one --><html><body id="8f91ac240d4b48c8">
      <p>Updated 2026-07-13 10:15:30</p>
      <form action="/login?csrf=first" data-csrf="first"><input value="first"></form>
      <script nonce="first">window.dynamic = 'first';</script><style>.a { color: red }</style>
      <img class="hero logo" src="/image.png?utm_source=one"></body></html>
    `);
    const second = fingerprints(`<html>
      <body id="7e82bd130c3a57d9"><p>Updated 2026-08-14 11:16:31</p>
      <form data-csrf="second" action="/login?utm_source=two"><input value="second"></form>
      <script nonce="second">window.dynamic = 'second';</script><style>.a{color:blue}</style>
      <img src="/image.png?tracking=two" class="logo hero"></body></html>`);

    assert.notEqual(first.exact.value, second.exact.value);
    assert.equal(first.normalizedHtml.value, second.normalizedHtml.value);
    assert.equal(first.visibleText.value, second.visibleText.value);
    assert.equal(first.domStructure.value, second.domStructure.value);
    assert.equal(first.formStructure.value, second.formStructure.value);
  });

  test('material visible-text and structure changes affect their independent fingerprints', () => {
    const first = fingerprints('<main><h1>Welcome to the account centre</h1><form><input type="text"></form></main>');
    const second = fingerprints('<main><section><h1>Confirm your payment details</h1><form method="post"><input type="password"><button>Continue</button></form></section></main>');
    assert.notEqual(first.visibleText.value, second.visibleText.value);
    assert.notEqual(first.domStructure.value, second.domStructure.value);
    assert.notEqual(first.formStructure.value, second.formStructure.value);
  });

  test('visible text excludes comments and raw or non-executing element bodies', () => {
    const result = fingerprints(`
      <!-- hidden comment words -->
      <style>secret style words</style><script>secret script words</script>
      <template>secret template words</template><noscript>secret fallback words</noscript>
      <main>Visible account words</main>
    `);
    const expected = fingerprints('<main>Visible account words</main>');
    assert.equal(result.visibleText.value, expected.visibleText.value);
  });

  test('an unclosed raw-text element cannot leak its body into visible-text fingerprints', () => {
    const result = fingerprints('<main>Visible words</main><script>private trailing script content');
    const expected = fingerprints('<main>Visible words</main><script></script>');
    assert.equal(result.visibleText.value, expected.visibleText.value);
    assert.doesNotMatch(JSON.stringify(result), /private|trailing/);
  });

  test('normalization removes token-like meta content selected by its metadata key', () => {
    const first = fingerprints('<meta name="csrf-token" content="private-one"><main>Page</main>');
    const second = fingerprints('<meta content="private-two" name="csrf-token"><main>Page</main>');
    assert.equal(first.normalizedHtml.value, second.normalizedHtml.value);
    assert.doesNotMatch(JSON.stringify(first), /private-one/);
  });

  test('returns null for absent visible text and form evidence', () => {
    const result = fingerprints('<html><head><script>dynamic only</script></head><body></body></html>');
    assert.equal(result.visibleText, null);
    assert.equal(result.formStructure, null);
  });

  test('form structure ignores field names, values, action paths, and query strings', () => {
    const first = fingerprints('<form method="post" action="https://collect.example/a?token=secret"><input type="password" name="first" value="one"><button type="submit">Go</button></form>');
    const second = fingerprints('<form action="https://collect.example/b?token=other" method="POST"><input value="two" name="second" type="password"><button type="submit">Continue</button></form>');
    assert.equal(first.formStructure.value, second.formStructure.value);
    assert.doesNotMatch(JSON.stringify(first.formStructure), /secret|collect|first|one/);
  });

  test('form structure distinguishes same-origin, external, insecure, and invalid action classes', () => {
    const values = [
      fingerprints('<form action="/submit"></form>').formStructure.value,
      fingerprints('<form action="https://external.example/submit"></form>').formStructure.value,
      fingerprints('<form action="http://external.example/submit"></form>').formStructure.value,
      fingerprints('<form action="javascript:alert(1)"></form>').formStructure.value,
    ];
    assert.equal(new Set(values).size, 4);
  });

  test('resource-host and identifier sets are normalized, sorted, deduplicated, and hashed', () => {
    const result = fingerprints('<main>Page</main>', {
      resources: {
        externalOrigins: ['https://Z.example/path', 'http://a.example/', 'https://z.example/other', 'not a URL'],
        truncated: false,
      },
      trackingIdentifiers: [
        { type: 'tag-container', value: 'GTM-ZZZZ' },
        { type: 'tag-container', value: 'GTM-ZZZZ' },
        { type: 'analytics-property', value: 'G-ABC1234567' },
        { type: 'invalid!', value: 'secret' },
      ],
    });
    assert.deepEqual(result.resourceHosts.values, ['a.example', 'z.example']);
    assert.match(result.resourceHosts.value, /^[a-f0-9]{64}$/);
    assert.deepEqual(result.identifiers.values, [
      { type: 'analytics-property', value: 'G-ABC1234567' },
      { type: 'tag-container', value: 'GTM-ZZZZ' },
    ]);
    assert.match(result.identifiers.value, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(result), /secret|\/path|\/other/);
  });

  test('empty relationship sets do not create misleading equality digests', () => {
    const result = fingerprints('<main>Page</main>');
    assert.deepEqual(result.resourceHosts.values, []);
    assert.equal(result.resourceHosts.value, null);
    assert.deepEqual(result.identifiers.values, []);
    assert.equal(result.identifiers.value, null);
  });

  test('preserves an upstream identifier-cap signal on the identifier-set fingerprint', () => {
    const result = fingerprints('<main>Page</main>', {
      trackingIdentifiers: [{ type: 'tag-container', value: 'GTM-AB12' }],
      identifiersTruncated: true,
    });
    assert.equal(result.identifiers.truncated, true);
    assert.equal(result.truncated, true);
  });

  test('caps direct fingerprint input by UTF-8 bytes and reports prefix scope', () => {
    const result = fingerprints(`<main>${'x'.repeat(MAX_FINGERPRINT_SOURCE_BYTES + 1)}</main>`);
    assert.equal(result.exact.bytes, MAX_FINGERPRINT_SOURCE_BYTES);
    assert.equal(result.exact.scope, 'captured-prefix');
    assert.equal(result.truncated, true);
    assert.match(result.limitations.join(' '), /input was capped/);
  });

  test('caps normalized and DOM tokens with explicit partial provenance', () => {
    const result = fingerprints(Array.from({ length: MAX_FINGERPRINT_TOKENS + 1 }, () => '<i>x</i>').join(''));
    assert.equal(result.normalizedHtml.tokenCount, MAX_FINGERPRINT_TOKENS);
    assert.equal(result.domStructure.nodeCount, MAX_FINGERPRINT_TOKENS);
    assert.equal(result.normalizedHtml.truncated, true);
    assert.equal(result.domStructure.truncated, true);
    assert.equal(result.complete, false);
  });

  test('caps visible-text tokens with explicit partial provenance', () => {
    const result = fingerprints(`<main>${Array.from({ length: MAX_VISIBLE_TEXT_TOKENS + 1 }, (_, index) => `word${index}`).join(' ')}</main>`);
    assert.equal(result.visibleText.tokenCount, MAX_VISIBLE_TEXT_TOKENS);
    assert.equal(result.visibleText.truncated, true);
    assert.match(result.limitations.join(' '), /normalized tokens/);
  });

  test('caps forms and controls with explicit partial provenance', () => {
    const forms = Array.from({ length: MAX_FORM_FINGERPRINTS + 1 }, () => '<form><input></form>').join('');
    const formLimited = fingerprints(forms);
    assert.equal(formLimited.formStructure.formCount, MAX_FORM_FINGERPRINTS);
    assert.equal(formLimited.formStructure.truncated, true);

    const controls = `<form>${'<input>'.repeat(MAX_FORM_CONTROLS + 1)}</form>`;
    const controlLimited = fingerprints(controls);
    assert.equal(controlLimited.formStructure.controlCount, MAX_FORM_CONTROLS);
    assert.equal(controlLimited.formStructure.truncated, true);
  });

  test('upstream source truncation marks the fingerprint collection incomplete', () => {
    const result = fingerprints('<main>Captured prefix</main>', {
      sourceTruncated: true,
      exactBodyHash: { algorithm: 'sha256', value: 'a'.repeat(64), scope: 'complete-body', bytes: 28 },
    });
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
    assert.equal(result.exact.scope, 'captured-prefix');
  });
});
