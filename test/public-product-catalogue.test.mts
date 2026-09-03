import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { CLI_COMMAND_REGISTRY } from '../cli/command-reference.mts';
import {
  INVESTIGATION_PLAN_RECIPES,
  buildWorkflowRecipeCatalogue,
} from '../cli/investigation-plan.mts';
import { registryStandardsCoverageSnapshot } from '../lib/registry-capabilities.mts';
import { CAPABILITY_MANIFEST } from '../packages/contracts/capability-manifest.mts';
import {
  CLI_PUBLIC_GUIDANCE,
  COVERAGE_DISTINCTIONS,
  METHODOLOGY_TOPICS,
} from '../packages/contracts/public-product.mts';
import {
  publicCliCatalogue,
  publicCoverage,
  publicExamples,
  publicMethodology,
  renderPublicCliCatalogueModule,
  renderPublicCliGuidanceModule,
  renderPublicCliIndexModule,
  renderPublicCoverageModule,
  renderPublicCoverageSummaryModule,
  renderPublicExamplesIndexModule,
  renderPublicExamplesModule,
  renderPublicMethodologyModule,
} from '../tools/public-product-catalogue-renderer.mts';
import {
  CANONICAL_TRAILING_SLASH_REDIRECTS,
  PRERENDERED_ROUTES,
  renderPublicRobots,
  renderPublicSitemap,
} from '../lib/prerendered-routes.mts';
import { WHOISLEUTH_SITE_ORIGIN } from '../lib/project-metadata.mts';
import { FRONTEND_ROUTE_GZIP_BUDGETS } from '../tools/frontend-loading-report.mts';

const GENERATED_DIRECTORY = new URL('../frontend/src/lib/generated/', import.meta.url);
const ROUTES_DIRECTORY = new URL('../frontend/src/routes/(public)/', import.meta.url);

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('public product catalogue', () => {
  test('projects all installed commands and fixed workflows from canonical metadata', () => {
    const catalogue = publicCliCatalogue();
    const workflows = buildWorkflowRecipeCatalogue();
    assert.equal(catalogue.commandCount, CLI_COMMAND_REGISTRY.length);
    assert.deepEqual(catalogue.commands.map((command) => command.id), CLI_COMMAND_REGISTRY.map((command) => command.command));
    assert.deepEqual(catalogue.workflows.recipes, workflows.recipes);
    assert.deepEqual(catalogue.workflows.limitations, workflows.limitations);
    assert.deepEqual(catalogue.workflows.recipes.map((recipe) => recipe.id), INVESTIGATION_PLAN_RECIPES);
    assert.equal(new Set(catalogue.workflows.recipes.map((recipe) => recipe.id)).size, catalogue.workflows.recipes.length);
    assert.ok(catalogue.workflows.recipes.some((recipe) => recipe.runnableByWorkflowRun));

    for (const [index, command] of catalogue.commands.entries()) {
      const definition = CLI_COMMAND_REGISTRY[index]!;
      assert.equal(command.group, definition.help.group);
      assert.equal(command.common, definition.documentation.common);
      assert.equal(command.networkEffect, definition.execution.networkEffect);
      assert.deepEqual(command.inputs, definition.grammar.positionals);
      assert.deepEqual(command.importantOptions, definition.completion.options);
      assert.deepEqual(command.supportedSchemaIdentifiers, definition.documentation.supportedSchemaIdentifiers);
      assert.deepEqual(command.outputFormats, definition.documentation.outputFormats);
      assert.deepEqual(command.primaryEvidenceArtefacts, definition.documentation.primaryEvidenceArtefacts);
    }
  });

  test('keeps methodology and coverage tied to canonical contract owners', () => {
    const methodology = publicMethodology();
    const coverage = publicCoverage();
    const registry = registryStandardsCoverageSnapshot();
    assert.deepEqual(methodology.topics, METHODOLOGY_TOPICS);
    assert.deepEqual(coverage.distinctions, COVERAGE_DISTINCTIONS);
    assert.equal(coverage.capabilities.length, CAPABILITY_MANIFEST.capabilities.length);
    assert.deepEqual(coverage.capabilities.map((item) => item.id), CAPABILITY_MANIFEST.capabilities.map((item) => item.id));
    assert.equal(coverage.summary.registrySnapshot.verifiedAt, registry.verifiedAt);
    assert.deepEqual(coverage.summary.registrySnapshot.counts, registry.counts);
    assert.equal(coverage.capabilities.every((item) => item.runtimeAvailability === 'not_evaluated_by_public_catalogue'), true);
  });

  test('builds deterministic, marked and target-safe examples through canonical builders', () => {
    const first = publicExamples();
    const second = publicExamples();
    assert.deepEqual(first, second);
    assert.equal(new Set(first.examples.map((example) => example.id)).size, first.examples.length);
    assert.ok(first.examples.some((example) => example.format === 'terminal'));
    assert.ok(first.examples.some((example) => example.format === 'JSON'));
    assert.equal(first.examples.every((example) => example.synthetic && (
      example.content.startsWith(example.notice)
      || (JSON.parse(example.content) as { synthetic?: unknown; notice?: unknown }).synthetic === true
    )), true);
    assert.equal(first.examples.every((example) => example.content.includes(example.notice)), true);
    assert.ok(first.examples.some((example) => example.large));
    const content = strings(first).join('\n');
    assert.match(content, /example\.test/u);
    assert.doesNotMatch(content, /192\.0\.2\.0\/24|AS64496/u);
    assert.match(content, /Offline evidence review[\s\S]*State  not found/u);
    assert.doesNotMatch(content, /(?:\/Users\/|\/home\/|[A-Z]:\\\\)/u);
    assert.doesNotMatch(content, /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/u);
    assert.doesNotMatch(content, /(?:^|[\r\n])(?:Cookie|Set-Cookie|Authorization):/iu);
    assert.doesNotMatch(content, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu);
    assert.equal(strings(first).every((value) => !/\b(?:com|net|org|io)\b/u.test(value) || value.includes('command')), true);
  });

  test('retains byte-exact generated frontend projections without browser execution imports', () => {
    const artifacts = [
      ['public-cli-catalogue.ts', renderPublicCliCatalogueModule()],
      ['public-cli-guidance.ts', renderPublicCliGuidanceModule()],
      ['public-cli-index.ts', renderPublicCliIndexModule()],
      ['public-coverage.ts', renderPublicCoverageModule()],
      ['public-coverage-summary.ts', renderPublicCoverageSummaryModule()],
      ['public-examples.ts', renderPublicExamplesModule()],
      ['public-examples-index.ts', renderPublicExamplesIndexModule()],
      ['public-methodology.ts', renderPublicMethodologyModule()],
    ] as const;
    for (const [name, expected] of artifacts) {
      const retained = readFileSync(new URL(name, GENERATED_DIRECTORY), 'utf8');
      assert.equal(retained, expected, name);
      assert.doesNotMatch(retained, /from ['"](?:node:|\.\.\/\.\.\/\.\.\/cli\/)/u, name);
    }
    assert.deepEqual(CLI_PUBLIC_GUIDANCE.commonWorkflows.map((item) => item.command).slice(-2), [
      'whoisleuth workflow-plan --explain evidence-handoff',
      'whoisleuth case-pack cases.json --audience public --reviewed --json',
    ]);
  });

  test('registers every public reference route, canonical redirect, sitemap URL and loading budget', () => {
    const routes = ['/cli', '/methodology', '/coverage', '/examples'] as const;
    const redirects = new Map(CANONICAL_TRAILING_SLASH_REDIRECTS);
    const robots = readFileSync(new URL('../frontend/static/robots.txt', import.meta.url), 'utf8');
    const sitemap = readFileSync(new URL('../frontend/static/sitemap.xml', import.meta.url), 'utf8');
    assert.equal(robots, renderPublicRobots());
    assert.equal(sitemap, renderPublicSitemap());
    for (const route of routes) {
      assert.ok(PRERENDERED_ROUTES.includes(route));
      assert.equal(redirects.get(`${route}/`), route);
      assert.equal(typeof FRONTEND_ROUTE_GZIP_BUDGETS[route], 'number');
      assert.ok(FRONTEND_ROUTE_GZIP_BUDGETS[route]! > 0);
      assert.ok(sitemap.includes(`<loc>${WHOISLEUTH_SITE_ORIGIN}${route}</loc>`));
    }
  });

  test('uses one top-level analyst-job vocabulary across public and console orientation', () => {
    const surfaces = ['./+page.svelte', '../(console)/dashboard/+page.svelte', './resources/+page.svelte'];
    for (const path of surfaces) {
      const source = readFileSync(new URL(path, ROUTES_DIRECTORY), 'utf8');
      assert.doesNotMatch(source, /PracticalWorkflow|Discover, Verify, Package, Recheck|practical loop/iu, path);
    }
    assert.deepEqual(METHODOLOGY_TOPICS.find((topic) => topic.id === 'jobs')?.states, ['investigate', 'respond', 'assure']);
  });
});
