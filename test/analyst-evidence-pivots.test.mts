import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildAnalystEvidencePivots } from '../frontend/src/lib/analysis/analyst-evidence-pivots.ts';

describe('analyst-controlled evidence pivots', () => {
  test('builds deterministic domain destinations from the validated canonical domain', () => {
    const pivots = buildAnalystEvidencePivots({
      type: 'domain',
      query: 'portal.example.com',
      registrableDomain: 'example.com',
      observedAddress: '45.67.89.10',
      observedCidrs: ['45.67.88.0/23'],
    });

    assert.deepEqual(pivots.map((item) => item.id), [
      'icann-registration',
      'iana-delegation',
      'certificate-transparency',
      'historical-captures',
      'safe-browsing-status',
      'ripestat-resource',
    ]);
    assert.equal(pivots[0].href, 'https://lookup.icann.org/en/lookup?name=example.com');
    assert.equal(pivots[1].href, 'https://www.iana.org/domains/root/db/com.html');
    assert.equal(pivots[2].href, 'https://crt.sh/?q=example.com');
    assert.equal(pivots[3].href, 'https://web.archive.org/web/*/example.com/');
    assert.equal(pivots[4].href, 'https://transparencyreport.google.com/safe-browsing/search?url=example.com');
    assert.equal(pivots[5].href, 'https://stat.ripe.net/app/launchpad/45.67.88.0%2F23');
    assert.ok(pivots.every((item) => item.disclosure.includes(item.sharedValue)));
  });

  test('normalizes an internationalized domain to its DNS-safe form', () => {
    const pivots = buildAnalystEvidencePivots({
      type: 'domain',
      query: 'bücher.example',
      registrableDomain: 'bücher.example',
    });

    assert.equal(pivots[0].sharedValue, 'xn--bcher-kva.example');
    assert.match(pivots[0].href, /name=xn--bcher-kva\.example$/u);
    assert.equal(pivots[1].sharedValue, '.example');
  });

  test('offers RIPEstat and PeeringDB only for a public, non-reserved ASN', () => {
    const pivots = buildAnalystEvidencePivots({
      type: 'asn',
      query: 'AS398101',
      startAutnum: 398101,
      endAutnum: 398101,
    });

    assert.deepEqual(pivots.map((item) => item.id), ['ripestat-resource', 'peeringdb-asn']);
    assert.equal(pivots[0].href, 'https://stat.ripe.net/app/launchpad/AS398101');
    assert.equal(pivots[1].href, 'https://www.peeringdb.com/net?asn=398101');
    assert.equal(pivots[1].sharedValue, 'AS398101');
  });

  test('offers a network pivot for a validated public IP address', () => {
    const pivots = buildAnalystEvidencePivots({
      type: 'ipv4',
      query: '45.67.89.10',
    });

    assert.equal(pivots.length, 1);
    assert.equal(pivots[0].id, 'ripestat-resource');
    assert.equal(pivots[0].sharedValue, '45.67.89.10');
  });

  test('rejects malformed, private, documentation, and reserved targets', () => {
    assert.deepEqual(buildAnalystEvidencePivots({
      type: 'domain',
      query: 'safe.example',
      registrableDomain: 'safe.example/path?next=outside.invalid',
      observedAddress: '127.0.0.1',
      observedCidrs: ['192.0.2.0/24', 'fc00::/7'],
    }), []);
    assert.deepEqual(buildAnalystEvidencePivots({
      type: 'asn',
      query: 'AS64496',
      startAutnum: 64496,
      endAutnum: 64496,
    }), []);
    assert.deepEqual(buildAnalystEvidencePivots({
      type: 'ipv6',
      query: '2001:db8::1',
    }), []);
    assert.deepEqual(buildAnalystEvidencePivots({
      type: 'ipv6',
      query: '::ffff:127.0.0.1',
    }), []);
    assert.deepEqual(buildAnalystEvidencePivots({
      type: 'ipv6',
      query: '::ffff:7f00:1',
    }), []);
  });

  test('never accepts an upstream-provided destination URL', () => {
    const pivots = buildAnalystEvidencePivots({
      type: 'domain',
      query: 'example.com',
      registrableDomain: 'https://outside.invalid/example.com',
      observedAddress: 'https://outside.invalid/',
      observedCidrs: ['https://outside.invalid/'],
    });

    assert.deepEqual(pivots, []);
  });
});
