import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  auditRdapExtensionRegistry,
  fetchOfficialRdapExtensionRegistry,
  main,
  MAX_RDAP_EXTENSION_SOURCE_BYTES,
  parseRdapExtensionRegistryCsv,
  RDAP_EXTENSION_DRIFT_AUDIT_SCHEMA,
} from '../tools/rdap-extension-drift-audit.mts';

const CURRENT = `Extension Identifier,Registry Operator,Specification,Contact,Intended Usage
artRecord,.TEST,[RFC0000],[Example],COMMON
reverse_search,Any,[RFC9536],[IETF],Search
`;

describe('RDAP extension drift audit', () => {
  test('parses quoted multiline fields and obsolete identifiers', () => {
    const parsed = parseRdapExtensionRegistryCsv(`Extension Identifier,Registry Operator,Specification,Contact,Intended Usage\r
alpha (OBSOLETED),Any,[RFC0000],[IETF],"Line one\r
line two"\r
beta,Any,[RFC0001],[IETF],COMMON\r
`);
    assert.deepEqual(parsed.map((entry) => [entry.identifier, entry.status]), [
      ['alpha', 'obsolete'],
      ['beta', 'current'],
    ]);
  });

  test('keeps the committed fixture aligned with the reviewed runtime catalogue', () => {
    const report = auditRdapExtensionRegistry({ now: () => new Date('2026-07-31T00:00:00.000Z') });
    assert.equal(report.schema, RDAP_EXTENSION_DRIFT_AUDIT_SCHEMA);
    assert.equal(report.mode, 'fixture');
    assert.equal(report.status, 'current');
    assert.equal(report.source.entries, 29);
    assert.deepEqual(report.changes, {
      added: [],
      removed: [],
      renamed: [],
      statusChanged: [],
      unrecognized: [],
      localOnly: [],
    });
  });

  test('reports source and local catalogue drift without changing behavior', () => {
    const report = auditRdapExtensionRegistry({
      liveSourceText: CURRENT,
      localCatalog: [
        { identifier: 'artrecord', status: 'obsolete' },
        { identifier: 'local_only', status: 'current' },
      ],
    });
    assert.equal(report.status, 'drift');
    assert.ok(report.changes.removed.includes('arin_originas0'));
    assert.deepEqual(report.changes.unrecognized, ['reverse_search']);
    assert.deepEqual(report.changes.localOnly, ['local_only']);
  });

  test('bounds malformed sources and main failures', async () => {
    assert.throws(
      () => parseRdapExtensionRegistryCsv('Extension Identifier,Registry Operator\nbad'),
      /header is not recognised/u,
    );
    let stderr = '';
    const exitCode = await main(['--live'], {
      fetchSource: async () => { throw new Error('fixture failure'); },
      stderr: { write(value) { stderr += value; } },
    });
    assert.equal(exitCode, 2);
    assert.match(stderr, /fixture failure/u);
  });

  test('keeps the manual official-source request bounded through its body read', async () => {
    let forwardedSignal: AbortSignal | null = null;
    const startedAt = Date.now();
    await assert.rejects(fetchOfficialRdapExtensionRegistry({
      timeoutMs: 20,
      fetchDetailed: async (_url, options) => {
        forwardedSignal = options.signal as AbortSignal;
        return new Promise(() => {});
      },
    }), /20 ms request deadline/u);
    assert.ok(Date.now() - startedAt < 1_000);
    assert.ok(forwardedSignal);
    assert.equal((forwardedSignal as AbortSignal).aborted, true);

    await assert.rejects(fetchOfficialRdapExtensionRegistry({
      timeoutMs: 20,
      fetchDetailed: async () => ({
        response: new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { status: 200 }),
      }),
    }), /20 ms request deadline/u);
  });

  test('rejects a truncated official source and accepts an exact-cap complete body', async () => {
    await assert.rejects(fetchOfficialRdapExtensionRegistry({
      fetchDetailed: async () => ({ response: new Response('x'.repeat(MAX_RDAP_EXTENSION_SOURCE_BYTES + 1)) }),
    }), new RegExp(`exceeded ${MAX_RDAP_EXTENSION_SOURCE_BYTES} bytes`, 'u'));

    const exact = 'x'.repeat(MAX_RDAP_EXTENSION_SOURCE_BYTES);
    assert.equal(await fetchOfficialRdapExtensionRegistry({
      fetchDetailed: async () => ({ response: new Response(exact) }),
    }), exact);
  });
});
