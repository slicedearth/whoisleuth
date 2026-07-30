import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildBrowserLookupHandoff } from '../frontend/src/lib/analysis/browser-lookup-handoff.ts';

describe('browser lookup handoff', () => {
  test('retains only the normalized hostname and selected lookup depth', () => {
    const handoff = buildBrowserLookupHandoff('https://user:secret@Sub.Example.Test:8443/private/path?token=secret#fragment');
    assert.equal(handoff.domain, 'sub.example.test');
    assert.equal(handoff.path, '/lookup?q=sub.example.test&depth=deep#query');
    assert.deepEqual(handoff.discarded, ['credentials', 'port', 'path', 'query', 'fragment']);
    assert.doesNotMatch(`${handoff.domain}\n${handoff.path}`, /user|secret|8443|private|token/);
  });

  test('rejects IP addresses and malformed targets', () => {
    assert.throws(() => buildBrowserLookupHandoff('https://127.0.0.1/private'), /valid domain/);
    assert.throws(() => buildBrowserLookupHandoff('not a domain'), /valid domain/);
  });
});
