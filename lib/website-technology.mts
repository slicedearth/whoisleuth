// Versioned, bounded technology indicators derived from the HTTP and static
// HTML evidence already collected by a deep lookup. A standards-compliant
// parser identifies live elements and attributes without executing scripts.
// Signatures emit only curated labels and fixed evidence descriptions; matched
// markup, header values, URL paths, and arbitrary upstream strings are never
// retained.

import { analyzeBrowserLibraries } from './browser-library-profile.mts';
import { createObservation } from '../packages/evidence/observation.mts';
import {
  MAX_STATIC_HTML_CHARS,
  MAX_TAG_LENGTH,
  MAX_TECHNOLOGY_TAGS,
  analyzeStaticHtml,
  type StaticHtmlAnalysis,
} from './static-html-analysis.mts';

type TechnologyCategory =
  | 'application runtime'
  | 'content management'
  | 'commerce'
  | 'site builder'
  | 'web framework'
  | 'static site generator'
  | 'web server'
  | 'delivery platform';
type TechnologyConfidence = 'high' | 'medium';
type TechnologyEvidenceSource = 'generator metadata' | 'static HTML' | 'resource origin' | 'HTTP server header' | 'passive response header';
type TechnologyEvidence = { source: TechnologyEvidenceSource; description: string };
type TechnologyFinding = {
  id: string;
  name: string;
  category: TechnologyCategory;
  confidence: TechnologyConfidence;
  evidence: TechnologyEvidence[];
};
type TechnologyInput = {
  html?: unknown;
  generator?: unknown;
  httpServer?: unknown;
  resourceOrigins?: unknown;
  responseHeaders?: unknown;
  htmlAnalysis?: StaticHtmlAnalysis;
  observedAt?: unknown;
  sourceTruncated?: unknown;
};
type MatchContext = {
  html: string;
  generator: string;
  httpServer: string;
  resourceHosts: Set<string>;
  responseHeaders: ReadonlyMap<string, string>;
};
type SignatureEvidence = TechnologyEvidence & {
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
};
type TechnologySignatureDescriptor = Readonly<{
  id: string;
  name: string;
  category: TechnologyCategory;
  minimumEvidenceMatches: 1 | 2;
  requiresNonResourceEvidence: boolean;
  evidence: ReadonlyArray<Readonly<Omit<SignatureEvidence, 'matches'>>>;
}>;

const TECHNOLOGY_PROFILE_VERSION = 10;
const MAX_TECHNOLOGY_HTML_CHARS = MAX_STATIC_HTML_CHARS;
const MAX_TECHNOLOGY_TAG_LENGTH = MAX_TAG_LENGTH;
const MAX_TECHNOLOGY_FINDINGS = 24;
const MAX_EVIDENCE_PER_TECHNOLOGY = 4;
const MAX_RESOURCE_ORIGINS = 30;
const MAX_GENERATOR_INPUT = 160;
const MAX_SERVER_INPUT = 240;
const MAX_PASSIVE_RESPONSE_HEADERS = 8;
const MAX_TECHNOLOGY_EVIDENCE_DESCRIPTION_LENGTH = 180;
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

function normalizedResponseHeaders(value: unknown): ReadonlyMap<string, string> {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const output = new Map<string, string>();
  for (const [rawName, rawValue] of Object.entries(input).slice(0, MAX_PASSIVE_RESPONSE_HEADERS * 4)) {
    const name = rawName.trim().toLowerCase();
    if (!PASSIVE_HEADER_NAMES.has(name) || typeof rawValue !== 'string') continue;
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

function htmlEvidence(markers: string[], description: string, confidence: TechnologyConfidence = 'high'): SignatureEvidence {
  return {
    source: 'static HTML',
    description,
    confidence,
    matches: ({ html }) => markers.some((marker) => html.includes(marker)),
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
    description,
    confidence,
    matches: ({ responseHeaders }) => {
      if (!responseHeaders.has(name)) return false;
      return pattern ? pattern.test(responseHeaders.get(name) ?? '') : true;
    },
  };
}

const TECHNOLOGY_SIGNATURES: TechnologySignature[] = [
  {
    id: 'wordpress', name: 'WordPress', category: 'content management',
    evidence: [
      generatorEvidence(/^wordpress(?:\s|$)/i, 'Generator metadata identifies WordPress.'),
      htmlEvidence(['/wp-content/', '/wp-includes/'], 'Static resource paths use WordPress conventions.', 'medium'),
    ],
  },
  {
    id: 'drupal', name: 'Drupal', category: 'content management',
    evidence: [
      generatorEvidence(/^drupal(?:\s|$)/i, 'Generator metadata identifies Drupal.'),
      htmlEvidence(['data-drupal-selector=', 'data-drupal-link-system-path=', 'drupal-settings-json'], 'Static markup contains Drupal-specific attributes.'),
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
      htmlEvidence(['ghost/api/content/', 'data-ghost-search'], 'Static markup contains Ghost-specific integration markers.'),
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
      htmlEvidence(['shopify-section', 'shopify.theme'], 'Static markup contains Shopify-specific storefront markers.'),
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
      htmlEvidence(['data-mage-init=', 'type="text/x-magento-init"', "type='text/x-magento-init'"], 'Static markup contains Commerce frontend initialisation markers.'),
    ],
  },
  {
    id: 'bigcommerce', name: 'BigCommerce', category: 'commerce',
    minimumEvidenceMatches: 2,
    evidence: [
      htmlEvidence(['cdn11.bigcommerce.com/s-', 'stencil-utils'], 'Static markup contains BigCommerce storefront asset markers.', 'medium'),
      resourcePatternEvidence(/^cdn\d+\.bigcommerce\.com$/i, 'A retained resource origin uses BigCommerce storefront delivery infrastructure.'),
    ],
  },
  {
    id: 'woocommerce', name: 'WooCommerce', category: 'commerce',
    evidence: [
      htmlEvidence(['/wp-content/plugins/woocommerce/'], 'Static resource paths identify the WooCommerce plugin.'),
    ],
  },
  {
    id: 'opencart', name: 'OpenCart', category: 'commerce',
    evidence: [
      htmlEvidence(
        ['index.php?route=common/home', 'image/catalog/opencart-logo.png'],
        'Static markup contains OpenCart routing or default asset conventions.',
      ),
    ],
  },
  {
    id: 'prestashop', name: 'PrestaShop', category: 'commerce',
    evidence: [
      htmlEvidence(['/modules/ps_'], 'Static resource paths use PrestaShop module conventions.'),
    ],
  },
  {
    id: 'wix', name: 'Wix', category: 'site builder',
    requiresNonResourceEvidence: true,
    evidence: [
      generatorEvidence(/^wix(?:\.com)?(?:\s|$)/i, 'Generator metadata identifies Wix.'),
      htmlEvidence(['data-mesh-id='], 'Static markup contains a Wix-specific document attribute.', 'medium'),
      resourceEvidence(['static.parastorage.com', 'wixstatic.com'], 'A retained resource origin uses Wix delivery infrastructure.'),
    ],
  },
  {
    id: 'squarespace', name: 'Squarespace', category: 'site builder',
    requiresNonResourceEvidence: true,
    evidence: [
      generatorEvidence(/^squarespace(?:\s|$)/i, 'Generator metadata identifies Squarespace.'),
      htmlEvidence(['squarespace-context'], 'Static markup contains a Squarespace-specific document marker.', 'medium'),
      resourceEvidence(['static.squarespace.com', 'static1.squarespace.com'], 'A retained resource origin uses Squarespace delivery infrastructure.'),
    ],
  },
  {
    id: 'webflow', name: 'Webflow', category: 'site builder',
    evidence: [
      generatorEvidence(/^webflow(?:\s|$)/i, 'Generator metadata identifies Webflow.'),
      htmlEvidence(['data-wf-page=', 'data-wf-site='], 'Static markup contains Webflow-specific document attributes.'),
    ],
  },
  {
    id: 'framer', name: 'Framer', category: 'site builder',
    requiresNonResourceEvidence: true,
    evidence: [
      generatorEvidence(/^framer(?:\s|$)/i, 'Generator metadata identifies Framer.'),
      htmlEvidence(['data-framer-name='], 'Static markup contains Framer-specific component attributes.'),
      resourceEvidence(['framerusercontent.com'], 'A retained resource origin uses Framer delivery infrastructure.'),
    ],
  },
  {
    id: 'weebly', name: 'Weebly', category: 'site builder',
    requiresNonResourceEvidence: true,
    evidence: [
      htmlEvidence(
        ['id="wsite-base-style"', "id='wsite-base-style'", 'title="wsite-theme-css"', "title='wsite-theme-css'"],
        'Static markup contains Weebly-specific theme attributes.',
      ),
      resourceEvidence(['editmysite.com'], 'A retained resource origin uses Weebly delivery infrastructure.'),
    ],
  },
  {
    id: 'angular', name: 'Angular', category: 'web framework',
    evidence: [htmlEvidence([' ng-version='], 'Static markup contains Angular version metadata.')],
  },
  {
    id: 'aspnet-web-forms', name: 'ASP.NET Web Forms', category: 'web framework',
    evidence: [htmlEvidence([' name="__viewstate"', ' id="__viewstate"'], 'Static form markup contains the ASP.NET Web Forms view-state field.')],
  },
  {
    id: 'nextjs', name: 'Next.js', category: 'web framework',
    evidence: [htmlEvidence(['id="__next_data__"', "id='__next_data__'", '/_next/static/'], 'Static markup contains Next.js bootstrap or asset markers.')],
  },
  {
    id: 'nuxt', name: 'Nuxt', category: 'web framework',
    evidence: [htmlEvidence(['id="__nuxt"', "id='__nuxt'", '/_nuxt/'], 'Static markup contains Nuxt bootstrap or asset markers.')],
  },
  {
    id: 'gatsby', name: 'Gatsby', category: 'web framework',
    evidence: [htmlEvidence(['id="___gatsby"', "id='___gatsby'", '/page-data/app-data.json'], 'Static markup contains Gatsby bootstrap or page-data markers.')],
  },
  {
    id: 'sveltekit', name: 'SvelteKit', category: 'web framework',
    evidence: [
      htmlEvidence(['data-sveltekit-preload-data=', 'data-sveltekit-reload='], 'Static markup contains SvelteKit-specific navigation attributes.'),
      htmlEvidence(['href="/_app/immutable/', 'src="/_app/immutable/'], 'Static asset paths use SvelteKit build conventions.', 'medium'),
    ],
  },
  {
    id: 'astro', name: 'Astro', category: 'web framework',
    evidence: [
      htmlEvidence(['<astro-island', '<astro-slot'], 'Static markup contains Astro component-island elements.'),
      htmlEvidence(['href="/_astro/', 'src="/_astro/'], 'Static asset paths use Astro build conventions.', 'medium'),
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
      responseHeaderEvidence('x-nf-request-id', null, 'A Netlify request identifier response header was observed.', 'medium'),
    ],
  },
  {
    id: 'vercel', name: 'Vercel', category: 'delivery platform',
    evidence: [
      serverEvidence(/^vercel(?:\s|$|\/)/i, 'The selected response server header identifies Vercel.'),
      responseHeaderEvidence('x-vercel-id', null, 'A Vercel request-trace response header was observed.', 'medium'),
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
    evidence: Object.freeze(signature.evidence.map(({ source, description, confidence }) => Object.freeze({
      source,
      description,
      confidence,
    }))),
  })),
);

function analyzeWebsiteTechnology(input: TechnologyInput = {}) {
  const htmlAnalysis = input.htmlAnalysis ?? analyzeStaticHtml(input.html);
  const browserLibraryProfile = analyzeBrowserLibraries({
    htmlAnalysis,
    observedAt: input.observedAt,
    sourceTruncated: input.sourceTruncated,
  });
  const context: MatchContext = {
    html: htmlAnalysis.markup,
    generator: boundedLowercase(input.generator, MAX_GENERATOR_INPUT),
    httpServer: boundedLowercase(input.httpServer, MAX_SERVER_INPUT),
    resourceHosts: normalizedResourceHosts(input.resourceOrigins),
    responseHeaders: normalizedResponseHeaders(input.responseHeaders),
  };
  const findings: TechnologyFinding[] = [];

  for (const signature of TECHNOLOGY_SIGNATURES) {
    const matched = signature.evidence.filter((evidence) => evidence.matches(context));
    if (matched.length < (signature.minimumEvidenceMatches || 1)) continue;
    if (signature.requiresNonResourceEvidence && matched.every((evidence) => evidence.source === 'resource origin')) continue;
    findings.push({
      id: signature.id,
      name: signature.name,
      category: signature.category,
      confidence: matched.some((evidence) => evidence.confidence === 'high') ? 'high' : 'medium',
      evidence: matched.slice(0, MAX_EVIDENCE_PER_TECHNOLOGY).map(({ source, description }) => ({ source, description })),
    });
  }

  findings.sort((left, right) => left.category.localeCompare(right.category) || left.name.localeCompare(right.name));
  const findingLimitReached = findings.length > MAX_TECHNOLOGY_FINDINGS;
  const truncated = input.sourceTruncated === true
    || htmlAnalysis.inputLimitReached
    || htmlAnalysis.tagLimitReached
    || findingLimitReached;
  const limitations = [
    'Curated signature matching is selective; an unmatched technology may still be present.',
    'Static response evidence cannot identify JavaScript-rendered or deliberately concealed technologies.',
    'Technology indicators describe observed implementation clues, not ownership, safety, or maliciousness.',
  ];
  if (input.sourceTruncated === true) limitations.push('The captured homepage body was truncated, so technology indicators may be incomplete.');
  if (htmlAnalysis.inputLimitReached) limitations.push(`Only the first ${MAX_TECHNOLOGY_HTML_CHARS} HTML characters were evaluated.`);
  if (htmlAnalysis.tagLimitReached) limitations.push(`Technology matching reached the ${MAX_TECHNOLOGY_TAGS}-tag or ${MAX_TECHNOLOGY_TAG_LENGTH}-character tag boundary.`);
  if (findingLimitReached) limitations.push(`Only the first ${MAX_TECHNOLOGY_FINDINGS} technology findings were retained.`);

  return {
    profileVersion: TECHNOLOGY_PROFILE_VERSION,
    ...createObservation({
      status: truncated ? 'partial' : 'success',
      observedAt: input.observedAt,
      scanMode: 'deep',
      source: 'derived',
      complete: !truncated,
      truncated,
      limitations,
      diagnostics: {
        findings: findings.length,
        htmlEvaluated: Boolean(context.html),
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
  TECHNOLOGY_PROFILE_VERSION,
  TECHNOLOGY_SIGNATURE_CATALOGUE,
  analyzeWebsiteTechnology,
};

export type {
  TechnologyCategory,
  TechnologyConfidence,
  TechnologyEvidence,
  TechnologyFinding,
  TechnologyInput,
  TechnologySignatureDescriptor,
};
