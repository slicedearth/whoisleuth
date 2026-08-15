import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildLocalGeoIpDatabase,
  LOCAL_GEOIP_SCHEMA,
  LOCAL_GEOIP_VERSION,
  lookupLocalGeoIp,
} from '../lib/local-geoip-evidence.mts';

describe('local GeoIP evidence', () => {
  test('preserves the stable source-facade family markers without emitting them as a document', () => {
    assert.equal(LOCAL_GEOIP_SCHEMA, 'whoisleuth.local-geoip-evidence');
    assert.equal(LOCAL_GEOIP_VERSION, 1);
    assert.equal('schema' in buildLocalGeoIpDatabase({
      sourceLabel: 'Synthetic fixture',
      databaseVersion: '1',
      license: 'Test data only',
      records: [],
    }), false);
  });

  test('uses the longest matching analyst-supplied prefix with source metadata', () => {
    const database = buildLocalGeoIpDatabase({
      sourceLabel: 'Synthetic fixture',
      databaseVersion: '2026-08-03',
      license: 'Test data only',
      records: [
        { network: '192.0.2.0/24', countryCode: 'AU', region: 'Fixture region' },
        { network: '192.0.2.128/25', countryCode: 'NZ', city: 'Fixture city', asn: 'AS64496', asName: 'Fixture network' },
      ],
    });
    const result = lookupLocalGeoIp(database, '192.0.2.200');
    assert.equal(result.state, 'matched');
    assert.equal(result.match?.network, '192.0.2.128/25');
    assert.equal(result.match?.countryCode, 'NZ');
    assert.equal(result.source?.license, 'Test data only');
  });

  test('keeps misses and invalid inputs distinct and rejects missing licence metadata', () => {
    const database = buildLocalGeoIpDatabase({
      sourceLabel: 'Synthetic fixture',
      databaseVersion: '1',
      license: 'Test data only',
      records: [{ network: '2001:db8::/32', countryCode: 'AU' }],
    });
    assert.equal(lookupLocalGeoIp(database, '2001:db8::1').state, 'matched');
    assert.equal(lookupLocalGeoIp(database, '192.0.2.1').state, 'not_found');
    assert.equal(lookupLocalGeoIp(database, 'bad').state, 'invalid');
    assert.throws(() => buildLocalGeoIpDatabase({ records: [] }), /requires bounded source/u);
  });

  test('rejects malformed prefixes instead of creating a catch-all attribution', () => {
    const database = buildLocalGeoIpDatabase({
      sourceLabel: 'Synthetic fixture',
      databaseVersion: '1',
      license: 'Test data only',
      records: [{ network: '192.0.2.0/', countryCode: 'AQ', city: 'Fixture city' }],
    });
    assert.equal(database.rejectedCount, 1);
    assert.equal(lookupLocalGeoIp(database, '198.51.100.1').state, 'partial');
  });
});
