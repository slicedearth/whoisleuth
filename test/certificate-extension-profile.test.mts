import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCertificateExtensionProfile } from '../lib/certificate-extension-profile.mts';

const CERTIFICATE_WITH_EXTENSIONS = 'MIIDijCCAnKgAwIBAgIBATANBgkqhkiG9w0BAQsFADAaMRgwFgYDVQQDDA9maXh0dXJlLmludmFsaWQwHhcNMjYwODA0MDkwOTUyWhcNMzYwODAxMDkwOTUyWjAaMRgwFgYDVQQDDA9maXh0dXJlLmludmFsaWQwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCXxeZqzKFahB19Pc4FHGvNvSZO+77986vgv+tlPOeD6VsbvsKkN5AH0AGQCP4WrbNiZAVW9ggUIoftWaSQqiv1lu5qldmLOtHwVDIufImAsCm0LvN1awzvZfOaAOPfVPjD1p1ko8JzXp60kxMM6+w0tqGHCkhKuaP46it0P+tvEdow+h4PUwi7jLGvUhSql8XYVYTmtOnOvJ7ZSZYnDFoRrom/InGopURUg2E2QIgLFkQQpUGKUfQIOJiPlCAL9ExP+Rwd6lQJYFTD8LNuQMkiWl+TxrGB+ZZmvzOQdqvLcfQKa/9dA9MS942fSnbsCz5mRbsII4R9h3j0gESKfW25AgMBAAGjgdowgdcwHQYDVR0OBBYEFH/wex8OmTlhOgRRus5BbRQB+f95MB8GA1UdIwQYMBaAFH/wex8OmTlhOgRRus5BbRQB+f95MA8GA1UdEwEB/wQFMAMBAf8wIQYDVR0gBBowGDAMBgorBgEEAdZ5AgUBMAgGBmeBDAECATBhBgNVHR8EWjBYMCmgJ6AlhiNodHRwOi8vY3JsLmZpeHR1cmUuaW52YWxpZC9saXN0LmNybDAroCmgJ4YlbGRhcDovL2RpcmVjdG9yeS5maXh0dXJlLmludmFsaWQvbGlzdDANBgkqhkiG9w0BAQsFAAOCAQEAGtD6GPY7VAZD5eEAnHImkXIev2CM25HneQpw1idp/QjeXsqttWedNBJ/lQJ/1V8QSVwou6TPoA+6CPf0sL/plGF15B32NhfMGan8w39KEJRE9BCc+7TBc/1yJi+jYEvBUwI9SJIab2GRhZFiloM+BC+OdcjaO3dijXRpOiSOd/u3/skNwfJ50ns9Cz6l4rx19E9rGtcF3QbSWbcQp65p9jQAlapZyo1SUIz0uGeI53I1TAspVD/axhfgnv//YGPFkvTVL/ysz1ka4CesXjaLafHB4cEXoqcgzKAAnT9/yJuQbKVSUvSw0r9HzYS7ciz9LRiaxqzdOilpDkAadW/leg==';

describe('certificate extension profile', () => {
  test('retains policy identifiers and distribution scheme counts without locations', () => {
    const result = parseCertificateExtensionProfile(Buffer.from(CERTIFICATE_WITH_EXTENSIONS, 'base64'));
    assert.equal(result.parsed, true);
    assert.deepEqual(result.certificatePolicies.oids, ['1.3.6.1.4.1.11129.2.5.1', '2.23.140.1.2.1']);
    assert.deepEqual(result.crlDistributionPoints, {
      total: 2, http: 1, https: 0, ldap: 1, other: 0, truncated: false,
    });
    assert.doesNotMatch(JSON.stringify(result), /fixture\.invalid|list\.crl/u);
  });

  test('fails soft for malformed or absent certificate bytes', () => {
    assert.equal(parseCertificateExtensionProfile(Buffer.from('not a certificate')).partial, true);
    assert.equal(parseCertificateExtensionProfile(null).parsed, false);
  });
});
