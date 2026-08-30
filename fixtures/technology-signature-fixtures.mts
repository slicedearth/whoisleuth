// Versioned, synthetic technology-signature fixtures. Inputs model only the
// bounded evidence already captured by deep Lookup and never trigger network
// requests, script execution, or artifact retention.

import {
  MAX_TECHNOLOGY_HTML_CHARS,
  TECHNOLOGY_SIGNATURE_CATALOGUE,
  type TechnologyInput,
} from '../lib/website-technology.mts';

type TechnologyFixtureKind = 'positive' | 'negative' | 'overlap' | 'truncation';

interface TechnologySignatureFixture {
  id: string;
  label: string;
  kind: TechnologyFixtureKind;
  input: TechnologyInput;
  expectedIds: readonly string[];
  positiveFor: readonly string[];
  negativeFor: readonly string[];
  expectedStatus?: 'success' | 'partial';
}

export const TECHNOLOGY_SIGNATURE_FIXTURE_SCHEMA = 'whoisleuth.technology-signature-fixtures';
export const TECHNOLOGY_SIGNATURE_FIXTURE_VERSION = 1;

export const ALL_TECHNOLOGY_SIGNATURE_IDS = Object.freeze(
  TECHNOLOGY_SIGNATURE_CATALOGUE.map((signature) => signature.id),
);

function positive(
  id: string,
  input: TechnologyInput,
  expectedIds: readonly string[] = [id],
): TechnologySignatureFixture {
  const completeInput = input.html === undefined && input.htmlAnalysis === undefined
    ? { ...input, html: '<main>Fixture technology evidence</main>' }
    : input;
  return Object.freeze({
    id: `positive-${id}`,
    label: `${id} positive evidence`,
    kind: 'positive',
    input: Object.freeze(completeInput),
    expectedIds: Object.freeze([...expectedIds]),
    positiveFor: Object.freeze([id]),
    negativeFor: Object.freeze([]),
  });
}

function negative(
  id: string,
  label: string,
  input: TechnologyInput,
  negativeFor: readonly string[] = ALL_TECHNOLOGY_SIGNATURE_IDS,
): TechnologySignatureFixture {
  return Object.freeze({
    id,
    label,
    kind: 'negative',
    input: Object.freeze(input),
    expectedIds: Object.freeze([]),
    positiveFor: Object.freeze([]),
    negativeFor: Object.freeze([...negativeFor]),
  });
}

const positiveFixtures: TechnologySignatureFixture[] = [
  positive('wordpress', { generator: 'WordPress 7.1' }),
  positive('drupal', { generator: 'Drupal 11' }),
  positive('joomla', { generator: 'Joomla! 5' }),
  positive('ghost', { generator: 'Ghost 6' }),
  positive('craft-cms', { responseHeaders: { 'x-powered-by': 'Craft CMS/5' } }),
  positive('typo3', { generator: 'TYPO3 CMS 13' }),
  positive('shopify', { html: '<section class="shopify-section"></section>' }),
  positive('adobe-commerce-magento', { html: '<main data-mage-init="{&quot;fixture&quot;:{}}"></main>' }),
  positive('bigcommerce', {
    html: '<script src="https://cdn11.bigcommerce.com/s/fixture/stencil-utils.js"></script>',
    resourceOrigins: ['https://cdn11.bigcommerce.com'],
  }),
  positive('woocommerce', {
    html: '<link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/store.css">',
  }, ['wordpress', 'woocommerce']),
  positive('opencart', { html: '<a href="index.php?route=common/home">Fixture</a>' }),
  positive('prestashop', { html: '<link href="/modules/ps_fixture/fixture.css">' }),
  positive('php', { responseHeaders: { 'x-powered-by': 'PHP/8.4 fixture' } }),
  positive('aspnet', { responseHeaders: { 'x-powered-by': 'ASP.NET' } }),
  positive('express', { responseHeaders: { 'x-powered-by': 'Express' } }),
  positive('wix', { generator: 'Wix.com Website Builder' }),
  positive('squarespace', { generator: 'Squarespace 7' }),
  positive('webflow', { generator: 'Webflow 2026' }),
  positive('framer', { generator: 'Framer 2026' }),
  positive('weebly', {
    html: '<link id="wsite-base-style" href="/fixture.css">',
    resourceOrigins: ['https://cdn2.editmysite.com'],
  }),
  positive('angular', { html: '<app-root ng-version="20.1.0"></app-root>' }),
  positive('aspnet-web-forms', { html: '<input type="hidden" name="__VIEWSTATE" value="discarded">' }),
  positive('nextjs', { html: '<script id="__NEXT_DATA__" type="application/json">{}</script>' }),
  positive('nuxt', { html: '<div id="__nuxt"></div>' }),
  positive('gatsby', { html: '<div id="___gatsby"></div>' }),
  positive('sveltekit', { html: '<a data-sveltekit-preload-data="hover" href="/fixture">Fixture</a>' }),
  positive('astro', { html: '<astro-island></astro-island>' }),
  positive('hugo', { generator: 'Hugo 0.150' }),
  positive('jekyll', { generator: 'Jekyll 4' }),
  positive('docusaurus', { generator: 'Docusaurus 3' }),
  positive('eleventy', { generator: 'Eleventy 3' }),
  positive('hexo', { generator: 'Hexo 7' }),
  positive('cloudflare', { httpServer: 'Cloudflare' }),
  positive('cloudfront', { resourceOrigins: ['https://fixture.cloudfront.net'] }),
  positive('netlify', { httpServer: 'Netlify' }),
  positive('vercel', { httpServer: 'Vercel' }),
  positive('fastly', { responseHeaders: { 'x-served-by': 'cache-fixture-FIX' } }),
  positive('nginx', { httpServer: 'nginx/1.27' }),
  positive('apache-http-server', { httpServer: 'Apache/2.4' }),
  positive('microsoft-iis', { httpServer: 'Microsoft-IIS/10.0' }),
  positive('litespeed', { httpServer: 'OpenLiteSpeed/1.8' }),
  positive('caddy', { httpServer: 'Caddy' }),
];

const negativeFixtures: TechnologySignatureFixture[] = [
  negative('negative-plain-page', 'Ordinary static page', {
    html: '<main><h1>Example service</h1><p>No implementation metadata is declared.</p></main>',
  }),
  negative('negative-ordinary-copy', 'Technology names in ordinary visible copy', {
    html: '<main>Documentation compares content systems, commerce services, site builders, frameworks, static generators, delivery networks, and web servers without publishing implementation markers.</main>',
  }),
  negative('negative-inert-markup', 'Markers inside comments, raw text, and templates', {
    html: `
      <!-- <astro-island></astro-island><div data-wf-page="fixture"></div> -->
      <script>const example = '<script id="__NEXT_DATA__"></script>';</script>
      <style>.fixture::after { content: 'shopify-section ng-version= data-sveltekit-reload='; }</style>
      <template><div data-drupal-selector="fixture"></div></template>
      <title><astro-island></astro-island></title>
    `,
  }),
  negative('negative-shared-origins', 'Generic shared delivery and widget origins', {
    resourceOrigins: [
      'https://cdn.example.test',
      'https://assets.example.test',
      'https://widgets.example.test',
    ],
  }),
  negative('negative-embedded-platform-assets', 'Embedded third-party platform assets without page markers', {
    resourceOrigins: [
      'https://cdn.shopify.com',
      'https://assets.wixstatic.com',
      'https://static.squarespace.com',
      'https://assets.framerusercontent.com',
      'https://cdn2.editmysite.com',
      'https://cdn11.bigcommerce.com',
    ],
  }, ['shopify', 'bigcommerce', 'wix', 'squarespace', 'framer', 'weebly']),
  negative('negative-malformed-inputs', 'Malformed and control-bearing evidence', {
    generator: 'WordPress\n7',
    httpServer: 'nginx\t1',
    resourceOrigins: [
      'not a URL',
      'https://user:secret@cdn.example.test',
      'javascript://assets.example.test',
    ],
  }),
  Object.freeze({
    id: 'negative-marker-after-input-cap',
    label: 'Marker beyond the evaluated HTML prefix',
    kind: 'truncation',
    input: Object.freeze({ html: `${'x'.repeat(MAX_TECHNOLOGY_HTML_CHARS)}<astro-island></astro-island>` }),
    expectedIds: Object.freeze([]),
    positiveFor: Object.freeze([]),
    negativeFor: Object.freeze(['astro']),
    expectedStatus: 'partial',
  }),
];

const overlapFixtures: TechnologySignatureFixture[] = [
  Object.freeze({
    id: 'overlap-application-and-delivery',
    label: 'Application framework behind a delivery service',
    kind: 'overlap',
    input: Object.freeze({
      httpServer: 'Cloudflare',
      html: '<script id="__NEXT_DATA__" type="application/json">{}</script>',
    }),
    expectedIds: Object.freeze(['cloudflare', 'nextjs']),
    positiveFor: Object.freeze([]),
    negativeFor: Object.freeze([]),
  }),
  Object.freeze({
    id: 'overlap-content-and-commerce',
    label: 'Commerce plugin on a content platform',
    kind: 'overlap',
    input: Object.freeze({
      html: '<link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/store.css">',
    }),
    expectedIds: Object.freeze(['wordpress', 'woocommerce']),
    positiveFor: Object.freeze([]),
    negativeFor: Object.freeze([]),
  }),
  Object.freeze({
    id: 'truncation-retained-prefix',
    label: 'Valid marker in an upstream-truncated captured prefix',
    kind: 'truncation',
    input: Object.freeze({
      html: '<astro-island></astro-island>',
      sourceTruncated: true,
    }),
    expectedIds: Object.freeze(['astro']),
    positiveFor: Object.freeze([]),
    negativeFor: Object.freeze([]),
    expectedStatus: 'partial',
  }),
];

export const TECHNOLOGY_SIGNATURE_FIXTURES: ReadonlyArray<TechnologySignatureFixture> = Object.freeze([
  ...positiveFixtures,
  ...negativeFixtures,
  ...overlapFixtures,
]);

export type { TechnologyFixtureKind, TechnologySignatureFixture };
