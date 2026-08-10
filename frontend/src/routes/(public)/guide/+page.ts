import { redirect } from '@sveltejs/kit';

export const prerender = true;

export function load(): never {
  redirect(308, '/resources');
}
