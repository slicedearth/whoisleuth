import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  FAVICON_FETCH_TIMEOUT_MS,
  HOMEPAGE_FETCH_TIMEOUT_MS,
  MAX_FAVICON_BYTES,
  MAX_FAVICON_CANDIDATES,
  MAX_HOMEPAGE_BYTES,
  MAX_OUTBOUND_REDIRECTS,
} from '../lib/outbound-request-bounds.mts';
import { MAX_REDIRECTS } from '../lib/safe-fetch.mts';
import { MAX_STATIC_HTML_CHARS } from '../lib/static-html-analysis.mts';
import { MAX_FINGERPRINT_SOURCE_BYTES } from '../lib/page-fingerprints.mts';
import { MAX_TECHNOLOGY_EXAMPLE_HTML_BYTES } from '../tools/technology-example-review.mts';

test('capture, native analysis, fingerprints and offline review share their source-size ceiling', () => {
  assert.equal(MAX_STATIC_HTML_CHARS, MAX_HOMEPAGE_BYTES);
  assert.equal(MAX_FINGERPRINT_SOURCE_BYTES, MAX_HOMEPAGE_BYTES);
  assert.equal(MAX_TECHNOLOGY_EXAMPLE_HTML_BYTES, MAX_HOMEPAGE_BYTES);
});

test('website collectors and the public disclosure share one bounded policy', () => {
  assert.equal(MAX_REDIRECTS, MAX_OUTBOUND_REDIRECTS);
  assert.ok(HOMEPAGE_FETCH_TIMEOUT_MS > FAVICON_FETCH_TIMEOUT_MS);
  assert.ok(MAX_HOMEPAGE_BYTES > MAX_FAVICON_BYTES);
  assert.ok(MAX_FAVICON_CANDIDATES >= 1 && MAX_FAVICON_CANDIDATES <= 8);

  const root = process.cwd();
  const homepageSource = readFileSync(join(root, 'lib', 'availability.mts'), 'utf8');
  const faviconSource = readFileSync(join(root, 'lib', 'favicon.mts'), 'utf8');
  const policySource = readFileSync(join(root, 'frontend', 'src', 'routes', '(public)', 'request-policy', '+page.svelte'), 'utf8');
  for (const source of [homepageSource, faviconSource, policySource]) {
    assert.match(source, /outbound-request-bounds\.mts/u);
  }
  assert.doesNotMatch(policySource, /300,000 bytes|200,000-byte|six-second|five-second|five hops/iu);
});
