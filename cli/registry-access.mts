const REGISTRY_ACCESS_PROFILE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'iana-bootstrap': 'IANA bootstrap discovery',
  'iana-referral': 'IANA referral discovery',
  'no-iana-service': 'No service published by IANA',
  'source-ip-authorization-required': 'Source-IP authorization required',
});

function registryAccessProfileLabel(value: unknown): string {
  return typeof value === 'string' && REGISTRY_ACCESS_PROFILE_LABELS[value]
    ? REGISTRY_ACCESS_PROFILE_LABELS[value]
    : 'Unknown';
}

export { registryAccessProfileLabel };
