import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildLocalGeoIpDatabase,
  lookupLocalGeoIp,
} from '../lib/local-geoip-evidence.mts';

describe('local GeoIP evidence', () => {
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
});
