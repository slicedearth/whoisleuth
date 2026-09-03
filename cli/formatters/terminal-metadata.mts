import {
  validHttpDeliveryMetadata,
  validPagePublicationMetadata,
} from '../../lib/homepage-metadata-contract.mts';
import {
  safeTerminalValue,
  terminalDisplayCount,
  terminalRecord,
  titleCase,
} from './terminal-shared.mts';

type LookupTerminalDetail = 'summary' | 'standard' | 'verbose';

function appendPublicationMetadataLines(
  lines: string[],
  value: unknown,
  detail: LookupTerminalDetail,
): void {
  if (detail === 'summary' || !validPagePublicationMetadata(value)) return;
  const metadata = terminalRecord(value);
  const robots = terminalRecord(metadata.robots);
  const twitter = terminalRecord(metadata.twitterCard);
  const headings = terminalRecord(metadata.headings);
  const images = terminalRecord(metadata.images);
  const blocking = terminalRecord(metadata.renderBlockingCandidates);
  lines.push(`Publication    ${metadata.complete === true ? 'Complete' : 'Partial'} · robots ${titleCase(robots.status)} · card ${titleCase(twitter.status)}`);
  const directives = Array.isArray(robots.directives) ? robots.directives.map((item) => safeTerminalValue(item)) : [];
  if (directives.length) lines.push(`Robots         ${safeTerminalValue(directives.join(', '))}${robots.conflicting === true ? ' · conflicting' : ''}`);
  else if (robots.status === 'not_observed') lines.push('Robots         No declaration observed in captured static HTML');
  if (twitter.cardType) lines.push(`Card type      ${safeTerminalValue(twitter.cardType)}`);
  lines.push(
    `Static page    headings ${terminalDisplayCount(headings.total)} · images ${terminalDisplayCount(images.total)} · blocking candidates ${terminalDisplayCount(blocking.total)}`,
  );
  if (detail === 'verbose') {
    lines.push(
      `Image alt      missing ${terminalDisplayCount(images.altMissing)} · empty ${terminalDisplayCount(images.altEmpty)} · non-empty ${terminalDisplayCount(images.altNonEmpty)} · unclassified ${terminalDisplayCount(images.altUnclassified)}`,
    );
    lines.push(
      `Blocking       scripts ${terminalDisplayCount(blocking.script)} · stylesheets ${terminalDisplayCount(blocking.stylesheet)} · static candidates only`,
    );
  }
}

function appendDeliveryMetadataLines(lines: string[], value: unknown, verbose = false): void {
  if (!validHttpDeliveryMetadata(value)) return;
  const metadata = terminalRecord(value);
  const encoding = terminalRecord(metadata.contentEncoding);
  const cache = terminalRecord(metadata.cachePolicy);
  const codings = Array.isArray(encoding.codings) ? encoding.codings.map((item) => safeTerminalValue(item)) : [];
  lines.push(`Delivery       ${metadata.complete === true ? 'Complete' : 'Partial'} · encoding ${titleCase(encoding.status)} · cache ${titleCase(cache.status)}`);
  if (codings.length) lines.push(`Content coding ${safeTerminalValue(codings.join(', '))}`);
  const cacheDirectives = [
    ['no-store', cache.noStore], ['no-cache', cache.noCache], ['must-revalidate', cache.mustRevalidate],
    ['public', cache.public], ['private', cache.private], ['immutable', cache.immutable],
  ].filter(([, present]) => present === true).map(([label]) => label);
  if (cacheDirectives.length) lines.push(`Cache policy   ${safeTerminalValue(cacheDirectives.join(', '))}`);
  if (verbose) {
    const seconds = [
      cache.maxAgeSeconds === null ? null : `max-age ${terminalDisplayCount(cache.maxAgeSeconds)}s`,
      cache.sMaxAgeSeconds === null ? null : `s-maxage ${terminalDisplayCount(cache.sMaxAgeSeconds)}s`,
      cache.ageSeconds === null ? null : `Age ${terminalDisplayCount(cache.ageSeconds)}s`,
    ].filter(Boolean);
    if (seconds.length) lines.push(`Cache timing   ${safeTerminalValue(seconds.join(' · '))}`);
    const declared = [
      terminalRecord(cache.etag).present === true ? 'ETag' : null,
      terminalRecord(cache.lastModified).present === true ? 'Last-Modified' : null,
      terminalRecord(cache.expires).present === true ? 'Expires' : null,
    ].filter(Boolean);
    lines.push(`Validators     ${declared.length ? safeTerminalValue(declared.join(', ')) : 'No validator declaration observed'}`);
  }
}

export { appendDeliveryMetadataLines, appendPublicationMetadataLines };
