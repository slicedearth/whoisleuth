#!/usr/bin/env node

// Converts the curated technology findings from one saved, complete Deep
// lookup into target-free review input. It reconstructs catalogue-owned
// markers and never copies the query, target, page text, or raw headers.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_SAVED_LOOKUP_INPUT_BYTES,
  parseSavedLookupDocument,
  type SavedLookupDocument,
} from '../cli/saved-lookup.mts';
import {
  TECHNOLOGY_REVIEW_INPUT_SCHEMA,
  TECHNOLOGY_REVIEW_INPUT_VERSION,
  MAX_TECHNOLOGY_REVIEW_IDS,
  TECHNOLOGY_REVIEW_LICENCE_BASES,
  type TechnologyReviewLicenceBasis,
} from '../fixtures/technology-reviewed-fixtures.mts';
import {
  TECHNOLOGY_SIGNATURE_CATALOGUE,
  analyzeWebsiteTechnology,
  type TechnologyEvidence,
  type TechnologyInput,
} from '../lib/website-technology.mts';

type UnknownRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };
type CandidateOptions = Readonly<{
  id: string;
  expectedIds: readonly string[];
  licenceBasis: TechnologyReviewLicenceBasis;
  reviewedAt: string;
}>;
type CandidateArguments = CandidateOptions & Readonly<{ inputPath: string }>;
type TechnologyEvidenceSource = TechnologyEvidence['source'];
type ReconstructedTechnologyReviewProfile = Readonly<{
  observedAt: string;
  expectedIds: readonly string[];
  input: TechnologyInput;
}>;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const MAX_FINDINGS = 24;
const MAX_EVIDENCE = 4;
const LICENCE_BASES = new Set<TechnologyReviewLicenceBasis>(TECHNOLOGY_REVIEW_LICENCE_BASES);

const GENERATOR_VALUES: Readonly<Record<string, string>> = Object.freeze({
  wordpress: 'WordPress', drupal: 'Drupal', joomla: 'Joomla', ghost: 'Ghost',
  'craft-cms': 'Craft CMS', typo3: 'TYPO3 CMS', opencart: 'OpenCart',
  prestashop: 'PrestaShop', wix: 'Wix', squarespace: 'Squarespace',
  webflow: 'Webflow', framer: 'Framer', weebly: 'Weebly', hugo: 'Hugo', jekyll: 'Jekyll',
  docusaurus: 'Docusaurus', eleventy: 'Eleventy', hexo: 'Hexo',
});
const SERVER_VALUES: Readonly<Record<string, string>> = Object.freeze({
  cloudflare: 'Cloudflare', cloudfront: 'CloudFront', netlify: 'Netlify',
  vercel: 'Vercel', nginx: 'nginx', 'apache-http-server': 'Apache',
  'microsoft-iis': 'Microsoft-IIS', litespeed: 'LiteSpeed', caddy: 'Caddy',
});
const STATIC_MARKUP: Readonly<Record<string, string>> = Object.freeze({
  wordpress: '<link href="/wp-content/fixture.css">',
  drupal: '<main data-drupal-selector="fixture"></main>',
  ghost: '<main data-ghost-search></main>',
  shopify: '<section class="shopify-section"></section>',
  'adobe-commerce-magento': '<main data-mage-init="{}"></main>',
  bigcommerce: '<link href="https://cdn11.bigcommerce.com/s-fixture/theme.css">',
  woocommerce: '<link href="/wp-content/plugins/woocommerce/fixture.css">',
  prestashop: '<link href="/modules/ps_fixture/fixture.css">',
  opencart: '<a href="index.php?route=common/home"></a>',
  wix: '<main data-mesh-id="fixture"></main>',
  squarespace: '<main data-marker="squarespace-context"></main>',
  webflow: '<main data-wf-page="fixture"></main>',
  framer: '<main data-framer-name="fixture"></main>',
  angular: '<main ng-version="fixture"></main>',
  'aspnet-web-forms': '<input name="__VIEWSTATE">',
  nextjs: '<script id="__NEXT_DATA__"></script>',
  nuxt: '<main id="__nuxt"></main>',
  gatsby: '<main id="___gatsby"></main>',
  sveltekit: '<a data-sveltekit-preload-data="hover"></a>',
  astro: '<astro-island></astro-island>',
});
const STATIC_ALTERNATES: Readonly<Record<string, ReadonlyArray<Readonly<{
  description: string;
  markup: string;
}>>>> = Object.freeze({
  sveltekit: Object.freeze([Object.freeze({
    description: 'Static asset paths use SvelteKit build conventions.',
    markup: '<link href="/_app/immutable/fixture.css">',
  })]),
  astro: Object.freeze([Object.freeze({
    description: 'Static asset paths use Astro build conventions.',
    markup: '<link href="/_astro/fixture.css">',
  })]),
});
const RESOURCE_ORIGINS: Readonly<Record<string, string>> = Object.freeze({
  shopify: 'https://cdn.shopify.com', bigcommerce: 'https://cdn11.bigcommerce.com',
  wix: 'https://wixstatic.com', squarespace: 'https://static.squarespace.com',
  framer: 'https://framerusercontent.com', weebly: 'https://editmysite.com',
  cloudfront: 'https://cloudfront.net',
});
const RESPONSE_HEADERS: Readonly<Record<string, Readonly<{ name: string; value: string }>>> = Object.freeze({
  drupal: Object.freeze({ name: 'x-drupal-cache', value: 'fixture' }),
  shopify: Object.freeze({ name: 'x-shopify-stage', value: 'fixture' }),
  php: Object.freeze({ name: 'x-powered-by', value: 'PHP' }),
  aspnet: Object.freeze({ name: 'x-powered-by', value: 'ASP.NET' }),
  express: Object.freeze({ name: 'x-powered-by', value: 'Express' }),
  cloudflare: Object.freeze({ name: 'cf-ray', value: 'fixture' }),
  netlify: Object.freeze({ name: 'x-nf-request-id', value: 'fixture' }),
  vercel: Object.freeze({ name: 'x-vercel-id', value: 'fixture' }),
  fastly: Object.freeze({ name: 'x-fastly-request-id', value: 'fixture' }),
});

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || CONTROL_RE.test(value)) {
    throw new TypeError(`${label} must be control-free text no longer than ${maximum} characters.`);
  }
  return value.trim();
}

function timestamp(value: unknown, label: string): string {
  const parsed = Date.parse(boundedText(value, label, 64));
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be a valid timestamp.`);
  return new Date(parsed).toISOString();
}

function mergeSingleton(target: UnknownRecord, field: string, value: string): void {
  const current = target[field];
  if (current !== undefined && current !== value) {
    throw new TypeError(`Reviewed findings contain incompatible ${field} evidence.`);
  }
  target[field] = value;
}

function addEvidence(
  input: UnknownRecord,
  technologyId: string,
  source: TechnologyEvidenceSource,
  description: string,
): void {
  if (source === 'generator metadata') {
    const value = GENERATOR_VALUES[technologyId];
    if (!value) throw new TypeError(`${technologyId} has no reviewed generator reconstruction.`);
    mergeSingleton(input, 'generator', value);
    return;
  }
  if (source === 'HTTP server header') {
    const value = SERVER_VALUES[technologyId];
    if (!value) throw new TypeError(`${technologyId} has no reviewed server reconstruction.`);
    mergeSingleton(input, 'httpServer', value);
    return;
  }
  if (source === 'static HTML') {
    const alternate = STATIC_ALTERNATES[technologyId]?.find((item) => item.description === description)?.markup;
    const value = alternate ?? STATIC_MARKUP[technologyId];
    if (!value) throw new TypeError(`${technologyId} has no reviewed static-markup reconstruction.`);
    const fragments = input.html instanceof Set ? input.html as Set<string> : new Set<string>();
    fragments.add(value);
    input.html = fragments;
    return;
  }
  if (source === 'resource origin') {
    const value = RESOURCE_ORIGINS[technologyId];
    if (!value) throw new TypeError(`${technologyId} has no reviewed resource-origin reconstruction.`);
    const origins = input.resourceOrigins instanceof Set ? input.resourceOrigins as Set<string> : new Set<string>();
    origins.add(value);
    input.resourceOrigins = origins;
    return;
  }
  const value = RESPONSE_HEADERS[technologyId];
  if (!value) throw new TypeError(`${technologyId} has no reviewed passive-header reconstruction.`);
  const headers = record(input.responseHeaders) ?? {};
  const name = technologyId === 'shopify' && description.includes('routing')
    ? 'x-sorting-hat-podid'
    : value.name;
  if (headers[name] !== undefined && headers[name] !== value.value) {
    throw new TypeError(`Reviewed findings contain incompatible ${name} evidence.`);
  }
  headers[name] = value.value;
  input.responseHeaders = headers;
}

export function reconstructTechnologyReviewProfile(
  rawProfile: unknown,
  confirmedIds: readonly string[],
): ReconstructedTechnologyReviewProfile {
  const profile = record(rawProfile);
  if (!profile || profile.status !== 'success' || profile.complete !== true || profile.truncated === true) {
    throw new TypeError('Technology review candidates require complete, successful technology evidence.');
  }
  const observedAt = timestamp(profile.observedAt, 'Technology observation time');
  if (confirmedIds.length > MAX_TECHNOLOGY_REVIEW_IDS) {
    throw new TypeError(`Expected technology ids must contain at most ${MAX_TECHNOLOGY_REVIEW_IDS} entries.`);
  }
  const rawFindings = Array.isArray(profile.findings) ? profile.findings : [];
  if (!rawFindings.length || rawFindings.length > MAX_FINDINGS) {
    throw new TypeError(`Technology review candidates require between 1 and ${MAX_FINDINGS} findings.`);
  }
  const catalogue = new Map(TECHNOLOGY_SIGNATURE_CATALOGUE.map((item) => [item.id, item]));
  const observedIds: string[] = [];
  const reconstructed: UnknownRecord = {};
  for (const rawFinding of rawFindings) {
    const finding = record(rawFinding);
    const id = boundedText(finding?.id, 'Technology finding id', 64).toLowerCase();
    const signature = catalogue.get(id);
    const evidence = Array.isArray(finding?.evidence) ? finding.evidence : [];
    if (!signature || !evidence.length || evidence.length > MAX_EVIDENCE) {
      throw new TypeError(`Technology finding ${id} does not match the current bounded catalogue.`);
    }
    if (observedIds.includes(id)) throw new TypeError(`Technology finding ${id} is duplicated.`);
    observedIds.push(id);
    for (const rawEvidence of evidence) {
      const item = record(rawEvidence);
      const source = boundedText(item?.source, 'Technology evidence source', 64) as TechnologyEvidenceSource;
      const description = boundedText(item?.description, 'Technology evidence description', 180);
      if (!signature.evidence.some((candidate) => candidate.source === source && candidate.description === description)) {
        throw new TypeError(`Technology finding ${id} contains evidence outside the current catalogue.`);
      }
      addEvidence(reconstructed, id, source, description);
    }
  }
  const expectedIds = [...new Set(confirmedIds.map((id) => boundedText(id, 'Expected technology id', 64).toLowerCase()))].sort();
  observedIds.sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(observedIds)) {
    throw new TypeError(`Confirmed technology ids [${expectedIds.join(', ')}] do not match the saved findings [${observedIds.join(', ')}].`);
  }
  const input: TechnologyInput = Object.freeze({
    ...(typeof reconstructed.generator === 'string' ? { generator: reconstructed.generator } : {}),
    ...(typeof reconstructed.httpServer === 'string' ? { httpServer: reconstructed.httpServer } : {}),
    ...(reconstructed.html instanceof Set ? { html: [...reconstructed.html].sort().join('') } : {}),
    ...(reconstructed.resourceOrigins instanceof Set ? { resourceOrigins: [...reconstructed.resourceOrigins].sort() } : {}),
    ...(record(reconstructed.responseHeaders) ? { responseHeaders: Object.fromEntries(Object.entries(record(reconstructed.responseHeaders) ?? {}).sort()) } : {}),
  });
  const rebuiltIds = analyzeWebsiteTechnology(input).findings.map((finding) => finding.id).sort();
  if (JSON.stringify(rebuiltIds) !== JSON.stringify(expectedIds)) {
    throw new TypeError(`Target-free reconstruction produced [${rebuiltIds.join(', ')}] instead of [${expectedIds.join(', ')}].`);
  }
  return Object.freeze({
    observedAt,
    expectedIds: Object.freeze(expectedIds),
    input,
  });
}

export function buildTechnologyReviewCandidate(
  document: SavedLookupDocument,
  options: CandidateOptions,
): UnknownRecord {
  if (document.mode !== 'deep') throw new TypeError('Technology review candidates require a saved Deep lookup.');
  const availability = record(document.availability);
  const reconstructed = reconstructTechnologyReviewProfile(
    availability?.technologyProfile,
    options.expectedIds,
  );
  const id = boundedText(options.id, 'Fixture id', 80).toLowerCase();
  if (!ID_RE.test(id)) throw new TypeError('Fixture id must be a lowercase hyphenated identifier.');
  if (!LICENCE_BASES.has(options.licenceBasis)) throw new TypeError('Licence basis is not supported.');
  return Object.freeze({
    schema: TECHNOLOGY_REVIEW_INPUT_SCHEMA,
    version: TECHNOLOGY_REVIEW_INPUT_VERSION,
    id,
    reviewedAt: timestamp(options.reviewedAt, 'Reviewed time'),
    observedAt: reconstructed.observedAt,
    licenseBasis: options.licenceBasis,
    expectedIds: reconstructed.expectedIds,
    negativeFor: Object.freeze([]),
    input: reconstructed.input,
  });
}

export function parseArguments(args: readonly string[]): CandidateArguments {
  const [inputPath, ...flags] = args;
  if (!inputPath || inputPath.startsWith('-')) {
    throw new TypeError('Usage: node tools/technology-review-candidate.mts LOOKUP.json --id=ID --expected=ID[,ID] --licence-basis=BASIS --reviewed-at=TIMESTAMP');
  }
  const values = new Map<string, string>();
  for (const flag of flags) {
    const match = /^--([a-z-]+)=(.*)$/u.exec(flag);
    if (!match?.[1] || values.has(match[1])) throw new TypeError(`Invalid or repeated option: ${flag}`);
    values.set(match[1], match[2] ?? '');
  }
  const allowed = new Set(['id', 'expected', 'licence-basis', 'reviewed-at']);
  const unknown = [...values.keys()].filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`Unknown option: --${unknown[0]}`);
  const licenceBasis = values.get('licence-basis');
  if (!LICENCE_BASES.has(licenceBasis as CandidateOptions['licenceBasis'])) {
    throw new TypeError(`Licence basis must be one of: ${TECHNOLOGY_REVIEW_LICENCE_BASES.join(', ')}.`);
  }
  return {
    inputPath,
    id: values.get('id') ?? '',
    expectedIds: (values.get('expected') ?? '').split(',').map((id) => id.trim()).filter(Boolean),
    licenceBasis: licenceBasis as CandidateOptions['licenceBasis'],
    reviewedAt: values.get('reviewed-at') ?? '',
  };
}

export async function main(
  args = process.argv.slice(2),
  output: WritableLike = process.stdout,
  errors: WritableLike = process.stderr,
): Promise<number> {
  try {
    const { inputPath, ...options } = parseArguments(args);
    const raw = await readFile(inputPath);
    if (!raw.byteLength || raw.byteLength > MAX_SAVED_LOOKUP_INPUT_BYTES) {
      throw new TypeError(`Saved lookup input must be between 1 byte and ${MAX_SAVED_LOOKUP_INPUT_BYTES} bytes.`);
    }
    const document = parseSavedLookupDocument(raw.toString('utf8'));
    output.write(`${JSON.stringify(buildTechnologyReviewCandidate(document, options), null, 2)}\n`);
    return 0;
  } catch (error) {
    errors.write(`${error instanceof Error ? error.message : 'Technology review candidate failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

export type { CandidateArguments, CandidateOptions, ReconstructedTechnologyReviewProfile };
