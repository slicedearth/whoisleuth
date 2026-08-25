import { PUBLIC_RESOURCE_ROUTES } from './public-resource-routes.mts';
import { WHOISLEUTH_SITE_ORIGIN } from './project-metadata.mts';

// Shared source of truth for the statically prerendered Svelte pages exposed
// by the portable Express host. Route groups are build-time structure only and
// therefore do not appear in these public paths.

const PRERENDERED_ROUTE_DEFINITIONS = Object.freeze([
  { path: '/', indexed: true },
  { path: '/brands', indexed: false },
  { path: '/bulk', indexed: false },
  { path: '/cli', indexed: true },
  { path: '/contact', indexed: false },
  { path: '/coverage', indexed: true },
  { path: '/dashboard', indexed: false },
  { path: '/demo', indexed: true },
  { path: '/discover', indexed: false },
  { path: '/examples', indexed: true },
  { path: '/login', indexed: false },
  { path: '/lookup', indexed: false },
  { path: '/methodology', indexed: true },
  { path: '/monitor', indexed: false },
  { path: '/privacy', indexed: true },
  { path: '/request-policy', indexed: true },
  { path: '/resources', indexed: true },
  ...PUBLIC_RESOURCE_ROUTES.map((path) => ({ path, indexed: true } as const)),
  { path: '/registry-support', indexed: false },
  { path: '/terms', indexed: true },
] as const);

const PRERENDERED_ROUTES = Object.freeze(
  PRERENDERED_ROUTE_DEFINITIONS.map((definition) => definition.path),
);

const PUBLIC_PRERENDERED_ROUTES = Object.freeze(
  PRERENDERED_ROUTE_DEFINITIONS
    .filter((definition) => definition.indexed)
    .map((definition) => definition.path),
);

const NON_INDEXED_PRERENDERED_ROUTES = Object.freeze(
  PRERENDERED_ROUTE_DEFINITIONS
    .filter((definition) => !definition.indexed)
    .map((definition) => definition.path),
);

const PRERENDERED_HTML_FILE_OVERRIDES = Object.freeze([
  ['/resources', 'resources.html'],
] as const);

const PERMANENT_ROUTE_REDIRECTS = Object.freeze([
  ['/guide', '/resources'],
  ['/guide/', '/resources'],
] as const);

const CANONICAL_TRAILING_SLASH_REDIRECTS = Object.freeze(
  PRERENDERED_ROUTES
    .filter((route) => route !== '/')
    .map((route) => [`${route}/`, route] as const),
);

function renderPublicSitemap(): string {
  const urls = PUBLIC_PRERENDERED_ROUTES.map((route) => (
    `  <url><loc>${WHOISLEUTH_SITE_ORIGIN}${route === '/' ? '/' : route}</loc></url>`
  ));
  return `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
  ].join('\n')}\n`;
}

function renderPublicRobots(): string {
  return `${[
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /.netlify/functions/',
    '',
    `Sitemap: ${WHOISLEUTH_SITE_ORIGIN}/sitemap.xml`,
  ].join('\n')}\n`;
}

export {
  CANONICAL_TRAILING_SLASH_REDIRECTS,
  NON_INDEXED_PRERENDERED_ROUTES,
  PERMANENT_ROUTE_REDIRECTS,
  PRERENDERED_ROUTE_DEFINITIONS,
  PRERENDERED_HTML_FILE_OVERRIDES,
  PRERENDERED_ROUTES,
  PUBLIC_PRERENDERED_ROUTES,
  renderPublicRobots,
  renderPublicSitemap,
};
