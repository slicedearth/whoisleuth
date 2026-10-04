import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { domainFeedDefinition } from '../../packages/monitoring/domain-feed.mts';

type FeedEnvironment = Readonly<Record<string, unknown>>;
// 200 canonical ASCII hostnames at 253 bytes, 20 literal terms at up to
// 320 UTF-8 bytes each, JSON framing and 11 fixed feed IDs fit in 64 KiB.
const DOMAIN_FEED_BODY_BYTES = 64 * 1024;
const DOMAIN_FEED_RESPONSE_BYTES = 512 * 1024;
const DOMAIN_FEED_QUERY_TIMEOUT_MS = 5_000;
const DOMAIN_FEED_STALE_MS = 36 * 60 * 60 * 1000;
const DOMAIN_FEED_MAX_RESULTS = 200;
const DOMAIN_FEED_SERVICE_LIMITATIONS = Object.freeze([
  'Feed membership only nominates candidates; it does not establish abuse, ownership or domain availability.',
  'Coverage and publisher freshness remain unknown where the snapshot does not declare them. Stale snapshots require review.',
  'Queries share a 200-candidate ceiling equally across selected feeds; matching-row totals are not inferred from retained results.',
]);
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/u;

type DomainFeedConnection = Readonly<{ url: string; token: string; access?: Readonly<{ id: string; secret: string }> }>;

function domainFeedConnection(env: FeedEnvironment = process.env): DomainFeedConnection | null {
  if (env.WHOISLEUTH_DOMAIN_FEED_ENABLED !== '1') return null;
  const token = env.WHOISLEUTH_DOMAIN_FEED_TOKEN ?? '';
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  let url: URL;
  try { if (typeof env.WHOISLEUTH_DOMAIN_FEED_URL !== 'string') return null; url = new URL(env.WHOISLEUTH_DOMAIN_FEED_URL); } catch { return null; }
  const loopback = url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!loopback && (url.protocol !== 'https:' || (url.port && url.port !== '443'))) || url.username || url.password
    || url.search || url.hash || url.pathname !== '/') return null;
  const id = env.WHOISLEUTH_DOMAIN_FEED_ACCESS_CLIENT_ID;
  const secret = env.WHOISLEUTH_DOMAIN_FEED_ACCESS_CLIENT_SECRET;
  if (Boolean(id) !== Boolean(secret) || (id && (typeof id !== 'string' || typeof secret !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(id) || !/^[\x21-\x7e]{1,256}$/u.test(secret)))) return null;
  return { url: url.origin, token, ...(typeof id === 'string' && typeof secret === 'string' ? { access: { id, secret } } : {}) };
}

function selectedDomainFeeds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 11 || value.some(id => typeof id !== 'string' || !domainFeedDefinition(id))) {
    throw new Error('Select recognised domain feed IDs.');
  }
  if (new Set(value).size !== value.length) throw new Error('Feed IDs must be unique.');
  return [...value] as string[];
}

function domainFeedServiceConfiguration(env: FeedEnvironment = process.env) {
  const token = env.WHOISLEUTH_DOMAIN_FEED_SERVICE_TOKEN ?? '';
  const directory = env.WHOISLEUTH_DOMAIN_FEED_CACHE_DIRECTORY ?? '';
  const port = Number(env.WHOISLEUTH_DOMAIN_FEED_SERVICE_PORT ?? '8787');
  if (typeof token !== 'string' || typeof directory !== 'string' || !TOKEN.test(token) || !path.isAbsolute(directory) || directory === path.parse(directory).root
    || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid domain feed service configuration.');
  if (typeof env.WHOISLEUTH_DOMAIN_FEED_SERVICE_FEEDS !== 'string') throw new Error('Select recognised domain feed IDs.');
  return { token, directory, port, feedIds: selectedDomainFeeds(env.WHOISLEUTH_DOMAIN_FEED_SERVICE_FEEDS.split(',')) };
}

function acceptsDomainFeedBearer(header: string | undefined, token: string): boolean {
  if (!TOKEN.test(token) || !header?.startsWith('Bearer ')) return false;
  const presented = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export { DOMAIN_FEED_BODY_BYTES, DOMAIN_FEED_RESPONSE_BYTES, DOMAIN_FEED_QUERY_TIMEOUT_MS, DOMAIN_FEED_STALE_MS,
  DOMAIN_FEED_MAX_RESULTS, domainFeedConnection, selectedDomainFeeds, domainFeedServiceConfiguration, acceptsDomainFeedBearer };
export { DOMAIN_FEED_SERVICE_LIMITATIONS };
export type { DomainFeedConnection, FeedEnvironment };
