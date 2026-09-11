import { publicReferenceCommandNavigation } from './public-reference-navigation.ts';
import {
  consoleNavigationGroups,
  monitorViewNavigation,
  publicCommandNavigation,
  referenceResources,
  type NavigationItem,
} from './workspaces.ts';

export type ConsoleCommandNavigationItem = NavigationItem & Readonly<{ group: string }>;

const publicCommands = [...new Map([
  ...publicCommandNavigation.map((item) => ({ ...item, group: 'Public' })),
  ...publicReferenceCommandNavigation.map((item) => ({ ...item, group: 'Documentation' })),
].map((item) => [item.href, item] as const)).values()];

export const consoleCommandNavigation: readonly ConsoleCommandNavigationItem[] = Object.freeze([
  ...consoleNavigationGroups.flatMap((navigationGroup) => (
    navigationGroup.items.map((item) => ({ ...item, group: navigationGroup.label }))
  )),
  ...monitorViewNavigation.flatMap(({ group, views }) => views
    .filter(({ view }) => view !== 'inbox' && view !== 'watchlists')
    .map(({ view, label, detail }) => ({
      href: `/monitor?view=${view}`, label, detail, group,
      icon: 'watchlist' as const, keywords: ['monitor', 'saved work', view],
    }))),
  ...referenceResources.map((item) => ({ ...item, group: 'Reference' })),
  ...publicCommands,
]);
