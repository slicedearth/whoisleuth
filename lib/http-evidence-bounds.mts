// Browser-safe bounds for the rich HTTP evidence contract and its compact
// browser-local projection. Both producers and consumers import these values
// so valid retained evidence is not rejected by a stale projection.

export const MAX_HTTP_EVIDENCE_REDIRECTS = 5;
