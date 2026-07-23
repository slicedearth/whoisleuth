// Versioned, bounded technology indicators derived from the HTTP and static
// HTML evidence already collected by a deep lookup. Signatures emit only
// curated labels and fixed evidence descriptions; matched markup, header
// values, URL paths, and arbitrary upstream strings are never retained.

import { createObservation } from './observation.mts';

type TechnologyCategory =
  | 'content management'
  | 'commerce'
  | 'site builder'
  | 'web framework'
  | 'static site generator'
  | 'web server'
  | 'delivery platform';
type TechnologyConfidence = 'high' | 'medium';
type TechnologyEvidenceSource = 'generator metadata' | 'static HTML' | 'resource origin' | 'HTTP server header';
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
  observedAt?: unknown;
  sourceTruncated?: unknown;
};
type MatchContext = {
  html: string;
  generator: string;
  httpServer: string;
  resourceHosts: Set<string>;
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
};

const TECHNOLOGY_PROFILE_VERSION = 2;
const MAX_TECHNOLOGY_HTML_CHARS = 300_000;
const MAX_TECHNOLOGY_TAGS = 2_048;
const MAX_TECHNOLOGY_TAG_LENGTH = 4_096;
const MAX_TECHNOLOGY_FINDINGS = 24;
const MAX_EVIDENCE_PER_TECHNOLOGY = 4;
const MAX_RESOURCE_ORIGINS = 30;
const MAX_GENERATOR_INPUT = 160;
const MAX_SERVER_INPUT = 240;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
const HTML_COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g;
const RAW_TEXT_BLOCK_RE = /<(script|style|textarea|template)\b([^>]*)>[\s\S]*?<\/\1\s*>/gi;
const TECHNOLOGY_TAG_RE = /<[a-z][^>]{0,4096}>/gi;
const OVERSIZED_TECHNOLOGY_TAG_RE = /<[a-z][^>]{4097}/i;

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

function searchableTagMarkup(value: unknown): { markup: string; inputLimitReached: boolean; tagLimitReached: boolean } {
  const supplied = typeof value === 'string' ? value : '';
  const inputLimitReached = supplied.length > MAX_TECHNOLOGY_HTML_CHARS;
  const sanitized = supplied
    .slice(0, MAX_TECHNOLOGY_HTML_CHARS)
    .replace(HTML_COMMENT_RE, ' ')
    .replace(RAW_TEXT_BLOCK_RE, '<$1$2>');
  const tags: string[] = [];
  let tagLimitReached = OVERSIZED_TECHNOLOGY_TAG_RE.test(sanitized);
  let match;
  TECHNOLOGY_TAG_RE.lastIndex = 0;
  while ((match = TECHNOLOGY_TAG_RE.exec(sanitized))) {
    if (tags.length >= MAX_TECHNOLOGY_TAGS) {
      tagLimitReached = true;
      break;
    }
    tags.push(match[0].toLowerCase());
  }
  return { markup: tags.join('\n'), inputLimitReached, tagLimitReached };
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
    id: 'shopify', name: 'Shopify', category: 'commerce',
    evidence: [
      htmlEvidence(['shopify-section', 'shopify.theme', 'cdn.shopify.com'], 'Static markup contains Shopify-specific storefront markers.'),
      resourceEvidence(['cdn.shopify.com'], 'A retained resource origin uses the Shopify content network.'),
    ],
  },
  {
    id: 'adobe-commerce-magento', name: 'Adobe Commerce / Magento Open Source', category: 'commerce',
    evidence: [
      htmlEvidence(['data-mage-init=', 'type="text/x-magento-init"', "type='text/x-magento-init'"], 'Static markup contains Commerce frontend initialization markers.'),
    ],
  },
  {
    id: 'bigcommerce', name: 'BigCommerce', category: 'commerce',
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
    id: 'wix', name: 'Wix', category: 'site builder',
    evidence: [
      generatorEvidence(/^wix(?:\s|$)/i, 'Generator metadata identifies Wix.'),
      htmlEvidence(['static.parastorage.com', 'wixstatic.com', 'data-mesh-id='], 'Static markup contains Wix-specific delivery markers.', 'medium'),
      resourceEvidence(['static.parastorage.com', 'wixstatic.com'], 'A retained resource origin uses Wix delivery infrastructure.'),
    ],
  },
  {
    id: 'squarespace', name: 'Squarespace', category: 'site builder',
    evidence: [
      generatorEvidence(/^squarespace(?:\s|$)/i, 'Generator metadata identifies Squarespace.'),
      htmlEvidence(['static.squarespace.com', 'static1.squarespace.com', 'squarespace-context'], 'Static markup contains Squarespace-specific delivery markers.', 'medium'),
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
    evidence: [htmlEvidence(['data-sveltekit-preload-data=', 'data-sveltekit-reload='], 'Static markup contains SvelteKit-specific navigation attributes.')],
  },
  {
    id: 'astro', name: 'Astro', category: 'web framework',
    evidence: [htmlEvidence(['<astro-island', '<astro-slot'], 'Static markup contains Astro component-island elements.')],
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
    id: 'cloudflare', name: 'Cloudflare', category: 'delivery platform',
    evidence: [serverEvidence(/^cloudflare(?:\s|$|\/)/i, 'The selected response server header identifies Cloudflare.')],
  },
  {
    id: 'cloudfront', name: 'Amazon CloudFront', category: 'delivery platform',
    evidence: [
      serverEvidence(/^cloudfront(?:\s|$|\/)/i, 'The selected response server header identifies Amazon CloudFront.'),
      resourceEvidence(['cloudfront.net'], 'A retained resource origin uses Amazon CloudFront delivery infrastructure.'),
    ],
  },
  {
    id: 'netlify', name: 'Netlify', category: 'delivery platform',
    evidence: [serverEvidence(/^netlify(?:\s|$|\/)/i, 'The selected response server header identifies Netlify.')],
  },
  {
    id: 'vercel', name: 'Vercel', category: 'delivery platform',
    evidence: [serverEvidence(/^vercel(?:\s|$|\/)/i, 'The selected response server header identifies Vercel.')],
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

function analyzeWebsiteTechnology(input: TechnologyInput = {}) {
  const tagMarkup = searchableTagMarkup(input.html);
  const context: MatchContext = {
    html: tagMarkup.markup,
    generator: boundedLowercase(input.generator, MAX_GENERATOR_INPUT),
    httpServer: boundedLowercase(input.httpServer, MAX_SERVER_INPUT),
    resourceHosts: normalizedResourceHosts(input.resourceOrigins),
  };
  const findings: TechnologyFinding[] = [];

  for (const signature of TECHNOLOGY_SIGNATURES) {
    const matched = signature.evidence.filter((evidence) => evidence.matches(context));
    if (!matched.length) continue;
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
  const truncated = input.sourceTruncated === true || tagMarkup.inputLimitReached || tagMarkup.tagLimitReached || findingLimitReached;
  const limitations = [
    'Curated signature matching is selective; an unmatched technology may still be present.',
    'Static response evidence cannot identify JavaScript-rendered or deliberately concealed technologies.',
    'Technology indicators describe observed implementation clues, not ownership, safety, or maliciousness.',
  ];
  if (input.sourceTruncated === true) limitations.push('The captured homepage body was truncated, so technology indicators may be incomplete.');
  if (tagMarkup.inputLimitReached) limitations.push(`Only the first ${MAX_TECHNOLOGY_HTML_CHARS} HTML characters were evaluated.`);
  if (tagMarkup.tagLimitReached) limitations.push(`Technology matching reached the ${MAX_TECHNOLOGY_TAGS}-tag or ${MAX_TECHNOLOGY_TAG_LENGTH}-character tag boundary.`);
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
        tagLimitReached: tagMarkup.tagLimitReached,
      },
    }),
    findings: findings.slice(0, MAX_TECHNOLOGY_FINDINGS),
  };
}

export {
  MAX_EVIDENCE_PER_TECHNOLOGY,
  MAX_TECHNOLOGY_FINDINGS,
  MAX_TECHNOLOGY_HTML_CHARS,
  MAX_TECHNOLOGY_TAGS,
  TECHNOLOGY_PROFILE_VERSION,
  analyzeWebsiteTechnology,
};

export type {
  TechnologyCategory,
  TechnologyConfidence,
  TechnologyEvidence,
  TechnologyFinding,
  TechnologyInput,
};
