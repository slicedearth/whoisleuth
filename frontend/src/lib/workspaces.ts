export type NavigationIcon =
  | 'analysis'
  | 'lookup'
  | 'discover'
  | 'bulk'
  | 'watchlist'
  | 'brand'
  | 'registry'
  | 'page';

export type NavigationItem = {
  href: string;
  label: string;
  detail: string;
  icon: NavigationIcon;
  keywords: readonly string[];
};

export const dashboard = {
  href: '/dashboard',
  label: 'Dashboard',
  detail: 'Start new work, continue saved work, or follow a guide',
  icon: 'analysis',
  keywords: ['home', 'start', 'console', 'saved work'],
} satisfies NavigationItem;

export const toolNavigation = [
  {
    href: '/lookup',
    label: 'Lookup',
    detail: 'Check one domain, IP address, or ASN',
    icon: 'lookup',
    keywords: ['whois', 'rdap', 'dns', 'tls', 'http'],
  },
  {
    href: '/discover',
    label: 'Discover',
    detail: 'Find domain candidates related to a brand',
    icon: 'discover',
    keywords: ['lookalike', 'typosquat', 'certificate', 'ct', 'candidate'],
  },
  {
    href: '/bulk',
    label: 'Bulk',
    detail: 'Compare and prioritise a list of domains',
    icon: 'bulk',
    keywords: ['batch', 'list', 'scan', 'triage'],
  },
  {
    href: '/monitor',
    label: 'Monitor',
    detail: 'Review cases, watchlists, changes, and campaigns',
    icon: 'watchlist',
    keywords: ['case', 'watchlist', 'campaign', 'history', 'change'],
  },
  {
    href: '/brands',
    label: 'Brands',
    detail: 'Set official domains, trusted infrastructure, and analysis preferences',
    icon: 'brand',
    keywords: ['profile', 'official', 'trusted', 'allowlist', 'baseline'],
  },
] satisfies NavigationItem[];

export const referenceResources = [
  {
    href: '/registry-support',
    label: 'Registry support',
    detail: 'See tested lookup support and known limits for domain endings',
    icon: 'registry',
    keywords: ['tld', 'cctld', 'gtld', 'coverage', 'suffix'],
  },
] satisfies NavigationItem[];

export const publicResources = [
  {
    href: '/guide',
    label: 'Guide',
    detail: 'Learn how to investigate domains and interpret results',
    icon: 'page',
    keywords: ['help', 'documentation', 'glossary', 'faq'],
  },
] satisfies NavigationItem[];

export const publicHomepage = {
  href: '/',
  label: 'Public homepage',
  detail: 'Return to the public product overview',
  icon: 'page',
  keywords: ['home', 'public', 'overview'],
} satisfies NavigationItem;

export const consoleNavigation = [dashboard, ...toolNavigation];
export const referenceNavigation = [...referenceResources, ...publicResources];
export const protectedDestinations = [...consoleNavigation, ...referenceResources];
