import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeWebsiteTechnology, minimiseTechnologyMarkup } from '../lib/website-technology.mts';
import { analyzeStaticHtml } from '../lib/static-html-analysis.mts';
import { buildReviewedTechnologyFixture } from '../tools/technology-fixture-review.mts';

const ids = (html: string) => analyzeWebsiteTechnology({ html }).findings.map((finding) => finding.id);
const roles = (html: string, extra: Record<string, unknown> = {}) => (
  analyzeWebsiteTechnology({ html, ...extra }).findings.map(({ id, roles }) => [id, roles])
);

test('structural technology markers reject mentions in unrelated attributes, text and tag names', () => {
  const negatives = [
    '<main title="data-drupal-selector= data-mesh-id= data-wf-page= data-framer-name= ng-version="></main>',
    '<main data-example="data-ghost-search shopify.theme shopify-section squarespace-context stencil-utils"></main>',
    '<main class="not-shopify-section shopify-section-copy"></main>',
    '<main type="text/x-magento-init" title="data-mage-init="></main>',
    '<main name="__VIEWSTATE" id="__NEXT_DATA__"></main>',
    '<main title="id=&quot;__nuxt&quot; id=&quot;___gatsby&quot;"></main>',
    '<main title="data-sveltekit-preload-data= data-sveltekit-reload="></main>',
    '<astro-island-example></astro-island-example><astro-slot-copy></astro-slot-copy>',
    '<div id="wsite-base-style" title="wsite-theme-css"></div>',
    '<main title="/wp-content/ /wp-includes/ /modules/ps_example/ /_next/static/ /_app/immutable/ /_astro/"></main>',
    '<p>index.php?route=common/home image/catalog/opencart-logo.png /page-data/app-data.json</p>',
    '<template><main data-mage-init="{}" ng-version="1"></main><astro-island></astro-island></template>',
    '<template data-mage-init="{}" data-wf-site="fixture"></template>',
    '<svg><g ng-version="1" data-drupal-selector="fixture"></g><astro-island></astro-island></svg>',
    '<!-- <main data-wf-site="fixture"></main> --><script>"<astro-island>"</script>',
  ];
  for (const html of negatives) {
    assert.deepEqual(ids(html), [], html);
    assert.equal(minimiseTechnologyMarkup({ html }), '', html);
  }
});

test('real attributes, token boundaries and HTML namespace integration remain recognisable', () => {
  const cases = [
    ['<main DATA-DRUPAL-SELECTOR="fixture"></main>', 'drupal'],
    ['<button data-ghost-search>Search</button>', 'ghost'],
    ['<section class="content shopify-section other"></section>', 'shopify'],
    ['<section id="shopify-section-fixture"></section>', 'shopify'],
    ['<script type="text/x-magento-init">{}</script>', 'adobe-commerce-magento'],
    ['<main data-mesh-id="fixture"></main>', 'wix'],
    ['<html data-wf-site="fixture"></html>', 'webflow'],
    ['<main data-framer-name="fixture"></main>', 'framer'],
    ['<link title="wsite-theme-css" href="/style.css">', 'weebly'],
    ['<main ng-version="fixture"></main>', 'angular'],
    ['<input id="__VIEWSTATE">', 'aspnet-web-forms'],
    ['<script id="__NEXT_DATA__"></script>', 'nextjs'],
    ['<main id="__nuxt"></main>', 'nuxt'],
    ['<main id="___gatsby"></main>', 'gatsby'],
    ['<a data-sveltekit-reload></a>', 'sveltekit'],
    ['<astro-slot></astro-slot>', 'astro'],
    ['<svg><foreignObject><main data-mage-init="{}"></main></foreignObject></svg>', 'adobe-commerce-magento'],
  ];
  for (const [html, expected] of cases) {
    assert.deepEqual(ids(html!), [expected], html);
    assert.deepEqual(ids(minimiseTechnologyMarkup({ html })), [expected], html);
  }
});

test('resource clues use intended URL paths, not queries, fragments, usernames or unrelated elements', () => {
  for (const html of [
    '<script src="/asset.js?example=/_next/static/private"></script>',
    '<link href="/asset.css#/_app/immutable/private">',
    '<img src="https://assets.example.test/?path=/wp-content/uploads/">',
    '<script src="https://cdn11.bigcommerce.com.example.test/s-fixture/theme.js"></script>',
    '<script src="https://cdn11.bigcommerce.com@assets.example.test/s-fixture/theme.js"></script>',
    '<script src="javascript:/_nuxt/fixture.js"></script>',
    '<script src="data:text/plain,/_astro/fixture.js"></script>',
    '<main src="/_next/static/fixture.js"></main>',
    '<a href="/_next/static/fixture.js">Documentation</a>',
    '<link rel="canonical" href="/_next/static/fixture.js">',
    '<link rel="alternate" href="/_app/immutable/fixture.js">',
    '<img src="/images/not-stencil-utils.png">',
    '<link href="/_next/staticity/fixture.css">',
    '<link href="/page-data/app-data.json.example">',
    '<a href="index.php?next=route=common/home"></a>',
    '<a href="index.php?route=common/home&amp;route=other"></a>',
    '<a href="copy-index.php?route=common/home"></a>',
  ]) assert.deepEqual(ids(html), [], html);
  assert.deepEqual(ids('<a href="/shop/index.php?locale=en&amp;route=common%2Fhome"></a>'), ['opencart']);
  assert.deepEqual(ids('<script src="/site/_next/static/fixture.js?discarded=private#part"></script>'), ['nextjs']);
});

test('off-origin resource attribution does not depend on a retained origin summary', () => {
  const origin = 'https://page.example.test';
  for (const resourceOrigins of [undefined, [], Array.from({ length: 30 }, (_, index) => `https://r${index}.example.test`)]) {
    assert.deepEqual(roles('<script src="https://assets.example.test/_next/static/fixture.js"></script>', {
      documentOrigin: origin, effectiveBaseUrl: `${origin}/page`, resourceOrigins,
    }), [['nextjs', ['embedded_dependency']]]);
  }
  assert.deepEqual(roles('<link href="https://assets.example.test/wp-content/fixture.css">'), [['wordpress', ['embedded_dependency']]]);
  assert.deepEqual(roles('<script src="//assets.example.test/_astro/fixture.js"></script>'), [['astro', ['embedded_dependency']]]);
  assert.deepEqual(roles('<script src="/_next/static/fixture.js"></script>', { documentOrigin: origin }), [['nextjs', ['framework_runtime']]]);
  assert.deepEqual(roles(`<script src="${origin}/_next/static/fixture.js"></script>`, { documentOrigin: `${origin}/` }), [['nextjs', ['framework_runtime']]]);
});

test('the first effective document base controls relative evidence and remains conservative without an origin', () => {
  const html = '<base href="https://assets.example.test/"><script src="_nuxt/fixture.js"></script>';
  assert.deepEqual(roles(html, { documentOrigin: 'https://page.example.test' }), [['nuxt', ['embedded_dependency']]]);
  assert.deepEqual(roles('<script src="/_nuxt/fixture.js"></script>', { effectiveBaseUrl: 'https://assets.example.test/' }), [['nuxt', ['embedded_dependency']]]);
  assert.deepEqual(roles('<script src="/_nuxt/fixture.js"></script>', { documentOrigin: 'invalid' }), [['nuxt', ['embedded_dependency']]]);
  const analysis = analyzeStaticHtml(html, { baseUrl: 'https://page.example.test' });
  assert.deepEqual(roles('', { htmlAnalysis: analysis, documentOrigin: 'https://page.example.test' }), [['nuxt', ['embedded_dependency']]]);
});

test('a header-only observation never evaluates contradictory page fields', () => {
  const result = analyzeWebsiteTechnology({
    htmlAvailable: false, html: '<main data-wf-site="fixture"></main>', generator: 'WordPress',
    htmlAnalysis: analyzeStaticHtml('<astro-island></astro-island>'),
    resourceOrigins: ['https://cloudfront.net'], httpServer: 'nginx',
  });
  assert.deepEqual(result.findings.map(({ id }) => id), ['nginx']);
  assert.equal(result.browserLibraryProfile, null);
  assert.equal(result.complete, false);
  assert.equal(result.diagnostics.htmlEvaluated, false);
  assert.equal(result.diagnostics.resourceOriginsEvaluated, 0);
});

test('minimisation preserves external-resource roles without retaining actual hosts, query strings or paths', () => {
  const input = { html: '<script src="https://private.example.test/_next/static/private-build.js?secret=value"></script>' };
  const html = minimiseTechnologyMarkup(input);
  assert.deepEqual(roles(html), [['nextjs', ['embedded_dependency']]]);
  assert.doesNotMatch(html, /private|secret|value/u);
  assert.match(html, /embedded\.invalid/u);
});

test('contribution review cannot turn a quoted marker into a positive platform fixture', () => {
  assert.throws(() => buildReviewedTechnologyFixture({
    schema: 'whoisleuth.technology-fixture-review-input', version: 2,
    id: 'structural-control', reviewedAt: '2026-09-09T00:00:00.000Z', observedAt: '2026-09-09T00:00:00.000Z',
    licenseBasis: 'factual-observation', expectedIds: ['wix'], negativeFor: [],
    input: { html: '<main title="data-mesh-id=fixture"></main>' },
  }), /no recognised structural catalogue marker/u);
});

test('a distinctive platform bundle is only an embedded clue, never an origin-host or application claim', () => {
  const html = '<script src="https://assets.squarespace.com/universal/scripts-compressed/bundle-hash-min.en-AU.js"></script>';
  assert.deepEqual(roles(html), [['squarespace', ['embedded_dependency']]]);
  assert.deepEqual(roles(minimiseTechnologyMarkup({ html })), [['squarespace', ['embedded_dependency']]]);
  for (const invalid of [
    '<script src="https://assets.squarespace.com.example.test/universal/scripts-compressed/fixture.js"></script>',
    '<main title="https://assets.squarespace.com/universal/scripts-compressed/fixture.js"></main>',
    '<script src="https://assets.squarespace.com/other/fixture.js?path=/universal/scripts-compressed/fixture.js"></script>',
  ]) assert.deepEqual(ids(invalid), []);
  assert.deepEqual(roles('<main data-marker="squarespace-context"></main>', { resourceOrigins: ['https://static1.squarespace.com'] }), []);
});
