const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_TECHNOLOGY_HTML_CHARS,
  TECHNOLOGY_PROFILE_VERSION,
  analyzeWebsiteTechnology,
} = require('../lib/website-technology.mts');

const observedAt = '2026-07-22T01:02:03.000Z';

function analyze(overrides = {}) {
  return analyzeWebsiteTechnology({ observedAt, ...overrides });
}

function finding(result, id) {
  return result.findings.find((item) => item.id === id);
}

describe('website technology profile', () => {
  test('emits a versioned complete derived observation', () => {
    const result = analyze({ html: '<main>Plain static page</main>' });
    assert.equal(result.profileVersion, TECHNOLOGY_PROFILE_VERSION);
    assert.equal(result.version, 1);
    assert.equal(result.status, 'success');
    assert.equal(result.source, 'derived');
    assert.equal(result.scanMode, 'deep');
    assert.equal(result.observedAt, observedAt);
    assert.equal(result.complete, true);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.findings, []);
    assert.match(result.limitations.join(' '), /unmatched technology may still be present/i);
  });

  test('combines generator and static resource evidence for one technology', () => {
    const result = analyze({
      generator: 'WordPress 7.1',
      html: '<link rel="stylesheet" href="/wp-content/themes/example/style.css">',
    });
    const item = finding(result, 'wordpress');
    assert.equal(item.confidence, 'high');
    assert.equal(item.category, 'content management');
    assert.deepEqual(item.evidence.map((entry) => entry.source), ['generator metadata', 'static HTML']);
  });

  test('raises confidence when a distinctive HTML marker accompanies a resource origin', () => {
    const result = analyze({
      html: '<section class="shopify-section"></section>',
      resourceOrigins: ['https://cdn.shopify.com'],
    });
    const item = finding(result, 'shopify');
    assert.equal(item.confidence, 'high');
    assert.deepEqual(item.evidence.map((entry) => entry.source), ['static HTML', 'resource origin']);
  });

  test('treats a recognized resource origin alone as medium-confidence evidence', () => {
    const result = analyze({ resourceOrigins: ['https://assets.wixstatic.com'] });
    const item = finding(result, 'wix');
    assert.equal(item.confidence, 'medium');
    assert.equal(item.evidence[0].source, 'resource origin');
  });

  test('recognizes bounded static framework markers case-insensitively', () => {
    const result = analyze({ html: `
      <script id="__NEXT_DATA__"></script>
      <div data-sveltekit-preload-data="hover"></div>
      <astro-island></astro-island>
    ` });
    assert.deepEqual(result.findings.map((item) => item.id), ['astro', 'nextjs', 'sveltekit']);
  });

  test('recognizes selected response server indicators without retaining the header', () => {
    const result = analyze({ httpServer: 'nginx/1.27.0 private-build' });
    assert.equal(finding(result, 'nginx').confidence, 'high');
    assert.doesNotMatch(JSON.stringify(result), /1\.27\.0|private-build/);
  });

  test('keeps delivery and application technologies separately attributed', () => {
    const result = analyze({
      httpServer: 'Cloudflare',
      html: '<script id="__NEXT_DATA__"></script>',
    });
    assert.deepEqual(result.findings.map((item) => [item.id, item.category]), [
      ['cloudflare', 'delivery platform'],
      ['nextjs', 'web framework'],
    ]);
  });

  test('sorts findings deterministically by category and name', () => {
    const input = {
      generator: 'Hugo 0.1',
      httpServer: 'Caddy',
      html: '<astro-island></astro-island><section class="shopify-section"></section>',
    };
    const first = analyze(input);
    const second = analyze(input);
    assert.deepEqual(first, second);
    assert.deepEqual(first.findings.map((item) => item.id), ['shopify', 'hugo', 'astro', 'caddy']);
  });

  test('rejects control-bearing generator and server inputs', () => {
    const result = analyze({ generator: 'WordPress\n7', httpServer: 'nginx\t1' });
    assert.deepEqual(result.findings, []);
    assert.equal(result.diagnostics.generatorEvaluated, false);
    assert.equal(result.diagnostics.serverEvaluated, false);
  });

  test('ignores invalid, credential-bearing, and non-HTTP resource origins', () => {
    const result = analyze({
      resourceOrigins: [
        'not a URL',
        'https://user:secret@cdn.shopify.com',
        'javascript://cdn.shopify.com',
        'https://cdn.shopify.com\u0007',
      ],
    });
    assert.deepEqual(result.findings, []);
    assert.equal(result.diagnostics.resourceOriginsEvaluated, 0);
    assert.doesNotMatch(JSON.stringify(result), /secret/);
  });

  test('marks an upstream-truncated response as partial', () => {
    const result = analyze({ html: '<astro-island></astro-island>', sourceTruncated: true });
    assert.equal(result.status, 'partial');
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
    assert.match(result.limitations.join(' '), /captured homepage body was truncated/i);
  });

  test('bounds direct HTML input and ignores markers beyond the evaluated prefix', () => {
    const result = analyze({ html: `${'x'.repeat(MAX_TECHNOLOGY_HTML_CHARS)}<astro-island>` });
    assert.equal(result.status, 'partial');
    assert.equal(result.truncated, true);
    assert.equal(finding(result, 'astro'), undefined);
    assert.match(result.limitations.join(' '), new RegExp(`first ${MAX_TECHNOLOGY_HTML_CHARS}`));
  });

  test('does not mutate input arrays', () => {
    const resourceOrigins = ['https://cdn.shopify.com'];
    const before = structuredClone(resourceOrigins);
    analyze({ resourceOrigins });
    assert.deepEqual(resourceOrigins, before);
  });

  test('does not retain untrusted matched markup or arbitrary upstream strings', () => {
    const result = analyze({
      html: '<script id="__NEXT_DATA__">private-token-value</script>',
      generator: 'WordPress private-generator-value',
      httpServer: 'nginx private-server-value',
    });
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /private-token-value|private-generator-value|private-server-value/);
    assert.match(serialized, /Static markup contains Next\.js bootstrap/);
  });

  test('does not treat comments, ordinary text, or raw-text bodies as live technology markup', () => {
    const result = analyze({ html: `
      <!-- <astro-island></astro-island> -->
      <p>Documentation mentions /_next/static/ and shopify-section.</p>
      <script>const example = '<div data-wf-page="fixture"></div>';</script>
      <style>.example::after { content: 'data-sveltekit-reload='; }</style>
    ` });
    assert.deepEqual(result.findings, []);
  });
});
