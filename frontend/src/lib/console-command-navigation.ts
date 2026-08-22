import { publicReferenceCommandNavigation } from './public-reference-navigation.ts';
import {
  consoleNavigationGroups,
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
  ...referenceResources.map((item) => ({ ...item, group: 'Reference' })),
  ...publicCommands,
]);
