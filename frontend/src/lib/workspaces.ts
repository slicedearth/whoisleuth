export const dashboard = {
  href: '/dashboard',
  label: 'Dashboard',
  detail: 'Start new work, continue saved work, or follow a guide',
};

export const toolNavigation = [
  { href: '/lookup', label: 'Lookup', detail: 'Check one domain, IP address, or ASN' },
  { href: '/discover', label: 'Discover', detail: 'Find domain candidates related to a brand' },
  { href: '/bulk', label: 'Bulk', detail: 'Compare and prioritise a list of domains' },
  { href: '/monitor', label: 'Monitor', detail: 'Review cases, watchlists, changes, and campaigns' },
  { href: '/brands', label: 'Brands', detail: 'Set official domains, trusted infrastructure, and analysis preferences' }
];

export const referenceResources = [
  { href: '/registry-support', label: 'Registry support', detail: 'See tested lookup support and known limits for domain endings' },
];

export const publicResources = [
  { href: '/guide', label: 'Guide', detail: 'Learn how to investigate domains and interpret results' },
];

export const consoleNavigation = [dashboard, ...toolNavigation];
export const referenceNavigation = [...referenceResources, ...publicResources];
export const protectedDestinations = [...consoleNavigation, ...referenceResources];
