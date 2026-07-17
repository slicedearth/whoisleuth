export const dashboard = {
  href: '/dashboard',
  label: 'Dashboard',
  detail: 'Start an investigation or continue browser-local work',
};

export const workspaces = [
  { href: '/lookup', label: 'Lookup', detail: 'Investigate a domain, IP address, or ASN' },
  { href: '/discover', label: 'Discover', detail: 'Generate and find brand-related candidates' },
  { href: '/bulk', label: 'Bulk', detail: 'Triage candidates and related infrastructure' },
  { href: '/monitor', label: 'Monitor', detail: 'Track analyst cases, watchlists, and change history' },
  { href: '/brands', label: 'Brands', detail: 'Manage profiles, allowlists, and posture' }
];

export const referenceWorkspaces = [
  { href: '/registry-support', label: 'Registry support', detail: 'Review fixture-backed compatibility and access constraints' },
];

export const consoleDestinations = [dashboard, ...workspaces, ...referenceWorkspaces];
