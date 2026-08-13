import {
  validHttpDeliveryMetadata,
  validPagePublicationMetadata,
} from '../../../../lib/homepage-metadata-contract.mts';

type MetadataDisplayRow = {
  id: string;
  label: string;
  value: string;
};

type HomepageMetadataDisplay = {
  status: string;
  complete: boolean;
  truncated: boolean;
  rows: MetadataDisplayRow[];
  limitations: string[];
  note: string;
};

function sourceState(value: unknown): string {
  return ({
    observed: 'Observed',
    not_observed: 'Not observed',
    partial: 'Partial',
    malformed: 'Malformed',
  } as Record<string, string>)[String(value)] || 'Unavailable';
}

function count(value: unknown, lowerBound: boolean): string {
  const number = Number(value);
  return `${lowerBound ? 'At least ' : ''}${Number.isSafeInteger(number) && number >= 0 ? number : 0}`;
}

function presentList(values: Array<[string, unknown]>, complete: boolean): string {
  const retained = values.filter(([, value]) => value === true).map(([label]) => label);
  return retained.join(', ') || (complete ? 'None observed' : 'Not established');
}

function publicationMetadataDisplay(value: unknown): HomepageMetadataDisplay | null {
  if (value === undefined || value === null) return null;
  if (!validPagePublicationMetadata(value)) return null;
  const root = value as Record<string, unknown>;
  const robots = root.robots as Record<string, unknown>;
  const twitter = root.twitterCard as Record<string, unknown>;
  const headings = root.headings as Record<string, unknown>;
  const images = root.images as Record<string, unknown>;
  const blocking = root.renderBlockingCandidates as Record<string, unknown>;
  const directives = robots.directives as string[];
  const headingsLowerBound = headings.complete !== true;
  const imageTotalLowerBound = images.totalComplete !== true;
  const imageClassLowerBound = images.totalComplete !== true;
  const blockingLowerBound = blocking.complete !== true;
  return {
    status: root.status === 'success' ? 'Complete' : 'Partial',
    complete: root.complete === true,
    truncated: root.truncated === true,
    rows: [
      { id: 'publication.robots.state', label: 'Robots declarations', value: sourceState(robots.status) },
      {
        id: 'publication.robots.directives',
        label: 'Recognized robots directives',
        value: directives.join(', ') || (robots.status === 'not_observed' ? 'None observed' : 'Not established'),
      },
      {
        id: 'publication.robots.conflict',
        label: 'Robots declaration conflict',
        value: robots.conflicting === true
          ? 'Conflicting declarations observed'
          : robots.status === 'partial' || robots.status === 'malformed' ? 'Not established' : 'None observed',
      },
      { id: 'publication.twitter.state', label: 'Twitter Card declarations', value: sourceState(twitter.status) },
      {
        id: 'publication.twitter.type',
        label: 'Twitter Card type',
        value: typeof twitter.cardType === 'string'
          ? twitter.cardType.replaceAll('_', ' ')
          : twitter.status === 'not_observed' ? 'None observed' : 'Not established',
      },
      {
        id: 'publication.twitter.fields',
        label: 'Twitter fields declared',
        value: presentList([
          ['title', twitter.titlePresent], ['description', twitter.descriptionPresent],
          ['image', twitter.imagePresent], ['image alternative text', twitter.imageAltPresent],
          ['site', twitter.sitePresent], ['creator', twitter.creatorPresent],
          ['player', twitter.playerPresent], ['application', twitter.appPresent],
        ], twitter.status === 'observed'),
      },
      {
        id: 'publication.headings',
        label: 'Heading elements',
        value: `${count(headings.total, headingsLowerBound)} total · H1 ${count(headings.h1, headingsLowerBound)} · H2 ${count(headings.h2, headingsLowerBound)} · H3 ${count(headings.h3, headingsLowerBound)} · H4 ${count(headings.h4, headingsLowerBound)} · H5 ${count(headings.h5, headingsLowerBound)} · H6 ${count(headings.h6, headingsLowerBound)}`,
      },
      {
        id: 'publication.images',
        label: 'Image alternative text',
        value: `${count(images.total, imageTotalLowerBound)} images · missing ${count(images.altMissing, imageClassLowerBound)} · empty ${count(images.altEmpty, imageClassLowerBound)} · non-empty ${count(images.altNonEmpty, imageClassLowerBound)} · unclassified ${count(images.altUnclassified, imageClassLowerBound)}`,
      },
      {
        id: 'publication.blocking',
        label: 'Static render-blocking candidates',
        value: `${count(blocking.total, blockingLowerBound)} total · scripts ${count(blocking.script, blockingLowerBound)} · stylesheets ${count(blocking.stylesheet, blockingLowerBound)}`,
      },
    ],
    limitations: root.limitations as string[],
    note: 'Static homepage declarations and candidates do not prove indexing, identity, accessibility conformance, performance, safety, or maliciousness.',
  };
}

function deliveryMetadataDisplay(value: unknown): HomepageMetadataDisplay | null {
  if (value === undefined || value === null) return null;
  if (!validHttpDeliveryMetadata(value)) return null;
  const root = value as Record<string, unknown>;
  const encoding = root.contentEncoding as Record<string, unknown>;
  const cache = root.cachePolicy as Record<string, unknown>;
  const codings = encoding.codings as string[];
  const cacheDirectives = presentList([
    ['no-store', cache.noStore], ['no-cache', cache.noCache],
    ['must-revalidate', cache.mustRevalidate], ['public', cache.public],
    ['private', cache.private], ['immutable', cache.immutable],
  ], cache.status === 'observed');
  const seconds = (
    value: unknown,
    present: unknown,
    parentStatus: unknown,
    independentlyObserved = false,
  ) => value !== null
    ? `${value} seconds`
    : present === true || !independentlyObserved && ['partial', 'malformed'].includes(String(parentStatus))
      ? 'Not established'
      : 'Not observed';
  const validity = (value: unknown) => {
    const item = value as Record<string, unknown>;
    return item.present !== true
      ? 'Not observed'
      : item.valid === true ? 'Syntactically valid' : item.valid === false ? 'Malformed' : 'Not established';
  };
  return {
    status: root.status === 'success' ? 'Complete' : 'Partial',
    complete: root.complete === true,
    truncated: root.truncated === true,
    rows: [
      { id: 'delivery.encoding.state', label: 'Content-Encoding', value: sourceState(encoding.status) },
      {
        id: 'delivery.encoding.codings',
        label: 'Declared content codings',
        value: codings.join(', ') || (encoding.status === 'not_observed' ? 'None observed' : 'Not established'),
      },
      {
        id: 'delivery.encoding.encoded',
        label: 'Encoded representation declared',
        value: encoding.encoded === true ? 'Yes' : encoding.encoded === false ? 'No' : 'Not established',
      },
      { id: 'delivery.cache.state', label: 'Cache declarations', value: sourceState(cache.status) },
      { id: 'delivery.cache.directives', label: 'Recognized cache directives', value: cacheDirectives },
      { id: 'delivery.cache.max_age', label: 'max-age', value: seconds(cache.maxAgeSeconds, cache.maxAgePresent, cache.status) },
      { id: 'delivery.cache.shared_max_age', label: 's-maxage', value: seconds(cache.sMaxAgeSeconds, cache.sMaxAgePresent, cache.status) },
      { id: 'delivery.cache.age', label: 'Age header', value: seconds(cache.ageSeconds, cache.agePresent, cache.status, true) },
      {
        id: 'delivery.cache.validators',
        label: 'Validator declarations',
        value: `ETag ${validity(cache.etag)} · Last-Modified ${validity(cache.lastModified)} · Expires ${validity(cache.expires)}`,
      },
    ],
    limitations: root.limitations as string[],
    note: 'These values describe one selected response. They do not prove cache storage, transfer savings, intermediary behaviour, freshness, privacy, performance, or safety.',
  };
}

export {
  deliveryMetadataDisplay,
  publicationMetadataDisplay,
  type HomepageMetadataDisplay,
  type MetadataDisplayRow,
};
