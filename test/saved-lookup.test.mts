import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  LEGACY_SAVED_LOOKUP_SCHEMA_VERSION,
  SAVED_LOOKUP_SCHEMA_VERSION,
  SUPPORTED_SAVED_LOOKUP_SCHEMA_VERSIONS,
  parseSavedLookupDocument,
} from '../cli/saved-lookup.mts';
import { loadCliLookupV1Fixture } from './cli-lookup-v1-fixture.mts';
import {
  httpDeliveryMetadataFixture,
  pagePublicationMetadataFixture,
} from './homepage-metadata-fixtures.mts';

describe('saved Lookup compatibility', () => {
  test('accepts the frozen v1 document and a current v2 document without rewriting either version', async () => {
    const legacyRaw = await loadCliLookupV1Fixture();
    const legacy = parseSavedLookupDocument(legacyRaw);
    assert.equal(legacy.version, LEGACY_SAVED_LOOKUP_SCHEMA_VERSION);

    const current = JSON.parse(legacyRaw) as Record<string, unknown>;
    current.version = SAVED_LOOKUP_SCHEMA_VERSION;
    current.availability = {
      ...(current.availability as Record<string, unknown>),
      pageIdentity: { status: 'success', publicationMetadata: pagePublicationMetadataFixture() },
      http: { status: 'success', response: { deliveryMetadata: httpDeliveryMetadataFixture() } },
    };
    assert.equal(parseSavedLookupDocument(JSON.stringify(current)).version, SAVED_LOOKUP_SCHEMA_VERSION);
    assert.deepEqual(SUPPORTED_SAVED_LOOKUP_SCHEMA_VERSIONS, [1, 2]);
  });

  test('rejects future versions, malformed current metadata, and new fields in a legacy envelope', async () => {
    const base = JSON.parse(await loadCliLookupV1Fixture()) as Record<string, unknown>;
    for (const version of [0, 3, 99, '1', true, [1]]) {
      assert.throws(() => parseSavedLookupDocument(JSON.stringify({ ...base, version })), /version 1 or 2/iu);
    }
    const legacyWithCurrent = structuredClone(base);
    legacyWithCurrent.availability = {
      ...(legacyWithCurrent.availability as Record<string, unknown>),
      pageIdentity: { publicationMetadata: pagePublicationMetadataFixture() },
    };
    assert.throws(() => parseSavedLookupDocument(JSON.stringify(legacyWithCurrent)), /cannot contain version 2 homepage metadata/iu);
    const malformed = structuredClone(legacyWithCurrent);
    malformed.version = 2;
    ((malformed.availability as Record<string, unknown>).pageIdentity as Record<string, unknown>).publicationMetadata = {
      ...pagePublicationMetadataFixture(), version: 2,
    };
    assert.throws(() => parseSavedLookupDocument(JSON.stringify(malformed)), /invalid homepage metadata/iu);

    const coercionBypass = structuredClone(base);
    coercionBypass.version = '1';
    coercionBypass.availability = {
      ...(coercionBypass.availability as Record<string, unknown>),
      pageIdentity: {
        status: 'success',
        publicationMetadata: { ...pagePublicationMetadataFixture(), version: 99 },
      },
    };
    assert.throws(() => parseSavedLookupDocument(JSON.stringify(coercionBypass)), /version 1 or 2/iu);

    const unavailableParent = structuredClone(base);
    unavailableParent.version = 2;
    unavailableParent.availability = {
      ...(unavailableParent.availability as Record<string, unknown>),
      pageIdentity: { status: 'error', publicationMetadata: pagePublicationMetadataFixture() },
      http: { status: 'error', response: { deliveryMetadata: httpDeliveryMetadataFixture() } },
    };
    assert.throws(() => parseSavedLookupDocument(JSON.stringify(unavailableParent)), /invalid homepage metadata/iu);
  });
});
