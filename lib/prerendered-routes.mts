// Shared source of truth for the statically prerendered Svelte pages exposed
// by the portable Express host. Route groups are build-time structure only and
// therefore do not appear in these public paths.

const PRERENDERED_ROUTES = Object.freeze([
  '/',
  '/brands',
  '/bulk',
  '/dashboard',
  '/demo',
  '/discover',
  '/guide',
  '/login',
  '/lookup',
  '/monitor',
  '/privacy',
  '/registry-support',
] as const);

const CANONICAL_TRAILING_SLASH_REDIRECTS = Object.freeze(
  PRERENDERED_ROUTES
    .filter((route) => route !== '/')
    .map((route) => [`${route}/`, route] as const),
);

export {
  CANONICAL_TRAILING_SLASH_REDIRECTS,
  PRERENDERED_ROUTES,
};
