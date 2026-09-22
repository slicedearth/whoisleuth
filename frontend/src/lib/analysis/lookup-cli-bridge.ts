import { prepareLookupCollectionTarget, prepareSelectedLookupUrl } from '../../../../packages/evidence/lookup-target.mts';

export function lookupCliBridge(input: Readonly<{ query: string; mode: 'fast' | 'deep'; selectedUrl: boolean }>) {
  if (input.selectedUrl && input.mode !== 'deep') throw new Error('Selected URL collection requires Deep mode.');
  const target = input.selectedUrl ? prepareSelectedLookupUrl(input.query.trim()) : prepareLookupCollectionTarget(input.query);
  return {
    initialPositionals: [target],
    initialOptions: { [`--${input.mode}`]: [''], '--plan': [''], '--json': [''], ...(input.selectedUrl ? { '--exact-url': [''] } : {}) },
  };
}
