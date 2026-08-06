import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { domainToASCII } from 'node:url';

import fc from 'fast-check';

import {
  MAX_ADVANCED_CONFUSABLE_VARIANTS,
  advancedConfusableVariantsForAscii,
  estimateAdvancedConfusableVariants,
  unicodeSkeleton,
  wholeLabelConfusableVariantsForAscii,
} from '../lib/idn-confusables.mts';
import { normalizeRdapEvents, summarizeLifecycle } from '../lib/rdap-normalization.mts';
import { isPrivateAddress } from '../lib/safe-fetch.mts';
import { parseWhoisChain } from '../lib/whois.mts';
import { fastCheckParameters } from './helpers/fast-check-config.mts';

type Ipv4Bytes = readonly [number, number, number, number];

const ipv4Bytes = fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255));
const asciiLabel = fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), {
  minLength: 1,
  maxLength: 32,
}).map((characters) => characters.join(''));

function ipv4String(bytes: Ipv4Bytes): string {
  return bytes.join('.');
}

function referencePrivateIpv4([a, b, c]: Ipv4Bytes): boolean {
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && b >= 18 && b <= 19)
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function ipv4HexGroups([a, b, c, d]: Ipv4Bytes): readonly [string, string] {
  return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
}

function compressIpv6(groups: readonly number[]): string {
  const full = groups.map((group) => group.toString(16).padStart(4, '0')).join(':');
  const hostname = new URL(`http://[${full}]/`).hostname;
  return hostname.slice(1, -1);
}

describe('core protocol property coverage', () => {
  test('matches the IPv4 range table while rejecting unsafe transition forms', () => {
    fc.assert(fc.property(ipv4Bytes, (bytes) => {
      const expected = referencePrivateIpv4(bytes);
      const [high, low] = ipv4HexGroups(bytes);
      assert.equal(isPrivateAddress(ipv4String(bytes)), expected);
      assert.equal(isPrivateAddress(`::ffff:${high}:${low}`), expected);
      assert.equal(isPrivateAddress(`64:ff9b::${high}:${low}`), expected);
      assert.equal(isPrivateAddress(`2002:${high}:${low}::`), true);
    }), fastCheckParameters(500));
  });

  test('classifies equivalent full and compressed IPv6 forms identically', () => {
    fc.assert(fc.property(
      fc.array(fc.nat(0xffff), { minLength: 8, maxLength: 8 }),
      (groups) => {
        const full = groups.map((group) => group.toString(16).padStart(4, '0')).join(':');
        assert.equal(isPrivateAddress(full), isPrivateAddress(compressIpv6(groups)));
      },
    ), fastCheckParameters(300));
  });

  test('rejects Teredo regardless of its embedded addresses', () => {
    fc.assert(fc.property(ipv4Bytes, ipv4Bytes, (server, client) => {
      const [serverHigh, serverLow] = ipv4HexGroups(server);
      const [clientHigh, clientLow] = ipv4HexGroups(client);
      const obfuscatedHigh = ((~Number.parseInt(clientHigh, 16)) & 0xffff).toString(16);
      const obfuscatedLow = ((~Number.parseInt(clientLow, 16)) & 0xffff).toString(16);
      const teredo = `2001:0000:${serverHigh}:${serverLow}:0000:ffff:${obfuscatedHigh}:${obfuscatedLow}`;
      assert.equal(isPrivateAddress(teredo), true);
    }), fastCheckParameters(300));
  });

  test('keeps RDAP lifecycle conclusions independent of bounded event order', () => {
    const event = fc.record({
      eventAction: fc.constantFrom(
        'registration',
        'expiration',
        'last changed',
        'transfer',
        'deletion',
        'last update of RDAP database',
      ),
      eventDate: fc.integer({ min: 0, max: 4_102_444_800_000 })
        .map((milliseconds) => new Date(milliseconds).toISOString()),
      eventActor: fc.string({ maxLength: 180 }),
    });
    fc.assert(fc.property(
      fc.array(event, { maxLength: 100 }),
      (events) => {
        const forward = normalizeRdapEvents(events);
        const reverse = normalizeRdapEvents([...events].reverse());
        assert.deepEqual(summarizeLifecycle(forward), summarizeLifecycle(reverse));
        assert.ok(forward.length <= 100);
        assert.ok(forward.every((entry) => (entry.action?.length ?? 0) <= 100));
        assert.ok(forward.every((entry) => (entry.date?.length ?? 0) <= 64));
        assert.ok(forward.every((entry) => (entry.actor?.length ?? 0) <= 160));
      },
    ), fastCheckParameters(200));
  });

  test('keeps arbitrary bounded WHOIS text within normalized collection limits', () => {
    fc.assert(fc.property(fc.string({ maxLength: 8_192 }), (response) => {
      const parsed = parseWhoisChain([{
        server: 'whois.registry.example',
        response,
      }]);
      assert.ok(parsed.nameservers.length <= 200);
      assert.ok(parsed.statuses.length <= 100);
      assert.ok(parsed.nameservers.every((value) => value.length <= 253));
      assert.deepEqual(parsed.fieldsTruncated, [...new Set(parsed.fieldsTruncated)].sort());
      assert.match(parsed.registrationStatus, /^(registered|not_found|inconclusive)$/u);
      assert.match(parsed.chainStatus, /^(complete|partial)$/u);
    }), fastCheckParameters(300));
  });

  test('keeps generated confusables deterministic, unique, and within declared budgets', () => {
    fc.assert(fc.property(asciiLabel, (label) => {
      const result = advancedConfusableVariantsForAscii(label);
      const estimate = estimateAdvancedConfusableVariants(label);
      assert.deepEqual(advancedConfusableVariantsForAscii(label), result);
      assert.equal(result.eligibleVariantCount, estimate.eligibleVariantCount);
      assert.equal(result.omittedByPolicy, estimate.omittedByPolicy);
      assert.equal(result.omittedByBudget, estimate.omittedByBudget);
      assert.ok(result.variants.length <= MAX_ADVANCED_CONFUSABLE_VARIANTS);
      assert.equal(
        new Set(result.variants.map((variant) => variant.unicodeLabel)).size,
        result.variants.length,
      );
      for (const variant of result.variants) {
        assert.equal(unicodeSkeleton(variant.unicodeLabel), label);
        assert.ok(domainToASCII(`${variant.unicodeLabel}.example`));
      }
      const wholeLabel = wholeLabelConfusableVariantsForAscii(label);
      assert.equal(new Set(wholeLabel.map((variant) => variant.unicodeLabel)).size, wholeLabel.length);
      assert.ok(wholeLabel.every((variant) => unicodeSkeleton(variant.unicodeLabel) === label));
    }), fastCheckParameters(100));
  });
});
