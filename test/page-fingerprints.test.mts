import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  PAGE_FINGERPRINT_VERSION,
  MAX_FINGERPRINT_SOURCE_BYTES,
  MAX_FINGERPRINT_TOKENS,
  MAX_VISIBLE_TEXT_TOKENS,
  MAX_FORM_FINGERPRINTS,
  MAX_FORM_CONTROLS,
  createPageFingerprints,
} from '../lib/page-fingerprints.mts';
import { requiredValue } from './value-assertions.mts';
import { MAX_STATIC_HTML_TAGS } from '../packages/contracts/page-fingerprints.mts';

const BASE_OPTIONS = Object.freeze({ baseUrl: 'https://example.com/start' });

function fingerprints(
  html: string,
  options: Parameters<typeof createPageFingerprints>[1] = {},
) {
  return createPageFingerprints(html, { ...BASE_OPTIONS, ...options });
}

describe('page fingerprints', () => {
  test('retains historical identifier normalisation at ASCII word boundaries', () => {
    // A bounded reference to the historical normalisation, independent of the
    // replacement implementation. Never run its backtracking pattern on long
    // input; the large-input test below has a separate process hang guard.
    const historical = (value: string) => value
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '<id>')
      .replace(/\b\d{4}-\d{1,2}-\d{1,2}(?:[t\s]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?)?\b/gi, '<time>')
      .replace(/\b\d{10,13}\b/g, '<time>')
      .replace(/\b[a-f0-9]{16,}\b/gi, '<id>')
      .replace(/\b(?=[a-z0-9_-]{20,}\b)(?=[a-z0-9_-]*[a-z])(?=[a-z0-9_-]*\d)[a-z0-9_-]+\b/gi, '<id>');
    const html = (text: string) => `<main>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</main>`;
    const samples = ['2026-01-02T03:04:05Z', 'AB1234567890AB1234567890', '9f91ac24-0d4b-48c8-8aee-c8111a9a1def'];
    for (const size of [18, 19, 20, 21, 64]) {
      for (const middle of ['g'.repeat(size), '7'.repeat(size), 'g-'.repeat(size), 'g_'.repeat(size)]) {
        for (const prefix of ['', '-', '__', 'é', '!']) {
          for (const suffix of ['', '1', '-', '__', 'é', '!']) samples.push(prefix + middle + suffix);
        }
      }
    }
    for (const text of samples) {
      const actual = fingerprints(html(text));
      const expected = fingerprints(html(historical(text)));
      assert.equal(actual.normalizedHtml.value, expected.normalizedHtml.value, JSON.stringify(text));
      assert.deepEqual(actual.visibleText, expected.visibleText, JSON.stringify(text));
    }
  });

  test('processes long hyphenated text without discarding the admitted body', () => {
    const moduleUrl = new URL('../lib/page-fingerprints.mts', import.meta.url).href;
    execFileSync(process.execPath, ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { createPageFingerprints, MAX_FINGERPRINT_SOURCE_BYTES } from ${JSON.stringify(moduleUrl)};
      const expected = createPageFingerprints('<main>&lt;id&gt;</main>');
      for (const size of [65_536, 131_072, MAX_FINGERPRINT_SOURCE_BYTES - 32]) {
        const text = 'g-'.repeat(Math.floor(size / 2));
        const ordinary = createPageFingerprints('<main>' + text + '</main>');
        const identifier = createPageFingerprints('<main>' + text + '1</main>');
        assert.equal(ordinary.exact.scope, 'complete-body');
        assert.equal(ordinary.exact.bytes, text.length + 13);
        assert.notEqual(ordinary.normalizedHtml.value, identifier.normalizedHtml.value);
        assert.equal(identifier.normalizedHtml.value, expected.normalizedHtml.value);
        assert.deepEqual(identifier.visibleText, expected.visibleText);
      }
    `], { timeout: 30_000, stdio: 'pipe' });
  });

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
    assert.equal(requiredValue(result.visibleText).algorithm, 'simhash64-v1');
    assert.match(requiredValue(result.visibleText).value, /^[a-f0-9]{16}$/);
    assert.equal(result.domStructure.algorithm, 'sha256');
    assert.equal(result.domStructure.parser, 'html-tree-v2');
    assert.equal(result.domStructure.similarity?.algorithm, 'simhash64-v1');
    assert.match(requiredValue(result.domStructure.similarity).value, /^[a-f0-9]{16}$/);
    assert.equal(requiredValue(result.formStructure).formCount, 1);
    assert.equal(requiredValue(result.formStructure).controlCount, 1);
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
    assert.equal(requiredValue(first.visibleText).value, requiredValue(second.visibleText).value);
    assert.equal(first.domStructure.value, second.domStructure.value);
    assert.equal(requiredValue(first.formStructure).value, requiredValue(second.formStructure).value);
  });

  test('material visible-text and structure changes affect their independent fingerprints', () => {
    const first = fingerprints('<main><h1>Welcome to the account centre</h1><form><input type="text"></form></main>');
    const second = fingerprints('<main><section><h1>Confirm your payment details</h1><form method="post"><input type="password"><button>Continue</button></form></section></main>');
    assert.notEqual(requiredValue(first.visibleText).value, requiredValue(second.visibleText).value);
    assert.notEqual(first.domStructure.value, second.domStructure.value);
    assert.notEqual(requiredValue(first.domStructure.similarity).value, requiredValue(second.domStructure.similarity).value);
    assert.notEqual(requiredValue(first.formStructure).value, requiredValue(second.formStructure).value);
  });

  test('derives bounded structural similarity from standards-compliant HTML tokens', () => {
    const malformed = fingerprints('<main><section><p>One<p>Two</section></main>');
    const explicit = fingerprints('<main><section><p>One</p><p>Two</p></section></main>');

    assert.equal(malformed.domStructure.similarity?.algorithm, 'simhash64-v1');
    assert.equal(explicit.domStructure.similarity?.algorithm, 'simhash64-v1');
    assert.ok(requiredValue(malformed.domStructure.similarity).tokenCount > 0);
    assert.doesNotMatch(JSON.stringify(malformed.domStructure.similarity), /One|Two/u);
  });

  test('visible text excludes comments and raw or non-executing element bodies', () => {
    const result = fingerprints(`
      <!-- hidden comment words -->
      <style>secret style words</style><script>secret script words</script>
      <template>secret template words</template><noscript>secret fallback words</noscript>
      <main>Visible account words</main>
    `);
    const expected = fingerprints('<main>Visible account words</main>');
    assert.equal(requiredValue(result.visibleText).value, requiredValue(expected.visibleText).value);
  });

  test('terminal controls and bidi formatting do not alter retained fingerprints', () => {
    const unsafe = fingerprints('<main>Visible\u009b\u202e account\u00ad words</main>');
    const clean = fingerprints('<main>Visible account words</main>');
    assert.equal(unsafe.normalizedHtml.value, clean.normalizedHtml.value);
    assert.equal(requiredValue(unsafe.visibleText).value, requiredValue(clean.visibleText).value);
  });

  test('an unclosed raw-text element cannot leak its body into visible-text fingerprints', () => {
    const result = fingerprints('<main>Visible words</main><script>private trailing script content');
    const expected = fingerprints('<main>Visible words</main><script></script>');
    assert.equal(requiredValue(result.visibleText).value, requiredValue(expected.visibleText).value);
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
    assert.equal(requiredValue(first.formStructure).value, requiredValue(second.formStructure).value);
    assert.doesNotMatch(JSON.stringify(first.formStructure), /secret|collect|first|one/);
  });

  test('form structure distinguishes same-origin, external, insecure, and invalid action classes', () => {
    const values = [
      requiredValue(fingerprints('<form action="/submit"></form>').formStructure).value,
      requiredValue(fingerprints('<form action="https://external.example/submit"></form>').formStructure).value,
      requiredValue(fingerprints('<form action="http://external.example/submit"></form>').formStructure).value,
      requiredValue(fingerprints('<form action="javascript:alert(1)"></form>').formStructure).value,
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
    assert.match(requiredValue(result.resourceHosts.value), /^[a-f0-9]{64}$/);
    assert.deepEqual(result.identifiers.values, [
      { type: 'analytics-property', value: 'G-ABC1234567' },
      { type: 'tag-container', value: 'GTM-ZZZZ' },
    ]);
    assert.match(requiredValue(result.identifiers.value), /^[a-f0-9]{64}$/);
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

  test('retains later structure and text throughout an admitted large document', () => {
    const prefix = '<main>' + '<div>record</div>'.repeat(4_000);
    const first = fingerprints(`${prefix}<section>original ending</section></main>`);
    const changed = fingerprints(`${prefix}<article>different ending</article></main>`);
    assert.ok(first.normalizedHtml.tokenCount > 4_096);
    assert.ok(first.domStructure.nodeCount > 4_096);
    assert.equal(first.complete, true);
    assert.equal(changed.complete, true);
    assert.notEqual(first.normalizedHtml.value, changed.normalizedHtml.value);
    assert.notEqual(first.domStructure.value, changed.domStructure.value);
    assert.ok(requiredValue(first.visibleText).tokenCount > 4_000);
  });

  test('keeps native construction bounds explicit without another shorter projection cap', () => {
    const result = fingerprints('<section>record</section>'.repeat(MAX_STATIC_HTML_TAGS + 1));
    assert.ok(result.normalizedHtml.tokenCount > 0);
    assert.ok(result.normalizedHtml.tokenCount <= MAX_FINGERPRINT_TOKENS);
    assert.ok(result.domStructure.nodeCount > 0);
    assert.ok(result.domStructure.nodeCount <= MAX_FINGERPRINT_TOKENS);
    assert.equal(result.normalizedHtml.truncated, true);
    assert.equal(result.domStructure.truncated, true);
    assert.equal(result.complete, false);
  });

  test('caps visible-text tokens with explicit partial provenance', () => {
    const result = fingerprints(`<main>${Array.from({ length: MAX_VISIBLE_TEXT_TOKENS + 1 }, (_, index) => `word${index}`).join(' ')}</main>`);
    assert.equal(requiredValue(result.visibleText).tokenCount, MAX_VISIBLE_TEXT_TOKENS);
    assert.equal(requiredValue(result.visibleText).truncated, true);
    assert.match(result.limitations.join(' '), /normalized tokens/);
  });

  test('caps forms and controls with explicit partial provenance', () => {
    const forms = Array.from({ length: MAX_FORM_FINGERPRINTS + 1 }, () => '<form><input></form>').join('');
    const formLimited = fingerprints(forms);
    assert.equal(requiredValue(formLimited.formStructure).formCount, MAX_FORM_FINGERPRINTS);
    assert.equal(requiredValue(formLimited.formStructure).truncated, true);

    const controls = `<form>${'<input>'.repeat(MAX_FORM_CONTROLS + 1)}</form>`;
    const controlLimited = fingerprints(controls);
    assert.equal(requiredValue(controlLimited.formStructure).controlCount, MAX_FORM_CONTROLS);
    assert.equal(requiredValue(controlLimited.formStructure).truncated, true);
  });

  test('upstream source truncation marks the fingerprint collection incomplete', () => {
    const html = '<main>Captured prefix</main><form><input></form>';
    const result = fingerprints(html, {
      sourceTruncated: true,
      exactBodyHash: { algorithm: 'sha256', value: 'a'.repeat(64), scope: 'complete-body', bytes: Buffer.byteLength(html) },
    });
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
    assert.equal(result.exact.scope, 'captured-prefix');
    assert.equal(result.normalizedHtml.truncated, true);
    assert.equal(result.domStructure.truncated, true);
    assert.equal(requiredValue(result.domStructure.similarity).truncated, true);
    assert.equal(requiredValue(result.visibleText).truncated, true);
    assert.equal(requiredValue(result.formStructure).truncated, true);
  });
});
