import { DOMAIN_FEED_CATALOGUE, normalizeDomainFeedReview, projectDomainFeedMatch, type DomainFeedReview, type DomainFeedSelection } from '../../../packages/monitoring/domain-feed.mts';
import { requestJsonCapped, STANDARD_JSON_RESPONSE_BYTES } from './bounded-json-response.ts';

export type DomainFeedServiceStatus = Readonly<{
  enabled: boolean;
  feeds: readonly Readonly<{ feedId: string; cached: boolean; stale: boolean; error: string | null }>[];
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function request(body: unknown, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<unknown> {
  const result = await requestJsonCapped('/api/domain-feed', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  }, { maximumBytes: STANDARD_JSON_RESPONSE_BYTES, timeoutMs: 40_000, fetchImpl });
  if (!result.response.ok) throw new Error('The optional feed service is unavailable. Manual local import remains available.');
  return result.body;
}

export async function loadDomainFeedServiceStatus(signal: AbortSignal, fetchImpl?: typeof fetch): Promise<DomainFeedServiceStatus> {
  const value = record(await request({ operation: 'status' }, signal, fetchImpl));
  if (!value || typeof value.enabled !== 'boolean' || !Array.isArray(value.feeds) || value.feeds.length > DOMAIN_FEED_CATALOGUE.length) throw new Error('The feed service returned an unreadable status.');
  const feeds = value.feeds.map((input) => {
    const feed = record(input);
    if (!feed || typeof feed.feedId !== 'string' || !DOMAIN_FEED_CATALOGUE.some((definition) => definition.id === feed.feedId) || typeof feed.cached !== 'boolean' || typeof feed.stale !== 'boolean' || !(feed.error === null || typeof feed.error === 'string' && feed.error.length <= 300)) throw new Error('The feed service returned an unreadable status.');
    return { feedId: feed.feedId, cached: feed.cached, stale: feed.stale, error: feed.error as string | null };
  });
  if (new Set(feeds.map((feed) => feed.feedId)).size !== feeds.length) throw new Error('The feed service returned ambiguous status.');
  return { enabled: value.enabled, feeds };
}

export async function queryDomainFeedService(feedId: string, selection: DomainFeedSelection, signal: AbortSignal, fetchImpl?: typeof fetch, reviewedAt?: string): Promise<DomainFeedReview[]> {
  // Brand identity remains local; the backend receives only explicit matching inputs.
  const value = record(await request({ operation: 'query', feedIds: [feedId], selection: { hosts: selection.hosts, terms: selection.terms } }, signal, fetchImpl));
  if (!value || value.enabled !== true || !Array.isArray(value.feeds) || value.feeds.length !== 1 || !Array.isArray(value.limitations) || value.limitations.length > 20 || value.limitations.some((item) => typeof item !== 'string' || item.length > 300)) throw new Error('The feed service returned an unreadable query result.');
  const result = record(value.feeds[0]);
  if (!result || typeof result.stale !== 'boolean' || result.error !== null) throw new Error('The selected feed cache is unavailable. No absence is inferred.');
  const review = normalizeDomainFeedReview(result.review);
  if (!review || review.feedId !== feedId) throw new Error('The feed service returned an unexpected feed result.');
  const localObservedAt = reviewedAt ?? new Date().toISOString();
  const matches = review.matches.map((match) => {
    const projected = projectDomainFeedMatch(match.domain, { ...review, importedAt: localObservedAt }, selection);
    if (!projected) throw new Error('The service returned a domain outside the explicit selection.');
    return projected;
  });
  return [{ ...review, selection, matches, limitations: [...review.limitations, ...value.limitations as string[], ...(result.stale ? ['The retained feed cache is stale; membership is not a current or continuous-coverage claim.'] : [])] }];
}
