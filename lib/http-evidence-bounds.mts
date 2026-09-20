// Browser-safe bounds for the rich HTTP evidence contract and its compact
// browser-local projection. Both producers and consumers import these values
// so valid retained evidence is not rejected by a stale projection.
import { MAX_OUTBOUND_HTTP_URL_CHARACTERS } from '../packages/contracts/http-url.mts';

export const MAX_HTTP_EVIDENCE_REDIRECTS = 5;
export const MAX_HTTP_ATTEMPTS = 2;
export const MAX_HTTP_PROVENANCE_URL = MAX_OUTBOUND_HTTP_URL_CHARACTERS;
export const MAX_HTTP_ERROR_LENGTH = 180;
