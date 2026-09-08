import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { HTML_TREE_FIXTURES } from './html-tree-fixtures.mts';
import { extractHtmlSignals } from '../lib/html-signals.mts';
import { analyzeStaticHtml, MAX_STATIC_HTML_CHARS, MAX_STATIC_HTML_TAGS } from '../lib/static-html-analysis.mts';
import { createPageFingerprints } from '../lib/page-fingerprints.mts';
import { sanitizeLookupChildProfiles } from '../lib/lookup-child-profile-contract.mts';
import { createHash } from 'node:crypto';
import { recordValue } from './value-assertions.mts';

describe('bounded native document evidence', () => {
  for (const fixture of HTML_TREE_FIXTURES) {
    test(fixture.name, () => {
      const analysis = analyzeStaticHtml(fixture.html, { includeVisibleText: true });
      assert.equal(analysis.forms.formsObserved, fixture.forms);
      assert.equal(analysis.forms.categories.password, fixture.passwordInputs);
      const result = extractHtmlSignals(fixture.html, 'example.test', { observedAt: '2026-09-08T00:00:00.000Z' });
      assert.equal(result.hasPasswordField, fixture.passwordInputs > 0);
      assert.equal(result.pageIdentity?.forms.count, fixture.forms);
      assert.equal(result.clientBehaviorProfile?.indicators.find((item) => item.id === 'inline_event_handlers')?.occurrences ?? 0, fixture.handlers);
      assert.equal(sanitizeLookupChildProfiles({ availability: { pageIdentity: result.pageIdentity } }).availability.pageIdentity, result.pageIdentity);
      assert.equal(analysis.inputLimitReached || analysis.tagLimitReached, false);
    });
  }

  test('only actual resource elements contribute credential-free hostnames', () => {
    const result = extractHtmlSignals(`
      <!-- <img src="https://user:private@hidden.example/logo.png"> -->
      <script>const example = '<img src="https://script.example/logo.png">';</script>
      <img src="https://user:private@rejected.example/logo.png">
      <img src="https://cdn.example:8443/logo.png?token=private">
      <base href="https://assets.example/">
      <img src="/logo.png">
    `, 'example.test');
    assert.deepEqual(result.externalAssetHosts, ['cdn.example', 'assets.example']);
    assert.doesNotMatch(JSON.stringify(result.externalAssetHosts), /private|user|hidden|rejected|script|8443|token/u);
  });

  test('entity decoding happens once, without turning quoted text into attributes', () => {
    const result = extractHtmlSignals('<meta property=og:title content="A &amp; B &amp;quot; C"><form action="https://collect.example/a?one=1&amp;two=2"></form>', 'example.test');
    assert.equal(result.pageIdentity?.openGraph.title, 'A & B &quot; C');
    assert.deepEqual(result.pageIdentity?.forms.externalActionOrigins, ['https://collect.example']);
  });

  test('body-positioned bases use native document resolution without changing head-only publication scope', () => {
    const html = '<body><base href="https://assets.example/root/"><form action=submit><input type=password></form><img src=logo.png></body>';
    const analysis = analyzeStaticHtml(html, { baseUrl: 'https://example.test/page' });
    const signals = extractHtmlSignals(html, 'example.test', { baseUrl: 'https://example.test/page', includeCredentialSurfaceProfile: true });
    assert.equal(analysis.effectiveBaseUrl, 'https://assets.example/root/');
    assert.deepEqual(signals.pageIdentity?.forms.externalActionOrigins, ['https://assets.example']);
    assert.equal(signals.credentialSurfaceProfile?.forms.actions.external, 1);
  });

  test('inert fallback text and truncated landing-page prefixes cannot classify a domain for sale', () => {
    for (const tag of ['iframe', 'noembed', 'noframes', 'noscript', 'template']) {
      const html = `<${tag}>This domain is for sale</${tag}>`;
      assert.equal(extractHtmlSignals(html, 'example.test').domainSaleSignal, null, tag);
    }
    assert.equal(extractHtmlSignals('<p>This domain is for sale</p>', 'example.test', { sourceTruncated: true }).domainSaleSignal, null);
    assert.equal(extractHtmlSignals('<p>This domain is for sale</p>', 'example.test').domainSaleSignal, 'explicit domain-sale landing-page content');
  });

  test('bounded metadata and multi-candidate resource output satisfy the public child contract', () => {
    const html = '<meta property=og:title content="' + 'x'.repeat(400) + '">' + Array.from({ length: 60 }, (_, index) =>
      `<img srcset="${Array.from({ length: 20 }, (_, candidate) => `/image-${index}-${candidate}.png ${candidate + 1}w`).join(',')}">`).join('');
    const result = extractHtmlSignals(html, 'example.test', { observedAt: '2026-09-08T00:00:00.000Z' });
    assert.equal(result.pageIdentity?.openGraph.title?.length, 200);
    assert.equal(result.pageIdentity?.resources.count, 1024);
    assert.equal(result.pageIdentity?.resources.truncated, true);
    assert.equal(sanitizeLookupChildProfiles({ availability: { pageIdentity: result.pageIdentity } }).availability.pageIdentity, result.pageIdentity);
  });

  test('native implied closing tags produce identical current fingerprints', () => {
    const implicit = createPageFingerprints('<main><p>One<p>Two</main>');
    const explicit = createPageFingerprints('<main><p>One</p><p>Two</p></main>');
    assert.deepEqual(implicit.domStructure, explicit.domStructure);
    assert.deepEqual(implicit.normalizedHtml, explicit.normalizedHtml);
  });

  test('a tag-only bound cannot become complete empty publisher evidence', () => {
    const result = extractHtmlSignals(`${'<br>'.repeat(MAX_STATIC_HTML_TAGS + 1)}<script type="application/ld+json">{"@type":"Organization","name":"Example publisher"}</script>`, 'example.test');
    assert.equal(result.structuredDataIdentity?.complete, false);
    assert.equal(result.structuredDataIdentity?.truncated, true);
    assert.equal(result.structuredDataIdentity?.status, 'partial');
  });

  test('ordinary maximum prose is complete while hostile construction remains bounded', () => {
    const prose = '<p>' + 'text '.repeat(Math.floor((MAX_STATIC_HTML_CHARS - 3) / 5));
    assert.equal(analyzeStaticHtml(prose).tagLimitReached, false);
    for (const html of [
      '<div>'.repeat(8_000),
      '<br>'.repeat(20_000),
      '<!---->'.repeat(40_000),
      '<table><b><i>'.repeat(8_000),
      '<svg><foreignObject>'.repeat(6_000),
    ]) {
      const result = analyzeStaticHtml(html);
      assert.equal(result.tagLimitReached, true);
      assert.equal(result.publicationMetadata.documentTruncated, true);
      assert.ok(result.elements.length <= MAX_STATIC_HTML_TAGS + 3);
    }
  });

  test('analyses late evidence through the whole admitted large body and preserves its exact hash', () => {
    for (const size of [600 * 1024, MAX_STATIC_HTML_CHARS]) {
      const suffix = '<main data-wf-site="fixture"><h1>Late evidence</h1><form><input type=password></form></main>';
      const html = '<!--' + 'x'.repeat(size - 7 - suffix.length) + '-->' + suffix;
      const analysis = analyzeStaticHtml(html, { includeVisibleText: true });
      const result = extractHtmlSignals(html, 'example.test', { htmlAnalysis: analysis });
      assert.equal(analysis.inputLimitReached, false);
      assert.equal(analysis.tagLimitReached, false);
      assert.equal(result.hasPasswordField, true);
      assert.deepEqual(result.technologyProfile?.findings.map(({ id }) => id), ['webflow']);
      assert.equal(result.technologyProfile?.complete, true);
      assert.equal(result.pageIdentity?.fingerprints.exact.bytes, size);
      assert.equal(result.pageIdentity?.fingerprints.exact.value, createHash('sha256').update(html).digest('hex'));
      assert.equal(result.pageIdentity?.fingerprints.exact.scope, 'complete-body');
      assert.equal(sanitizeLookupChildProfiles({ availability: { pageIdentity: result.pageIdentity } }).availability.pageIdentity, result.pageIdentity);
      const current = result.pageIdentity!.fingerprints;
      const legacy = { ...result.pageIdentity, fingerprints: {
        ...current, fingerprintVersion: 1,
        domStructure: { ...current.domStructure, parser: 'static-tag-sequence-v1' },
      } };
      const rejected = recordValue(recordValue(sanitizeLookupChildProfiles({ availability: { pageIdentity: legacy } }).availability.pageIdentity).fingerprints);
      assert.equal(rejected.status, 'error');
      assert.equal(rejected.compatibility, 'malformed');
      assert.equal(Object.hasOwn(rejected, 'exact'), false);
    }
  });

  test('an over-bound source stays partial and does not inspect the suffix', () => {
    const html = ' '.repeat(MAX_STATIC_HTML_CHARS) + '<form><input type=password></form>';
    const result = extractHtmlSignals(html, 'example.test');
    assert.equal(result.hasPasswordField, false);
    assert.equal(result.technologyProfile?.complete, false);
    assert.equal(result.pageIdentity?.fingerprints.exact.scope, 'captured-prefix');
    assert.equal(result.pageIdentity?.fingerprints.exact.bytes, MAX_STATIC_HTML_CHARS);
  });

  test('native element evidence is not cut off by the former reconstruction limit', () => {
    const html = '<div></div>'.repeat(2_500) + '<main data-wf-site="fixture"><h1>Later page</h1></main>';
    const result = extractHtmlSignals(html, 'example.test');
    assert.deepEqual(result.technologyProfile?.findings.map(({ id }) => id), ['webflow']);
    assert.equal(result.technologyProfile?.complete, true);
    assert.equal(result.pageRoleProfile?.findings.some(({ role }) => role === 'content'), true);
    assert.equal(result.pageRoleProfile?.complete, true);
    // The independently bounded similarity representation remains honest.
    assert.equal(result.pageIdentity?.fingerprints.domStructure.truncated, true);
  });

  test('an oversized drawing attribute limits fingerprints, not independent HTML technology evidence', () => {
    const html = '<svg><path d="' + 'M1 2L3 4 '.repeat(1_000) + '"></path></svg><main data-wf-site="fixture"></main>';
    const result = extractHtmlSignals(html, 'example.test');
    assert.equal(result.technologyProfile?.complete, true);
    assert.deepEqual(result.technologyProfile?.findings.map(({ id }) => id), ['webflow']);
    assert.equal(result.pageIdentity?.fingerprints.complete, false);
    const htmlAttribute = extractHtmlSignals('<main data-description="' + 'x'.repeat(5_000) + '" data-wf-site="fixture"></main>', 'example.test');
    assert.equal(htmlAttribute.technologyProfile?.complete, false);
  });
});
