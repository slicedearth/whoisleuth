import { PUBLIC_RESOURCES } from './public-resources.ts';
import {
  publicReferenceSectionNavigation,
  type NavigationItem,
} from './workspaces.ts';

export type PublicReferenceDestination = Readonly<{
  href: string;
  label: string;
  detail: string;
}>;

export type PublicReferenceGroup = Readonly<{
  label: string;
  items: readonly PublicReferenceDestination[];
}>;

function destination(href: string): PublicReferenceDestination {
  const item = publicReferenceSectionNavigation.find((candidate) => candidate.href === href);
  if (!item) throw new TypeError(`Missing public reference destination ${href}.`);
  return Object.freeze({ href: item.href, label: item.label, detail: item.detail });
}

const evidenceGuides = Object.freeze(PUBLIC_RESOURCES.map((resource) => Object.freeze({
  href: `/resources/${resource.slug}`,
  label: resource.shortTitle,
  detail: resource.description,
})));

export const PUBLIC_REFERENCE_GROUPS: readonly PublicReferenceGroup[] = Object.freeze([
  Object.freeze({ label: 'Start', items: Object.freeze([destination('/resources')]) }),
  Object.freeze({ label: 'Command line', items: Object.freeze([destination('/cli')]) }),
  Object.freeze({
    label: 'Product reference',
    items: Object.freeze([
      destination('/methodology'),
      destination('/coverage'),
      destination('/examples'),
    ]),
  }),
  Object.freeze({ label: 'Evidence guides', items: evidenceGuides }),
]);

export const PUBLIC_REFERENCE_DESTINATIONS: readonly PublicReferenceDestination[] = Object.freeze(
  PUBLIC_REFERENCE_GROUPS.flatMap((group) => group.items),
);

export const publicReferenceCommandNavigation: readonly NavigationItem[] = Object.freeze(
  PUBLIC_REFERENCE_DESTINATIONS.map((item) => Object.freeze({
    ...item,
    icon: 'page' as const,
    keywords: Object.freeze(['public', 'documentation', 'guide', ...item.label.toLowerCase().split(/\s+/u)]),
    opensInNewTab: true as const,
  })),
);

export function publicReferenceDestination(pathname: string): PublicReferenceDestination | null {
  return PUBLIC_REFERENCE_DESTINATIONS.find((item) => item.href === pathname) ?? null;
}

export function relatedPublicReferences(pathname: string): readonly PublicReferenceDestination[] {
  const resource = PUBLIC_RESOURCES.find(item => `/resources/${item.slug}` === pathname);
  if (resource) return [
    { href: resource.guideHref, label: resource.guideLabel, detail: 'Continue this task in the application guide.' },
    { href: resource.demoHref, label: resource.demoLabel, detail: 'Apply the guide to fictional evidence.' },
  ];
  const group = PUBLIC_REFERENCE_GROUPS.find(item => item.items.some(page => page.href === pathname));
  return (group?.items.length && group.items.length > 1
    ? group.items.filter(item => item.href !== pathname)
    : PUBLIC_REFERENCE_DESTINATIONS.filter(item => ['/cli', '/examples', '/methodology'].includes(item.href) && item.href !== pathname));
}
