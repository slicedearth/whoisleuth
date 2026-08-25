// Exact bounded contracts for metadata derived from the already-captured Deep
// homepage response. These validators perform no collection and accept only
// fixed enums, booleans, counts, and reviewed limitation text.

const PAGE_PUBLICATION_METADATA_VERSION = 1;
const HTTP_DELIVERY_METADATA_VERSION = 1;
const MAX_PAGE_PUBLICATION_TAG_COUNT = 8_192;
const MAX_PAGE_PUBLICATION_META_ELEMENTS = 128;
const MAX_PAGE_PUBLICATION_DECLARATIONS = 64;
const MAX_PAGE_PUBLICATION_ROBOTS_DIRECTIVES = 64;
const MAX_HTTP_DELIVERY_TOKENS = 32;
const MAX_HTTP_DELIVERY_HEADER_BYTES = 1_024;
const MAX_HTTP_CACHE_SECONDS = 315_360_000;
const MAX_HOMEPAGE_METADATA_LIMITATIONS = 4;
const MAX_HOMEPAGE_METADATA_LIMITATION_LENGTH = 300;

const PAGE_PUBLICATION_LIMITATIONS = Object.freeze({
  scope: 'Counts and declarations describe only the captured static homepage HTML; they are not a full accessibility, indexing, or performance audit.',
  body: 'Homepage body capture reached its byte limit; later declarations and elements may be absent.',
  bounds: 'Static HTML token or attribute bounds were reached; publication metadata is partial.',
  malformed: 'At least one publication declaration could not be interpreted; raw declaration values were not retained.',
});

const HTTP_DELIVERY_LIMITATIONS = Object.freeze({
  scope: 'Selected-response headers are point-in-time declarations and do not prove intermediary caching, compression effectiveness, or page performance.',
  bounds: 'At least one delivery header exceeded its byte or item bound and was not partially parsed.',
  malformed: 'At least one delivery header could not be interpreted; raw header values were not retained.',
});

const COMPONENT_STATES = new Set(['observed', 'not_observed', 'partial', 'malformed']);
const ROBOTS_DIRECTIVES = new Set([
  'all', 'follow', 'index', 'max-image-preview', 'max-snippet', 'max-video-preview',
  'noarchive', 'nocache', 'nofollow', 'noimageindex', 'noindex', 'none', 'nositelinkssearchbox',
  'nosnippet', 'notranslate', 'unavailable_after',
]);
const TWITTER_CARD_TYPES = new Set(['summary', 'summary_large_image', 'player', 'app', 'other']);
const CONTENT_CODINGS = new Set(['gzip', 'br', 'deflate', 'zstd', 'identity', 'other']);
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedCount(value: unknown, maximum: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function fixedSortedStrings(value: unknown, allowed: Set<string>, maximum: number): value is string[] {
  if (!Array.isArray(value) || value.length > maximum || !value.every((item) => typeof item === 'string' && allowed.has(item))) return false;
  return value.every((item, index) => index === 0 || String(value[index - 1]) < item);
}

function fixedLimitations(value: unknown, allowed: readonly string[]): value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_HOMEPAGE_METADATA_LIMITATIONS) return false;
  return value.every((item, index) => typeof item === 'string'
    && item.length <= MAX_HOMEPAGE_METADATA_LIMITATION_LENGTH
    && !CONTROL_RE.test(item)
    && allowed.includes(item)
    && value.indexOf(item) === index);
}

function validComponentState(value: unknown): boolean {
  return typeof value === 'string' && COMPONENT_STATES.has(value);
}

function validPagePublicationMetadata(value: unknown): boolean {
  const root = record(value);
  if (!root || !exactKeys(root, [
    'version', 'status', 'complete', 'truncated', 'limitations', 'robots', 'twitterCard',
    'headings', 'images', 'renderBlockingCandidates',
  ])
    || root.version !== PAGE_PUBLICATION_METADATA_VERSION
    || !['success', 'partial'].includes(String(root.status))
    || typeof root.complete !== 'boolean'
    || typeof root.truncated !== 'boolean'
    || !fixedLimitations(root.limitations, Object.values(PAGE_PUBLICATION_LIMITATIONS))) return false;

  const robots = record(root.robots);
  const twitter = record(root.twitterCard);
  const headings = record(root.headings);
  const images = record(root.images);
  const blocking = record(root.renderBlockingCandidates);
  if (!robots || !twitter || !headings || !images || !blocking) return false;

  if (!exactKeys(robots, [
    'status', 'complete', 'truncated', 'directives', 'recognizedDirectiveCount', 'unknownDirectiveCount', 'conflicting',
  ])
    || !validComponentState(robots.status)
    || typeof robots.complete !== 'boolean'
    || typeof robots.truncated !== 'boolean'
    || !fixedSortedStrings(robots.directives, ROBOTS_DIRECTIVES, MAX_PAGE_PUBLICATION_ROBOTS_DIRECTIVES)
    || !boundedCount(robots.recognizedDirectiveCount, MAX_PAGE_PUBLICATION_ROBOTS_DIRECTIVES)
    || !boundedCount(robots.unknownDirectiveCount, MAX_PAGE_PUBLICATION_ROBOTS_DIRECTIVES)
    || Number(robots.recognizedDirectiveCount) + Number(robots.unknownDirectiveCount) > MAX_PAGE_PUBLICATION_ROBOTS_DIRECTIVES
    || Number(robots.recognizedDirectiveCount) < (robots.directives as string[]).length
    || typeof robots.conflicting !== 'boolean') return false;
  if (robots.status === 'partial'
    ? robots.complete !== false || robots.truncated !== true
    : robots.status === 'malformed'
      ? robots.complete !== false || robots.truncated !== false
      : robots.complete !== true || robots.truncated !== false) return false;
  const robotValues = new Set(robots.directives as string[]);
  const conflict = (robotValues.has('index') || robotValues.has('all'))
      && (robotValues.has('noindex') || robotValues.has('none'))
    || (robotValues.has('follow') || robotValues.has('all'))
      && (robotValues.has('nofollow') || robotValues.has('none'));
  if (robots.conflicting !== conflict) return false;
  if (robots.status === 'observed' && (
    Number(robots.recognizedDirectiveCount) + Number(robots.unknownDirectiveCount) === 0
      || (Number(robots.recognizedDirectiveCount) === 0) !== ((robots.directives as string[]).length === 0)
  )) return false;
  if (robots.status === 'not_observed' && (
    (robots.directives as string[]).length || robots.recognizedDirectiveCount !== 0
      || robots.unknownDirectiveCount !== 0 || robots.conflicting !== false
  )) return false;

  if (!exactKeys(twitter, [
    'status', 'complete', 'truncated', 'cardType', 'declarationCount', 'titlePresent', 'descriptionPresent', 'imagePresent',
    'imageAltPresent', 'sitePresent', 'creatorPresent', 'playerPresent', 'appPresent',
  ])
    || !validComponentState(twitter.status)
    || typeof twitter.complete !== 'boolean'
    || typeof twitter.truncated !== 'boolean'
    || !(twitter.cardType === null || typeof twitter.cardType === 'string' && TWITTER_CARD_TYPES.has(twitter.cardType))
    || !boundedCount(twitter.declarationCount, MAX_PAGE_PUBLICATION_DECLARATIONS)
    || !['titlePresent', 'descriptionPresent', 'imagePresent', 'imageAltPresent', 'sitePresent', 'creatorPresent', 'playerPresent', 'appPresent']
      .every((key) => typeof twitter[key] === 'boolean')) return false;
  if (twitter.status === 'partial'
    ? twitter.complete !== false || twitter.truncated !== true
    : twitter.status === 'malformed'
      ? twitter.complete !== false || twitter.truncated !== false
      : twitter.complete !== true || twitter.truncated !== false) return false;
  if (twitter.status === 'not_observed' && (
    twitter.cardType !== null || twitter.declarationCount !== 0
      || ['titlePresent', 'descriptionPresent', 'imagePresent', 'imageAltPresent', 'sitePresent', 'creatorPresent', 'playerPresent', 'appPresent']
        .some((key) => twitter[key] === true)
  )) return false;
  const twitterValuePresent = twitter.cardType !== null
    || ['titlePresent', 'descriptionPresent', 'imagePresent', 'imageAltPresent', 'sitePresent', 'creatorPresent', 'playerPresent', 'appPresent']
      .some((key) => twitter[key] === true);
  if (twitterValuePresent && twitter.declarationCount === 0) return false;
  if (twitter.status === 'observed' && (twitter.declarationCount === 0 || !twitterValuePresent)) return false;

  if (!exactKeys(headings, ['complete', 'truncated', 'total', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
    || typeof headings.complete !== 'boolean'
    || typeof headings.truncated !== 'boolean'
    || headings.complete === headings.truncated
    || !['total', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].every((key) => boundedCount(headings[key], MAX_PAGE_PUBLICATION_TAG_COUNT))
    || headings.total !== ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].reduce((sum, key) => sum + Number(headings[key]), 0)) return false;
  if (!exactKeys(images, [
    'totalComplete', 'classificationComplete', 'truncated',
    'total', 'altMissing', 'altEmpty', 'altNonEmpty', 'altUnclassified',
  ])
    || typeof images.totalComplete !== 'boolean'
    || typeof images.classificationComplete !== 'boolean'
    || typeof images.truncated !== 'boolean'
    || images.truncated !== (images.totalComplete !== true || images.classificationComplete !== true)
    || images.classificationComplete === true && (images.totalComplete !== true || images.altUnclassified !== 0)
    || !['total', 'altMissing', 'altEmpty', 'altNonEmpty', 'altUnclassified'].every((key) => boundedCount(images[key], MAX_PAGE_PUBLICATION_TAG_COUNT))
    || images.total !== ['altMissing', 'altEmpty', 'altNonEmpty', 'altUnclassified'].reduce((sum, key) => sum + Number(images[key]), 0)) return false;
  if (!exactKeys(blocking, ['complete', 'truncated', 'script', 'stylesheet', 'total', 'scope'])
    || typeof blocking.complete !== 'boolean'
    || typeof blocking.truncated !== 'boolean'
    || blocking.complete === blocking.truncated
    || !['script', 'stylesheet', 'total'].every((key) => boundedCount(blocking[key], MAX_PAGE_PUBLICATION_TAG_COUNT))
    || blocking.total !== Number(blocking.script) + Number(blocking.stylesheet)
    || blocking.scope !== 'explicit-head-static-v1') return false;

  const componentTruncated = robots.truncated === true || twitter.truncated === true
    || headings.truncated === true || images.truncated === true || blocking.truncated === true;
  const componentIncomplete = robots.complete !== true || twitter.complete !== true
    || headings.complete !== true || images.totalComplete !== true
    || images.classificationComplete !== true || blocking.complete !== true;
  if (root.truncated !== componentTruncated) return false;
  if (root.status === 'success' ? root.complete !== true || componentIncomplete : root.complete !== false || !componentIncomplete) return false;
  const limitations = root.limitations as string[];
  const hasTruncationLimitation = limitations.some((item) => (
    item === PAGE_PUBLICATION_LIMITATIONS.body || item === PAGE_PUBLICATION_LIMITATIONS.bounds
  ));
  const hasMalformedLimitation = limitations.includes(PAGE_PUBLICATION_LIMITATIONS.malformed);
  const malformedComponent = [robots.status, twitter.status].includes('malformed');
  if (root.truncated !== hasTruncationLimitation
    || malformedComponent && !hasMalformedLimitation
    || root.status === 'success' && hasMalformedLimitation) return false;
  return limitations.includes(PAGE_PUBLICATION_LIMITATIONS.scope);
}

function validPresenceValidity(value: unknown): boolean {
  const item = record(value);
  return Boolean(item && exactKeys(item, ['present', 'valid'])
    && typeof item.present === 'boolean'
    && (item.valid === null || typeof item.valid === 'boolean')
    && (item.present === true || item.valid === null));
}

function validHttpDeliveryMetadata(value: unknown): boolean {
  const root = record(value);
  if (!root || !exactKeys(root, ['version', 'status', 'complete', 'truncated', 'limitations', 'contentEncoding', 'cachePolicy'])
    || root.version !== HTTP_DELIVERY_METADATA_VERSION
    || !['success', 'partial'].includes(String(root.status))
    || typeof root.complete !== 'boolean'
    || typeof root.truncated !== 'boolean'
    || !fixedLimitations(root.limitations, Object.values(HTTP_DELIVERY_LIMITATIONS))) return false;
  const encoding = record(root.contentEncoding);
  const cache = record(root.cachePolicy);
  if (!encoding || !cache) return false;
  if (!exactKeys(encoding, ['status', 'codings', 'encoded', 'unknownCodingCount'])
    || !validComponentState(encoding.status)
    || !fixedSortedStrings(encoding.codings, CONTENT_CODINGS, MAX_HTTP_DELIVERY_TOKENS)
    || !(encoding.encoded === null || typeof encoding.encoded === 'boolean')
    || !boundedCount(encoding.unknownCodingCount, MAX_HTTP_DELIVERY_TOKENS)) return false;
  const codings = encoding.codings as string[];
  if (encoding.status === 'observed') {
    if (!codings.length || typeof encoding.encoded !== 'boolean') return false;
    if (encoding.encoded !== codings.some((coding) => coding !== 'identity')) return false;
    if ((encoding.unknownCodingCount === 0) !== !codings.includes('other')) return false;
  } else if (codings.length || encoding.encoded !== null || encoding.unknownCodingCount !== 0) return false;

  if (!exactKeys(cache, [
    'status', 'noStore', 'noCache', 'mustRevalidate', 'public', 'private', 'immutable',
    'maxAgeSeconds', 'sMaxAgeSeconds', 'ageSeconds', 'maxAgePresent', 'sMaxAgePresent',
    'agePresent', 'unknownDirectiveCount', 'etag',
    'lastModified', 'expires',
  ])
    || !validComponentState(cache.status)
    || !['noStore', 'noCache', 'mustRevalidate', 'public', 'private', 'immutable'].every((key) => typeof cache[key] === 'boolean')
    || !['maxAgeSeconds', 'sMaxAgeSeconds', 'ageSeconds'].every((key) => cache[key] === null || boundedCount(cache[key], MAX_HTTP_CACHE_SECONDS))
    || !['maxAgePresent', 'sMaxAgePresent', 'agePresent'].every((key) => typeof cache[key] === 'boolean')
    || cache.maxAgePresent === false && cache.maxAgeSeconds !== null
    || cache.sMaxAgePresent === false && cache.sMaxAgeSeconds !== null
    || cache.agePresent === false && cache.ageSeconds !== null
    || !boundedCount(cache.unknownDirectiveCount, MAX_HTTP_DELIVERY_TOKENS)
    || !validPresenceValidity(cache.etag)
    || !validPresenceValidity(cache.lastModified)
    || !validPresenceValidity(cache.expires)) return false;
  if (cache.status === 'not_observed' && (
    ['noStore', 'noCache', 'mustRevalidate', 'public', 'private', 'immutable'].some((key) => cache[key] === true)
      || ['maxAgeSeconds', 'sMaxAgeSeconds', 'ageSeconds'].some((key) => cache[key] !== null)
      || ['maxAgePresent', 'sMaxAgePresent', 'agePresent'].some((key) => cache[key] === true)
      || cache.unknownDirectiveCount !== 0
      || [cache.etag, cache.lastModified, cache.expires].some((item) => (item as Record<string, unknown>).present === true)
  )) return false;
  const numericCacheEvidence = [
    [cache.maxAgePresent, cache.maxAgeSeconds],
    [cache.sMaxAgePresent, cache.sMaxAgeSeconds],
    [cache.agePresent, cache.ageSeconds],
  ] as const;
  const validatorEvidence = [cache.etag, cache.lastModified, cache.expires]
    .map((item) => item as Record<string, unknown>);
  const cacheEvidencePresent = ['noStore', 'noCache', 'mustRevalidate', 'public', 'private', 'immutable']
    .some((key) => cache[key] === true)
    || numericCacheEvidence.some(([present]) => present === true)
    || cache.unknownDirectiveCount !== 0
    || validatorEvidence.some((item) => item.present === true);
  if (cache.status === 'observed' && (!cacheEvidencePresent
    || numericCacheEvidence.some(([present, result]) => present === true && result === null)
    || validatorEvidence.some((item) => item.present === true && item.valid !== true))) return false;
  const uncertainValidator = [cache.etag, cache.lastModified, cache.expires]
    .some((item) => (item as Record<string, unknown>).present === true
      && (item as Record<string, unknown>).valid === null);
  if (uncertainValidator && !['partial', 'malformed'].includes(String(cache.status))) return false;

  const componentIncomplete = [encoding.status, cache.status].some((state) => state === 'partial' || state === 'malformed');
  if (root.status === 'success' ? root.complete !== true || componentIncomplete : root.complete !== false || !componentIncomplete) return false;
  if (root.truncated !== [encoding.status, cache.status].includes('partial')) return false;
  const limitations = root.limitations as string[];
  const hasBoundsLimitation = limitations.includes(HTTP_DELIVERY_LIMITATIONS.bounds);
  const hasMalformedLimitation = limitations.includes(HTTP_DELIVERY_LIMITATIONS.malformed);
  const definitelyMalformed = [encoding.status, cache.status].includes('malformed')
    || numericCacheEvidence.some(([present, result]) => present === true && result === null)
    || validatorEvidence.some((item) => item.present === true && item.valid === false);
  if (root.truncated !== hasBoundsLimitation
    || definitelyMalformed && !hasMalformedLimitation
    || root.status === 'success' && hasMalformedLimitation) return false;
  return limitations.includes(HTTP_DELIVERY_LIMITATIONS.scope);
}

export {
  HTTP_DELIVERY_LIMITATIONS,
  MAX_HTTP_DELIVERY_HEADER_BYTES,
  HTTP_DELIVERY_METADATA_VERSION,
  MAX_HTTP_CACHE_SECONDS,
  MAX_HTTP_DELIVERY_TOKENS,
  MAX_PAGE_PUBLICATION_DECLARATIONS,
  MAX_PAGE_PUBLICATION_META_ELEMENTS,
  MAX_PAGE_PUBLICATION_ROBOTS_DIRECTIVES,
  MAX_PAGE_PUBLICATION_TAG_COUNT,
  PAGE_PUBLICATION_LIMITATIONS,
  PAGE_PUBLICATION_METADATA_VERSION,
  validHttpDeliveryMetadata,
  validPagePublicationMetadata,
};
