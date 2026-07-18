const REGISTRY_ACCESS_PROFILE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'iana-bootstrap': 'IANA bootstrap discovery',
  'iana-referral': 'IANA referral discovery',
  'no-iana-service': 'No service published by IANA',
  'registry-policy-restricted': 'Registry policy restricted',
  'source-ip-authorization-required': 'Source-IP authorization required',
});
const WHOIS_REGISTRY_ACCESS_PROFILES = new Set([
  'iana-referral',
  'no-iana-service',
  'registry-policy-restricted',
  'source-ip-authorization-required',
]);
const RDAP_REGISTRY_ACCESS_PROFILES = new Set([
  'iana-bootstrap',
  'no-iana-service',
]);

function isRegistryAccessProfile(value: unknown): value is string {
  return typeof value === 'string' && Object.hasOwn(REGISTRY_ACCESS_PROFILE_LABELS, value);
}

function isWhoisRegistryAccessProfile(value: unknown): value is string {
  return typeof value === 'string' && WHOIS_REGISTRY_ACCESS_PROFILES.has(value);
}

function isRdapRegistryAccessProfile(value: unknown): value is string {
  return typeof value === 'string' && RDAP_REGISTRY_ACCESS_PROFILES.has(value);
}

function registryAccessProfileLabel(value: unknown): string {
  return isRegistryAccessProfile(value)
    ? REGISTRY_ACCESS_PROFILE_LABELS[value]
    : 'Unknown';
}

export {
  isRdapRegistryAccessProfile,
  isWhoisRegistryAccessProfile,
  registryAccessProfileLabel,
};
