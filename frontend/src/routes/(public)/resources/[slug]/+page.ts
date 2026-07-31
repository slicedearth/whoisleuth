import { error } from '@sveltejs/kit';
import type { EntryGenerator, PageLoad } from './$types';

import {
  PUBLIC_RESOURCE_SLUGS,
  publicResource,
} from '$lib/public-resources';

export const entries: EntryGenerator = () =>
  PUBLIC_RESOURCE_SLUGS.map((slug) => ({ slug }));

export const load: PageLoad = ({ params }) => {
  const resource = publicResource(params.slug);
  if (!resource) error(404, 'Resource not found');
  return { resource };
};
