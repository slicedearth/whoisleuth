import { safeFetchDetailed } from '../safe-fetch.mts';
import { readRequestTextCapped } from '../http.mts';
import { normalizeDomainFeedSelection, normalizeDomainFeedReview, buildDomainFeedReview,
  type DomainFeedSnapshotMetadata } from '../../packages/monitoring/domain-feed.mts';
import { domainFeedConnection, selectedDomainFeeds, DOMAIN_FEED_BODY_BYTES, DOMAIN_FEED_RESPONSE_BYTES,
  DOMAIN_FEED_QUERY_TIMEOUT_MS, type FeedEnvironment } from './domain-feed-config.mts';
import { DOMAIN_FEED_SERVICE_LIMITATIONS, DOMAIN_FEED_MAX_RESULTS, domainFeedResultAllocation } from './domain-feed-config.mts';
import { normalizeExplicitIsoTimestamp } from '../../packages/evidence/observation.mts';
import { normalizeDomainFeedCursor, normalizeDomainFeedHistoryPage, type DomainFeedCursor } from '../../packages/monitoring/domain-feed-history.mts';

type DomainFeedOperation = Readonly<{ operation: 'status' }> | Readonly<{ operation: 'query'; feedIds: string[];
  selection: ReturnType<typeof normalizeDomainFeedSelection> }> | Readonly<{ operation: 'history'; feedIds: string[];
  selection: ReturnType<typeof normalizeDomainFeedSelection>; cursor: DomainFeedCursor | null }>;
type DomainFeedTransport = (url: string, init: RequestInit) => Promise<Response>;

function containsDecodedCredential(value: unknown, credentials: readonly string[]): boolean {
  if (typeof value === 'string') return credentials.some(secret => value.includes(secret));
  if (value && typeof value === 'object') return Object.values(value).some(child => containsDecodedCredential(child, credentials));
  return false;
}

function parseDomainFeedOperation(value: unknown): DomainFeedOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > DOMAIN_FEED_BODY_BYTES) throw new Error('Invalid domain feed request.');
  const record = value as Record<string, unknown>;
  if (record.operation === 'status' && Object.keys(record).length === 1) return { operation: 'status' };
  if (!['query', 'history'].includes(String(record.operation)) || Object.keys(record).sort().join(',') !==
    (record.operation === 'history' ? 'cursor,feedIds,operation,selection' : 'feedIds,operation,selection')) throw new Error('Invalid domain feed request.');
  if (!record.selection || typeof record.selection !== 'object' || Array.isArray(record.selection)
    || Object.keys(record.selection).some(key => !['hosts', 'terms', 'negativeTerms'].includes(key))) throw new Error('Only literal hosts and terms may be sent.');
  const selection = normalizeDomainFeedSelection(record.selection as { hosts?: string[]; terms?: string[] });
  if (selection.hosts.length + selection.terms.length === 0) throw new Error('Select at least one literal host or term.');
  const feedIds = selectedDomainFeeds(record.feedIds);
  if (record.operation === 'history') {
    if (feedIds.length !== 1) throw new Error('Review one retained source history at a time.');
    return { operation: 'history', feedIds, selection,
      cursor: record.cursor === null ? null : normalizeDomainFeedCursor(record.cursor, feedIds[0]!, selection) };
  }
  return { operation: 'query', feedIds, selection };
}

async function domainFeedTransport(url: string, init: RequestInit): Promise<Response> {
  const parsed = new URL(url);
  // This separate transport accepts only fixed numeric loopback origins. It is
  // not a private-network exception in the shared SSRF-safe request engine.
  if (parsed.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(parsed.hostname)) return fetch(url, { ...init, redirect: 'error' });
  return (await safeFetchDetailed(url, init, { maxRedirects: 0 })).response;
}

function validateDomainFeedReply(value: unknown, operation: DomainFeedOperation): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid feed service reply.');
  const record = value as Record<string, unknown>;
  if (operation.operation === 'history') {
    if (Object.keys(record).sort().join(',') !== 'enabled,history' || record.enabled !== true) throw new Error('Invalid feed history reply.');
    const history = normalizeDomainFeedHistoryPage(record.history, operation.feedIds[0]!, operation.selection);
    if (operation.cursor && (history.epoch !== operation.cursor.epoch || history.sequence !== operation.cursor.sequence
      || (operation.cursor.sequence <= operation.cursor.through && history.through !== operation.cursor.through))) throw new Error('Unexpected feed history progress.');
    return { enabled: true, history };
  }
  if (Object.keys(record).sort().join(',') !== (operation.operation === 'status' ? 'enabled,feeds' : 'enabled,feeds,limitations')) throw new Error('Invalid feed service reply.');
  if (record.enabled !== true || !Array.isArray(record.feeds) || record.feeds.length < 1 || record.feeds.length > 11) throw new Error('Invalid feed service reply.');
  const seen = new Set<string>();
  const feeds = [];
  let retainedMatches = 0;
  for (const entry of record.feeds) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid feed service reply.');
    const feed = entry as Record<string, unknown>;
    if (Object.keys(feed).sort().join(',') !== (operation.operation === 'status' ? 'cached,checkedAt,error,feedId,metadata,stale' : 'error,feedId,review,stale')) throw new Error('Invalid feed service reply.');
    selectedDomainFeeds([feed.feedId]);
    if (typeof feed.feedId !== 'string' || seen.has(feed.feedId) || typeof feed.stale !== 'boolean'
      || !(feed.error === null || typeof feed.error === 'string' && feed.error.length <= 256)) throw new Error('Invalid feed service reply.');
    seen.add(feed.feedId);
    if (operation.operation === 'query') {
      const review = feed.review === null ? null : normalizeDomainFeedReview(feed.review);
      if (!operation.feedIds.includes(feed.feedId) || (feed.review !== null && !review)) throw new Error('Invalid feed service review.');
      if (review && (review.feedId !== feed.feedId || JSON.stringify(review.selection) !== JSON.stringify(operation.selection))) throw new Error('Feed identity or selection mismatch.');
      if (review) {
        retainedMatches += review.matches.length;
        if (review.matches.length > domainFeedResultAllocation(operation.feedIds.length) || retainedMatches > DOMAIN_FEED_MAX_RESULTS) throw new Error('Feed result allocation exceeded.');
      }
      feeds.push({ feedId: feed.feedId, stale: feed.stale, review, error: feed.error === null ? null : review
        ? 'Latest refresh could not be confirmed; review the retained snapshot date.' : 'Retained feed snapshot is unavailable.' });
    } else {
      if (typeof feed.cached !== 'boolean' || feed.cached !== (feed.metadata !== null)) throw new Error('Invalid cache status.');
      if (feed.cached !== (feed.checkedAt !== null)) throw new Error('Invalid cache check state.');
      if (!(feed.checkedAt === null || typeof feed.checkedAt === 'string' && normalizeExplicitIsoTimestamp(feed.checkedAt) === feed.checkedAt)) throw new Error('Invalid service clock.');
      if (feed.metadata !== null) {
        if (!feed.metadata || typeof feed.metadata !== 'object' || Array.isArray(feed.metadata)
          || Object.keys(feed.metadata).sort().join(',') !== 'acquiredAt,bytes,declaredPublishedAt,declaredVersion,feedId,importedAt,revision,rows') throw new Error('Invalid service metadata.');
        const checked = buildDomainFeedReview(feed.metadata as DomainFeedSnapshotMetadata, normalizeDomainFeedSelection({ hosts: ['validation.invalid'] }), [], { matched: null, omitted: null, truncated: false });
        if (checked.feedId !== feed.feedId) throw new Error('Feed identity mismatch.');
      }
      feeds.push({ feedId: feed.feedId, cached: feed.cached, stale: feed.stale, metadata: feed.metadata, checkedAt: feed.checkedAt,
        error: feed.error === null ? null : feed.cached ? 'Latest refresh could not be confirmed; last-good snapshot is retained.' : 'No usable retained snapshot is available.' });
    }
  }
  if (operation.operation === 'query' && (seen.size !== operation.feedIds.length || !Array.isArray(record.limitations)
    || JSON.stringify(record.limitations) !== JSON.stringify(DOMAIN_FEED_SERVICE_LIMITATIONS))) throw new Error('Invalid feed service reply.');
  return { enabled: true, feeds, ...(operation.operation === 'query' ? { limitations: DOMAIN_FEED_SERVICE_LIMITATIONS } : {}) };
}

async function executeDomainFeedOperation(operation: DomainFeedOperation, options: { env?: FeedEnvironment;
  signal?: AbortSignal; transport?: DomainFeedTransport } = {}) {
  const configuration = domainFeedConnection(options.env);
  if (!configuration) return operation.operation === 'status'
    ? { status: 200, body: { enabled: false, feeds: [] } }
    : { status: 503, body: { error: 'Optional domain feed service is disconnected.', errorCode: 'DOMAIN_FEED_DISCONNECTED' } };
  const signal = AbortSignal.any([AbortSignal.timeout(DOMAIN_FEED_QUERY_TIMEOUT_MS + 3_000), ...(options.signal ? [options.signal] : [])]);
  const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${configuration.token}` });
  if (configuration.access) { headers.set('CF-Access-Client-Id', configuration.access.id); headers.set('CF-Access-Client-Secret', configuration.access.secret); }
  try {
    const response = await (options.transport ?? domainFeedTransport)(`${configuration.url}/${operation.operation}`, {
      method: 'POST', headers, body: JSON.stringify(operation.operation === 'status' ? {} : { feedIds: operation.feedIds,
        selection: { ...operation.selection, brandProfileId: undefined },
        ...(operation.operation === 'history' ? { cursor: operation.cursor } : {}) }), signal, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    if (response.status !== 200 || response.redirected || !response.headers.get('content-type')?.startsWith('application/json')) {
      await response.body?.cancel().catch(() => {});
      throw new Error('Unavailable feed service.');
    }
    const body = await readRequestTextCapped({ body: response.body, headers: response.headers, signal }, DOMAIN_FEED_RESPONSE_BYTES);
    if (body.status !== 'ok') throw new Error('Invalid feed service response body.');
    if (body.body.includes(configuration.token) || (configuration.access && body.body.includes(configuration.access.secret))) throw new Error('Credential echo rejected.');
    const decoded = validateDomainFeedReply(JSON.parse(body.body), operation);
    const outgoing = JSON.stringify(decoded);
    const credentials = [configuration.token, ...(configuration.access ? [configuration.access.secret] : [])];
    if (credentials.some(secret => outgoing.includes(secret)) || containsDecodedCredential(decoded, credentials)) throw new Error('Decoded credential echo rejected.');
    return { status: 200, body: decoded };
  } catch {
    return { status: options.signal?.aborted ? 408 : 503, body: { error: 'Optional domain feed service is unavailable.', errorCode: 'DOMAIN_FEED_UNAVAILABLE' } };
  }
}

export { parseDomainFeedOperation, executeDomainFeedOperation, validateDomainFeedReply, domainFeedTransport };
export type { DomainFeedOperation, DomainFeedTransport };
