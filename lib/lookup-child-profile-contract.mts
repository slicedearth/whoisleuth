// Browser-safe version and collection boundaries shared by Lookup child
// profile producers and the client response trust boundary.
export const TECHNOLOGY_PROFILE_VERSION = 11;
export const SUPPORTED_TECHNOLOGY_PROFILE_VERSIONS = Object.freeze([10, TECHNOLOGY_PROFILE_VERSION]);
export const MAX_TECHNOLOGY_FINDINGS = 24;
export const MAX_EVIDENCE_PER_TECHNOLOGY = 4;
export const MAX_TECHNOLOGY_EVIDENCE_DESCRIPTION_LENGTH = 180;

export const BROWSER_LIBRARY_PROFILE_VERSION = 2;
export const MAX_LIBRARY_FINDINGS = 16;

export const WEBSITE_SECURITY_POSTURE_VERSION = 2;
export const MAX_SECURITY_POSTURE_FINDINGS = 32;

export const CREDENTIAL_SURFACE_PROFILE_VERSION = 1;

export const STRUCTURED_DATA_IDENTITY_VERSION = 1;
export const MAX_STRUCTURED_DATA_ENTITIES = 16;
export const MAX_STRUCTURED_DATA_SAME_AS_HOSTS = 12;

export const PAGE_ROLE_PROFILE_VERSION = 1;
export const MAX_PAGE_ROLE_FINDINGS = 4;
export const MAX_PAGE_ROLE_EVIDENCE = 4;

export const CLIENT_BEHAVIOR_PROFILE_VERSION = 1;
export const MAX_CLIENT_BEHAVIOR_INDICATORS = 12;
