// Shared declarative limits for direct website observation. Runtime collectors
// and the public request-policy page import these values so operator-facing
// disclosures cannot drift from the enforced request boundaries.

export const MAX_OUTBOUND_REDIRECTS = 5;
export const HOMEPAGE_FETCH_TIMEOUT_MS = 6_000;
// One MiB admits large static application pages while bounding bytes retained
// from each response. Parsing, derived outputs and request concurrency retain
// separate work limits; this is not a claim that larger pages lack evidence.
export const MAX_HOMEPAGE_BYTES = 1024 * 1024;
export const FAVICON_FETCH_TIMEOUT_MS = 5_000;
export const MAX_FAVICON_BYTES = 200_000;
export const MAX_FAVICON_CANDIDATES = 4;
