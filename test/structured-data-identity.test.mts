import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_STRUCTURED_DATA_ENTITIES,
  MAX_STRUCTURED_DATA_SCRIPTS,
  STRUCTURED_DATA_IDENTITY_VERSION,
  analyzeStructuredDataIdentity,
} from '../lib/structured-data-identity.mts';

const OBSERVED_AT = '2026-07-27T01:02:03.000Z';

function analyze(html: string, overrides: Record<string, unknown> = {}) {
  return analyzeStructuredDataIdentity({
    html,
    baseUrl: 'https://shop.example.test/catalogue?session=private',
    observedAt: OBSERVED_AT,
    ...overrides,
  });
}

describe('bounded structured-data identity', () => {
  test('retains only curated publisher-declared identity fields', () => {
    const profile = analyze(`
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": ["Organization", "Corporation"],
          "name": " Example\\u0007 Trading ",
          "url": "/account?token=private#section",
          "sameAs": [
            "https://social.example.test/example-trading?private=1",
            "https://SOCIAL.example.test/duplicate",
            "mailto:private@example.test"
          ],
          "email": "private@example.test",
          "telephone": "+61 0000 0000",
          "address": { "streetAddress": "Private address" }
        }
      </script>
    `);

    assert.equal(profile.structuredDataVersion, STRUCTURED_DATA_IDENTITY_VERSION);
    assert.equal(profile.status, 'success');
    assert.equal(profile.complete, true);
    assert.equal(profile.source, 'html');
    assert.equal(profile.observedAt, OBSERVED_AT);
    assert.deepEqual(profile.entities, [{
      types: ['Corporation', 'Organization'],
      name: 'Example Trading',
      declaredOrigin: 'https://shop.example.test',
      sameAsHosts: ['social.example.test'],
    }]);
    assert.doesNotMatch(
      JSON.stringify(profile),
      /private@example|Private address|\+61|token=|catalogue|example-trading/,
    );
    assert.match(profile.limitations.join(' '), /do not prove identity/i);
  });

  test('does not retain person records or arbitrary schema properties', () => {
    const profile = analyze(`
      <script TYPE="application/ld+json; charset=utf-8">
        [
          {"@type":"Person","name":"Private Person","url":"https://person.example.test/profile"},
          {"@type":"Product","name":"Private Product","url":"https://product.example.test/item"},
          {"@type":"WebSite","name":"Example service","url":"https://www.example.test/start"}
        ]
      </script>
    `);

    assert.deepEqual(profile.entities, [{
      types: ['WebSite'],
      name: 'Example service',
      declaredOrigin: 'https://www.example.test',
      sameAsHosts: [],
    }]);
    assert.doesNotMatch(JSON.stringify(profile), /Private Person|Private Product|\/profile|\/item/);
  });

  test('does not turn a missing base URL into a synthetic relative origin', () => {
    const profile = analyzeStructuredDataIdentity({
      html: '<script type="application/ld+json">{"@type":"Organization","name":"Example","url":"/relative"}</script>',
      observedAt: OBSERVED_AT,
    });

    assert.deepEqual(profile.entities, [{
      types: ['Organization'],
      name: 'Example',
      declaredOrigin: null,
      sameAsHosts: [],
    }]);
    assert.doesNotMatch(JSON.stringify(profile), /invalid\.example|relative/);
  });

  test('marks malformed, referenced, truncated, and over-limit evidence as partial', () => {
    const scripts = [
      '<script type="application/ld+json" src="/identity.json"></script>',
      '<script type="application/ld+json">{"@type":"Organization","name":</script>',
      ...Array.from(
        { length: MAX_STRUCTURED_DATA_SCRIPTS + 1 },
        (_, index) => `<script type="application/ld+json">{"@type":"Organization","name":"Entity ${index}"}</script>`,
      ),
    ].join('');
    const profile = analyze(scripts, { sourceTruncated: true });

    assert.equal(profile.status, 'partial');
    assert.equal(profile.complete, false);
    assert.equal(profile.truncated, true);
    assert.ok(profile.entities.length <= MAX_STRUCTURED_DATA_ENTITIES);
    assert.equal(profile.diagnostics.scriptsExamined, MAX_STRUCTURED_DATA_SCRIPTS);
    assert.equal(profile.diagnostics.externalScriptsSkipped, 1);
    assert.equal(profile.diagnostics.malformedScripts, 1);
    assert.match(profile.limitations.join(' '), /Referenced JSON-LD scripts were not fetched/);
    assert.match(profile.limitations.join(' '), /body was truncated|body capture was truncated|captured homepage body was truncated/i);
  });

  test('keeps a complete no-match result neutral', () => {
    const profile = analyze('<main>No JSON-LD is published.</main>');

    assert.equal(profile.status, 'success');
    assert.equal(profile.complete, true);
    assert.deepEqual(profile.entities, []);
  });
});
