import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import { parseRdap } from '../lib/rdap.mts';

const FIXTURE_URL = new URL('../fixtures/rdap/reference-oracle/domain-with-redaction.json', import.meta.url);
const FIXTURE_SHA256 = '4ba79a97d7651a3984dc6e612ba79e5e2722f62d8b1a87fdda6953c692c79fcd';

describe('independent RDAP reference fixture', () => {
  test('normalizes a redacted domain response without live collection', async () => {
    const text = await readFile(FIXTURE_URL, 'utf8');
    assert.equal(createHash('sha256').update(text).digest('hex'), FIXTURE_SHA256);
    const parsed = parseRdap('domain', JSON.parse(text));
    assert.ok(parsed);
    assert.equal(parsed.domain, 'example.com');
    assert.equal(parsed.handle, null);
    assert.equal(parsed.registrarIanaId, '1');
    assert.deepEqual(parsed.nameservers, ['ns1.example.com', 'ns2.example.com']);
    assert.deepEqual(parsed.conformance, ['rdap_level_0', 'redacted']);
    assert.equal(parsed.redactions.length, 14);
    assert.equal(parsed.registrant?.name, null);
    assert.equal(parsed.registrant?.email, null);
    assert.equal(parsed.registrar?.name, 'Example Registrar Inc.');
    assert.equal(parsed.lifecycle.createdDateIso, '1997-06-03T00:00:00.000Z');
    assert.equal(parsed.dnssec, 'Unsigned');
  });
});
