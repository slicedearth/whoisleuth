import type { AnalystReviewLifecycle } from './analyst-review-state.ts';

/** The Dashboard and inbox must describe the same retained attention set. */
export function analystReviewNeedsAttention(lifecycle: AnalystReviewLifecycle): boolean {
  return !['expected', 'suppressed', 'resolved'].includes(lifecycle.state);
}

export function analystReviewAttentionHref(subjectKey?: string): string {
  const query = new URLSearchParams({ view: 'inbox', attention: '1' });
  if (subjectKey) query.set('review', subjectKey);
  return `/monitor?${query}`;
}
