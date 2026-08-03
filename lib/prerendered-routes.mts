import { PUBLIC_RESOURCE_ROUTES } from './public-resource-routes.mts';

// Shared source of truth for the statically prerendered Svelte pages exposed
// by the portable Express host. Route groups are build-time structure only and
// therefore do not appear in these public paths.

const PRERENDERED_ROUTES = Object.freeze([
  '/',
  '/brands',
  '/bulk',
  '/contact',
  '/dashboard',
  '/demo',
  '/discover',
  '/guide',
  '/login',
  '/lookup',
  '/monitor',
  '/privacy',
  '/resources',
  ...PUBLIC_RESOURCE_ROUTES,
  '/registry-support',
] as const);

const PRERENDERED_HTML_FILE_OVERRIDES = Object.freeze([
  ['/resources', 'resources.html'],
] as const);

const CANONICAL_TRAILING_SLASH_REDIRECTS = Object.freeze(
  PRERENDERED_ROUTES
    .filter((route) => route !== '/')
    .map((route) => [`${route}/`, route] as const),
);

export {
  CANONICAL_TRAILING_SLASH_REDIRECTS,
  PRERENDERED_HTML_FILE_OVERRIDES,
  PRERENDERED_ROUTES,
};
