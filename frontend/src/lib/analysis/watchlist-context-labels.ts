import { MAX_PROFILES } from '../../../../packages/contracts/workspace-portability.mts';

export type WatchBrandNames = ReadonlyMap<string, string>;
export type WatchBrandProfileName = Readonly<{ id: string; name: string }>;

/** Optional presentation context never changes retained identifiers or write authority. */
export function buildWatchBrandNames(
  profiles: readonly WatchBrandProfileName[],
  sourceState: 'loading' | 'ready' | 'unavailable',
): WatchBrandNames {
  const names = new Map<string, string>();
  if (sourceState !== 'ready') return names;
  const ambiguous = new Set<string>();
  for (const profile of profiles.slice(0, MAX_PROFILES)) {
    if (ambiguous.has(profile.id)) continue;
    const previous = names.get(profile.id);
    if (previous !== undefined && previous !== profile.name) {
      names.delete(profile.id);
      ambiguous.add(profile.id);
    } else if (profile.name) names.set(profile.id, profile.name);
  }
  return names;
}

export function watchContextBrandDisplay(brandProfileId: string | null, names: WatchBrandNames) {
  if (brandProfileId === null) return {
    label: 'Watchlist-only context',
    description: 'No Brand identifier is assigned to this context.',
  };
  const name = names.get(brandProfileId);
  return {
    label: name ? `Brand ${name}` : `Brand name unavailable (${brandProfileId})`,
    description: `Exact Brand identifier: ${brandProfileId}`,
  };
}
