import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { join } from 'node:path';

import {
  PUBLIC_RESOURCES,
  PUBLIC_RESOURCE_SLUGS,
  publicResource,
} from '../frontend/src/lib/public-resources.ts';
import { PUBLIC_RESOURCE_ROUTES } from '../lib/public-resource-routes.mts';

function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(allStrings);
  return [];
}

test('public resources expose a bounded unique set of useful investigation topics', () => {
  assert.equal(PUBLIC_RESOURCES.length, 8);
  assert.deepEqual(PUBLIC_RESOURCE_SLUGS, PUBLIC_RESOURCES.map((resource) => resource.slug));
  assert.equal(new Set(PUBLIC_RESOURCE_SLUGS).size, PUBLIC_RESOURCE_SLUGS.length);

  for (const resource of PUBLIC_RESOURCES) {
    assert.match(resource.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    assert.equal(resource.summary.length, 2);
    assert.equal(resource.steps.length, 3);
    assert.equal(resource.evidence.length, 3);
    assert.equal(resource.questions.length, 3);
    assert.equal(resource.demoHref, '/demo');
    assert.match(resource.guideHref, /^\/guide(?:#[a-z0-9-]+)?$/u);
    assert.match(resource.repositoryDoc, /^docs\/[a-z0-9-]+\.md$/u);
  }
});

test('public resource lookup is exact, neutral for invalid input, and does not invent routes', () => {
  const resource = publicResource('rdap-vs-whois');
  assert.equal(resource?.title, 'RDAP versus WHOIS: why registration sources disagree');
  assert.equal(publicResource('RDAP-vs-WHOIS'), null);
  assert.equal(publicResource('../privacy'), null);
  assert.equal(publicResource(null), null);
});

test('public resource copy remains bounded, plain text, and source-aware', () => {
  const strings = allStrings(PUBLIC_RESOURCES);
  assert.equal(strings.every((value) => value.length > 0 && value.length <= 600), true);
  assert.equal(strings.every((value) => !/[\x00-\x1f\x7f]/u.test(value)), true);
  assert.equal(strings.every((value) => !value.includes('—')), true);

  const completeCopy = strings.join(' ');
  assert.match(completeCopy, /does not (?:prove|establish)|not evidence|cannot|limitation/iu);
  assert.match(completeCopy, /partial|unavailable|inconclusive/iu);
  assert.doesNotMatch(completeCopy, /\bguaranteed safe\b|\bproves malicious\b|\bowns? the\b/iu);
});

test('the sitemap and social preview remain aligned with the public resource contract', () => {
  const repositoryRoot = join(import.meta.dirname, '..');
  const sitemap = readFileSync(join(repositoryRoot, 'frontend', 'static', 'sitemap.xml'), 'utf8');
  for (const route of PUBLIC_RESOURCE_ROUTES) {
    assert.match(sitemap, new RegExp(`<loc>https://whoisleuth\\.com${route}</loc>`, 'u'));
  }

  const preview = readFileSync(join(repositoryRoot, 'frontend', 'static', 'social-preview.png'));
  assert.deepEqual([...preview.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(preview.readUInt32BE(16), 1280);
  assert.equal(preview.readUInt32BE(20), 640);
  assert.ok(preview.byteLength <= 1_048_576);
});
