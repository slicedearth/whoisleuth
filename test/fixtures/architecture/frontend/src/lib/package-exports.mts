import { readable } from 'svelte/store';
// @ts-expect-error Deliberately invalid subpath for the architecture rejection control.
import 'svelte/not-a-public-export';

export const value = readable(0);
