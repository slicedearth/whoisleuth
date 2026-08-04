import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { domainToASCII } from 'node:url';

import {
  digestRegistryIdnPolicySource,
  parseRegistryIdnPolicy,
  reviewRegistryIdnCandidates,
} from '../frontend/src/lib/analysis/idn-registry-policy.ts';

const XML = `<?xml version="1.0"?><lgr><data>
  <char cp="0061"/><char cp="00E4"/><char cp="0430"/>
  <char cp="0061 0301"/><range first-cp="0062" last-cp="007A"/>
</data></lgr>`;

async function policy() {
  return parseRegistryIdnPolicy({
    suffix: '.test',
    sourceName: ' reviewed\n table.xml ',
    sourceDigestSha256: await digestRegistryIdnPolicySource(XML),
    xml: XML,
  });
}

describe('local registry IDN table review', () => {
  test('parses a bounded LGR repertoire with stable provenance', async () => {
    const parsed = await policy();
    assert.equal(parsed.schema, 'whoisleuth.registry-idn-policy');
    assert.equal(parsed.suffix, 'test');
    assert.equal(parsed.sourceName, 'reviewed table.xml');
    assert.equal(parsed.codePointCount, 28);
    assert.equal(parsed.sequenceCount, 1);
    assert.match(parsed.sourceDigestSha256, /^sha256:[a-f0-9]{64}$/);
  });

  test('keeps listed, unlisted, ASCII, and out-of-scope results distinct', async () => {
    const parsed = await policy();
    const reviews = reviewRegistryIdnCandidates(parsed, [
      { domain: domainToASCII('ä.test') },
      { domain: domainToASCII('é.test') },
      { domain: 'plain.test' },
      { domain: domainToASCII('ä.example') },
    ]);
    assert.deepEqual(reviews.map((item) => item.state), ['allowed_by_table', 'not_listed', 'ascii_only', 'out_of_scope']);
    assert.deepEqual(reviews[1]?.unlistedCodePoints, ['U+00E9']);
  });

  test('rejects active XML constructs, malformed provenance, and excessive ranges', async () => {
    const digest = await digestRegistryIdnPolicySource(XML);
    assert.throws(() => parseRegistryIdnPolicy({ suffix: 'test', sourceName: 'x.xml', sourceDigestSha256: digest, xml: '<!DOCTYPE lgr><lgr><char cp="0061"/></lgr>' }), /document types/i);
    assert.throws(() => parseRegistryIdnPolicy({ suffix: 'test', sourceName: 'x.xml', sourceDigestSha256: 'bad', xml: XML }), /digest/i);
    assert.throws(() => parseRegistryIdnPolicy({ suffix: 'bad suffix', sourceName: 'x.xml', sourceDigestSha256: digest, xml: XML }), /DNS-safe/i);
  });
});
