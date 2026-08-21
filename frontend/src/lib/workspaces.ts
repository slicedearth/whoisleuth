export type NavigationIcon =
  | 'analysis'
  | 'lookup'
  | 'discover'
  | 'bulk'
  | 'case'
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
  opensInNewTab?: true;
  activeQuery?: Readonly<{
    name: string;
    values: readonly string[];
    defaultValue?: string;
  }>;
};

export type NavigationGroup = Readonly<{
  label: 'Start' | 'Investigate' | 'Respond' | 'Assure';
  items: readonly NavigationItem[];
}>;

export const dashboard = {
  href: '/dashboard',
  label: 'Dashboard',
  detail: 'Start or resume work across the three analyst jobs',
  icon: 'analysis',
  keywords: ['home', 'start', 'console', 'saved work'],
} satisfies NavigationItem;

export const lookupNavigation = {
    href: '/lookup',
    label: 'Lookup',
    detail: 'Check one domain, IP address, or ASN',
    icon: 'lookup',
    keywords: ['whois', 'rdap', 'dns', 'tls', 'http'],
  } satisfies NavigationItem;

export const discoverNavigation = {
    href: '/discover',
    label: 'Discover',
    detail: 'Find domain candidates related to a brand',
    icon: 'discover',
    keywords: ['lookalike', 'typosquat', 'certificate', 'ct', 'candidate'],
  } satisfies NavigationItem;

export const bulkNavigation = {
    href: '/bulk',
    label: 'Bulk',
    detail: 'Compare and prioritise a list of domains',
    icon: 'bulk',
    keywords: ['batch', 'list', 'scan', 'triage'],
  } satisfies NavigationItem;

export const monitorNavigation = {
    href: '/monitor',
    label: 'Monitor',
    detail: 'Review cases, prepare responses, campaigns, and follow-up',
    icon: 'case',
    keywords: ['respond', 'case', 'response', 'campaign', 'follow-up', 'inbox'],
    activeQuery: {
      name: 'view',
      values: ['inbox', 'cases', 'campaigns', 'relationships'],
      defaultValue: 'inbox',
    },
  } satisfies NavigationItem;

export const monitorAssuranceNavigation = {
    href: '/monitor?view=watchlists',
    label: 'Watchlists & controls',
    detail: 'Review monitoring history, watchlists, and local rules',
    icon: 'watchlist',
    keywords: ['assure', 'monitoring', 'watchlist', 'timeline', 'history', 'change', 'rules', 'controls'],
    activeQuery: {
      name: 'view',
      values: ['timeline', 'watchlists', 'rules'],
    },
  } satisfies NavigationItem;

export const brandsNavigation = {
    href: '/brands',
    label: 'Brands',
    detail: 'Review owned-domain profiles, dependencies, and controls',
    icon: 'brand',
    keywords: ['profile', 'official', 'trusted', 'allowlist', 'baseline'],
  } satisfies NavigationItem;

export const toolNavigation = [
  lookupNavigation,
  discoverNavigation,
  bulkNavigation,
  monitorNavigation,
  brandsNavigation,
];

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
    href: '/resources',
    label: 'Resources',
    detail: 'Learn the workflows and browse source-aware topic guides',
    icon: 'page',
    keywords: ['learn', 'guide', 'help', 'documentation', 'glossary', 'faq', 'resources', 'library', 'rdap', 'whois', 'dns', 'tls', 'evidence'],
    opensInNewTab: true,
  },
] satisfies NavigationItem[];

export const publicHomepage = {
  href: '/',
  label: 'Public homepage',
  detail: 'Return to the public product overview',
  icon: 'page',
  keywords: ['home', 'public', 'overview'],
  opensInNewTab: true,
} satisfies NavigationItem;

export const publicCommandNavigation = [
  publicHomepage,
  {
    href: '/demo',
    label: 'Synthetic demo',
    detail: 'Explore fixed fictional evidence without contacting a live target',
    icon: 'page',
    keywords: ['public', 'sample', 'fictional', 'preview'],
    opensInNewTab: true,
  },
  {
    href: '/privacy',
    label: 'Privacy',
    detail: 'Review collection, storage, retention, and third-party processing',
    icon: 'page',
    keywords: ['public', 'policy', 'data', 'browser', 'storage'],
    opensInNewTab: true,
  },
  {
    href: '/terms',
    label: 'Terms',
    detail: 'Review acceptable use and service limitations',
    icon: 'page',
    keywords: ['public', 'policy', 'conditions', 'acceptable use'],
    opensInNewTab: true,
  },
  {
    href: '/request-policy',
    label: 'Request policy',
    detail: 'Review bounded request, automation, and provider rules',
    icon: 'page',
    keywords: ['public', 'requests', 'network', 'automation', 'providers'],
    opensInNewTab: true,
  },
  {
    href: '/contact',
    label: 'Contact',
    detail: 'Prepare a privacy-preserving support message',
    icon: 'page',
    keywords: ['public', 'support', 'message', 'feedback'],
    opensInNewTab: true,
  },
] satisfies NavigationItem[];

export const consoleNavigationGroups: readonly NavigationGroup[] = [
  {
    label: 'Start',
    items: [dashboard],
  },
  {
    label: 'Investigate',
    items: [lookupNavigation, discoverNavigation, bulkNavigation],
  },
  {
    label: 'Respond',
    items: [monitorNavigation],
  },
  {
    label: 'Assure',
    items: [monitorAssuranceNavigation, brandsNavigation],
  },
];

export const consoleNavigation = consoleNavigationGroups.flatMap((group) => group.items);
export const referenceNavigation: readonly NavigationItem[] = [...referenceResources, ...publicResources];
export const protectedDestinations = [...consoleNavigation, ...referenceResources];

export function isNavigationItemActive(item: NavigationItem, currentUrl: URL): boolean {
  const destination = new URL(item.href, currentUrl.origin);
  if (destination.pathname !== currentUrl.pathname) return false;
  if (item.activeQuery) {
    const requestedValue = currentUrl.searchParams.get(item.activeQuery.name);
    const knownValue = requestedValue === null || consoleNavigation.some((candidate) => {
      const candidateDestination = new URL(candidate.href, currentUrl.origin);
      const candidateQuery = candidate.activeQuery;
      if (!candidateQuery) return false;
      return candidateDestination.pathname === currentUrl.pathname
        && candidateQuery.name === item.activeQuery?.name
        && candidateQuery.values.includes(requestedValue);
    });
    const value = requestedValue === null || !knownValue
      ? item.activeQuery.defaultValue ?? requestedValue ?? ''
      : requestedValue;
    return item.activeQuery.values.includes(value);
  }
  if (!destination.search) return true;
  return [...destination.searchParams].every(([name, value]) => currentUrl.searchParams.get(name) === value);
}

export function isProtectedDestination(currentUrl: URL): boolean {
  return protectedDestinations.some((item) => (
    new URL(item.href, currentUrl.origin).pathname === currentUrl.pathname
  ));
}
