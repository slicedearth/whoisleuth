import {
  HTTP_DELIVERY_LIMITATIONS,
  HTTP_DELIVERY_METADATA_VERSION,
  PAGE_PUBLICATION_LIMITATIONS,
  PAGE_PUBLICATION_METADATA_VERSION,
} from '../lib/homepage-metadata-contract.mts';

function pagePublicationMetadataFixture() {
  return {
    version: PAGE_PUBLICATION_METADATA_VERSION,
    status: 'success',
    complete: true,
    truncated: false,
    limitations: [PAGE_PUBLICATION_LIMITATIONS.scope],
    robots: {
      status: 'observed',
      complete: true,
      truncated: false,
      directives: ['follow', 'index'],
      recognizedDirectiveCount: 2,
      unknownDirectiveCount: 0,
      conflicting: false,
    },
    twitterCard: {
      status: 'observed',
      complete: true,
      truncated: false,
      cardType: 'summary_large_image',
      declarationCount: 3,
      titlePresent: true,
      descriptionPresent: false,
      imagePresent: true,
      imageAltPresent: false,
      sitePresent: false,
      creatorPresent: false,
      playerPresent: false,
      appPresent: false,
    },
    headings: { complete: true, truncated: false, total: 2, h1: 1, h2: 1, h3: 0, h4: 0, h5: 0, h6: 0 },
    images: {
      totalComplete: true,
      classificationComplete: true,
      truncated: false,
      total: 2,
      altMissing: 1,
      altEmpty: 0,
      altNonEmpty: 1,
      altUnclassified: 0,
    },
    renderBlockingCandidates: {
      complete: true,
      truncated: false,
      script: 1,
      stylesheet: 1,
      total: 2,
      scope: 'explicit-head-static-v1',
    },
  };
}

function httpDeliveryMetadataFixture() {
  return {
    version: HTTP_DELIVERY_METADATA_VERSION,
    status: 'success',
    complete: true,
    truncated: false,
    limitations: [HTTP_DELIVERY_LIMITATIONS.scope],
    contentEncoding: {
      status: 'observed', codings: ['br', 'gzip'], encoded: true, unknownCodingCount: 0,
    },
    cachePolicy: {
      status: 'observed',
      noStore: false,
      noCache: false,
      mustRevalidate: false,
      public: true,
      private: false,
      immutable: true,
      maxAgeSeconds: 3600,
      sMaxAgeSeconds: 120,
      ageSeconds: 45,
      maxAgePresent: true,
      sMaxAgePresent: true,
      agePresent: true,
      unknownDirectiveCount: 0,
      etag: { present: true, valid: true },
      lastModified: { present: true, valid: true },
      expires: { present: false, valid: null },
    },
  };
}

export { httpDeliveryMetadataFixture, pagePublicationMetadataFixture };
