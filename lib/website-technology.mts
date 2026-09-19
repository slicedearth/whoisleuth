// Versioned, bounded technology indicators derived from the HTTP and static
// HTML evidence already collected by a deep lookup. A standards-compliant
// parser identifies live elements and attributes without executing scripts.
// Signatures emit only curated labels and fixed evidence descriptions; matched
// markup, header values, URL paths, and arbitrary upstream strings are never
// retained.

import { analyzeBrowserLibraries } from './browser-library-profile.mts';
import { createObservation } from '../packages/evidence/observation.mts';
import {
  attributeValue,
  createTechnologyMarkupContext,
  elementMarker,
  hasAttributes,
  navigationMarker,
  resourceMarker,
  type TechnologyMarkupContext,
  type TechnologyMarkupRule,
} from './technology-markup.mts';
import {
  MAX_STATIC_HTML_CHARS,
  MAX_STATIC_HTML_TAGS as MAX_TECHNOLOGY_TAGS,
  analyzeStaticHtml,
  type StaticHtmlAnalysis,
} from './static-html-analysis.mts';
import {
  TECHNOLOGY_EVIDENCE_ROLE_ORDER,
  type TechnologyEvidenceRole,
} from './technology-evidence-role.mts';
import {
  MAX_EVIDENCE_PER_TECHNOLOGY,
  MAX_TECHNOLOGY_EVIDENCE_DESCRIPTION_LENGTH,
  MAX_TECHNOLOGY_FINDINGS,
  TECHNOLOGY_PROFILE_VERSION,
} from './lookup-child-profile-contract.mts';

const TECHNOLOGY_CATEGORIES = Object.freeze([
  'application runtime',
  'content management',
  'commerce',
  'site builder',
  'web framework',
  'static site generator',
  'web server',
  'delivery platform',
] as const);
type TechnologyCategory = (typeof TECHNOLOGY_CATEGORIES)[number];
type TechnologyConfidence = 'high' | 'medium';
const TECHNOLOGY_EVIDENCE_SOURCES = Object.freeze([
  'generator metadata',
  'static HTML',
  'resource origin',
  'HTTP server header',
  'passive response header',
] as const);
type TechnologyEvidenceSource = (typeof TECHNOLOGY_EVIDENCE_SOURCES)[number];
type TechnologyEvidence = {
  source: TechnologyEvidenceSource;
  role: TechnologyEvidenceRole;
  description: string;
};
type TechnologyFinding = {
  id: string;
  name: string;
  category: TechnologyCategory;
  confidence: TechnologyConfidence;
  roles: TechnologyEvidenceRole[];
  evidence: TechnologyEvidence[];
};
type TechnologyInput = {
  html?: unknown;
  htmlAvailable?: unknown;
  generator?: unknown;
  httpServer?: unknown;
  resourceOrigins?: unknown;
  responseHeaders?: unknown;
  htmlAnalysis?: StaticHtmlAnalysis;
  effectiveBaseUrl?: unknown;
  documentOrigin?: unknown;
  observedAt?: unknown;
  sourceTruncated?: unknown;
  signal?: AbortSignal;
};
type MatchContext = TechnologyMarkupContext & {
  generator: string;
  httpServer: string;
  resourceHosts: Set<string>;
  responseHeaders: ReadonlyMap<string, string>;
};
type SignatureEvidence = Omit<TechnologyEvidence, 'role'> & {
  markupRules?: readonly TechnologyMarkupRule[];
  role?: TechnologyEvidenceRole;
  roleFor?: (context: MatchContext) => TechnologyEvidenceRole | undefined;
  confidence: TechnologyConfidence;
  matches: (context: MatchContext) => boolean;
};
type TechnologySignature = {
  id: string;
  name: string;
  category: TechnologyCategory;
  evidence: SignatureEvidence[];
  minimumEvidenceMatches?: 2;
  requiresNonResourceEvidence?: boolean;
  allowEmbeddedOnly?: boolean;
};
type TechnologySignatureDescriptor = Readonly<{
  id: string;
  name: string;
  category: TechnologyCategory;
  minimumEvidenceMatches: 1 | 2;
  requiresNonResourceEvidence: boolean;
  evidence: ReadonlyArray<Readonly<Omit<SignatureEvidence, 'matches' | 'markupRules'>>>;
}>;

const MAX_TECHNOLOGY_HTML_CHARS = MAX_STATIC_HTML_CHARS;
const MAX_RESOURCE_ORIGINS = 30;
const MAX_GENERATOR_INPUT = 160;
const MAX_SERVER_INPUT = 240;
const MAX_PASSIVE_RESPONSE_HEADERS = 8;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;

function boundedLowercase(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength || CONTROL_CHARACTER_RE.test(value)) return '';
  return value.trim().toLowerCase();
}

function normalizedResourceHosts(value: unknown): Set<string> {
  const hosts = new Set<string>();
  for (const item of (Array.isArray(value) ? value : []).slice(0, MAX_RESOURCE_ORIGINS)) {
    if (typeof item !== 'string' || item.length > 2048 || CONTROL_CHARACTER_RE.test(item)) continue;
    try {
      const parsed = new URL(item);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) continue;
      hosts.add(parsed.hostname.toLowerCase());
    } catch {
      // An invalid retained origin cannot contribute to a technology finding.
    }
  }
  return hosts;
}

const PASSIVE_TECHNOLOGY_HEADER_NAMES = Object.freeze([
  'cf-ray',
  'x-drupal-cache',
  'x-served-by',
  'x-nf-request-id',
  'x-powered-by',
  'x-shopify-stage',
  'x-sorting-hat-podid',
  'x-vercel-id',
] as const);
const PASSIVE_HEADER_NAMES = new Set<string>(PASSIVE_TECHNOLOGY_HEADER_NAMES);

function technologyHeaderValue(value: unknown): string {
  if (typeof value !== 'string' || value.length > 240 || CONTROL_CHARACTER_RE.test(value)) return '';
  return value.trim();
}

function captureTechnologyResponseHeaders(value: unknown): Record<string, string> {
  const output: Record<string, string> = {};
  const getter = value && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function'
    ? (value as { get(name: string): unknown }).get.bind(value)
    : null;
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  for (const name of PASSIVE_TECHNOLOGY_HEADER_NAMES) {
    let rawValue: unknown;
    try {
      rawValue = getter ? getter(name) : record?.[name];
    } catch {
      rawValue = undefined;
    }
    const headerValue = technologyHeaderValue(rawValue);
    if (headerValue) output[name] = headerValue;
  }
  return output;
}

function normalizedResponseHeaders(value: unknown): ReadonlyMap<string, string> {
  const output = new Map<string, string>();
  for (const [name, rawValue] of Object.entries(captureTechnologyResponseHeaders(value))) {
    if (!PASSIVE_HEADER_NAMES.has(name)) continue;
    const normalized = boundedLowercase(rawValue, 240);
    if (!normalized) continue;
    output.set(name, normalized);
    if (output.size >= MAX_PASSIVE_RESPONSE_HEADERS) break;
  }
  return output;
}

function generatorEvidence(pattern: RegExp, description: string): SignatureEvidence {
  return {
    source: 'generator metadata',
    description,
    confidence: 'high',
    matches: ({ generator }) => pattern.test(generator),
  };
}

function htmlEvidence(markupRules: readonly TechnologyMarkupRule[], description: string, confidence: TechnologyConfidence = 'high'): SignatureEvidence {
  return {
    source: 'static HTML',
    description,
    confidence,
    markupRules,
    matches: (context) => markupRules.some((rule) => rule.matches(context)),
    roleFor: (context) => markupRules.some((rule) => rule.matches(context) && !rule.embedded?.(context))
      ? undefined
      : 'embedded_dependency',
  };
}

function resourceEvidence(hosts: string[], description: string): SignatureEvidence {
  return {
    source: 'resource origin',
    description,
    confidence: 'medium',
    matches: ({ resourceHosts }) => hosts.some((host) => resourceHosts.has(host) || [...resourceHosts].some((value) => value.endsWith(`.${host}`))),
  };
}

function resourcePatternEvidence(pattern: RegExp, description: string): SignatureEvidence {
  return {
    source: 'resource origin',
    description,
    confidence: 'medium',
    matches: ({ resourceHosts }) => [...resourceHosts].some((host) => pattern.test(host)),
  };
}

function serverEvidence(pattern: RegExp, description: string, confidence: TechnologyConfidence = 'high'): SignatureEvidence {
  return {
    source: 'HTTP server header',
    description,
    confidence,
    matches: ({ httpServer }) => pattern.test(httpServer),
  };
}

function responseHeaderEvidence(
  name: string,
  pattern: RegExp | null,
  description: string,
  confidence: TechnologyConfidence = 'high',
): SignatureEvidence {
  return {
    source: 'passive response header',
    description: `${name}: ${description}`,
    confidence,
    matches: ({ responseHeaders }) => {
      if (!responseHeaders.has(name)) return false;
      return pattern ? pattern.test(responseHeaders.get(name) ?? '') : true;
    },
  };
}

function evidenceRole(
  signature: TechnologySignature,
  evidence: SignatureEvidence,
  context?: MatchContext,
): TechnologyEvidenceRole {
  const contextualRole = context ? evidence.roleFor?.(context) : undefined;
  if (contextualRole) return contextualRole;
  if (evidence.role) return evidence.role;
  if (evidence.source === 'resource origin') return 'embedded_dependency';
  if (signature.category === 'delivery platform') return 'observed_edge';
  if (['application runtime', 'web framework', 'static site generator', 'web server'].includes(signature.category)) {
    return 'framework_runtime';
  }
  return 'application_platform';
}

const TECHNOLOGY_SIGNATURES: TechnologySignature[] = [
  {
    id: 'wordpress', name: 'WordPress', category: 'content management',
    evidence: [
      generatorEvidence(/^wordpress(?:\s|$)/i, 'Generator metadata identifies WordPress.'),
      htmlEvidence([
        resourceMarker((url) => /\/wp-content\//iu.test(url.pathname), '/wp-content/fixture.css'),
        resourceMarker((url) => /\/wp-includes\//iu.test(url.pathname), '/wp-includes/fixture.js'),
      ], 'Static resource paths use WordPress conventions.', 'medium'),
    ],
  },
  {
    id: 'drupal', name: 'Drupal', category: 'content management',
    evidence: [
      generatorEvidence(/^drupal(?:\s|$)/i, 'Generator metadata identifies Drupal.'),
      htmlEvidence([
        elementMarker((element) => hasAttributes(element, 'data-drupal-selector'), '<main data-drupal-selector="fixture"></main>'),
        elementMarker((element) => hasAttributes(element, 'data-drupal-link-system-path'), '<main data-drupal-link-system-path="fixture"></main>'),
      ], 'Static markup contains Drupal-specific attributes.'),
      responseHeaderEvidence('x-drupal-cache', null, 'A Drupal-specific cache response header was observed.', 'medium'),
    ],
  },
  {
    id: 'joomla', name: 'Joomla', category: 'content management',
    evidence: [generatorEvidence(/^joomla!?\b/i, 'Generator metadata identifies Joomla.')],
  },
  {
    id: 'ghost', name: 'Ghost', category: 'content management',
    evidence: [
      generatorEvidence(/^ghost(?:\s|$)/i, 'Generator metadata identifies Ghost.'),
      htmlEvidence([
        elementMarker((element) => hasAttributes(element, 'data-ghost-search'), '<main data-ghost-search></main>'),
        resourceMarker((url) => /\/ghost\/api\/content\//iu.test(url.pathname), '/ghost/api/content/'),
      ], 'Static markup contains Ghost-specific integration markers.'),
    ],
  },
  {
    id: 'craft-cms', name: 'Craft CMS', category: 'content management',
    evidence: [
      responseHeaderEvidence(
        'x-powered-by',
        /(?:^|,\s*)craft cms(?:\s|$|\/)/i,
        'The passive X-Powered-By response header identifies Craft CMS.',
      ),
    ],
  },
  {
    id: 'typo3', name: 'TYPO3 CMS', category: 'content management',
    evidence: [generatorEvidence(/^typo3(?:\s+cms)?(?:\s|$)/i, 'Generator metadata identifies TYPO3 CMS.')],
  },
  {
    id: 'shopify', name: 'Shopify', category: 'commerce',
    requiresNonResourceEvidence: true,
    evidence: [
      htmlEvidence([
        elementMarker((element) => attributeValue(element, 'class').split(/\s/u).includes('shopify-section')
          || /^shopify-section(?:-|$)/u.test(attributeValue(element, 'id')), '<section class="shopify-section"></section>'),
      ], 'Static markup contains Shopify-specific storefront markers.'),
      resourceEvidence(['cdn.shopify.com'], 'A retained resource origin uses the Shopify content network.'),
      responseHeaderEvidence('x-shopify-stage', null, 'A Shopify-specific platform response header was observed.', 'medium'),
      responseHeaderEvidence('x-sorting-hat-podid', null, 'A Shopify-specific routing response header was observed.', 'medium'),
    ],
  },
  {
    id: 'php', name: 'PHP', category: 'application runtime',
    evidence: [responseHeaderEvidence('x-powered-by', /^php(?:\s|$|\/)/i, 'The passive X-Powered-By response header identifies PHP.')],
  },
  {
    id: 'aspnet', name: 'ASP.NET', category: 'web framework',
    evidence: [responseHeaderEvidence('x-powered-by', /^asp\.net(?:\s|$|\/)/i, 'The passive X-Powered-By response header identifies ASP.NET.')],
  },
  {
    id: 'express', name: 'Express', category: 'web framework',
    evidence: [responseHeaderEvidence('x-powered-by', /^express(?:\s|$|\/)/i, 'The passive X-Powered-By response header identifies Express.')],
  },
  {
    id: 'adobe-commerce-magento', name: 'Adobe Commerce / Magento Open Source', category: 'commerce',
    evidence: [
      htmlEvidence([
        elementMarker((element) => hasAttributes(element, 'data-mage-init'), '<main data-mage-init="{}"></main>'),
        elementMarker((element) => element.name === 'script' && attributeValue(element, 'type') === 'text/x-magento-init', '<script type="text/x-magento-init">{}</script>'),
      ], 'Static markup contains Commerce frontend initialisation markers.'),
    ],
  },
  {
    id: 'bigcommerce', name: 'BigCommerce', category: 'commerce',
    minimumEvidenceMatches: 2,
    allowEmbeddedOnly: true,
    evidence: [
      htmlEvidence([
        resourceMarker((url) => /(?:^|\/)stencil-utils(?:[./-]|$)/iu.test(url.pathname), '/assets/stencil-utils.js'),
        resourceMarker((url) => /^cdn\d+\.bigcommerce\.com$/iu.test(url.hostname) && /^\/s-[^/]+\//iu.test(url.pathname), 'https://cdn11.bigcommerce.com/s-fixture/theme.css'),
      ], 'Static markup contains BigCommerce storefront asset markers.', 'medium'),
      resourcePatternEvidence(/^cdn\d+\.bigcommerce\.com$/i, 'A retained resource origin uses BigCommerce storefront delivery infrastructure.'),
    ],
  },
  {
    id: 'woocommerce', name: 'WooCommerce', category: 'commerce',
    evidence: [
      htmlEvidence([resourceMarker((url) => /\/wp-content\/plugins\/woocommerce\//iu.test(url.pathname), '/wp-content/plugins/woocommerce/fixture.css')], 'Static resource paths identify the WooCommerce plugin.'),
    ],
  },
  {
    id: 'opencart', name: 'OpenCart', category: 'commerce',
    evidence: [
      htmlEvidence(
        [
          navigationMarker((url) => /\/index\.php$/iu.test(url.pathname) && url.searchParams.getAll('route').length === 1 && url.searchParams.get('route')?.toLowerCase() === 'common/home', 'index.php?route=common/home'),
          resourceMarker((url) => /\/image\/catalog\/opencart-logo\.png$/iu.test(url.pathname), '/image/catalog/opencart-logo.png'),
        ],
        'Static markup contains OpenCart routing or default asset conventions.',
      ),
    ],
  },
  {
    id: 'prestashop', name: 'PrestaShop', category: 'commerce',
    evidence: [
      htmlEvidence([resourceMarker((url) => /\/modules\/ps_[^/]+\//iu.test(url.pathname), '/modules/ps_fixture/fixture.css')], 'Static resource paths use PrestaShop module conventions.'),
    ],
  },
  {
    id: 'wix', name: 'Wix', category: 'site builder',
    requiresNonResourceEvidence: true,
    evidence: [
      generatorEvidence(/^wix(?:\.com)?(?:\s|$)/i, 'Generator metadata identifies Wix.'),
      htmlEvidence([elementMarker((element) => hasAttributes(element, 'data-mesh-id'), '<main data-mesh-id="fixture"></main>')], 'Static markup contains a Wix-specific document attribute.', 'medium'),
      resourceEvidence(['static.parastorage.com', 'wixstatic.com'], 'A retained resource origin uses Wix delivery infrastructure.'),
    ],
  },
  {
    id: 'squarespace', name: 'Squarespace', category: 'site builder',
    requiresNonResourceEvidence: true,
    allowEmbeddedOnly: true,
    evidence: [
      generatorEvidence(/^squarespace(?:\s|$)/i, 'Generator metadata identifies Squarespace.'),
      htmlEvidence([
        resourceMarker((url) => url.hostname === 'assets.squarespace.com' && /^\/universal\/scripts-compressed\/[a-z0-9][a-z0-9.-]*\.js$/iu.test(url.pathname), 'https://assets.squarespace.com/universal/scripts-compressed/fixture.js'),
      ], 'Static resource paths use Squarespace platform bundle conventions.', 'medium'),
    ],
  },
  {
    id: 'webflow', name: 'Webflow', category: 'site builder',
    evidence: [
      generatorEvidence(/^webflow(?:\s|$)/i, 'Generator metadata identifies Webflow.'),
      htmlEvidence([
        elementMarker((element) => hasAttributes(element, 'data-wf-page'), '<main data-wf-page="fixture"></main>'),
        elementMarker((element) => hasAttributes(element, 'data-wf-site'), '<main data-wf-site="fixture"></main>'),
      ], 'Static markup contains Webflow-specific document attributes.'),
    ],
  },
  {
    id: 'framer', name: 'Framer', category: 'site builder',
    requiresNonResourceEvidence: true,
    evidence: [
      generatorEvidence(/^framer(?:\s|$)/i, 'Generator metadata identifies Framer.'),
      htmlEvidence([elementMarker((element) => hasAttributes(element, 'data-framer-name'), '<main data-framer-name="fixture"></main>')], 'Static markup contains Framer-specific component attributes.'),
      resourceEvidence(['framerusercontent.com'], 'A retained resource origin uses Framer delivery infrastructure.'),
    ],
  },
  {
    id: 'weebly', name: 'Weebly', category: 'site builder',
    requiresNonResourceEvidence: true,
    evidence: [
      htmlEvidence(
        [elementMarker((element) => element.name === 'link' && (attributeValue(element, 'id') === 'wsite-base-style' || attributeValue(element, 'title') === 'wsite-theme-css'), '<link id="wsite-base-style" href="/fixture.css">')],
        'Static markup contains Weebly-specific theme attributes.',
      ),
      resourceEvidence(['editmysite.com'], 'A retained resource origin uses Weebly delivery infrastructure.'),
    ],
  },
  {
    id: 'angular', name: 'Angular', category: 'web framework',
    evidence: [htmlEvidence([elementMarker((element) => hasAttributes(element, 'ng-version'), '<main ng-version="fixture"></main>')], 'Static markup contains Angular version metadata.')],
  },
  {
    id: 'aspnet-web-forms', name: 'ASP.NET Web Forms', category: 'web framework',
    evidence: [htmlEvidence([elementMarker((element) => element.name === 'input' && (attributeValue(element, 'name') === '__viewstate' || attributeValue(element, 'id') === '__viewstate'), '<input name="__VIEWSTATE">')], 'Static form markup contains the ASP.NET Web Forms view-state field.')],
  },
  {
    id: 'nextjs', name: 'Next.js', category: 'web framework',
    evidence: [htmlEvidence([
      elementMarker((element) => element.name === 'script' && attributeValue(element, 'id') === '__next_data__', '<script id="__NEXT_DATA__"></script>'),
      resourceMarker((url) => /\/_next\/static\//iu.test(url.pathname), '/_next/static/fixture.js'),
    ], 'Static markup contains Next.js bootstrap or asset markers.')],
  },
  {
    id: 'nuxt', name: 'Nuxt', category: 'web framework',
    evidence: [htmlEvidence([
      elementMarker((element) => attributeValue(element, 'id') === '__nuxt', '<main id="__nuxt"></main>'),
      resourceMarker((url) => /\/_nuxt\//iu.test(url.pathname), '/_nuxt/fixture.js'),
    ], 'Static markup contains Nuxt bootstrap or asset markers.')],
  },
  {
    id: 'gatsby', name: 'Gatsby', category: 'web framework',
    evidence: [htmlEvidence([
      elementMarker((element) => attributeValue(element, 'id') === '___gatsby', '<main id="___gatsby"></main>'),
      resourceMarker((url) => /\/page-data\/app-data\.json$/iu.test(url.pathname), '/page-data/app-data.json'),
    ], 'Static markup contains Gatsby bootstrap or page-data markers.')],
  },
  {
    id: 'sveltekit', name: 'SvelteKit', category: 'web framework',
    evidence: [
      htmlEvidence([
        elementMarker((element) => hasAttributes(element, 'data-sveltekit-preload-data'), '<a data-sveltekit-preload-data="hover"></a>'),
        elementMarker((element) => hasAttributes(element, 'data-sveltekit-reload'), '<a data-sveltekit-reload></a>'),
      ], 'Static markup contains SvelteKit-specific navigation attributes.'),
      htmlEvidence([resourceMarker((url) => /\/_app\/immutable\//iu.test(url.pathname), '/_app/immutable/fixture.css')], 'Static asset paths use SvelteKit build conventions.', 'medium'),
    ],
  },
  {
    id: 'astro', name: 'Astro', category: 'web framework',
    evidence: [
      htmlEvidence([
        elementMarker((element) => element.name === 'astro-island', '<astro-island></astro-island>'),
        elementMarker((element) => element.name === 'astro-slot', '<astro-slot></astro-slot>'),
      ], 'Static markup contains Astro component-island elements.'),
      htmlEvidence([resourceMarker((url) => /\/_astro\//iu.test(url.pathname), '/_astro/fixture.css')], 'Static asset paths use Astro build conventions.', 'medium'),
    ],
  },
  {
    id: 'hugo', name: 'Hugo', category: 'static site generator',
    evidence: [generatorEvidence(/^hugo(?:\s|$)/i, 'Generator metadata identifies Hugo.')],
  },
  {
    id: 'jekyll', name: 'Jekyll', category: 'static site generator',
    evidence: [generatorEvidence(/^jekyll(?:\s|$)/i, 'Generator metadata identifies Jekyll.')],
  },
  {
    id: 'docusaurus', name: 'Docusaurus', category: 'static site generator',
    evidence: [generatorEvidence(/^docusaurus(?:\s|$)/i, 'Generator metadata identifies Docusaurus.')],
  },
  {
    id: 'eleventy', name: 'Eleventy', category: 'static site generator',
    evidence: [generatorEvidence(/^(?:eleventy|11ty)(?:\s|$)/i, 'Generator metadata identifies Eleventy.')],
  },
  {
    id: 'hexo', name: 'Hexo', category: 'static site generator',
    evidence: [generatorEvidence(/^hexo(?:\s|$)/i, 'Generator metadata identifies Hexo.')],
  },
  {
    id: 'cloudflare', name: 'Cloudflare', category: 'delivery platform',
    evidence: [
      serverEvidence(/^cloudflare(?:\s|$|\/)/i, 'The selected response server header identifies Cloudflare.'),
      responseHeaderEvidence('cf-ray', null, 'A Cloudflare request-trace response header was observed.', 'medium'),
    ],
  },
  {
    id: 'cloudfront', name: 'Amazon CloudFront', category: 'delivery platform',
    evidence: [
      resourceEvidence(['cloudfront.net'], 'A retained resource origin uses Amazon CloudFront delivery infrastructure.'),
    ],
  },
  {
    id: 'netlify', name: 'Netlify', category: 'delivery platform',
    evidence: [
      serverEvidence(/^netlify(?:\s|$|\/)/i, 'The selected response server header identifies Netlify.'),
      { ...responseHeaderEvidence('x-nf-request-id', null, 'A Netlify application-platform response header was observed.', 'medium'), role: 'application_platform' },
    ],
  },
  {
    id: 'vercel', name: 'Vercel', category: 'delivery platform',
    evidence: [
      serverEvidence(/^vercel(?:\s|$|\/)/i, 'The selected response server header identifies Vercel.'),
      { ...responseHeaderEvidence('x-vercel-id', null, 'A Vercel application-platform response header was observed.', 'medium'), role: 'application_platform' },
    ],
  },
  {
    id: 'fastly', name: 'Fastly', category: 'delivery platform',
    evidence: [responseHeaderEvidence(
      'x-served-by',
      /(?:^|,\s*)cache-[a-z0-9-]+-[a-z]{3}(?:\s*,|$)/i,
      'The passive X-Served-By response header contains a Fastly cache-node identifier.',
      'medium',
    )],
  },
  {
    id: 'nginx', name: 'nginx', category: 'web server',
    evidence: [serverEvidence(/^nginx(?:\s|$|\/)/i, 'The selected response server header identifies nginx.')],
  },
  {
    id: 'apache-http-server', name: 'Apache HTTP Server', category: 'web server',
    evidence: [serverEvidence(/^apache(?:\s|$|\/)/i, 'The selected response server header identifies Apache HTTP Server.')],
  },
  {
    id: 'microsoft-iis', name: 'Microsoft IIS', category: 'web server',
    evidence: [serverEvidence(/^microsoft-iis(?:\s|$|\/)/i, 'The selected response server header identifies Microsoft IIS.')],
  },
  {
    id: 'litespeed', name: 'LiteSpeed', category: 'web server',
    evidence: [serverEvidence(/^(?:open)?litespeed(?:\s|$|\/)/i, 'The selected response server header identifies LiteSpeed.')],
  },
  {
    id: 'caddy', name: 'Caddy', category: 'web server',
    evidence: [serverEvidence(/^caddy(?:\s|$|\/)/i, 'The selected response server header identifies Caddy.')],
  },
];

const TECHNOLOGY_SIGNATURE_CATALOGUE: ReadonlyArray<TechnologySignatureDescriptor> = Object.freeze(
  TECHNOLOGY_SIGNATURES.map((signature) => Object.freeze({
    id: signature.id,
    name: signature.name,
    category: signature.category,
    minimumEvidenceMatches: signature.minimumEvidenceMatches || 1,
    requiresNonResourceEvidence: signature.requiresNonResourceEvidence === true,
    evidence: Object.freeze(signature.evidence.map((evidence) => Object.freeze({
        source: evidence.source,
        role: evidenceRole(signature, evidence),
        description: evidence.description,
        confidence: evidence.confidence,
      }))),
  })),
);

function technologyHtmlAnalysis(input: TechnologyInput): StaticHtmlAnalysis {
  return input.htmlAnalysis ?? analyzeStaticHtml(input.html, {
    ...(typeof input.documentOrigin === 'string' ? { baseUrl: input.documentOrigin } : {}),
  });
}

// These are fixed semantic reconstructions, not copies of observed markup.
// Keeping them beside the predicates removes a second keyword catalogue from
// the contribution tools. Independent structural fixtures test the predicates.
function minimiseTechnologyMarkup(input: TechnologyInput): string {
  const analysis = technologyHtmlAnalysis(input);
  if (analysis.inputLimitReached || analysis.tagLimitReached) {
    throw new TypeError('Technology review markup exceeded the complete structural-analysis boundary.');
  }
  const context = createTechnologyMarkupContext(analysis, input.effectiveBaseUrl, input.documentOrigin);
  const fragments = TECHNOLOGY_SIGNATURES.flatMap((signature) => signature.evidence.flatMap((evidence) => (
    (evidence.markupRules ?? []).flatMap((rule) => rule.matches(context)
      ? [rule.embedded?.(context) ? rule.embeddedReviewMarkup! : rule.reviewMarkup]
      : [])
  )));
  return [...new Set(fragments)].join('');
}

function reconstructTechnologyHtmlEvidence(id: string, description: string, role?: TechnologyEvidenceRole): string {
  const rules = TECHNOLOGY_SIGNATURES.find((signature) => signature.id === id)?.evidence
    .find((evidence) => evidence.source === 'static HTML' && evidence.description === description)?.markupRules;
  const markup = role === 'embedded_dependency'
    ? rules?.find((rule) => rule.embeddedReviewMarkup)?.embeddedReviewMarkup
    : rules?.[0]?.reviewMarkup;
  if (!markup) throw new TypeError('The retained static clue has no current structural reconstruction.');
  return markup;
}

async function analyzeWebsiteTechnology(input: TechnologyInput = {}) {
  input.signal?.throwIfAborted();
  // Existing direct callers pass minimised, already-derived page evidence rather
  // than the page body. The real collector declares false for header-only
  // responses, while an explicit malformed declaration also fails closed.
  const htmlAvailable = input.htmlAvailable === undefined
    ? true
    : input.htmlAvailable === true;
  const htmlAnalysis = htmlAvailable ? technologyHtmlAnalysis(input) : analyzeStaticHtml('');
  const browserLibraryProfile = htmlAvailable ? await analyzeBrowserLibraries({
    htmlAnalysis,
    observedAt: input.observedAt,
    sourceTruncated: input.sourceTruncated,
    ...(input.signal ? { signal: input.signal } : {}),
  }) : null;
  const context: MatchContext = {
    ...createTechnologyMarkupContext(htmlAnalysis, input.effectiveBaseUrl, input.documentOrigin),
    generator: htmlAvailable ? boundedLowercase(input.generator, MAX_GENERATOR_INPUT) : '',
    httpServer: boundedLowercase(input.httpServer, MAX_SERVER_INPUT),
    resourceHosts: htmlAvailable ? normalizedResourceHosts(input.resourceOrigins) : new Set<string>(),
    responseHeaders: normalizedResponseHeaders(input.responseHeaders),
  };
  const findings: TechnologyFinding[] = [];

  for (const signature of TECHNOLOGY_SIGNATURES) {
    const matched = signature.evidence
      .filter((evidence) => evidence.matches(context))
      .map((evidence) => ({ evidence, role: evidenceRole(signature, evidence, context) }));
    const nonEmbeddedMatches = matched.filter((entry) => entry.role !== 'embedded_dependency');
    const minimumEvidenceMatches = signature.minimumEvidenceMatches || 1;
    const qualifiesForPlatform = matched.length >= minimumEvidenceMatches
      && (minimumEvidenceMatches === 1 || nonEmbeddedMatches.length > 0)
      && (!signature.requiresNonResourceEvidence || nonEmbeddedMatches.length > 0);
    const contextualEmbeddedEvidence = matched.filter((entry) => (
      entry.role === 'embedded_dependency' && entry.evidence.roleFor !== undefined
    ));
    const selected = qualifiesForPlatform
      ? matched
      : signature.allowEmbeddedOnly
        ? contextualEmbeddedEvidence.slice(0, 1)
        : [];
    if (selected.length === 0) continue;
    const matchedEvidence = selected.slice(0, MAX_EVIDENCE_PER_TECHNOLOGY).map(({ evidence, role }) => ({
      source: evidence.source,
      role,
      description: evidence.description,
    }));
    findings.push({
      id: signature.id,
      name: signature.name,
      category: signature.category,
      confidence: selected.some(({ evidence }) => evidence.confidence === 'high') ? 'high' : 'medium',
      roles: TECHNOLOGY_EVIDENCE_ROLE_ORDER.filter((role) => matchedEvidence.some((evidence) => evidence.role === role)),
      evidence: matchedEvidence,
    });
  }

  findings.sort((left, right) => left.category.localeCompare(right.category) || left.name.localeCompare(right.name));
  const findingLimitReached = findings.length > MAX_TECHNOLOGY_FINDINGS;
  const truncated = input.sourceTruncated === true
    || htmlAnalysis.inputLimitReached
    || htmlAnalysis.tagLimitReached
    || findingLimitReached;
  const partial = truncated || !htmlAvailable;
  const limitations = [
    'Curated signature matching is selective; an unmatched technology may still be present.',
    'Static response evidence cannot identify JavaScript-rendered or deliberately concealed technologies.',
    'Technology indicators describe observed implementation clues, not ownership, safety, or maliciousness.',
  ];
  if (!htmlAvailable) limitations.push('HTML page identity was unavailable; only bounded permitted response-header indicators were evaluated.');
  if (input.sourceTruncated === true) limitations.push('The captured homepage body was truncated, so technology indicators may be incomplete.');
  if (htmlAnalysis.inputLimitReached) limitations.push(`Only the first ${MAX_TECHNOLOGY_HTML_CHARS} HTML characters were evaluated.`);
  if (htmlAnalysis.tagLimitReached) limitations.push('Static HTML construction or attribute projection reached a bound; later technology indicators may be missing.');
  if (findingLimitReached) limitations.push(`Only the first ${MAX_TECHNOLOGY_FINDINGS} technology findings were retained.`);

  return {
    profileVersion: TECHNOLOGY_PROFILE_VERSION,
    ...createObservation({
      status: partial ? 'partial' : 'success',
      observedAt: input.observedAt,
      scanMode: 'deep',
      source: 'derived',
      complete: !partial,
      truncated,
      limitations,
      diagnostics: {
        findings: findings.length,
        htmlEvaluated: htmlAvailable,
        generatorEvaluated: Boolean(context.generator),
        serverEvaluated: Boolean(context.httpServer),
        resourceOriginsEvaluated: context.resourceHosts.size,
        passiveHeadersEvaluated: context.responseHeaders.size,
        tagLimitReached: htmlAnalysis.tagLimitReached,
      },
    }),
    findings: findings.slice(0, MAX_TECHNOLOGY_FINDINGS),
    browserLibraryProfile,
  };
}

export {
  MAX_EVIDENCE_PER_TECHNOLOGY,
  MAX_TECHNOLOGY_EVIDENCE_DESCRIPTION_LENGTH,
  MAX_TECHNOLOGY_FINDINGS,
  MAX_TECHNOLOGY_HTML_CHARS,
  MAX_TECHNOLOGY_TAGS,
  PASSIVE_TECHNOLOGY_HEADER_NAMES,
  TECHNOLOGY_CATEGORIES,
  TECHNOLOGY_EVIDENCE_SOURCES,
  TECHNOLOGY_PROFILE_VERSION,
  TECHNOLOGY_SIGNATURE_CATALOGUE,
  analyzeWebsiteTechnology,
  captureTechnologyResponseHeaders,
  minimiseTechnologyMarkup,
  reconstructTechnologyHtmlEvidence,
};

export type {
  TechnologyCategory,
  TechnologyConfidence,
  TechnologyEvidence,
  TechnologyEvidenceSource,
  TechnologyEvidenceRole,
  TechnologyFinding,
  TechnologyInput,
  TechnologySignatureDescriptor,
};
