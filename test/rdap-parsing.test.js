const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { parseRdap } = require('../lib/rdap');

describe('structured RDAP metadata', () => {
  test('preserves registrar IDs, addresses, glue, DNSSEC, and protocol notes', () => {
    const parsed = parseRdap('domain', {
      ldhName: 'XN--BCHER-KVA.EXAMPLE',
      unicodeName: 'bücher.example',
      port43: 'whois.example',
      entities: [{
        handle: 'REG-1',
        roles: ['registrar'],
        publicIds: [{ type: 'IANA Registrar ID', identifier: '9999' }],
        vcardArray: ['vcard', [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'Example Registrar'],
          ['adr', {}, 'text', ['', '', '1 Registry Way', 'Melbourne', 'VIC', '3000', 'AU']],
        ]],
      }],
      nameservers: [{
        ldhName: 'NS1.EXAMPLE',
        ipAddresses: { v4: ['192.0.2.10'], v6: ['2001:db8::10'] },
      }],
      secureDNS: {
        zoneSigned: true,
        delegationSigned: true,
        dsData: [{ keyTag: 12345, algorithm: 13, digestType: 2, digest: 'ABCDEF' }],
      },
      notices: [{ title: 'Terms', description: ['Use subject to registry terms.'] }],
      remarks: [{ title: 'Status', description: ['Data redacted by policy.'] }],
    });

    assert.equal(parsed.unicodeDomain, 'bücher.example');
    assert.equal(parsed.port43, 'whois.example');
    assert.equal(parsed.registrarIanaId, '9999');
    assert.equal(parsed.registrar.address, '1 Registry Way, Melbourne, VIC, 3000, AU');
    assert.deepEqual(parsed.nameserverDetails[0].addresses, ['192.0.2.10', '2001:db8::10']);
    assert.deepEqual(parsed.dsData[0], { keyTag: 12345, algorithm: 13, digestType: 2, digest: 'ABCDEF' });
    assert.equal(parsed.notices[0].title, 'Terms');
    assert.equal(parsed.remarks[0].descriptions[0], 'Data redacted by policy.');
  });

  test('bounds notice text copied into the structured response', () => {
    const parsed = parseRdap('asn', {
      startAutnum: 64496,
      endAutnum: 64496,
      parentHandle: 'PARENT-AS-BLOCK',
      port43: 'whois.rir.example',
      notices: Array.from({ length: 20 }, (_, i) => ({
        title: `Notice ${i}`,
        description: ['x'.repeat(2000)],
      })),
    });

    assert.equal(parsed.notices.length, 12);
    assert.equal(parsed.notices[0].descriptions[0].length, 800);
    assert.equal(parsed.parentHandle, 'PARENT-AS-BLOCK');
    assert.equal(parsed.port43, 'whois.rir.example');
  });
});
