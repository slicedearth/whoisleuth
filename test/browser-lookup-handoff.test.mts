import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildBrowserLookupHandoff } from '../frontend/src/lib/analysis/browser-lookup-handoff.ts';

describe('browser lookup handoff', () => {
  test('retains only the normalized hostname and selected lookup depth', () => {
    const handoff = buildBrowserLookupHandoff('https://user:secret@Sub.Example.Test:8443/private/path?token=secret#fragment');
    assert.equal(handoff.domain, 'sub.example.test');
    assert.equal(handoff.path, '/lookup?q=sub.example.test&depth=deep#query');
    assert.equal(handoff.sanitizedUrl, 'https://sub.example.test/');
    assert.equal(handoff.disclosedValue, 'sub.example.test');
    assert.equal(handoff.destinationUrl, handoff.path);
    assert.equal(handoff.visibility, 'this_deployment');
    assert.deepEqual(handoff.discarded, ['credentials', 'port', 'path', 'query', 'fragment']);
    assert.doesNotMatch(`${handoff.domain}\n${handoff.path}`, /user|secret|8443|private|token/);
  });

  test('previews an exact loopback companion disclosure without making a request', () => {
    const handoff = buildBrowserLookupHandoff(
      'https://user:secret@Sub.Example.Test:8443/private?token=secret#fragment',
      {
        destinationKind: 'local_companion',
        endpoint: 'http://127.0.0.1:4312/review',
        disclosureFormat: 'sanitized_url',
      },
    );
    assert.equal(handoff.disclosedValue, 'https://sub.example.test/');
    assert.equal(handoff.destinationUrl, 'http://127.0.0.1:4312/review?target=https%3A%2F%2Fsub.example.test%2F');
    assert.equal(handoff.visibility, 'local_device');
    assert.equal(handoff.opensNewContext, true);
    assert.doesNotMatch(handoff.destinationUrl, /user|secret|8443|private|token|fragment/u);
  });

  test('accepts an exact bracketed IPv6 loopback companion endpoint', () => {
    const handoff = buildBrowserLookupHandoff('example.test', {
      destinationKind: 'local_companion',
      endpoint: 'http://[::1]:4312/review',
    });
    assert.equal(handoff.destinationUrl, 'http://[::1]:4312/review?target=example.test');
    assert.equal(handoff.visibility, 'local_device');
  });

  test('requires HTTPS for configured external services and strips endpoint query material', () => {
    const handoff = buildBrowserLookupHandoff('example.test', {
      destinationKind: 'external_https',
      endpoint: 'https://analyst-service.invalid/review',
    });
    assert.equal(handoff.destinationUrl, 'https://analyst-service.invalid/review?target=example.test');
    assert.equal(handoff.visibility, 'third_party');
    assert.throws(() => buildBrowserLookupHandoff('example.test', {
      destinationKind: 'external_https',
      endpoint: 'http://analyst-service.invalid/review',
    }), /must use HTTPS/u);
    assert.throws(() => buildBrowserLookupHandoff('example.test', {
      destinationKind: 'local_companion',
      endpoint: 'https://private.example.test/review',
    }), /localhost or a loopback address/u);
    assert.throws(() => buildBrowserLookupHandoff('example.test', {
      destinationKind: 'external_https',
      endpoint: 'https://analyst-service.invalid/review?session=browser-local',
    }), /cannot contain credentials, a query, or a fragment/u);
  });

  test('rejects IP addresses and malformed targets', () => {
    assert.throws(() => buildBrowserLookupHandoff('https://127.0.0.1/private'), /valid domain/);
    assert.throws(() => buildBrowserLookupHandoff('ftp://example.test/private'), /HTTP\(S\)/);
    assert.throws(() => buildBrowserLookupHandoff('not a domain'), /valid domain/);
  });
});
