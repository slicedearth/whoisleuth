// Shared response-contract bounds for certificate-log search. The collector
// and browser normalizer import these values so a valid backend response is
// not accidentally clipped by a stale client-side mirror.

export const MAX_CT_RESPONSE_RESULTS = 500;
export const MAX_CT_RESPONSE_HOSTNAMES_PER_MATCH = 50;
export const MAX_CT_RESPONSE_TIMESTAMP_LENGTH = 64;
export const MAX_CT_RESPONSE_CERTIFICATE_GROUPS = 100;
export const MAX_CT_RESPONSE_DOMAINS_PER_GROUP = 20;
export const MAX_CT_RESPONSE_HOSTNAMES_PER_GROUP = 30;
