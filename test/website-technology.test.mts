import { requiredValue } from './value-assertions.mts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_TECHNOLOGY_HTML_CHARS,
  TECHNOLOGY_PROFILE_VERSION,
  analyzeWebsiteTechnology,
  captureTechnologyResponseHeaders,
} from '../lib/website-technology.mts';
import type { TechnologyFinding } from '../lib/website-technology.mts';

const observedAt = '2026-07-22T01:02:03.000Z';

function analyze(overrides = {}) {
  return analyzeWebsiteTechnology({ observedAt, ...overrides });
}

function finding(
  result: ReturnType<typeof analyzeWebsiteTechnology>,
  id: string,
): TechnologyFinding {
  const item = result.findings.find((finding) => finding.id === id);
  assert.ok(item);
  return item;
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

  test('recognizes distinctive commerce platform markers without another request', () => {
    const result = analyze({
      html: `
        <main data-mage-init='{"fixture":{}}'></main>
        <link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/store.css">
        <script src="https://cdn11.bigcommerce.com/s/fixture/stencil-utils.js"></script>
      `,
      resourceOrigins: ['https://cdn11.bigcommerce.com'],
    });

    assert.deepEqual(result.findings.filter((item) => item.category === 'commerce').map((item) => item.id), [
      'adobe-commerce-magento',
      'bigcommerce',
      'woocommerce',
    ]);
    assert.equal(finding(result, 'adobe-commerce-magento').confidence, 'high');
    assert.equal(finding(result, 'bigcommerce').confidence, 'medium');
    assert.equal(finding(result, 'woocommerce').confidence, 'high');
    assert.equal(finding(result, 'wordpress').confidence, 'medium');
  });

  test('does not infer commerce platforms from ordinary page text or unrelated origins', () => {
    const result = analyze({
      html: '<main>Migration notes mention Magento, BigCommerce, OpenCart, PrestaShop, and WooCommerce.</main>',
      resourceOrigins: ['https://developer.bigcommerce.com'],
    });

    assert.equal(result.findings.find((item) => item.id === 'adobe-commerce-magento'), undefined);
    assert.equal(result.findings.find((item) => item.id === 'bigcommerce'), undefined);
    assert.equal(result.findings.find((item) => item.id === 'opencart'), undefined);
    assert.equal(result.findings.find((item) => item.id === 'prestashop'), undefined);
    assert.equal(result.findings.find((item) => item.id === 'woocommerce'), undefined);
  });

  test('recognises a PrestaShop installation from its default module asset convention', () => {
    const result = analyze({
      html: '<link rel="stylesheet" href="/modules/ps_feature/fixture.css">',
    });

    const item = finding(result, 'prestashop');
    assert.equal(item.confidence, 'high');
    assert.deepEqual(item.evidence, [{
      source: 'static HTML',
      role: 'application_platform',
      description: 'Static resource paths use PrestaShop module conventions.',
    }]);
    assert.doesNotMatch(JSON.stringify(result), /ps_feature|fixture\.css/u);
  });

  test('recognises OpenCart routing and default asset conventions without page copy', () => {
    const result = analyze({
      html: '<a href="index.php?route=common/home"><img src="image/catalog/opencart-logo.png" alt="Store"></a>',
    });

    const item = finding(result, 'opencart');
    assert.equal(item.confidence, 'high');
    assert.deepEqual(item.evidence, [{
      source: 'static HTML',
      role: 'application_platform',
      description: 'Static markup contains OpenCart routing or default asset conventions.',
    }]);
    assert.doesNotMatch(JSON.stringify(result), /common\/home|opencart-logo|Store/u);
  });

  test('recognises a Netlify request identifier behind another selected server', () => {
    const result = analyze({
      httpServer: 'cloudflare',
      responseHeaders: {
        'x-nf-request-id': 'bounded-request-marker',
      },
    });

    const item = finding(result, 'netlify');
    assert.equal(item.confidence, 'medium');
    assert.deepEqual(item.evidence, [{
      source: 'passive response header',
      role: 'application_platform',
      description: 'A Netlify application-platform response header was observed.',
    }]);
    assert.doesNotMatch(JSON.stringify(result), /bounded-request-marker/u);
  });

  test('does not identify a site-builder platform from an embedded resource origin alone', () => {
    const result = analyze({ resourceOrigins: ['https://assets.wixstatic.com'] });
    assert.equal(result.findings.find((item) => item.id === 'wix'), undefined);
  });

  test('recognises Weebly theme attributes alongside its bounded resource origin', () => {
    const result = analyze({
      html: '<link id="wsite-base-style" href="/css/sites.css">',
      resourceOrigins: ['https://static.editmysite.com'],
    });
    const item = finding(result, 'weebly');
    assert.equal(item.confidence, 'high');
    assert.deepEqual(item.evidence.map((entry) => entry.source), ['static HTML', 'resource origin']);
    assert.doesNotMatch(JSON.stringify(result), /wsite-base-style|static\.editmysite/u);
  });

  test('recognizes bounded static framework markers case-insensitively', () => {
    const result = analyze({ html: `
      <script id="__NEXT_DATA__"></script>
      <div data-sveltekit-preload-data="hover"></div>
      <astro-island></astro-island>
    ` });
    assert.deepEqual(result.findings.map((item) => item.id), ['astro', 'nextjs', 'sveltekit']);
  });

  test('recognizes an Astro static build from its generated asset path', () => {
    const result = analyze({
      html: '<link rel="stylesheet" href="/_astro/layout.fixture.css"><script type="module" src="/_astro/page.fixture.js"></script>',
    });
    const item = finding(result, 'astro');
    assert.equal(item.confidence, 'medium');
    assert.deepEqual(item.evidence, [{
      source: 'static HTML',
      role: 'framework_runtime',
      description: 'Static asset paths use Astro build conventions.',
    }]);
  });

  test('recognizes selected response server indicators without retaining the header', () => {
    const result = analyze({ httpServer: 'nginx/1.27.0 private-build' });
    assert.equal(finding(result, 'nginx').confidence, 'high');
    assert.doesNotMatch(JSON.stringify(result), /1\.27\.0|private-build/);
  });

  test('recognises the standard cache-node response marker and rejects an obsolete request-id clue', () => {
    const observed = analyzeWebsiteTechnology({
      responseHeaders: {
        'x-served-by': 'cache-control-fixture-CONTROL-SYD, cache-syd12345-SYD',
      },
    });
    const obsolete = analyzeWebsiteTechnology({
      responseHeaders: { 'x-fastly-request-id': 'private-request-id' },
    });

    assert.equal(observed.findings.some((finding) => finding.id === 'fastly'), true);
    assert.equal(obsolete.findings.some((finding) => finding.id === 'fastly'), false);
    assert.doesNotMatch(JSON.stringify(observed), /cache-syd12345|private-request-id/u);
  });

  test('recognizes allowlisted passive response headers without retaining their values', () => {
    const result = analyze({
      html: '<main>Fixture</main>',
      responseHeaders: {
        'x-powered-by': 'PHP/8.4 private-build',
        'x-vercel-id': 'private-request-value',
        'x-generator': 'unused-private-generator',
        'x-unrelated-secret': 'must-not-be-evaluated',
      },
    });
    assert.deepEqual(result.findings.map((item) => item.id), ['php', 'vercel']);
    assert.ok(result.findings.every((item) => item.evidence[0]?.source === 'passive response header'));
    assert.equal(result.diagnostics.passiveHeadersEvaluated, 2);
    assert.doesNotMatch(JSON.stringify(result), /8\\.4|private-build|private-request-value|unused-private-generator|must-not-be-evaluated/);
  });

  test('recognises the default CMS runtime header without retaining its value', () => {
    const result = analyze({
      responseHeaders: {
        'x-powered-by': 'Craft CMS/5.10.13.1',
      },
    });

    assert.deepEqual(result.findings.map((item) => item.id), ['craft-cms']);
    assert.deepEqual(finding(result, 'craft-cms').evidence, [{
      source: 'passive response header',
      role: 'application_platform',
      description: 'The passive X-Powered-By response header identifies Craft CMS.',
    }]);
    assert.doesNotMatch(JSON.stringify(result), /5\.10\.13\.1/u);
  });

  test('requires exact allowlisted header value signatures for runtime indicators', () => {
    const result = analyze({
      html: '<main>Fixture</main>',
      responseHeaders: {
        'x-powered-by': 'A private application mentions PHP',
      },
    });
    assert.equal(result.findings.find((item) => item.id === 'php'), undefined);
    assert.equal(result.findings.find((item) => item.id === 'craft-cms'), undefined);
  });

  test('recognizes an expanded set of generator-declared platforms', () => {
    const cases = [
      ['TYPO3 CMS 13', 'typo3', 'content management'],
      ['Wix.com Website Builder', 'wix', 'site builder'],
      ['Framer 2026', 'framer', 'site builder'],
      ['Docusaurus v3.8', 'docusaurus', 'static site generator'],
      ['Eleventy v3', 'eleventy', 'static site generator'],
      ['11ty 3.1', 'eleventy', 'static site generator'],
      ['Hexo 7', 'hexo', 'static site generator'],
    ];

    for (const [generator, id, category] of cases) {
      const item = finding(analyze({ generator }), requiredValue(id));
      assert.equal(item.category, category, requiredValue(generator));
      assert.equal(item.confidence, 'high', requiredValue(generator));
      assert.equal(requiredValue(item.evidence[0]).source, 'generator metadata', requiredValue(generator));
    }
  });

  test('recognizes tokenized framework attributes and static build paths', () => {
    const result = analyze({ html: `
      <app-root ng-version="20.1.0"></app-root>
      <input type="hidden" name="__VIEWSTATE" value="discarded">
      <link rel="modulepreload" href="/_app/immutable/entry/start.fixture.js">
    ` });

    assert.deepEqual(result.findings.filter((item) => item.category === 'web framework').map((item) => item.id), [
      'angular',
      'aspnet-web-forms',
      'sveltekit',
    ]);
    assert.equal(finding(result, 'angular').confidence, 'high');
    assert.equal(finding(result, 'aspnet-web-forms').confidence, 'high');
    assert.equal(finding(result, 'sveltekit').confidence, 'medium');
    assert.doesNotMatch(JSON.stringify(result), /20\.1\.0|discarded|start\.fixture/);
  });

  test('keeps embedded site-builder resource origins neutral without page evidence', () => {
    const result = analyze({
      resourceOrigins: [
        'https://assets.framerusercontent.com',
        'https://cdn2.editmysite.com',
      ],
    });

    assert.deepEqual(result.findings, []);
  });

  test('requires both storefront markup and origin evidence for a shared commerce CDN', () => {
    assert.deepEqual(analyze({
      resourceOrigins: ['https://cdn11.bigcommerce.com'],
    }).findings, []);
    assert.equal(finding(analyze({
      html: '<script src="https://cdn11.bigcommerce.com/s/fixture/stencil-utils.js"></script>',
      resourceOrigins: ['https://cdn11.bigcommerce.com'],
    }), 'bigcommerce').confidence, 'medium');
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
    assert.deepEqual(finding(result, 'cloudflare').roles, ['observed_edge']);
    assert.deepEqual(finding(result, 'nextjs').roles, ['framework_runtime']);
  });

  test('keeps incomplete edge, platform, and generic runtime indicators separately attributed', () => {
    const result = analyzeWebsiteTechnology({
      htmlAvailable: false,
      httpServer: 'Cloudflare',
      responseHeaders: {
        'x-nf-request-id': 'bounded-platform-indicator',
        'x-vercel-id': 'conflicting-platform-indicator',
        'x-powered-by': 'PHP/8.4',
      },
      observedAt,
    });

    assert.equal(result.status, 'partial');
    assert.equal(result.complete, false);
    assert.deepEqual(result.findings.map((item) => [item.id, item.roles]), [
      ['php', ['framework_runtime']],
      ['cloudflare', ['observed_edge']],
      ['netlify', ['application_platform']],
      ['vercel', ['application_platform']],
    ]);
    assert.deepEqual(result.findings.map((item) => item.evidence[0]?.source), [
      'passive response header',
      'HTTP server header',
      'passive response header',
      'passive response header',
    ]);
    assert.match(result.limitations.join(' '), /HTML page identity was unavailable/i);
    assert.doesNotMatch(JSON.stringify(result), /bounded-platform-indicator|conflicting-platform-indicator|8\.4/u);
  });

  test('recognizes CloudFront from retained resource evidence', () => {
    const resourceResult = analyze({ resourceOrigins: ['https://assets.fixture.cloudfront.net'] });
    assert.equal(finding(resourceResult, 'cloudfront').confidence, 'medium');
    assert.deepEqual(finding(resourceResult, 'cloudfront').roles, ['embedded_dependency']);
  });

  test('captures only canonical bounded technology headers for direct analysis', () => {
    const captured = captureTechnologyResponseHeaders(new Headers({
      'x-nf-request-id': 'platform-indicator',
      'x-powered-by': 'PHP/8.4',
      'x-unrelated-secret': 'must-not-be-retained',
    }));
    assert.deepEqual(captured, {
      'x-nf-request-id': 'platform-indicator',
      'x-powered-by': 'PHP/8.4',
    });
    assert.deepEqual(captureTechnologyResponseHeaders({
      'x-vercel-id': 'x'.repeat(241),
      'cf-ray': 'invalid\nvalue',
      authorization: 'private',
    }), {});
  });

  test('keeps header-only evidence partial and independent from HTML identity', () => {
    const result = analyzeWebsiteTechnology({
      htmlAvailable: false,
      responseHeaders: { 'x-vercel-id': 'bounded-platform-indicator' },
      observedAt,
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.complete, false);
    assert.equal(result.truncated, false);
    assert.equal(result.diagnostics.htmlEvaluated, false);
    assert.equal(result.browserLibraryProfile, null);
    assert.deepEqual(finding(result, 'vercel').roles, ['application_platform']);
    assert.match(result.limitations.join(' '), /HTML page identity was unavailable/i);
    assert.doesNotMatch(JSON.stringify(result), /bounded-platform-indicator/u);
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
    assert.equal(result.findings.find((item) => item.id === 'astro'), undefined);
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
      <title><astro-island></astro-island></title>
      <script>const example = '<div data-wf-page="fixture"></div>';</script>
      <style>.example::after { content: 'data-sveltekit-reload= ng-version= data-framer-name='; }</style>
    ` });
    assert.deepEqual(result.findings, []);
  });

  test('bounds deeply nested hostile markup without constructing a DOM tree', () => {
    const html = '<div>'.repeat(MAX_TECHNOLOGY_HTML_CHARS / 5);
    const startedAt = performance.now();
    const result = analyze({ html });
    const elapsedMs = performance.now() - startedAt;

    assert.equal(result.status, 'partial');
    assert.equal(result.diagnostics.tagLimitReached, true);
    assert.equal(requiredValue(result.browserLibraryProfile).status, 'partial');
    assert.ok(elapsedMs < 2_000, `Expected bounded tokenization under 2 seconds; received ${Math.round(elapsedMs)}ms.`);
  });
});
