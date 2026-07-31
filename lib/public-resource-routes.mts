const PUBLIC_RESOURCE_SLUGS = Object.freeze([
  'open-source-domain-intelligence',
  'rdap-vs-whois',
  'lookalike-domain-checker',
  'certificate-transparency-brand-protection',
  'domain-investigation-workflow',
  'bulk-domain-comparison',
  'ip-asn-investigation',
  'local-first-osint',
] as const);

type PublicResourceSlug = (typeof PUBLIC_RESOURCE_SLUGS)[number];

const PUBLIC_RESOURCE_ROUTES = Object.freeze(
  PUBLIC_RESOURCE_SLUGS.map((slug) => `/resources/${slug}` as const),
);

export {
  PUBLIC_RESOURCE_ROUTES,
  PUBLIC_RESOURCE_SLUGS,
  type PublicResourceSlug,
};
