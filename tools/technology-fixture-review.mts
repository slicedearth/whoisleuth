#!/usr/bin/env node

// Converts one contributor-reviewed, already-minimized observation into the
// public real-world fixture contract. The output reconstructs only known
// catalogue markers and shared vendor origins, never copied page content.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TECHNOLOGY_REVIEWED_FIXTURE_SCHEMA,
  TECHNOLOGY_REVIEWED_FIXTURE_VERSION,
  type TechnologyReviewedFixture,
} from '../fixtures/technology-reviewed-fixtures.mts';
import {
  TECHNOLOGY_SIGNATURE_CATALOGUE,
  TECHNOLOGY_PROFILE_VERSION,
  analyzeWebsiteTechnology,
  type TechnologyInput,
} from '../lib/website-technology.mts';

export const MAX_TECHNOLOGY_REVIEW_INPUT_BYTES = 64 * 1024;
export const MAX_REVIEWED_MARKUP_BYTES = 8 * 1024;
export const MAX_REVIEWED_RESOURCE_ORIGINS = 16;

type UnknownRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const IPV4_RE = /(?:^|[^0-9])(?:\d{1,3}\.){3}\d{1,3}(?:[^0-9]|$)/u;
const LICENSE_BASES = new Set([
  'factual-observation',
  'minimized-with-permission',
  'public-domain',
]);
const SHARED_VENDOR_HOSTS = new Set([
  'cdn.shopify.com',
  'static.parastorage.com',
  'wixstatic.com',
  'static.squarespace.com',
  'static1.squarespace.com',
  'framerusercontent.com',
  'editmysite.com',
  'cloudfront.net',
]);
const SHARED_VENDOR_HOST_PATTERNS = [/^cdn\d+\.bigcommerce\.com$/iu];
const SAFE_MARKERS: ReadonlyArray<Readonly<{ marker: string; output: string }>> = Object.freeze([
  { marker: '/wp-content/', output: '<link href="/wp-content/fixture.css">' },
  { marker: '/wp-includes/', output: '<script src="/wp-includes/fixture.js"></script>' },
  { marker: 'data-drupal-selector=', output: '<main data-drupal-selector="fixture"></main>' },
  { marker: 'data-drupal-link-system-path=', output: '<main data-drupal-link-system-path="fixture"></main>' },
  { marker: 'drupal-settings-json', output: '<script type="application/json" data-drupal-selector="drupal-settings-json"></script>' },
  { marker: 'ghost/api/content/', output: '<link href="/ghost/api/content/">' },
  { marker: 'data-ghost-search', output: '<main data-ghost-search></main>' },
  { marker: 'shopify-section', output: '<section class="shopify-section"></section>' },
  { marker: 'shopify.theme', output: '<main data-marker="shopify.theme"></main>' },
  { marker: 'data-mage-init=', output: '<main data-mage-init="{}"></main>' },
  { marker: 'type="text/x-magento-init"', output: '<script type="text/x-magento-init">{}</script>' },
  { marker: "type='text/x-magento-init'", output: '<script type="text/x-magento-init">{}</script>' },
  { marker: 'cdn11.bigcommerce.com/s-', output: '<link href="https://cdn11.bigcommerce.com/s-fixture/theme.css">' },
  { marker: 'stencil-utils', output: '<script src="/stencil-utils.js"></script>' },
  { marker: '/wp-content/plugins/woocommerce/', output: '<link href="/wp-content/plugins/woocommerce/fixture.css">' },
  { marker: 'data-mesh-id=', output: '<main data-mesh-id="fixture"></main>' },
  { marker: 'squarespace-context', output: '<main data-marker="squarespace-context"></main>' },
  { marker: 'data-wf-page=', output: '<main data-wf-page="fixture"></main>' },
  { marker: 'data-wf-site=', output: '<main data-wf-site="fixture"></main>' },
  { marker: 'data-framer-name=', output: '<main data-framer-name="fixture"></main>' },
  { marker: ' ng-version=', output: '<main ng-version="fixture"></main>' },
  { marker: ' name="__viewstate"', output: '<input name="__VIEWSTATE">' },
  { marker: ' id="__viewstate"', output: '<input id="__VIEWSTATE">' },
  { marker: 'id="__next_data__"', output: '<script id="__NEXT_DATA__"></script>' },
  { marker: "id='__next_data__'", output: '<script id="__NEXT_DATA__"></script>' },
  { marker: '/_next/static/', output: '<script src="/_next/static/fixture.js"></script>' },
  { marker: 'id="__nuxt"', output: '<main id="__nuxt"></main>' },
  { marker: "id='__nuxt'", output: '<main id="__nuxt"></main>' },
  { marker: '/_nuxt/', output: '<script src="/_nuxt/fixture.js"></script>' },
  { marker: 'id="___gatsby"', output: '<main id="___gatsby"></main>' },
  { marker: "id='___gatsby'", output: '<main id="___gatsby"></main>' },
  { marker: '/page-data/app-data.json', output: '<link href="/page-data/app-data.json">' },
  { marker: 'data-sveltekit-preload-data=', output: '<a data-sveltekit-preload-data="hover"></a>' },
  { marker: 'data-sveltekit-reload=', output: '<a data-sveltekit-reload></a>' },
  { marker: 'href="/_app/immutable/', output: '<link href="/_app/immutable/fixture.css">' },
  { marker: 'src="/_app/immutable/', output: '<script src="/_app/immutable/fixture.js"></script>' },
  { marker: '<astro-island', output: '<astro-island></astro-island>' },
  { marker: '<astro-slot', output: '<astro-slot></astro-slot>' },
  { marker: 'href="/_astro/', output: '<link href="/_astro/fixture.css">' },
  { marker: 'src="/_astro/', output: '<script src="/_astro/fixture.js"></script>' },
]);
const REVIEW_INPUT_KEYS = new Set([
  'schema',
  'version',
  'id',
  'reviewedAt',
  'observedAt',
  'licenseBasis',
  'expectedIds',
  'input',
]);
const TECHNOLOGY_INPUT_KEYS = new Set([
  'generator',
  'httpServer',
  'html',
  'resourceOrigins',
]);
const HEADER_CANONICAL_VALUES: Readonly<Record<string, string>> = Object.freeze({
  cloudfront: 'CloudFront',
  'apache-http-server': 'Apache',
  'microsoft-iis': 'Microsoft-IIS',
});

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || CONTROL_RE.test(value)) {
    throw new TypeError(`${label} must be control-free text no longer than ${maximum} characters.`);
  }
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized) throw new TypeError(`${label} must not be empty.`);
  return normalized;
}

function timestamp(value: unknown, label: string): string {
  const candidate = text(value, label, 64);
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be a valid timestamp.`);
  return new Date(parsed).toISOString();
}

function assertExactKeys(value: UnknownRecord, allowed: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`${label} contains unsupported fields: ${unknown.sort().join(', ')}.`);
}

function normalizeHeader(
  value: unknown,
  label: string,
  field: 'generator' | 'httpServer',
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const header = text(value, label, 160);
  if (EMAIL_RE.test(header) || IPV4_RE.test(header) || /https?:\/\//iu.test(header)) {
    throw new TypeError(`${label} contains target or contact material.`);
  }
  const findings = analyzeWebsiteTechnology({ [field]: header }).findings;
  if (findings.length !== 1) {
    throw new TypeError(`${label} must produce exactly one recognized catalogue technology before it can be minimized.`);
  }
  const finding = findings[0];
  if (!finding) throw new TypeError(`${label} could not be minimized.`);
  const candidate = HEADER_CANONICAL_VALUES[finding.id] ?? finding.name;
  const reconstructed = analyzeWebsiteTechnology({ [field]: candidate }).findings.map((item) => item.id);
  if (reconstructed.length !== 1 || reconstructed[0] !== finding.id) {
    throw new TypeError(`${label} has no privacy-safe canonical reconstruction.`);
  }
  return candidate;
}

function normalizeMarkup(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const markup = text(value, 'Minimised HTML', MAX_REVIEWED_MARKUP_BYTES).toLowerCase();
  if (EMAIL_RE.test(markup) || IPV4_RE.test(markup) || /<!--|<style\b/iu.test(markup)) {
    throw new TypeError('Minimised HTML contains contact, address, comment, or style material.');
  }
  const outputs = SAFE_MARKERS
    .filter(({ marker }) => markup.includes(marker))
    .map(({ output }) => output);
  if (!outputs.length) {
    throw new TypeError('Minimised HTML contains no recognised catalogue marker.');
  }
  return [...new Set(outputs)].join('');
}

function normalizeOrigins(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_REVIEWED_RESOURCE_ORIGINS) {
    throw new TypeError(`Resource origins must contain at most ${MAX_REVIEWED_RESOURCE_ORIGINS} shared vendor origins.`);
  }
  const origins = new Set<string>();
  for (const item of value) {
    const raw = text(item, 'Resource origin', 2048);
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new TypeError('Resource origins must be valid HTTP or HTTPS origins.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash) {
      throw new TypeError('Resource origins must not include credentials, paths, queries, or fragments.');
    }
    const host = parsed.hostname.toLowerCase();
    if (!SHARED_VENDOR_HOSTS.has(host)
      && ![...SHARED_VENDOR_HOSTS].some((suffix) => host.endsWith(`.${suffix}`))
      && !SHARED_VENDOR_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
      throw new TypeError('Resource origin is not an approved shared vendor host.');
    }
    origins.add(`${parsed.protocol}//${host}`);
  }
  return [...origins].sort();
}

export function buildReviewedTechnologyFixture(raw: unknown): TechnologyReviewedFixture {
  const source = record(raw);
  const input = record(source?.input);
  if (!source || source.schema !== 'whoisleuth.technology-fixture-review-input'
    || source.version !== 1 || !input) {
    throw new TypeError('Technology review input uses an unsupported contract.');
  }
  assertExactKeys(source, REVIEW_INPUT_KEYS, 'Technology review input');
  assertExactKeys(input, TECHNOLOGY_INPUT_KEYS, 'Technology evidence input');
  const id = text(source.id, 'Fixture id', 80).toLowerCase();
  if (!ID_RE.test(id)) throw new TypeError('Fixture id must be a lowercase hyphenated identifier.');
  const reviewedAt = timestamp(source.reviewedAt, 'Reviewed time');
  const observedAt = timestamp(source.observedAt, 'Observed time');
  const licenseBasis = text(source.licenseBasis, 'License basis', 40);
  if (!LICENSE_BASES.has(licenseBasis)) throw new TypeError('License basis is not supported.');
  const expectedIds = Array.isArray(source.expectedIds)
    ? [...new Set(source.expectedIds.map((value) => text(value, 'Expected technology id', 64).toLowerCase()))].sort()
    : [];
  const catalogueIds = new Set(TECHNOLOGY_SIGNATURE_CATALOGUE.map((item) => item.id));
  if (!expectedIds.length || expectedIds.some((expected) => !catalogueIds.has(expected))) {
    throw new TypeError('Expected technology ids must reference at least one current catalogue entry.');
  }
  const label = `Reviewed ${expectedIds.join(' + ')} fixture`;
  const generator = normalizeHeader(input.generator, 'Generator value', 'generator');
  const httpServer = normalizeHeader(input.httpServer, 'HTTP server value', 'httpServer');
  const html = normalizeMarkup(input.html);
  const resourceOrigins = normalizeOrigins(input.resourceOrigins);
  const normalizedInput: TechnologyInput = Object.freeze({
    ...(generator ? { generator } : {}),
    ...(httpServer ? { httpServer } : {}),
    ...(html ? { html } : {}),
    ...(resourceOrigins.length ? { resourceOrigins } : {}),
    observedAt,
  });
  const observedIds = analyzeWebsiteTechnology(normalizedInput).findings.map((finding) => finding.id).sort();
  if (JSON.stringify(observedIds) !== JSON.stringify(expectedIds)) {
    throw new TypeError(`Minimized evidence observed [${observedIds.join(', ')}] instead of [${expectedIds.join(', ')}].`);
  }
  return Object.freeze({
    schema: TECHNOLOGY_REVIEWED_FIXTURE_SCHEMA,
    version: TECHNOLOGY_REVIEWED_FIXTURE_VERSION,
    catalogueVersion: TECHNOLOGY_PROFILE_VERSION,
    id,
    label,
    reviewedAt,
    observedAt,
    licenseBasis: licenseBasis as TechnologyReviewedFixture['licenseBasis'],
    expectedIds: Object.freeze(expectedIds),
    input: normalizedInput,
    privacy: Object.freeze({
      rawPageRetained: false,
      sourceTargetRetained: false,
      contactsRetained: false,
    }),
  });
}

export async function main(
  args = process.argv.slice(2),
  output: WritableLike = process.stdout,
  errors: WritableLike = process.stderr,
): Promise<number> {
  try {
    if (args.length !== 1 || !args[0] || args[0].startsWith('-')) {
      throw new TypeError('Usage: node tools/technology-fixture-review.mts INPUT.json');
    }
    const raw = await readFile(args[0]);
    if (raw.byteLength === 0 || raw.byteLength > MAX_TECHNOLOGY_REVIEW_INPUT_BYTES) {
      throw new TypeError(`Technology review input must be between 1 byte and ${MAX_TECHNOLOGY_REVIEW_INPUT_BYTES} bytes.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8')) as unknown;
    } catch {
      throw new TypeError('Technology review input must be valid JSON.');
    }
    output.write(`${JSON.stringify(buildReviewedTechnologyFixture(parsed), null, 2)}\n`);
    return 0;
  } catch (error) {
    errors.write(`${error instanceof Error ? error.message : 'Technology fixture review failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
